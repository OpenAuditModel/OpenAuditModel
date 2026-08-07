<p align="center">
  <img src="assets/logo.png" alt="OpenAuditModel" width="420">
</p>

# OpenAuditModel

> **OpenAuditModel defines a common, verifiable and backend-independent audit event model for
> business applications.**
>
> **One audit model for every application.**

|                           |                                                                  |
| ------------------------- | ---------------------------------------------------------------- |
| **Specification version** | 0.1                                                              |
| **Project status**        | **Experimental**                                                 |
| **Production readiness**  | **Not production-ready**                                         |
| **Compliance**            | **No compliance guarantee**                                      |
| **Canonical schema**      | `https://openauditmodel.org/schemas/audit-event/0.1/schema.json` |
| **License**               | Apache License 2.0                                               |

Version 0.1 is an experimental specification. Field names, constraints, vocabularies and the
compatibility strategy may all change. Nothing here constitutes legal advice, and conformance to this
specification is not compliance with any law, regulation, standard or contract.

---

## Quick start

No install, no checkout — three commands against one file.

```bash
cat > audit-event.json <<'EOF'
{
  "specVersion": "0.1",
  "id": "018f1b70-2c18-7f3a-b46d-5e8a1c9d0b12",
  "time": "2026-03-14T11:47:52.108Z",
  "event": {
    "name": "financial.transfer.execute",
    "category": "data-modification",
    "outcome": "success"
  },
  "actor": { "type": "user", "id": "user-5120" },
  "resource": { "type": "money-transfer", "id": "transfer-2026-004418" },
  "application": { "name": "payments-api", "environment": "production" }
}
EOF

npx @openauditmodel/cli validate audit-event.json
npx @openauditmodel/cli lint-privacy audit-event.json
npx @openauditmodel/cli check-profile audit-event.json --profile financial-transaction-management
```

The binary is `auditmodel` once installed (`npm i -D @openauditmodel/cli`); `openauditmodel` is
accepted as an alias. The profile is passed with `--profile`, never positionally.

That third command **fails**, and it is meant to. The event is schema-valid but the financial profile
requires an authorization decision, a correlation identifier, a transaction reference, an amount, a
currency, a direction, a status and a linked resource. The output names each missing field with a
JSON Pointer. Adding them is the point of the exercise:

```jsonc
  "authorization": { "decision": "allow" },
  "request": { "correlationId": "transfer-2026-004418" },
  "relatedResources": [{ "type": "account", "id": "account-ref-781" }],
  "metadata": {
    "financial": {
      "transactionId": "txn-2026-0314-0091",
      "amount": 1250.5,
      "currency": "EUR",
      "direction": "outbound",
      "status": "settled"
    }
  }
```

With those added the event conforms and `check-profile` exits `0`. Note what the profile asked for
and what it did not: an amount and a currency, but no account number, no counterparty name and no
payment instruction. A profile requires the fields that make an operation reviewable, not the
business record itself.

### Exit codes

The same contract across every command, so a CI job can branch on it:

| Code | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| `0`  | A verdict was produced and it passed.                                                |
| `1`  | A verdict was produced and it failed — invalid, a privacy finding, a rule violation. |
| `2`  | The tool could not run: unreadable file, bad arguments, unknown profile.             |
| `3`  | **No verdict was produced.** Nothing was evaluated.                                  |

`3` is the one worth understanding, because it is the code that is easy to misread as success:

- `check-profile` returns it when **no rule in the profile governs the event**. That usually means the
  event name does not match the profile's vocabulary — `transfer.created` instead of
  `financial.transfer.execute`, say. **Not-applicable is not conformance.** The profile said nothing
  about this event; it did not approve it.
- `lint-privacy` returns it when the input **is not an OpenAuditModel event**, so nothing was scanned.
  The linter reads the locations the specification defines on an audit event; point it at an
  arbitrary application log and it has nowhere to look. It reports that plainly rather than
  reporting `clean`.

