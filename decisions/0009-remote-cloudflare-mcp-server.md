# 0009 — Remote Cloudflare MCP server

## Status

**Superseded by [ADR 0011](0011-self-hosted-docker-mcp-server.md)** — 2026-07-30. Retained as
historical context.

The deployment decisions here (Cloudflare Workers, the `agents` SDK, Wrangler) no longer apply: the
Worker was implemented and tested but never deployed, and the project now self-hosts a container
image instead. The reasoning about remote-first distribution, statelessness, running no model in the
server, delegating to the existing engines, not persisting event content and deferring authentication
is unchanged and carried forward into ADR 0011.

Originally accepted — 2026-07-30. Applies to specification version 0.1.

The Worker is implemented and tested in this repository. It has **not** been deployed, and the custom
domain has not been attached or verified.

## Context

OpenAuditModel is a specification with a conformance toolchain: schema validation, RFC 8785 integrity
and chain verification, deterministic privacy linting, and declarative profile conformance. All of it
runs offline, in a CLI, for someone who has already cloned the repository.

The people who most need it are instrumenting an application, usually with a coding agent, and have
not cloned anything. They are choosing an event name, deciding whether the account being disabled is
an `actor` or a `resource`, and about to put a request body into `metadata`. The specification answers
all of that and none of it is reachable from where the work happens.

MCP is the mechanism that closes the gap. The question this decision answers is what shape the first
MCP server takes.

## Decision

### 1. Remote-only, with no local stdio distribution

The first MCP server is a hosted HTTP endpoint. No npm package, no stdio binary, no local install.

A local stdio server is in several respects the safer design — the user's audit events never leave
their machine — and it is deliberately not what ships first, because it does not solve the problem.
A local server requires the user to install Node, install a package, keep it updated, and know it
exists. That is the same barrier as cloning the repository, which is the barrier this is meant to
remove. Adoption of a standard depends on being reachable by someone who has not yet decided to
adopt it.

Remote-only also has one honest advantage: there is a single deployed version. A local package
fragments into whatever versions people installed, and a conformance verdict that varies by installed
version is worse than one that is centrally wrong.

The cost is real and is stated rather than minimised: **audit event content leaves the user's
machine**. See Privacy considerations.

### 2. Streamable HTTP

The transport is MCP Streamable HTTP at `/mcp`. Not SSE, which is deprecated for this purpose, and
not a bespoke protocol.

Streamable HTTP is what a remote MCP server is expected to speak, it works through ordinary HTTP
infrastructure, and it needs no persistent connection — which is what makes the stateless design in
decision 4 possible.

### 3. Cloudflare Workers

Cloudflare Workers, via the `agents` SDK's `createMcpHandler`.

The workload is a pure function of its input: parse, analyse, return. It has no state, no storage, no
outbound call and no long-running work. That is the shape a Worker is for. The alternative — a
container or a virtual machine — would mean operating a server, patching it, and paying for it while
idle, in exchange for capabilities this workload does not use.

`createMcpHandler` is the stateless handler, imported from `agents/mcp/server` rather than the
broader `agents/mcp` entry point, which pulls in Durable Object machinery this server does not want.
The deprecated `McpAgent` architecture is not used.

### 4. Stateless

A server instance is constructed per request and discarded. There is no session, no Durable Object,
no KV, no R2, no D1 and no queue binding.

Statelessness is a **privacy control**, not only an architectural preference. A service with nowhere
to write cannot accidentally retain a caller's audit event: no cache to leak, no session to
reconstruct, no storage to be subpoenaed or misconfigured. The absence of a binding is a stronger
guarantee than a policy of not using one.

It also matches MCP's stateless mode exactly, so nothing is lost.

### 5. No model runs inside the Worker

The server calls no LLM and contains none. Every tool is deterministic: the same event always
produces the same result.

Two reasons. A conformance verdict must be reproducible — an audit tool that answers differently on
Tuesday is not a conformance tool. And an LLM inside the server would mean sending the caller's audit
event to a third-party model provider, which is precisely the disclosure the data-handling statement
promises does not happen.

The three prompts return **text**. The connected agent does the reasoning, on the user's side of the
boundary, under the user's existing agreement with whichever model they already chose.

### 6. Tools delegate to the existing engines

Every tool is an adapter. `validate_event` calls the same validator, `lint_privacy` the same linter,
`check_profile` the same profile engine.

