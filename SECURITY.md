# Security Policy

## Supported versions

| Version | Status                                 |
| ------- | -------------------------------------- |
| 0.1     | Experimental. Fixes applied to `main`. |

OpenAuditModel v0.1 is **experimental and not production-ready**. There are no released production
SDKs, and no long-term support commitment.

## Reporting a vulnerability

**Do not open a public issue for a security report.**

Report privately through GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability). If that is unavailable to you, open a public issue containing
only a request for a private contact channel, with no technical detail.

Please include:

- What the issue is, and which component is affected — the schema, the CLI, the tests or the
  specification text.
- How to reproduce it, ideally as a minimal event document or command.
- What an attacker gains.
- Any suggested fix.

Expect an acknowledgement within a few working days. This is a young project maintained on a
best-effort basis; there is no commercial response commitment, and stating that plainly is more
useful than a target nobody can hold to.

Please give a reasonable period for a fix before public disclosure. Credit is given in the changelog
unless you prefer otherwise.

## What is in scope

- **The canonical schema.** A constraint that fails to reject what the specification says it rejects,
  or that rejects a conforming event.
- **The conformance tooling.** Anything that makes `auditmodel` report a valid result for an invalid
  event, or that allows a crafted input file to cause unsafe behaviour when validated.
- **The specification.** Guidance that would lead a correct implementation into an insecure or
  privacy-violating design. This is treated as a security issue, not a documentation issue.
- **Dependencies.** Vulnerable dependencies of the tooling.

## What is out of scope

- Vulnerabilities in your own application, storage system, SIEM or pipeline. This project ships no
  runtime.
- The observation that schema validation does not detect secrets in `metadata`. That is a documented
  and unavoidable limitation. See [specification/privacy.md](specification/privacy.md) §6.
- The observation that integrity metadata does not prevent deletion or provide storage immutability.
  Documented in [specification/integrity.md](specification/integrity.md) §6.
- Requests to add compliance certification, attestation or regulatory mappings.

## The remote MCP service

The project intends to operate a public, unauthenticated MCP endpoint at
`https://mcp.openauditmodel.org/mcp`. **It is not deployed yet**: nothing runs at that address and
the DNS record has not been created. The threat model below describes what that endpoint will be
when it is stood up, because it is the only component that would accept data from strangers.

**Never put a production audit event, a real credential or personal data into a public bug report,
a GitHub issue, or a reproduction fixture.** If a defect needs an event to reproduce, construct a
synthetic one; see [examples/privacy/README.md](examples/privacy/README.md) for how the project does
it. A reproduction case containing a real secret turns a bug report into a disclosure.

### What the service does and does not do

> MCP tool inputs are processed ephemerally by the OpenAuditModel MCP service. The service does
> not intentionally persist audit event content or include tool arguments in application logs.

> Users should review their organization’s data-handling requirements before submitting production
> audit events to a remote MCP service.

- **No persistence.** The container has no database, no volume and no writable application
  directory, and is designed to run with a read-only root filesystem. There is nowhere for submitted
  content to be stored, which is a stronger guarantee than a policy of not storing it.
- **No argument logging.** Application logs carry only a generated request identifier, the route,
  the tool name, a result category, a status code and a duration. No tool argument, event identifier,
  actor, resource, digest or finding is written to a log by application code.
- **Safe errors.** An unexpected failure is mapped to a category before it leaves the process, so no
  stack trace, internal path or quoted input reaches a client.
- **Output safety.** Findings carry rule identifiers and JSON Pointers, never the value that produced
  them, never a preview or prefix, and never a decoded token claim. Tests assert that no synthetic
  fixture secret appears in any response.
- **No model.** Nothing submitted is sent to an LLM; every tool is deterministic.
- **Read-only.** No tool has a side effect, and there is no write operation of any kind.
- **Offline.** The server fetches nothing, resolves no evidence reference and retrieves no URL found
  in an event.

**It is a remote service.** Content you submit leaves your machine. The project does not claim
otherwise, and users handling regulated audit data should use the CLI, which never sends anything
anywhere.

