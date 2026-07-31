# 0011 — Self-hosted Docker MCP server

## Status

Accepted — 2026-07-30. Applies to specification version 0.1.

**Supersedes [ADR 0009](0009-remote-cloudflare-mcp-server.md)** in its deployment decisions
(Cloudflare Workers, the `agents` SDK, Wrangler). ADR 0009 is retained as historical context and
marked superseded; its reasoning about _remote-first distribution_, _statelessness_, _no LLM in the
server_, _delegating to the existing engines_, _not persisting event content_ and _deferring
authentication_ is unchanged and is carried forward here.

## Context

ADR 0009 shipped the MCP server as a Cloudflare Worker. It was implemented, tested and dry-run, but
never deployed: the custom domain was never attached, and the endpoint was documented as an intention
rather than a live service.

The deployment strategy has changed. The project will host the MCP server on infrastructure the owner
controls rather than on Cloudflare's platform.

Nothing about the _server's behaviour_ motivated the change, which matters for what had to be
rewritten. The tools, prompts, resources, output-safety rules and engine delegation were correct and
are kept. What changed is where the process runs and what wraps it.

## Decision

### 1. Cloudflare Workers deployment is abandoned

The Worker deployment path is removed: `wrangler.jsonc`, the Cloudflare deploy workflow, the
`agents` dependency and the Worker-only entry point.

The Worker was a good fit technically — the workload is a pure function of its input, which is what
Workers are for — but it bound the project to one vendor's platform, one vendor's SDK wrapper around
MCP, and one vendor's account for the canonical endpoint. For a specification whose entire argument
is backend and vendor independence ([ADR 0003](0003-backend-and-transport-independence.md)), hosting
the reference service in a way that could only run on one provider was an uncomfortable fit that the
change in strategy resolves.

The practical trigger was ownership: the project owner wants the service on infrastructure they
control. Because the Worker had never been deployed, abandoning it cost nothing operationally.

### 2. Self-hosting, with Docker as the deployment unit

**Docker is the deployment unit.** The image is built with the standard Docker build process on
whichever daemon will run it, and **deployment is performed with Docker Compose** —
`deploy/docker-compose.yml` is the deployment description, not merely an example of one. Compose
rather than a bare `docker run` because the hardening this service depends on — read-only root
filesystem, dropped capabilities, `no-new-privileges`, loopback-only port binding, the health check,
the shutdown grace period — is a long list that must be identical on every start, and a file that is
reviewed in version control is a better place for it than a command someone retypes.

A container is the portable form of "a process and its dependencies". It runs on the owner's server,
on a different provider next year, or on a contributor's laptop, with the same behaviour — which is
the property the Worker deployment did not have. It also makes the service reproducible by anyone who
wants to verify what the public endpoint is running, or run their own because they will not send
audit events to someone else's.

That last point is the substantive gain over the Worker. ADR 0009's central negative was that audit
event content leaves the user's machine, and it had no answer beyond "use the CLI". A Dockerfile in
the repository gives an organization a third option: build the image and run the MCP server inside
their own network, where the data never leaves.

### 3. Streamable HTTP is unchanged

The transport is exactly what it was. Only the host changed.

MCP Streamable HTTP is transport-independent of the runtime, so the protocol decision from ADR 0009
survives the platform change untouched — which is the point of choosing a standard transport rather
than a platform's own.

### 4. Node.js, with the official MCP packages

Node 24 with `@modelcontextprotocol/server` and `@modelcontextprotocol/node`. The Cloudflare `agents`
wrapper is gone; `createMcpHandler` now comes from the official server package, and `toNodeHandler`
from the official node package adapts it to `node:http`.

Node because the engines are already TypeScript running on Node in the CLI, so the server and the
command line tool execute _the same code_ — which is what makes the parity tests meaningful rather
than aspirational. A different runtime would have meant a second implementation and the drift that
follows.

Plain `node:http`, not Express. The surface is four routes. A framework would add dependencies and
middleware behaviour to a service whose security argument is that very little happens between the
socket and the deterministic engines.

### 5. Stateless operation is retained

No session, no database, no cache, no storage of any kind. A fresh MCP server instance per request.

Unchanged from ADR 0009, and for the same reason: statelessness is a **privacy control**, not only an
architectural preference. A service with nowhere to write cannot accidentally retain a caller's audit
event. Self-hosting does not weaken that — it strengthens the claim, because the operator can verify
it by inspecting a container that has no volume, no database and a read-only filesystem.

### 6. TLS is terminated by a reverse proxy

The container speaks plain HTTP on port 3000. Nginx, Traefik or Caddy holds the certificate.

