# OpenAuditModel MCP server

**Implements specification 1.0, and reads 0.1. Not yet proven in production. No compliance guarantee.**

A stateless Node.js MCP server over Streamable HTTP, exposing the OpenAuditModel conformance engines.
Built as a local Docker image and self-hosted behind a reverse proxy that terminates TLS. There is no
registry: the image is built on whichever Docker daemon runs it.

```text
https://mcp.openauditmodel.org/mcp
```

> **Deployed and verified.** `curl https://mcp.openauditmodel.org/health` answers, and
> [deploy/smoke-test.mjs](../deploy/smoke-test.mjs) passes against it. Public and unauthenticated, with
> no availability guarantee — see "Public service risk" below.

Deployment, reverse-proxy configuration, environment variables, upgrade and rollback:
[deploy/README.md](../deploy/README.md). Why it is self-hosted rather than serverless:
[ADR 0011](../decisions/0011-self-hosted-docker-mcp-server.md).

## Data handling

> MCP tool inputs are processed ephemerally by the OpenAuditModel MCP service. The service does not
> intentionally persist audit event content or include tool arguments in application logs.

> Users should review their organization's data-handling requirements before submitting production
> audit events to a remote MCP service.

Audit event content submitted to a **public** instance leaves your machine. Because the server is
built and run from source, an organization can run it inside its own network instead, and the data
never leaves — which is the option a hosted-only service could not offer.

|                    |                                                                  |
| ------------------ | ---------------------------------------------------------------- |
| Authentication     | none                                                             |
| User-specific data | none                                                             |
| Write operations   | none                                                             |
| Persistence        | none — no database, no volume, no writable application directory |
| Model calls        | none — every tool is deterministic                               |

## Connecting

```bash
claude mcp add --transport http openauditmodel https://mcp.openauditmodel.org/mcp
claude mcp list
claude mcp get openauditmodel
```

Against a local instance, built from this repository:

```bash
docker build --tag openauditmodel-mcp:local --file Dockerfile .
docker run --rm -p 127.0.0.1:3000:3000 openauditmodel-mcp:local

claude mcp add --transport http openauditmodel-local http://127.0.0.1:3000/mcp
npx @modelcontextprotocol/inspector          # then connect to http://127.0.0.1:3000/mcp
```

Only Claude Code and MCP Inspector are named. Remote Streamable HTTP support varies between clients,
and no claim is made about one that has not been tried.

## Tools

Ten, all deterministic, read-only, stateless and offline. Each delegates to the same engine the
`auditmodel` CLI uses; parity is asserted by test rather than assumed.

| Tool                      | Purpose                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| `validate_event`          | Validate against the canonical schema; returns failures with JSON Pointers     |
| `verify_integrity`        | Recalculate an event's digest and compare it with the declared hash            |
| `verify_chain`            | Verify previous-hash chains across a set of events                             |
| `verify_checkpoint`       | Compare an archive with a chain checkpoint; the check that sees a deleted tail |
| `verify_proof`            | Verify one event's Merkle inclusion proof against a published root             |
| `lint_privacy`            | Report values shaped like credentials or unminimized payloads                  |
| `check_profile`           | Check against any of the ten bundled domain profiles                           |
| `check_coverage`          | Report how much of a profile a set of events reaches, and what it misses       |
| `generate_event_template` | Produce a placeholder skeleton for an event name                               |
| `get_event_guidance`      | Explain what an event name requires, from schema, conventions and profile      |

`verify_integrity`, `verify_chain`, `verify_checkpoint` and `verify_proof` accept an optional `publicKeyPem` argument — a PEM-encoded
public key for the declared algorithm: `Ed25519`, `ECDSA-P256-SHA256` or `RSA-PSS-SHA256` — to
additionally verify `integrity.signature`, the same way the CLI's `--public-key` does. Without it, a
declared signature in an implemented algorithm is reported as declared but not checked, and a
declared signature in an algorithm this verifier does not implement fails verification whether or
not a key is supplied. The key
is public by definition, so passing it as
a tool argument carries no confidentiality concern; nothing about the key is persisted or logged
either way, the same as every other tool input. One key per call: `verify_checkpoint` and
`verify_proof` apply it to the document's own signature and to every event's, so a document signed by
a different party than the events is verified in two calls, one per key. See
[ADR 0012](../decisions/0012-ed25519-signature-verification.md).

