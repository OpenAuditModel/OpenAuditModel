# OpenAuditModel MCP server

**Experimental. Not production-ready. No compliance guarantee.**

A stateless Node.js MCP server over Streamable HTTP, exposing the OpenAuditModel conformance engines.
Built as a local Docker image and self-hosted behind a reverse proxy that terminates TLS. There is no
registry: the image is built on whichever Docker daemon runs it.

```text
https://mcp.openauditmodel.org/mcp
```

> **Deployed and verified.** `curl https://mcp.openauditmodel.org/health` answers, and
> [deploy/smoke-test.mjs](../deploy/smoke-test.mjs) passes against it. Still a v0.1 alpha — see
> "Public alpha risk" below.

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
| Authentication     | none in the v0.1 alpha                                           |
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

Seven, all deterministic, read-only, stateless and offline. Each delegates to the same engine the
`auditmodel` CLI uses; parity is asserted by test rather than assumed.

| Tool                      | Purpose                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `validate_event`          | Validate against the canonical schema; returns failures with JSON Pointers |
| `verify_integrity`        | Recalculate an event's digest and compare it with the declared hash        |
| `verify_chain`            | Verify previous-hash chains across a set of events                         |
| `lint_privacy`            | Report values shaped like credentials or unminimized payloads              |
| `check_profile`           | Check against any of the ten bundled domain profiles                       |
| `generate_event_template` | Produce a placeholder skeleton for an event name                           |
| `get_event_guidance`      | Explain what an event name requires, from schema, conventions and profile  |

No tool returns the event it was given. `lint_privacy` never returns a matched value, a preview, a
prefix, a suffix or a decoded token claim. `verify_integrity` never returns canonicalized content or
digest input.

`check_profile` accepts only the bundled profiles; a caller-supplied profile document would make
conformance mean whatever the caller wanted. `matchedRules` lists rules selected by the event-name
selector, and a conditional rule appears there even when its condition did not hold — in which case it
contributed no requirements.

## Resources

Twenty-nine read-only documents under `openauditmodel://`: seven specification chapters, both
canonical schemas, the semantic conventions index and seven convention documents, the profile index,
all ten profile definitions and the examples index.

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

| Route                   | Behaviour                                                        |
| ----------------------- | ---------------------------------------------------------------- |
| `POST /mcp`, `GET /mcp` | Streamable HTTP, stateless — a fresh server instance per request |
| `GET /health`           | `{"status":"ok"}`                                                |
| `GET /`                 | Fixed metadata; no version, hostname or container detail         |
| anything else           | 404                                                              |

Registration is separate from transport, so standards-based OAuth can later wrap the HTTP boundary
without touching a tool implementation.

## Build

Two files are generated and must be regenerated when their sources change. CI fails when either is
stale, and the Docker build regenerates and re-verifies them so a stale artifact cannot reach an
image.

```bash
npm run generate --workspace mcp        # write both
npm run generate:check --workspace mcp  # fail if stale
```

- `src/schema-validator.generated.ts` — Ajv's standalone output for the canonical schema. Kept even
  though Node permits runtime compilation: it is Ajv's own compiled logic, so this server's verdict is
  identical to the CLI's by construction, and the schema stays a build artifact rather than a runtime
  input.
- `src/resource-manifest.generated.ts` — the bundled resource content.

```bash
npm run mcp:start                       # compile and run on :3000, no container

# From the repository root. Nothing is pushed anywhere.
docker build --tag openauditmodel-mcp:local --file Dockerfile .
```

## Limits

| Limit                     | Default         | Variable                |
| ------------------------- | --------------- | ----------------------- |
| Request body              | 1,000,000 bytes | `OAM_MAX_REQUEST_BYTES` |
| Single event              | 256,000 bytes   | `OAM_MAX_EVENT_BYTES`   |
| Events per `verify_chain` | 200             | `OAM_MAX_CHAIN_EVENTS`  |
| JSON depth                | 200             | —                       |
| Tool output               | 512,000 bytes   | —                       |

Exceeding a limit returns a structured error. Input is never silently truncated: validating part of an
event and reporting a verdict on the whole would be worse than refusing it.

## Origin and host policy

A request with **no** `Origin` is accepted — that is every non-browser MCP client. A present but
unlisted `Origin` gets 403. Comparison is on the parsed origin, so
`https://openauditmodel.org.evil.example` cannot pass by prefix, and a wildcard entry fails startup
rather than being quietly accepted.

Host validation is available via `OAM_ALLOWED_HOSTS`. `X-Forwarded-Host` is consulted **only** when
`OAM_TRUST_PROXY=true`: believing it by default would let any client assert any host.

## Logging

Application logs carry a generated request identifier, the route, the tool name, a result category, a
status code and a duration — and nothing else. There is no parameter through which a request body, an
event identifier, an actor, a resource, a digest or a privacy finding could be logged. `toolName` is
one of seven published names and says which analysis ran; an _event_ name is excluded, because that
would describe the caller's business operations.

Set `OAM_LOG_LEVEL=error` or `silent` to reduce or disable output.

## Public alpha risk

Unauthenticated. Anyone who can reach the endpoint can call every tool. That is defensible only
because every tool is read-only, there is no account, no write operation and no persistence — and it
stops being defensible the moment any of those changes. Apply reverse-proxy rate limiting before
public exposure.

## What this is not

Not a compliance service. Conformance is a statement about the shape and semantics of data, never
about compliance with any law, regulation, standard or contract.