Certificate lifecycle — issuance, renewal, rotation, OCSP — is an operational concern that changes far
more often than this application, and proxies solve it well. Keeping it outside also means the
private key never enters the process that parses caller-supplied audit event content, which is the
process most exposed to malformed input.

The container therefore manages no certificate, no DNS record and no domain. It listens on a port.

### 7. The server stores nothing

No database, no volume, no writable application directory, no temporary files, no request-body logs.
The image is designed to run with a read-only root filesystem.

The logging allowlist is the part that needs stating, because it is where this normally goes wrong: a
log line may carry a generated request identifier, the route, the tool name, a result category, a
status code and a duration. There is no parameter through which a request body, an event identifier,
an actor, a resource, a digest or a privacy finding could be passed to the logger. `toolName` is
included deliberately — it is one of seven published names and says which analysis ran, revealing
nothing about the caller's data — while an _event_ name is excluded, because that would describe the
caller's business operations.

### 8. The precompiled validator remains

Ajv's standalone output is kept, even though Node permits runtime compilation.

The original reason was that Workers forbid `new Function`, and that constraint is gone. Two better
reasons survive it. The generated module is Ajv's own compiled logic for the canonical schema, so the
server's verdict is identical to the CLI's by construction rather than by coincidence — a property
the parity tests check and would be weaker if each side compiled independently. And compiling at
startup would mean the schema is a runtime input, which invites the idea that it could be fetched or
swapped; precompiling makes it a build artifact, verified stale-or-current by CI.

Removing it would have been a change with no benefit and a real loss, so it stays.

### 9. No image registry

**The project does not require an image registry.** The image is built with the standard Docker build
process on the host that runs it, and deployment is `docker compose up`. Nothing is pushed and
nothing is pulled.

`openauditmodel-mcp:local` is the default tag for development and deployment. A release is a
versioned local tag such as `openauditmodel-mcp:0.1.0-alpha.1`, which is also what makes rollback
possible: tag a build before replacing it and it stays addressable. `latest` is never used — an
unqualified `latest` invites production use of a moving target, and for a locally built image it
would also be ambiguous about which build produced it.

A registry earns its complexity when an image must move between the machine that built it and the
machines that run it. That is not the situation: there is one deployment, its operator has the source,
and `docker build` is fast enough that building on the target is simpler than distributing to it.
Adding a registry would mean an account, an authentication path, a publish workflow holding a
credential, and tag-versus-source drift — all to solve a distribution problem the project does not
have.

Building on the target also makes the running service trivially traceable to a working tree, which
is the property the registry's provenance attestation was there to provide.

Registry publishing may be reconsidered if the project ever needs to distribute prebuilt images to
operators who are not building from source. That is outside this decision.

## Consequences

**Positive**

- The service runs anywhere a container runs, including inside an organization's own network, which
  answers ADR 0009's central privacy negative for those who need it.
- The CLI and the server execute the same engine code on the same runtime.
- No vendor SDK sits between the project and MCP; the official packages are used directly.
- Container hardening — non-root, read-only root filesystem, all capabilities dropped, no host
  mounts, no Docker socket — is inspectable by an operator rather than asserted by the project.
- No registry account, no publish credential and no image distribution to secure. What runs is built
  from a working tree the operator already has.

**Negative**

- **The project now operates a server.** Patching, monitoring, capacity and uptime become real work
  that the Worker platform would have absorbed.
- No global edge network. Latency is whatever the single origin gives.
- A reverse proxy and a TLS certificate are now prerequisites, and both are the operator's
  responsibility rather than a platform feature.
- The image must be rebuilt and redeployed for a specification change to reach the endpoint, exactly
  as the Worker had to be — but now the redeploy is a manual operational step.
- **Every deployment host needs a build toolchain and must build for itself.** With one deployment
  that is a simplification; with several it would become duplicated work and a way for hosts to drift
  onto different builds. That is the point at which a registry becomes worth its cost.
- No published SBOM or provenance attestation, because there is no published artifact to attach one
  to. An operator who needs either can generate it from the image they built.
- Two months of Worker-specific work is discarded. The tools, prompts, resources, engines and
  generated artifacts were reused; the deployment layer was not.

**Neutral**

- The container is a private workspace package, not published to npm, and there is still no local
  stdio distribution.

## Alternatives considered

**Keep the Cloudflare Worker and self-host in parallel.** Rejected explicitly: two production MCP
implementations means two behaviours to keep in step, and the one that is not being exercised drifts
silently. The task of maintaining parity between them would exceed the value of having both.

**Deploy to another serverless platform.** Rejected: it would repeat the original problem with a
different vendor's name on it.

**Ship a plain Node process without a container.** Rejected: dependency versions, the Node version
and the generated artifacts would become properties of whatever the host happened to have installed.
A container makes the runtime part of the artifact.