Reimplementing them for the Worker would create two definitions of conformance that would drift, and
the drift would be silent: an event that the CLI rejects and the MCP server accepts is a bug nobody
notices until it is embedded in stored audit data. Parity is asserted by tests that run both paths
over the published fixtures and compare results, so a divergence fails the build.

This is why the previous phase removed the filesystem coupling from the engines rather than forking
them.

### 7. Resources are bundled at build time

The nineteen exposed documents are compiled into a generated TypeScript module from an **allowlist**.
The Worker reads no file and fetches nothing.

Workers have no ordinary filesystem, so bundling is partly forced. The allowlist is the deliberate
part: nothing is discovered by walking a directory. A public endpoint that served whatever was in the
repository would eventually serve a test fixture full of synthetic secrets, a CI configuration, or a
development script — not through a vulnerability, but because somebody added a file. Adding a
resource is a reviewable change to a named list.

Fetching from `openauditmodel.org` or GitHub at runtime was rejected: it would make the MCP server
depend on the website being up, introduce a network call into a service that otherwise makes none,
and create a path where the served content differs from the deployed version.

### 8. Ajv is precompiled

Cloudflare Workers forbid runtime dynamic code generation, and Ajv compiles schemas with
`new Function`. The canonical schema is therefore compiled ahead of time with Ajv's standalone
generator, and the result is passed into the existing `createValidatorFromCompiled` seam.

The alternative was a different validator that runs in Workers. Rejected: a second validator is a
second opinion about what conforms, and the difference would appear on exactly the edge cases that
matter. Ajv's standalone output **is** Ajv's compiled logic, so the Worker's verdict is identical
rather than similar — a property the parity tests confirm across every fixture in the repository.

Two details follow from it. Ajv's `esm: true` output still uses CJS `require` for its runtime
helpers, which the generator rewrites into real imports. And the validator interface was split into a
module that does not import Ajv at all, so the compiler is not merely unused in the bundle but
absent from it — a bundle containing `new Function` would ship the prohibited construct as dead code
and make the property unverifiable by inspection.

### 9. Event content is not persisted

No binding stores it, no application code logs it, and no error message quotes it.

Logging is the part that needs stating, because it is where this normally goes wrong. The Worker adds
no request logging. An unexpected exception is mapped to a category before it leaves the process: an
error message may quote the value that caused it, and a stack trace names internal paths. Findings
already carry JSON Pointers and rule identifiers rather than values, which is a property of the
engines, and the tests assert that no synthetic fixture secret appears in any response.

### 10. Authentication is deferred

The alpha is public and unauthenticated.

This is defensible only because of what the server is: every tool is read-only, there is no user
account, no write operation, no persistence, and no private server-side resource. There is nothing to
authorise, because there is nothing a caller can reach that another caller could not.

It would not be defensible for anything that stored data, and it stops being defensible the moment
one of those properties changes. Registration is kept separate from transport specifically so that
OAuth can wrap the HTTP boundary later without touching a single tool implementation.

Abuse protection is deliberately not an in-memory rate limiter: a Worker isolate is per-request, so a
counter in process memory is both ineffective and misleading. Rate limiting belongs at the zone level.

## Consequences

**Positive**

- The specification is reachable from where instrumentation is written, without cloning anything.
- One deployed version, so conformance answers do not vary by what someone installed.
- The engines are exercised by a second consumer, which is what surfaced the last of their
  filesystem coupling.
- Statelessness makes the privacy guarantee structural rather than procedural.
- The bundle provably contains no code generation and no filesystem access, checked in CI.

**Negative**

- **Audit event content leaves the user's machine.** This is the central trade-off, and no
  architecture choice inside the Worker removes it.
- Availability now matters. A specification that was a file in a repository now has an endpoint that
  can be down.
- The project takes on operating a public service: abuse, cost, and a deployment to keep current.
- No offline use. An air-gapped user gets the CLI and nothing else.
- Unauthenticated means anyone can consume capacity.
- The Worker and the CLI can drift despite the parity tests, because the tests cover representative
  fixtures rather than every input.

**Neutral**

- The Worker is a private workspace package. It is not published to npm and has no binary.

## Alternatives considered

**Ship a local stdio server first.** Rejected as the _first_ release; see decision 1. It remains the
right answer for users who cannot send audit content to a third party, and it is not precluded.