```bash
# conforming → 0        the profile's rules were checked and passed
# violations  → 1        the event matched the profile and failed a rule
# not applicable → 3     the event name matched no rule in the profile
npx @openauditmodel/cli check-profile audit-event.json --profile document-management
```

That last command returns `3` for the financial event above: `document-management` governs no
`financial.*` event. Running an event against the wrong profile can never produce a pass.

### Exporting an existing audit trail

Adoption does not require changing where you store anything. The lowest-friction path is an export
mapper, which is also the shape enterprise customers ask for:

```text
existing audit database → mapper → OpenAuditModel NDJSON → customer, archive or SIEM
```

`validate`, `lint-privacy` and `check-profile` all accept `.ndjson` and `.jsonl`, so the export can be
checked in CI before it is handed to anyone.

## What is OpenAuditModel?

OpenAuditModel is an open, vendor-neutral specification for the structure of an audit event: a
record of an auditable operation performed in a business application.

It consists of:

- A **normative specification** describing what an audit event is and what a producer must record.
- A **canonical JSON Schema** (Draft 2020-12) that machine-verifies the structure.
- A **conformance toolchain** — a CLI, fixtures and tests — so that conformance is provable rather
  than asserted.

The model itself is not a product, a service, a library or a pipeline: an audit event is valid with
nothing deployed. The repository does also contain an optional MCP server for tooling, which is not
part of the specification and which nobody needs in order to conform.

## What problem does it solve?

Almost every application records auditable operations, and almost every application invents its own
shape for them. The consequences are familiar:

- Audit records cannot be validated, so defects are found years later, in retained data.
- Two systems' audit trails cannot be read together without bespoke translation.
- Every new application re-litigates the same questions: what is an actor, how do we record acting on
  behalf of someone, where does the approval go.
- Audit data accumulates secrets and personal data because nobody decided what should be recorded.
- Migrating storage means rewriting the data model.

OpenAuditModel answers those questions once, in a way that is checkable by a validator.

It standardizes how applications describe operations such as authentication, authorization, identity
changes, privileged operations, data access, data modification, configuration changes, workflow
approvals, delegation, impersonation, administrative actions, security-relevant actions, external
data sharing, resource lifecycle operations, and deployment and operational changes.

## Has this been tried before?

Yes, several times, and by serious people. This project is not the first attempt to give audit
events a common shape, and the reason for another one is narrower than "there wasn't a standard".

**XDAS** (The Open Group, 1998) defined a set of generic events and a portable audit record format
so that records from different components of a distributed system could be merged and analysed
together. It remained a Preliminary Specification.

**CEE** (MITRE) is the closest predecessor in shape. It defined an Event Taxonomy, a Field
Dictionary, an Event Schema with extensions, and Event Profiles — customizable extensions of the
schema for a particular need — together with JSON and XML encodings and a transport layer that
covered secure logging and verifiable record logs. That is close enough to this project's structure
that it should be said plainly rather than discovered. MITRE stopped all work on CEE in 2014 when
its sponsor's funding ended, and keeps the site as an archive. It stopped for want of funding, not
because the idea was wrong.

**CADF** (DMTF DSP0262) is a full audit event model: schema definitions, extensible taxonomies, and
interfaces for federating event records between providers. Its framing — initiator, action, target,
outcome, observer — is reflected here. Its target is cloud and service-provider auditing.

**OCSF** is the active one, describing itself as an extensible framework for developing schemas with
a vendor-agnostic core security schema, initially focused on cybersecurity events. It has real
adoption across security vendors.

### So why another one?

Not because those are wrong, and not because a schema is a novel idea. The differences are of focus:

- **The subject is a business operation, not security telemetry or a control-plane action.** The
  questions this model insists on — who authorized it, who approved it, on whose behalf it was done,
  why, and what the record looked like before and after — are the ones that come up when a business
  application is audited, and they are peripheral in models built for other domains.
