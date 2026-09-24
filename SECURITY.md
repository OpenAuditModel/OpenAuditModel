# Security Policy

## Supported versions

| Version | Status                                                                     |
| ------- | -------------------------------------------------------------------------- |
| 1.0.x   | Current release (conformance CLI and MCP server). Fixes applied to `main`. |
| 0.6.x   | Superseded. No fixes; upgrade to the current release.                      |
| 0.5.x   | Superseded. No fixes; upgrade to the current release.                      |
| 0.4.x   | Superseded. No fixes; upgrade to the current release.                      |
| 0.3.x   | Superseded. No fixes; upgrade to the current release.                      |
| 0.2.x   | Superseded. No fixes; upgrade to the current release.                      |
| 0.1.x   | Superseded. No fixes; upgrade to the current release.                      |

The repository version above is the tooling release. The **specification** version is `1.0`, stable
from this release; the tooling also reads events written under `0.1`.

**What receives fixes.** Only the newest release. A fix lands on `main` and ships in the next release,
which is a patch if the fix is all it contains. There is no backport to an earlier minor, and none is
needed to stay on 1.x: every 1.x release reads every event the one before it did, under the
compatibility rules of [ADR 0017](decisions/0017-versioning-and-compatibility.md), so upgrading
within 1.x never requires changing an event. A security fix is released as soon as it is ready, not
held for a scheduled release.

**What does not.** Every 0.x release. The 0.x line is closed; its events are still read by 1.x, so
moving to 1.x is the upgrade. There are no released production SDKs, and no long-term support
commitment beyond the above.

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

The project operates a public, unauthenticated MCP endpoint at
`https://mcp.openauditmodel.org/mcp`. The threat model below describes that endpoint, because it is
the only component that accepts data from strangers.

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
- **No argument logging.** A request's log line carries only a generated request identifier, the
  route that answered it (`/`, `/health`, `/mcp`, or `other` for anything else, never the path the
  caller sent), a result category, a status code and a duration. No tool name, tool argument, event
  identifier, actor, resource, digest or finding is written to a log by application code.
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
  omits it. A present `Origin` that `OAM_ALLOWED_ORIGINS` does not list is refused with 403, and that
  includes `localhost` and `127.0.0.1` origins. The service sends no CORS headers on any route, and
  answers `OPTIONS /mcp` with 405, so a browser cannot complete a preflighted request to it from any
  origin: the endpoint serves MCP clients, not web pages.