`verify_chain` returns each chain's `headHash` — the declared hash of its highest-sequence event, the
value a published chain head or checkpoint names — and lists the sealing batches the events declare
in `notes`. A batch is reported, not judged, and never changes `valid`; see
[ADR 0013](../decisions/0013-batch-id-reported-not-judged.md).

`verify_checkpoint` takes the events and a checkpoint document, verifies the events as `verify_chain`
does, and compares every chain the checkpoint names with the archive. Its `outcome` is one of
`agrees`, `disagrees`, `no-chain` (the archive holds none of the named chains; nothing was compared)
and `invalid-checkpoint` (not a checkpoint under its schema; nothing about the archive was judged).
The anchor is returned and never dereferenced, and the result carries the same line the CLI prints:
consistency with the supplied checkpoint is what was established, not the checkpoint's provenance.
See [ADR 0014](../decisions/0014-chain-checkpoints.md).

`verify_proof` takes one event and an inclusion proof, checks the proof's own consistency and the
root it recomputes to under RFC 6962 hashing, verifies the event as `verify_integrity` does and
requires its hash to be the leaf. Its `outcome` is one of `verified`, `failed`, `no-leaf` (the
event's hash cannot be established; nothing to prove) and `invalid-proof`. The root's anchor is
returned and never dereferenced. See
[ADR 0015](../decisions/0015-merkle-inclusion-proofs.md).

No tool returns the event it was given. `lint_privacy` never returns a matched value, a preview, a
prefix, a suffix or a decoded token claim. `verify_integrity` never returns canonicalized content or
digest input.

`check_profile` accepts only the bundled profiles; a caller-supplied profile document would make
conformance mean whatever the caller wanted. `matchedRules` lists rules selected by the event-name
selector, and a conditional rule appears there even when its condition did not hold — in which case it
contributed no requirements.

## Resources

Thirty-seven read-only documents under `openauditmodel://`: seven specification chapters, five
schemas — the audit event schema for 1.0 and for 0.1, the profile definition schema, the chain
checkpoint schema and the inclusion proof schema — the semantic conventions index and twelve
convention documents, the profile index, all ten profile definitions and the examples index.

Content is compiled in at build time from an allowlist in
[scripts/generate-resource-manifest.mjs](scripts/generate-resource-manifest.mjs). The server reads no
file and fetches nothing, and the image ships without the source repository. A resource is exposed
because it is named in that list — which is what keeps test sources, synthetic secret fixtures and CI
configuration off a public endpoint.

## Prompts

`design_audit_event`, `review_audit_event`, `instrument_operation`. They return guidance text for the
connected agent. **No model runs inside this server**, and `instrument_operation` directs the host
agent to use its own repository tools — the server never sees your source code.

## Architecture

```text
node:http  →  toNodeHandler  →  createMcpHandler  →  MCP server (per request)
                                                        ↓
                                          conformance engines, unchanged
```

Plain `node:http`, no framework: the surface is four routes, and a framework would add dependencies
and middleware behaviour to a service whose security argument is that very little happens between the
socket and the deterministic engines. MCP is handled by the official `@modelcontextprotocol/server`
and `@modelcontextprotocol/node` packages.

| Route                           | Behaviour                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /mcp`                     | Streamable HTTP, stateless — a fresh server instance per request; one message per request |
| `GET`, `DELETE`, `OPTIONS /mcp` | 405: no stream is offered, and there is no session to end                                 |
| `GET /health`                   | `{"status":"ok"}`                                                                         |
| `GET /`                         | Fixed metadata; no version, hostname or container detail                                  |
| anything else                   | 404                                                                                       |

A JSON-RPC batch is refused with 400: one request's body limit does not bound the work a batch asks
for, and the protocol dropped batching in 2025-06-18. `subscriptions/listen` is refused as a method
not offered, because the server publishes no notifications.

Registration is separate from transport, so standards-based OAuth can later wrap the HTTP boundary
without touching a tool implementation.

## Build

Five files are generated and must be regenerated when their sources change. CI fails when any is
stale, and the Docker build regenerates and re-verifies them so a stale artifact cannot reach an
image.

```bash
npm run generate --workspace mcp        # write all five
npm run generate:check --workspace mcp  # fail if any is stale
```

- `src/schema-validator-1.0.generated.ts` and `src/schema-validator-0.1.generated.ts` — Ajv's
  standalone output for each version's audit event schema; the server judges each event by the one
  its `specVersion` names. Kept even though Node permits runtime compilation: it is Ajv's own
  compiled logic, so this server's verdict is identical to the CLI's by construction, and the schema
  stays a build artifact rather than a runtime input.
- `src/checkpoint-validator.generated.ts` and `src/proof-validator.generated.ts` — the same, for the
  checkpoint and inclusion proof formats.
- `src/resource-manifest.generated.ts` — the bundled resource content.

```bash
npm run mcp:start                       # compile and run on :3000, no container

# From the repository root. Nothing is pushed anywhere.
docker build --tag openauditmodel-mcp:local --file Dockerfile .
```

## Limits

| Limit                                            | Default         | Variable                |
| ------------------------------------------------ | --------------- | ----------------------- |
| Request body                                     | 1,000,000 bytes | `OAM_MAX_REQUEST_BYTES` |
| Single event                                     | 256,000 bytes   | `OAM_MAX_EVENT_BYTES`   |
| Events per `verify_chain` or `verify_checkpoint` | 200             | `OAM_MAX_CHAIN_EVENTS`  |
| JSON depth                                       | 200             | —                       |
| Tool output                                      | 512,000 bytes   | —                       |

Exceeding a limit returns a structured error. Input is never silently truncated: validating part of an
event and reporting a verdict on the whole would be worse than refusing it.

## Origin and host policy

A request with **no** `Origin` is accepted — that is every non-browser MCP client. A present but
unlisted `Origin` gets 403. Comparison is on the parsed origin, so
`https://openauditmodel.org.evil.example` cannot pass by prefix, and a wildcard entry fails startup
rather than being quietly accepted.

Host validation is on by default: with `OAM_ALLOWED_HOSTS` unset, the server answers on loopback
names only (`localhost`, `127.0.0.1`, `[::1]`), so a bare `docker run` or a local start needs no
configuration and a public deployment must state the names it serves. `X-Forwarded-Host` is
consulted **only** when `OAM_TRUST_PROXY=true`: believing it by default would let any client assert
any host.

Host validation defends against DNS rebinding, a browser led to this server under another name. It
does not keep out a client that reaches the server directly: such a client writes its own `Host`
header, and can write an allowed one. What keeps direct clients out is the network — a tunnel with no
inbound port, or a firewall that admits only the proxy.

## Logging

A request's log line carries a generated request identifier, the route that answered it (`/`,
`/health`, `/mcp`, or `other` — never the path the caller sent), a result category, a status code
and a duration, and nothing else. There is no parameter through which a request body, an event
identifier, an actor, a resource, a digest or a privacy finding could be logged. The logger accepts
a `toolName` field, one of ten published names, but no request line sets it; an _event_ name is
excluded, because it would describe the caller's business operations.

Set `OAM_LOG_LEVEL=error` or `silent` to reduce or disable output.

## Public service risk

Unauthenticated, and offered without an availability guarantee: the specification is stable from
1.0, the hosted service is a convenience. Anyone who can reach the endpoint can call every tool. That is defensible only
because every tool is read-only, there is no account, no write operation and no persistence — and it
stops being defensible the moment any of those changes. Apply reverse-proxy rate limiting before
public exposure.

## What this is not

Not a compliance service. Conformance is a statement about the shape and semantics of data, never
about compliance with any law, regulation, standard or contract.