- **Conformance is testable rather than asserted.** A canonical JSON Schema, published fixtures and a
  validator mean a producer can be shown to conform, or shown not to, before the data is retained for
  years. Profiles add requirements for a domain and are structurally unable to relax the core.
- **The specification is reachable by the tooling that writes the code.** Much of this instrumentation
  is now written with a coding agent in the loop, and an agent that can query the model, generate an
  event against it, validate the result and check it for leaked credentials is a different proposition
  from a specification document it has to be told about.

None of those parts is individually novel. The combination, and the narrowness of the target, are the
bet this project is making.

## Why is an audit event different from an application debug log?

An application log line says:

```text
Document downloaded successfully.
```

That is enough to debug the download and almost useless six months later. A structured audit event
answers the questions a reviewer, an investigator or a customer will actually ask:

- Who performed the operation?
- Was it a user, a service or the system itself?
- Was it performed on behalf of someone else?
- What action was performed?
- What resource was affected?
- What was the result?
- What authorization decision allowed or denied it?
- Was approval involved, and by whom?
- What changed?
- Which application produced the event, in which environment?
- How does it correlate with a request or a distributed trace?
- Does it contain personal data?
- Can its integrity be checked?

An audit event is written for a reader who was not there, does not have the source code, and is
reading it years later. A debug log is written for the engineer looking at it today. Both are useful;
they are not the same artifact, and one does not substitute for the other.

**Not every audit event needs every optional field.** A conforming event can be seven fields long.
See [examples/valid/minimal-event.json](examples/valid/minimal-event.json).

## What does OpenAuditModel _not_ do?

It is **not**:

a log storage backend · a database · a SIEM · a GRC platform · a dashboard · an audit management
application · a compliance certification product · a policy engine · an authorization system · a
telemetry transport · a guarantee of regulatory or legal compliance.

It is **not a replacement for** OpenTelemetry, CloudEvents, ECS, OCSF, CADF or OSCAL.

The specification defines no web server, no REST API, no database, no user interface, no SaaS
service, no production SDK, no regulatory mapping packs, no country-specific fields and no
product-specific fields. That is by design, not by omission. The repository ships one optional
component — an MCP server that exposes the conformance engines to AI agents — which stores nothing
and is not required to produce or consume a conforming event.

## How does it relate to existing standards?

OpenAuditModel complements existing standards rather than reinventing them. None of them is required.

| Standard                      | Relationship                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------- |
| **CloudEvents**               | MAY be used as a transport envelope. The complete audit event travels as `data`. |
| **OpenTelemetry**             | MAY be used for telemetry transport, collection and trace correlation.           |
| **ECS**                       | Supported through an informative export mapping.                                 |
| **OCSF**                      | Supported through an informative security-event mapping.                         |
| **CADF**                      | A DMTF audit event standard. Prior art; not an export target in v0.1.            |
| **OSCAL**                     | May later be used for control and assessment mappings. Not addressed in v0.1.    |
| **JSON Schema Draft 2020-12** | Defines the canonical machine-verifiable structure.                              |

### Specifically, OpenTelemetry

OpenTelemetry is an excellent way to **transport and correlate** audit events, and
`request.traceId` / `request.spanId` are defined to be W3C Trace Context compatible so that an audit
event joins cleanly to the trace of the request that caused it.

OpenTelemetry does not define semantics for approval, delegation, business justification, before and
after change state, evidence references or per-event tamper-evidence. This project does not claim
that it does, and does not attempt to replace it. One caution: telemetry pipelines sample, and audit
trails must not be sampled. See [mappings/opentelemetry.md](mappings/opentelemetry.md).

### Specifically, CloudEvents

CloudEvents standardizes the envelope; OpenAuditModel standardizes what is inside it. They compose
because neither tries to do the other's job. Using CloudEvents is optional, and an OpenAuditModel
event is valid standalone. See [mappings/cloudevents.md](mappings/cloudevents.md).

