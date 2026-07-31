# 0010 — Official domain and canonical identifiers

## Status

Accepted — 2026-07-30. Applies to specification version 0.1.

Supersedes, in part, [ADR 0003](0003-backend-and-transport-independence.md) decision 4 and its
rejection of HTTPS schema identifiers.

Contains a **breaking change to both published schema identifiers**.

**Not yet in effect for dereferencing.** The identifiers below are the canonical names and are
already used as `$id`, but the website that would serve them has not been deployed, so
`https://openauditmodel.org/schemas/...` currently resolves to nothing. Everything this ADR decides
about _naming_ is in force; everything it claims about _fetching_ is pending that deployment.
Nothing in the specification, the CLI or the MCP server requires an identifier to be fetched.

## Context

[ADR 0003](0003-backend-and-transport-independence.md) chose URN identifiers for the canonical
schemas:

```text
urn:openauditmodel:schema:audit-event:0.1
urn:openauditmodel:schema:profile-definition:0.1
```

The reasoning was explicit and, at the time, correct: the project owned no domain, and _a schema
identifier that stops resolving is worse than one that never claimed to_. A URN promises nothing, so
it cannot break that promise. The repository was disciplined about this — a test asserted that the
core schema contained no HTTP identifier other than the JSON Schema meta-schema, and no fictional
domain was ever introduced.

The project now owns `openauditmodel.org`. The condition that made URNs the right answer no longer
holds, and the cost of keeping them has become visible:

- A URN tells a reader nothing about where to find the schema. Every consumer has to be told
  out-of-band, and every tool has to special-case it.
- Registry-style tooling and IDE JSON Schema integration are built around dereferenceable `$id`
  values. A URN silently disables them.
- `$id` is an identifier, not a fetch instruction. Making it dereferenceable costs nothing at
  validation time while making the ecosystem's default behaviour work.

## Decision

### 1. Canonical identifiers become HTTPS URLs

```text
https://openauditmodel.org/schemas/audit-event/0.1/schema.json
https://openauditmodel.org/schemas/profile-definition/0.1/schema.json
```

The URNs are withdrawn. They were experimental pre-release identifiers; both are removed rather than
kept as aliases, because two canonical `$id` values for one schema is not a canonical `$id`.

### 2. The canonical URLs return the actual JSON documents

A request to either URL returns the schema itself: `application/json`, no HTML wrapper, no redirect
to a documentation page. An identifier that resolves to a marketing page is worse than one that
resolves to nothing, because it looks like it worked.

The published files are byte-identical copies of the repository sources. They are copied by the site
build rather than hand-maintained, and a test compares the published copy against the source: a
schema that drifts from its published form is a schema nobody can rely on.

### 3. Versioned schema files are immutable

Once published, `…/audit-event/0.1/schema.json` never changes content. A correction ships as a new
version path.

This is the property that makes a dereferenceable identifier safe. A consumer that pins `0.1` and a
consumer that fetched it a year ago must be validating against the same document; otherwise the
identifier means "whatever we think today", and every stored audit event's conformance claim becomes
unverifiable retroactively.

### 4. Dereferencing remains unnecessary

The offline property that ADR 0003 protected is unchanged and is not weakened by this decision.

No `$ref` in either schema resolves to a remote location. Validation performs no network call. The
conformance CLI reads the schema from the repository and never fetches anything. `$id` is a name
that is intended to become resolvable once the site is deployed; nothing requires it to be resolved,
which is why the undeployed site blocks no other work.

The neutrality test was narrowed rather than deleted: the core schema may now contain URLs under the
project's own domain, and any third-party URL still fails the build. A dependency on someone else's
hosting is what that test exists to prevent, and that has not changed.

### 5. The website is static

The documentation site is generated HTML and CSS with no application framework, no server-side
rendering, no database, no accounts, no analytics and no cookies.

The site's primary job is to serve two JSON files at fixed URLs, forever, and to explain a
specification. Neither needs a runtime. A static site has no request path that can fail, no
dependency that can be compromised at runtime, and no per-request cost — which matters for an
artifact whose value depends on still being there in a decade.

### 6. The website and the MCP endpoint use separate subdomains

```text
openauditmodel.org        static documentation and canonical schemas
mcp.openauditmodel.org    the remote MCP Worker
```

Two deployment units, deployed independently.

They have opposite risk profiles. The documentation site is static, cacheable and effectively
immutable. The MCP service executes code on every request, accepts caller-supplied audit event
content, and will change far more often. Sharing one Worker would couple their deployment lifecycles
— a bad MCP deploy would take down the canonical schema URLs — and would put a request-handling
surface in front of documents that need none.

Separate subdomains also keep the security boundaries legible: the canonical identifiers are served
from an origin that runs no application code.

## Consequences

**Positive**

- The canonical identifiers are shaped to be dereferenceable, so tooling that expects to fetch `$id`
  will work **once the site is deployed**. Until then such tooling gets nothing back, which is the
  one cost of choosing an HTTPS identifier before serving it.
- Schema publication is derived from the repository and tested, so it cannot silently drift.
- Immutability makes a pinned version a real guarantee rather than a convention.
- The documentation origin runs no application code.

**Negative — breaking**

- **Both schema `$id` values changed.** Any consumer that pinned a URN must update. In an
  unreleased, experimental specification the blast radius is nil, but the change is breaking and is
  labelled as such in [CHANGELOG.md](../CHANGELOG.md).
- The project now depends on a domain registration. Losing `openauditmodel.org` would break
  identifier resolution — though, per decision 4, not validation.
- Immutability means a mistake in a published schema cannot be corrected in place; it requires a new
  version path.
- Two deployments cost more to operate than one.

**Neutral**

- The identifier includes a version segment (`/0.1/`) rather than encoding the version only inside
  the document, so that the immutability rule has something to attach to.

## Alternatives considered

**Keep the URNs.** Rejected: the only argument for them was the absence of a domain, and that is no
longer the case. Tooling that expects a dereferenceable `$id` is common enough that the cost is real.

**Publish both a URN and an HTTPS `$id` as aliases.** Rejected. `$id` is singular by definition, and
two identifiers for one schema means consumers disagree about what they validated against.

**Serve the schema URL as an HTML documentation page with the JSON available elsewhere.** Rejected:
an identifier that resolves to something other than the thing it identifies is a trap, and content
negotiation makes the result depend on the client's `Accept` header.

**Use a versionless `latest` URL.** Rejected: it is incompatible with decision 3, and a schema
identifier that changes meaning over time makes every historical conformance claim unverifiable.

**Host the site and the MCP endpoint on one Worker.** Rejected; see decision 6.