**Publish an npm package that runs an HTTP server locally.** Rejected: it has the installation
barrier of stdio and the operational surface of a server, with the advantages of neither.

**Use a container or virtual machine.** Rejected; see decision 3.

**Use `McpAgent` with Durable Objects for sessions.** Rejected. Sessions would mean per-user state,
which means storage, which is exactly what decision 4 removes. Nothing this server does needs to
remember a previous request.

**Fetch resources from the website at runtime.** Rejected; see decision 7.

**Use a Workers-compatible validator instead of precompiling Ajv.** Rejected; see decision 8.

**Add an eighth tool that rewrites or redacts an event.** Rejected, and not merely out of scope: the
fix for a secret in an audit record is to change the instrumentation that produced it and rotate the
credential, not to rewrite the record. A tool that edited audit events would be a tool for destroying
audit trails.

## Security considerations

- **No code is executed from input.** Tools parse JSON and run deterministic analysis. There is no
  expression evaluation and, after precompilation, no code generation anywhere in the bundle.
- **Origin and Host validation are the SDK's**, configured rather than hand-written, because a
  hand-rolled URL check disagrees with a real parser exactly on the inputs an attacker chooses. A
  missing `Origin` is accepted, since every non-browser MCP client omits it; a present but disallowed
  one is refused with 403. Localhost is allowed only when the deployment does not declare itself
  production.
- **Input is bounded** by request body size, event size, event count, JSON depth and output size.
  Exceeding a limit is refused, never truncated.
- **No path resolution.** A resource URI matches an allowlist entry exactly or it is not found. There
  is no filesystem to traverse.
- **Errors are categorised before leaving the process**, so no stack trace, internal path or quoted
  input reaches a client.
- **No outbound network access.** Nothing is fetched, no evidence reference is resolved, no URL in an
  event is retrieved.
- **Unauthenticated by design, narrowly.** Read-only, no accounts, no writes, no persistence.
- **Unresolved:** the endpoint is open to anyone. Cost and capacity abuse are mitigated at the zone
  level, outside this repository, and that mitigation is not verifiable from here.

## Privacy considerations

> MCP tool inputs are processed ephemerally by the OpenAuditModel Cloudflare Worker. The service does
> not intentionally persist audit event content or include tool arguments in application logs.

> Users should review their organization's data-handling requirements before submitting production
> audit events to a remote MCP service.

The wording is deliberate. "Does not intentionally persist" is what can honestly be claimed: the
Worker has no storage binding and writes no logs of its own, but it runs on infrastructure the
project does not operate, and platform-level request metadata exists regardless.

What must **not** be claimed, and is not claimed anywhere in this repository, is that events stay on
the user's machine. They do not. Users handling regulated audit data should assume the CLI is the
appropriate tool and this service is for design and review of examples.

Findings never carry the value that produced them — a property inherited from the engines and
asserted by tests over the synthetic privacy fixtures.

## Compatibility considerations

- The MCP dependency versions are pinned by `agents@0.20.1` and are not selected independently.
  Upgrading `agents` may move the MCP protocol packages with it.
- Tool names, resource URIs and prompt names are a public interface. Renaming one breaks connected
  agents, and is a breaking change even though nothing in the specification changed.
- The Worker version tracks the repository version, so a conformance answer can be attributed to a
  release.
- Resources are served from a build-time snapshot: a specification change reaches the endpoint only
  when the Worker is redeployed. CI fails on a stale manifest so the two cannot silently diverge.
- `check_profile` exposes only `identity-and-access-management`. Placeholder profiles are not
  enforceable and are not offered, so a caller cannot mistake intent for a rule.

## Deployment considerations

- Deployment runs from the default branch or a manual dispatch, never from a pull request, which
  could come from a fork and would hold a Cloudflare token.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are repository secrets. No account identifier or
  token appears in the repository, including in `wrangler.jsonc`.
- The workflow regenerates and verifies both generated artifacts, runs every test, dry-runs the
  build, and greps the bundle for `new Function` and `node:fs` before deploying.
- The canonical endpoint is the custom domain. The `workers.dev` address is for deployment
  verification and is not documented as the public endpoint.
- **The custom domain has not been attached or tested from this repository.** Until it has, the
  documented endpoint is an intention rather than a live service, and is described that way.