### Specifically, ECS, OCSF and CADF

ECS is a field vocabulary for search; OCSF is a schema for security telemetry; CADF (DMTF DSP0262) is
a complete audit event model with its own schema definitions, taxonomies and federation interfaces,
aimed at cloud and service-provider auditing. OpenAuditModel exports to the first two and takes
conceptual framing from the third — the difference there is domain, not completeness. All three
mappings are informative, one-directional, and honest about what does not map — see
[mappings/](mappings/).

## Why is the model backend-independent?

Because audit tooling normally arrives attached to a backend, and the model then acquires fields that
exist for that backend's benefit. Adopting the model means adopting the product, data cannot move
between stores without translation, and an audit trail that must be readable in a decade depends on a
product that may not exist then.

OpenAuditModel therefore defines no transport, no storage concept and no required pipeline.
Schema identifiers never have to be dereferenced, so validation needs no network call and no domain
registration has to be maintained for the schema to keep working. An event is equally valid written
to a file, inserted into a table, published to a topic or held in memory.

See [ADR 0003](decisions/0003-backend-and-transport-independence.md).

## What is in v0.1?

```text
specification/         15 normative documents defining the model
schemas/v0.1/          the canonical JSON Schema (Draft 2020-12)
semantic-conventions/  recommended event names and vocabularies
profiles/              ten enforceable domain profiles, 127 rules
mappings/              informative mappings to CloudEvents, OTel, ECS, OCSF, CADF
examples/              11 valid and 7 invalid conformance fixtures
examples/integrity/    generated tamper-evidence fixtures, valid and invalid
examples/privacy/      clean and finding fixtures for the privacy linter
examples/profiles/     conforming, violating and out-of-scope profile fixtures
conformance/           the `auditmodel` CLI and its test suite
mcp/                   the remote MCP server, distributed as a container image
deploy/                Docker Compose and reverse-proxy examples
decisions/             12 architecture decision records
```

The core model requires seven fields — `specVersion`, `id`, `time`, `event`, `actor`, `resource`,
`application` — and offers nineteen optional context objects covering subject, delegation,
authentication, authorization, approval, request correlation, change, reason, evidence, integrity,
privacy, control categories, metadata and extensions.

Start with [specification/overview.md](specification/overview.md), then
[specification/event-model.md](specification/event-model.md).

## What is experimental?

All of it. Specifically, expect these to change:

- **The compatibility strategy.** `specVersion` is pinned to `"0.1"` by a `const` in the schema.
  How future versions negotiate compatibility is undecided.
- **Closed vocabularies.** `actor.type` and `event.severity` are closed enumerations in v0.1.
  Whether they should be is an open question.
- **Array bounds and length limits.** The current values are conservative defaults, not researched
  ones.
- **Profiles.** Ten are implemented and enforceable, but none has production adoption evidence yet:
  their requirements are reasoned, not validated against real deployments.
- **Planned commands.** `check-coverage` is documented as future work and does not exist.
- **The profile rule vocabulary.** Six capabilities and one conditional operator. Profile inheritance,
  composition and multi-profile checking are not implemented.
- **Privacy rule thresholds and vocabularies.** Hard-coded in v0.1, with no configuration and no
  suppression mechanism.
- **The digest exclusion set.** Now fixed, so any future change to it invalidates every stored digest
  rather than only new events.

Two things are already committed to, even while experimental: event names do not silently change
meaning, and extensions never weaken the core.

## How can an event be validated?

Requires Node.js 22 or newer. Everything runs offline.

```bash
npm install
npm run build

npm run auditmodel -- validate examples/valid/minimal-event.json
```

After building, the CLI can also be run directly:

```bash
node dist/conformance/src/cli.js validate examples/valid
auditmodel validate <event-file>          # when installed or linked
```

Output:

```text
schema: https://openauditmodel.org/schemas/audit-event/0.1/schema.json (schemas/v0.1/audit-event.schema.json)

ok    examples/valid/minimal-event.json

1 event checked: 1 valid, 0 invalid, 0 unreadable
```

A path may be a JSON file holding one event, a JSON file holding an array of events, a `.jsonl` or
`.ndjson` file holding one event per line, or a directory of those files.

A failure reports the JSON Pointer of every problem:

```text
FAIL  examples/invalid/delegation-without-subject.json
    /subject  missing required property "subject"  [required]
```

Exit codes: `0` valid, `1` at least one event failed validation, `2` usage error or a file that could
not be read or parsed.

Validation is one half of conformance. The rules a schema cannot express — do not record secrets, do
not misuse `subject` as a target, do not silently redefine an event name — are normative in the
specification and are not detectable by any validator. See
[specification/privacy.md](specification/privacy.md).

## How is an event's integrity verified?

An event MAY carry `integrity` material: a digest of itself, and a link to the previous event in a
chain. Two commands check it, both entirely offline.

```bash
auditmodel verify-integrity examples/integrity/valid/single-event-sha256.json
auditmodel verify-chain examples/integrity/valid/three-event-chain
```

```text
ok    examples/integrity/valid/single-event-sha256.json
        schema valid
        canonicalization: RFC8785
        hash algorithm: SHA-256
        integrity hash valid
```

```text
chain chain-platform-control-service-instance-7c1a
  events:    3
  sequences: 1..3
  ok    all 3 event digests valid
  ok    all 2 previous-hash links valid
  ok    chain starts at a genesis event
```

A failure names the finding and shows both digests, never the event:

```text
FAIL  examples/integrity/invalid/tampered-event.json
        integrity hash mismatch  [hash-mismatch]
          declared:   03638029fc5fa4b1b043b762ab6c59b21ab8a60328a7a9956dcb8ccd9aac4e93
          calculated: 193a462d707f0402e78cc172827e55579c80492905ca70647f4ce1c270f0706e
```

**What is verified.** That the event validates against the canonical schema; that its declared
canonicalization and hash algorithm are ones the verifier implements; that recalculating its digest
reproduces `integrity.hash`; and, for chains, that every event links to its predecessor, that
sequences are unique and orderable, and that one algorithm is used throughout.

**What is not verified.** Whether the events you supplied are all the events that existed: chain
verification proves consistency of the supplied set, and an attacker who removes the _end_ of a chain
leaves something internally consistent. Detecting that needs an external checkpoint, which is out of
scope. Key generation, storage, rotation, revocation and certificate parsing are likewise out of scope,
regardless of whether a signature is present.

**How the digest is calculated.** Deep-clone the event, remove exactly `/integrity/hash` and
`/integrity/signature`, serialize with **RFC 8785** (the JSON Canonicalization Scheme), encode as
UTF-8, hash, and encode as lower-case hexadecimal. RFC 8785 is used because a digest over JSON is
meaningless unless property order, number formatting and escaping are fixed first.

Everything else is _inside_ the digest — including `sequence`, `previousHash`, `chainId`, `batchId`,
`hashAlgorithm` and `canonicalization`. That is deliberate: if chain metadata were excluded, an
attacker could re-link and re-order events freely while every hash still verified.

**Supported algorithms.** `SHA-256`, `SHA-384` and `SHA-512`, matched case-sensitively. The schema
keeps the vocabulary open so a future algorithm needs no schema change — but acceptance by the schema
is not support, and an event declaring anything else is reported as unverifiable rather than verified.

**Signature verification.** `integrity.signature` can additionally be checked with `--public-key
<path>`, a PEM-encoded Ed25519 public key — `ECDSA-P256-SHA256` and `RSA-PSS-SHA256` are
schema-recommended but not yet implemented. It verifies over the same digest input as the hash, so a
signed chain is exactly as tamper-evident as a hashed one. Without the flag, a declared signature is
neither checked nor mentioned, and a signature currently requires an accompanying `hash` to be checked
at all. There is no key registry: `keyId` is never dereferenced, and a verifying party supplies the key
it already trusts. See [ADR 0012](decisions/0012-ed25519-signature-verification.md).