**Terminate TLS inside the application.** Rejected; see decision 6.

**Use Alpine for a smaller image.** Rejected: nothing here needs musl, and a smaller image bought
with a less-tested libc is a poor trade for a service whose only job is to be correct. Debian slim
with the official Node image is the safer default; Alpine remains available if a dependency ever
proves it needs it.

**Drop the precompiled validator now that Node allows compilation.** Rejected; see decision 8.

**Publish images to a container registry (GHCR or Docker Hub).** Rejected for now; see decision 9. It
was implemented first, with multi-platform builds, an SBOM and provenance attestation, then removed:
it was infrastructure for distributing an image that has nowhere to be distributed to. The
registry-shaped question worth returning to is not "which registry" but "is the image moving between
machines yet".

## Security considerations

- **Non-root.** The process runs as the image's `node` user. A service that only parses JSON has no
  reason to be able to write anywhere.
- **Read-only root filesystem**, all Linux capabilities dropped, `no-new-privileges`, no host mount,
  no Docker socket, no privileged mode.
- **Origin validation** compares the _parsed_ origin against a configured allowlist, so
  `https://openauditmodel.org.evil.example` cannot pass by prefix. A missing `Origin` is accepted —
  every non-browser MCP client omits it — and a present but unlisted one is refused with 403. A
  wildcard entry fails startup rather than being accepted and discouraged.
- **Host validation** is available and consults `X-Forwarded-Host` **only** when the deployment
  declares itself behind a trusted proxy. Believing a forwarded header by default would let any client
  assert any host and defeat the check.
- **Request limits** are enforced while reading the body, so an oversized request is refused before it
  is buffered, not after.
- **Safe errors.** No stack trace, internal path or quoted input reaches a client; an unexpected
  failure is mapped to a category first.
- **No outbound network access**, no evidence reference resolution, no URL retrieval, no model call.
- **Graceful shutdown** on SIGTERM and SIGINT with a bounded grace period, so in-flight requests
  finish instead of being cut off by SIGKILL.
- **Unauthenticated**, narrowly: read-only, no accounts, no writes, no persistence. Rate limiting is
  a proxy concern and is deliberately not an in-process counter, which would be ineffective across
  replicas.
- **Unresolved:** the endpoint is open to anyone who can reach it. Edge rate limiting must be in place
  before public exposure, and that is an operational step this repository cannot verify.

## Privacy considerations

> MCP tool inputs are processed ephemerally by the OpenAuditModel MCP service. The service does not
> intentionally persist audit event content or include tool arguments in application logs.

> Users should review their organization's data-handling requirements before submitting production
> audit events to a remote MCP service.

Self-hosting changes who holds the data, not whether it travels. Content submitted to the public
endpoint still leaves the user's machine and is processed on the project's infrastructure. The honest
improvement is that an organization can now run the same image themselves and keep the data inside
their own network — an option the Worker never offered.

The proxy is outside the application's control, and an operator must configure it not to log request
bodies. The application cannot enforce that.

## Compatibility considerations

- **No MCP behaviour changed.** The same seven tools, three prompts and nineteen resources, with the
  same names, URIs and result shapes. A connected client cannot tell the platform changed.
- The endpoint URL is unchanged: `https://mcp.openauditmodel.org/mcp`.
- Tool names, resource URIs and prompt names remain a public interface; renaming one breaks connected
  agents and is a breaking change regardless of the specification.
- Resources are still a build-time snapshot, so a specification change reaches the endpoint only on
  redeploy. CI fails on a stale manifest so the two cannot silently diverge.
- Image tags are local and explicit. `latest` is never used.

## Deployment considerations

- The image is built with `docker build --tag openauditmodel-mcp:local --file Dockerfile .` on the
  host that will run it, and started with `docker compose -f deploy/docker-compose.yml up -d`.
- **Nothing is published.** CI builds an ephemeral image, tests it and discards it; there is no
  registry login, push, pull or credential anywhere in the repository.
- The image is built for the architecture of the host that builds it, which is the only architecture
  that host needs.
- `mcp.openauditmodel.org` must resolve to the reverse proxy, not the container. No IP address is
  recorded in this repository.
- The server is stateless, so an update is rebuild-and-recreate and a rollback is pointing Compose at
  a previously tagged build. Neither carries a data compatibility question, because there is no data.
- Because the image is local, a rollback target exists only if it was tagged before being replaced.
  `docker image prune -a` removes untagged builds, so an untagged previous version is unrecoverable
  except by rebuilding from the corresponding commit.
- **Not yet deployed.** The image builds are defined and the compose and proxy examples are written,
  but no deployment has been performed and the endpoint is not live. It is described as an intention
  until it has been stood up and tested.