- **Host validation.** A `Host` that `OAM_ALLOWED_HOSTS` does not list is refused with 403.
  `X-Forwarded-Host` is believed only with `OAM_TRUST_PROXY=true`, which the example deployment leaves
  off. Host validation defends against DNS rebinding. It does not keep out a client that reaches the
  server directly, which writes its own `Host`; the network does that, through a tunnel or a
  firewall. See [deploy/README.md](deploy/README.md#behind-cloudflare).
- **One message per request.** A JSON-RPC batch is refused with 400. The body limit bounds a batch's
  size but not the work it asks for: before 1.0.0, one body under the limit held thousands of
  resource reads and drew a response of over a hundred megabytes.
- **Input limits.** Request body 1,000,000 bytes; single event 256,000 bytes; 200 events per
  `verify_chain`; JSON depth 200; output 512,000 bytes. Exceeding a limit is refused, never silently
  truncated.
- **No path resolution.** A resource URI matches a build-time allowlist exactly or is not found.
- **No runtime code generation.** The schema validators are precompiled: one per specification
  version, and one each for the checkpoint and proof formats. A test fails if a tool or resource
  module, or any generated validator, contains `new Function`, or if a tool or resource module
  imports `node:fs`. The test reads the source, not a
  built bundle, so it does not cover code a dependency might generate at runtime.

### Container hardening

The runtime image runs as the non-root `node` user, is designed for a read-only root filesystem,
and the example deployment drops all Linux capabilities and sets `no-new-privileges`. It mounts no
host directory and never the Docker socket. TLS is terminated by a reverse proxy, so the certificate
private key never enters the process that parses caller-supplied audit events.

An operator must configure the **proxy** not to log request bodies; the application cannot enforce
that. See [deploy/README.md](deploy/README.md).

### Authentication

The hosted service is public and unauthenticated. That is defensible only because every tool is
read-only, there is no account, no write operation, no persistence and no private server-side
resource. It stops being defensible the moment any of those changes, and MCP registration is kept
separate from transport so that OAuth can be added at the HTTP boundary without touching a tool.

Rate limiting is a zone-level concern (reverse-proxy or edge rate limiting) and is
deliberately not an in-process counter, which would be ineffective across replicas.

### Known dependency advisories

`npm audit` reports no advisory against the dependency tree 1.0.0 ships, including the one recorded
for 0.6 (GHSA-frvp-7c67-39w9, in `@hono/node-server`). An advisory that has no fix is recorded here
rather than suppressed.

## Security review for 1.0

Before 1.0.0, the CLI's input handling and the MCP server's HTTP boundary were reviewed. What was
found is fixed in 1.0.0, and the items that are the maintainer's to act on are listed below.

**Fixed in 1.0.0:**

- A forged Ed25519 signature was accepted: under a small-order public key such as the identity
  point, a signature verifies for any message, and some OpenSSL builds check neither the key nor `R`. A
  small-order key is now refused when it is loaded, and a small-order `R` when a signature is
  checked.
- An RSA key with an exponent of 1 was accepted, and a "signature" made from the message alone
  verified under it. An RSA key whose exponent is even or below 3 is refused.
- An EC public key at the point at infinity was accepted, and under Node 22 checking a signature
  under it aborted the process — for an MCP server run on Node 22, with one unauthenticated request.
  Node 24, which the MCP image uses, reads the key without aborting. It is refused before anything
  reads it, under either.
- JSON nested deeply enough to exhaust the stack ended a command with an internal error. Every
  command now refuses a document or line nested more than 200 levels deep, with exit 2.
- A named pipe or device given as a file was read. Only regular files are read now.
- Control characters in a file name or a finding reached the terminal as written. They are escaped.
- A JSON parse error could quote the input it failed on. It now names a position only.
- A newline in a property name or a file name started a line of its own in text output, so input
  could print a forged summary. Newlines, carriage returns and tabs from input are escaped.
- A property name shaped like a credential — a token, or a URL or connection string carrying a
  password — was repeated in schema and privacy findings. It is redacted as `<redacted>` in every
  path and message, and `lint-privacy` reports it as a finding.
- A private key given where a public key belongs was used, and a lower-case label such as
  `-----BEGIN ec PRIVATE KEY-----` got past the check. Any private key is refused, in the CLI and on
  the MCP server, which also tells the caller to treat the key as exposed.
- `verify-checkpoint` reported a chain as agreeing when some of the events declaring it could not be
  verified. Such a chain is no longer reported as agreeing, and no deletion is inferred from events
  that are present but unverified.
- A file was checked by name and then opened by name, so it could be replaced in between. It is now
  opened once, checked as opened, and read no further than the size it had.
- On the MCP server, a request body with a `__proto__` member was judged as a different document from
  the one sent; it is refused with 400. `subscriptions/listen` held a stream open with nothing to
  send; it is refused. A JSON-RPC batch could ask for unbounded work in one request; batches are
  refused. A request's log line named the path the caller sent; it names the route.
- The deployment guide said a client that reached the origin directly got a 403. Host validation
  cannot promise that, and the guide now says what does: the tunnel, or a firewall.
- The release job installed whatever npm 11 was newest, and restored a dependency cache, in the job
  that holds the publishing credential, and it would publish from any ref named like a version. It
  now installs an exact npm, restores no cache, and publishes only a tag.

**Recommended to the maintainer, not done in the repository:**

- Pin the GitHub Actions the workflows use to commit SHAs rather than version tags.
- Publish from a protected GitHub environment with a required reviewer, so that a tag alone cannot
  publish.
- Build and pack in a job without `id-token: write`, and publish that tarball from a job that runs
  no package scripts, so that no dependency's code runs beside the publishing credential.

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