```bash
auditmodel verify-integrity examples/integrity/valid/signed-event-ed25519.json \
  --public-key examples/integrity/keys/ed25519-test-public.pem
```

**Tamper-evident, not tamper-proof.** Verification detects modification of the events it is given. It
does not prevent deletion, does not provide storage immutability, and creates no legal evidentiary
status. See [specification/integrity.md](specification/integrity.md) §8 and
[ADR 0006](decisions/0006-event-digest-and-chain-verification.md).

## How are privacy risks detected?

Audit data concentrates who did what to whom, and instrumentation written once and rarely revisited
is exactly where a password ends up in a log that is kept for seven years.

```bash
auditmodel lint-privacy examples/privacy/findings/access-token-field.json
auditmodel lint-privacy examples/privacy --format json
```

```text
FAIL  examples/privacy/findings/access-token-field.json  (1 finding)
        CRITICAL  OAM-PRIV-001  confidence high  /metadata/accessToken
          A property name associated with credentials carries a non-empty value.
          recommendation: Remove the value. Record only the fact of the operation, or a
          non-sensitive identifier for the credential.
```

Seventeen rules across ten categories: credential-shaped property names, authorization header values,
private key markers, published token formats, URLs with embedded user information, evidence
references carrying query strings, connection strings, oversized values and raw payload fields — plus
one heuristic that measures character entropy.

**The output never contains the value that produced a finding.** Not a preview, not a prefix, not a
decoded token claim. Linter output ends up in CI logs and pull request comments, which are usually
less protected than the audit store; a tool that echoed its matches would move secrets from a
controlled system into an uncontrolled one, precisely when a secret was present.

**It runs entirely locally.** No remote service, no scanning API, no model, no network. It resolves
no reference, fetches no evidence URL and opens no file an event names. It never modifies or redacts
an event: the fix for a secret in an audit record is to change the instrumentation and rotate the
credential, not to rewrite history.

**A finding is a suspicion, and a clean result is not a clearance.** A finding does not establish a
breach, a regulatory violation or a confirmed credential. And a password that happens to be a
dictionary word, stored under a field named `note`, matches nothing — as does most personal data,
which is not shaped like a secret at all. Severity and confidence are reported separately for this
reason: a field named `password` is critical/high, a random-looking string in an arbitrary field is
medium/low.

Exit codes: `0` no findings, `1` findings or a schema-invalid event, `2` usage or input error. Full
rule catalogue, thresholds, inspected paths and honest limits:
[specification/privacy.md](specification/privacy.md) §6 and
[ADR 0007](decisions/0007-deterministic-privacy-linting.md).

## How do I use it from an AI agent?

A remote MCP server exposes the same deterministic engines the CLI uses, so an agent writing
instrumentation can validate, privacy-lint and profile-check an event without cloning anything.

```bash
claude mcp add --transport http openauditmodel https://mcp.openauditmodel.org/mcp
```

Seven tools — `validate_event`, `verify_integrity`, `verify_chain`, `lint_privacy`,
`check_profile`, `generate_event_template`, `get_event_guidance` — three prompts, and twenty-nine
read-only resources covering the specification, both schemas, the semantic conventions and the IAM
profile.

**It is a remote service, and this matters.** MCP tool inputs are processed ephemerally by the
OpenAuditModel MCP service. The service does not intentionally persist audit event content or
include tool arguments in application logs. Users should review their organization’s data-handling
requirements before submitting production audit events to a remote MCP service. Nothing here claims
your events stay on your machine — they do not. For regulated audit data, use the CLI, which sends
nothing anywhere.