### Boundary controls

- **Origin validation.** A request with no `Origin` is accepted, since every non-browser MCP client
  omits it. A present but disallowed `Origin` is refused with 403. Localhost origins are accepted
  only when the deployment does not declare itself production.
- **Input limits.** Request body 1,000,000 bytes; single event 256,000 bytes; 200 events per
  `verify_chain`; JSON depth 200; output 512,000 bytes. Exceeding a limit is refused, never silently
  truncated.
- **No path resolution.** A resource URI matches a build-time allowlist exactly or is not found.
- **No runtime code generation.** The schema validator is precompiled, and CI fails if the deployed
  bundle contains `new Function` or `node:fs`.

### Container hardening

The runtime image runs as the non-root `node` user, is designed for a read-only root filesystem,
and the example deployment drops all Linux capabilities and sets `no-new-privileges`. It mounts no
host directory and never the Docker socket. TLS is terminated by a reverse proxy, so the certificate
private key never enters the process that parses caller-supplied audit events.

An operator must configure the **proxy** not to log request bodies; the application cannot enforce
that. See [deploy/README.md](deploy/README.md).

### Authentication

The v0.1 alpha is public and unauthenticated. That is defensible only because every tool is
read-only, there is no account, no write operation, no persistence and no private server-side
resource. It stops being defensible the moment any of those changes, and MCP registration is kept
separate from transport so that OAuth can be added at the HTTP boundary without touching a tool.

Rate limiting is a zone-level concern (reverse-proxy or edge rate limiting) and is
deliberately not an in-process counter, which would be ineffective across replicas.

### Known dependency advisories

`npm audit` reports one advisory that has no available fix, and it is recorded here rather than
suppressed:

> **GHSA-frvp-7c67-39w9** — path traversal in `serve-static` on Windows via an encoded backslash, in
> `@hono/node-server` below 2.0.5. It reaches this project as a transitive dependency of
> `@modelcontextprotocol/node`, which declares `^1.19.9`.

It is not reachable here. `@modelcontextprotocol/node` imports exactly one symbol,
`getRequestListener`, to adapt between `node:http` and Web Standard requests; the `serve-static`
entry point ships in the package but is never imported, this server serves no static files, and the
runtime image runs Linux while the advisory is Windows-specific.

Forcing the dependency to 2.x was tried and rejected: it is a major version the MCP maintainers have
not declared support for, and taking an untested bump in the layer that adapts every request is a
larger risk than an advisory in code that is never loaded. Revisit when
`@modelcontextprotocol/node` widens its range.

## Security-relevant properties of this repository

Worth knowing when assessing the project:

- **Offline by design.** Validation resolves no remote references and makes no network calls. The
  test suite requires no network access.
- **One runtime service, narrowly scoped.** The MCP server in [mcp/](mcp/) is the only deployable
  component. It has no database, no user interface, no account and no write operation; everything
  else here is a specification, a schema or an offline command line tool with no deployed attack
  surface.
- **Regular expression portability.** Schema patterns use no look-around and no back-references, which
  keeps behaviour identical across engines and avoids the catastrophic backtracking classes that
  cause denial of service in some validators. This is enforced by a test.
- **Bounded inputs.** String lengths and array sizes are bounded in the schema, so a validator is not
  asked to process an unbounded document as if it were conforming.
- **Strict core objects.** Unknown properties in core objects are rejected rather than silently
  accepted.

## Handling audit data safely

If you are implementing this specification, the security-relevant guidance is concentrated in:

- [specification/privacy.md](specification/privacy.md) — values that must never be recorded, the
  allowlist capture model, and why validation cannot enforce it.
- [specification/integrity.md](specification/integrity.md) — what tamper-evidence does and does not
  give you.
- [specification/delivery.md](specification/delivery.md) — duplication, loss and what pipeline
  components must not modify.

Audit data concentrates who did what to whom, is usually retained longer than production data, and is
frequently readable by more people than the data it describes. Treat the store accordingly.