No model runs inside the server: every tool is deterministic and read-only, and the prompts return
guidance text for your agent to act on. Findings never carry the value that produced them.

> Deployed and verified: `https://mcp.openauditmodel.org/mcp` answers, and the site above serves the
> canonical schemas. Both are still an unauthenticated v0.1 alpha — see
> [mcp/README.md](mcp/README.md), "Public alpha risk".

Run it yourself — which keeps your audit events inside your own network. The image is built from this
repository; there is no registry to pull from:

```bash
docker build --tag openauditmodel-mcp:local --file Dockerfile .

docker run --rm -p 127.0.0.1:3000:3000 \
  -e OAM_ALLOWED_ORIGINS=https://openauditmodel.org \
  openauditmodel-mcp:local
```

See [mcp/README.md](mcp/README.md), [deploy/README.md](deploy/README.md) and
[ADR 0011](decisions/0011-self-hosted-docker-mcp-server.md).

## How are extensions added?

Two extension points, for two different purposes.

**`metadata`** carries domain-specific audit interpretation data with plain keys:

```json
{ "metadata": { "assignedRole": "support-agent", "expiresAt": "2026-06-16T00:00:00Z" } }
```

**`extensions`** carries vendor-specific or product-specific data under a reverse-domain namespace of
at least three segments, which the validator enforces:

```json
{
  "extensions": {
    "com.example.identity.directory.id": "directory-1",
    "io.vendor.product.feature.enabled": true
  }
}
```

Keys like `clusterId` or `customValue` are rejected. Extensions must never weaken a required core
field or change the meaning of an existing one, and consumers must ignore extensions they do not
understand. See [specification/extension-model.md](specification/extension-model.md) and
[ADR 0004](decisions/0004-reverse-domain-extension-namespaces.md).

## What are profiles, and how are they checked?

A profile is an optional, stricter set of requirements for one domain. The core says every event
needs an actor; a profile says that _in this domain_, a privileged role assignment also needs an
approval and a multi-factor authenticated session.

```bash
auditmodel check-profile examples/profiles/identity-and-access-management/valid \
  --profile identity-and-access-management
```

```text
ok    .../valid/role-assign-privileged.json  (IAM-CORE-001, IAM-CORE-002, IAM-ROLE-001, IAM-ROLE-002)

FAIL  .../invalid/privileged-role-without-mfa.json  (1 violation)
        ERROR  IAM-ROLE-002  /authentication/mfa
          required by the profile to equal true
```

**A profile only ever adds.** Every profile-conforming event is a core-conforming event, and this is
enforced structurally rather than by review: the rule vocabulary contains no keyword that could remove
a requirement — no `optionalPaths`, no `exemptPaths`, no `overrides` — and core validation runs first,
so an event failing the core schema is reported as core-invalid with its profile rules never
evaluated.

**Profiles are data, not code.** A profile is a JSON document validated against
[profile-definition.schema.json](profiles/profile-definition.schema.json). Six capabilities: two
selector forms, three requirement forms, one recommendation form, and one conditional — a single path
compared for equality against a single scalar. No expressions, no scripts, no regular expressions,
nothing executed. The eleven-rule identity profile is expressed entirely in JSON, with no TypeScript.
Adding a profile requires no code.

**An event no rule governs is `not-applicable`, never conforming**, and exits `3`. Silence is not
conformance: a pipeline checking document events against an identity profile must not read a pass as
assurance.

| Profile                                                                        | Status                                                                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [Identity and access management](profiles/identity-and-access-management/)     | **Implemented** — 11 rules across accounts, roles, permissions, service accounts and credential rotation    |
| [Document management](profiles/document-management/)                           | **Implemented** — 11 rules across sharing, permissions, versioning, retention and legal hold                |
| [Incident management](profiles/incident-management/)                           | **Implemented** — 15 rules across incident, problem and corrective-action lifecycle                         |
| [Message broker management](profiles/message-broker-management/)               | **Implemented** — 12 rules across broker control-plane, ACL, quota, configuration and offset administration |
| [Deployment and change management](profiles/deployment-and-change-management/) | **Implemented** — 13 rules across deployment, release, rollback and configuration change                    |
| [Financial transaction management](profiles/financial-transaction-management/) | **Implemented** — 12 rules across transfers, payments, reversals, settlement and limits                     |
| [Secrets and key management](profiles/secrets-and-key-management/)             | **Implemented** — 14 rules across secret, key and certificate lifecycle and high-risk access                |
| [Customer and account management](profiles/customer-and-account-management/)   | **Implemented** — 13 rules across customer and business-account lifecycle                                   |
| [Backup and recovery](profiles/backup-and-recovery/)                           | **Implemented** — 13 rules across backup, restore, recovery and failover                                    |
| [API and integration management](profiles/api-and-integration-management/)     | **Implemented** — 13 rules across API credential, webhook and integration lifecycle                         |

**Profiles are not regulatory mappings**, and profile conformance is not legal compliance. A profile
requires audit fields; it cites no regulation, article or jurisdiction, and the definition format
gives it nowhere to put one. Profiles also do not replace privacy linting: a profile says which fields
must be present, the linter says which values must not, and every published profile fixture is
required by test to pass both.

See [profiles/README.md](profiles/README.md), [ADR 0005](decisions/0005-core-and-profile-separation.md)
and [ADR 0008](decisions/0008-declarative-profile-conformance.md).

## Legal and compliance limitations

Read this section before citing OpenAuditModel in any compliance context.

1. **No compliance guarantee.** Conformance is a statement about the shape and semantics of data. It
   is not compliance with GDPR, HIPAA, SOC 2, ISO 27001, PCI DSS, or any other framework, and must not
   be presented as such.
2. **No legal advice.** Nothing in this repository is legal advice.
3. **No regulatory mappings.** The core model contains no regulation identifiers, article numbers,
   control identifiers or jurisdiction-specific fields, deliberately. `controlCategories` carries
   regulation-neutral labels only.
4. **No evidentiary status.** A hash or signature does not automatically make an audit record
   admissible or probative. That depends on jurisdiction, process and key custody.
5. **Tamper-evident, not immutable.** Integrity metadata makes alteration detectable. It does not
   prevent deletion, does not provide storage immutability and does not replace write-once storage.
   See [specification/integrity.md](specification/integrity.md).
6. **Validation cannot detect secrets.** A password in `metadata` passes every test in this
   repository. See [specification/privacy.md](specification/privacy.md).
7. **Experimental.** The model may change incompatibly before 1.0.

## Contributing

Contributions are welcome, including disagreement with the decisions recorded in
[decisions/](decisions/).

Specification changes follow an RFC-like process: open an issue using the specification change
template, describing the problem, the proposed change, the compatibility impact and the conformance
tests that would prove it. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to propose a core field, a
semantic convention, a domain profile, an external mapping or a vendor extension, and how
compatibility is evaluated.

Please also read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security issues go to
[SECURITY.md](SECURITY.md), not to the public tracker.

## Licensing

All content in this repository — specification text, JSON Schemas, examples, tooling and tests — is
licensed under the **Apache License 2.0**. See [LICENSE](LICENSE).

A single license was chosen deliberately for v0.1. Splitting documentation under a separate content
license such as CC BY 4.0 is a reasonable thing for a standards project to do, and adds a licensing
boundary that contributors have to reason about on every change. If the project's governance later
justifies that boundary, the change will be recorded as an architecture decision. Until then, one
license applies to everything.

This repository contains no copyrighted control framework text, no proprietary framework content, no
licensed regulatory commentary and no vendor documentation.

## Status of this repository

Version 0.1 is a specification, a canonical schema and a conformance toolchain. It is experimental,
not production-ready, and carries no compliance guarantee.
