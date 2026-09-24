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
| **Specification version** | 1.0 — stable; events written under 0.1 are still read            |
| **Tooling release**       | 1.0.0 — the CLI and MCP server, versioned in `package.json`      |
| **Project status**        | **Stable specification**                                         |
| **Production use**        | **Not yet proven** — see below                                   |
| **Compliance**            | **No compliance guarantee**                                      |
| **Canonical schema**      | `https://openauditmodel.org/schemas/audit-event/1.0/schema.json` |
| **License**               | Apache License 2.0                                               |

**1.0 means the specification is frozen and the tooling is complete.** The schema at its 1.0 address
will not change, the identifiers it publishes are permanent, and every later 1.x version follows the
compatibility rules in [ADR 0017](decisions/0017-versioning-and-compatibility.md): a minor version
only adds, and nothing an event valid under 1.0 relies on is taken away. The conformance tooling
implements everything the specification defines, with one shortfall it names: only `validate` gives
an event of a version it does not implement a verdict of its own; the other commands never pass such
an event, but count it as schema-invalid ([ADR 0017](decisions/0017-versioning-and-compatibility.md),
Consequences).

It does **not** mean the model has been proven in production. One producer has been measured against
it and does not yet conform, and no deployment is known to run on it. That claim will be made when
there is evidence for it, and not before.

The two versions move independently: tooling releases ship fixes and commands without touching the
model, and the specification version changes only when the schema or a normative document changes
meaning. Every release note states both. Nothing here constitutes legal advice, and conformance to
this specification is not compliance with any law, regulation, standard or contract.

---

## Quick start

No install, no checkout — three commands against one file.

```bash
cat > audit-event.json <<'EOF'
{
  "specVersion": "1.0",
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

- `validate` returns it when **no event failed and at least one declares a specification version
  this tool does not implement**, such as a later 1.x. That event was not evaluated: not passed,
  and not failed either, because the rules it claims are not rules this tool has.
- `check-profile` returns it when **no rule in the profile governs the event**. That usually means the
  event name does not match the profile's vocabulary — `transfer.created` instead of
  `financial.transfer.execute`, say. **Not-applicable is not conformance.** The profile said nothing
  about this event; it did not approve it.
- `lint-privacy` returns it when the input **is not an OpenAuditModel event**, so nothing was scanned.
  The linter reads the locations the specification defines on an audit event; point it at an
  arbitrary application log and it has nowhere to look. It reports that plainly rather than
  reporting `clean`.
- `verify-chain` returns it when **no event could be assigned to a chain**, so no chain was
  checked. The per-event findings name why — most commonly a missing `integrity.chainId`,
  `integrity.hash` or `sequence`, or a schema-invalid event. A set of events with no verifiable
  chain is not a broken chain; it is a set nothing was proven about.
- `verify-checkpoint` returns it when **the archive holds none of the chains the checkpoint
  names**, so nothing was compared. An archive the checkpoint does not describe is not a verified
  archive.
- `verify-proof` returns it when **the event's hash cannot be established** — no integrity object,
  no hash, an algorithm this verifier does not implement — so there is nothing to prove.

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

**What the profiles will ask for** is in [profiles/REQUIREMENTS.md](profiles/REQUIREMENTS.md): every
event name a profile selects, what each of the 127 rules requires, and the fields the ten profiles
ask for most often. It is generated from the profiles themselves, so it says what the tooling
actually enforces rather than what a document once said it would. Core validation is the floor and
most producers pass it on the first try; the profiles are where a real adoption finds out what it is
not recording.

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
| **CADF**                      | A DMTF audit event standard. Prior art; not an export target in 1.0.             |
| **OSCAL**                     | May later be used for control and assessment mappings. Not addressed in 1.0.     |
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

## What is in 1.0?

```text
specification/         15 normative documents defining the model
schemas/v1.0/          the canonical JSON Schema (Draft 2020-12), stable
schemas/v0.1/          the pre-1.0 schema, kept for events written against it
schemas/checkpoint/    the chain checkpoint schema, a tooling document versioned on its own
schemas/proof/         the inclusion proof schema, with RFC 6962 hashing written into it
semantic-conventions/  recommended event names and vocabularies
profiles/              ten enforceable domain profiles, 127 rules (113 error-severity, 14 advisory)
profiles/REQUIREMENTS.md  generated: what every rule asks for, from the producer's side
mappings/              informative mappings to CloudEvents, OTel, ECS, OCSF, CADF
examples/              11 valid and 7 invalid conformance fixtures
examples/integrity/    generated tamper-evidence fixtures, valid and invalid
examples/privacy/      clean and finding fixtures for the privacy linter
examples/compatibility/ events sealed under 0.1, which the 1.x tooling is held to verifying
examples/profiles/     conforming, violating and out-of-scope profile fixtures
conformance/           the `auditmodel` CLI and its test suite
conformance-kit/       every fixture's expected verdict, as data, for any language
mcp/                   the remote MCP server, distributed as a container image
deploy/                Docker Compose and reverse-proxy examples
decisions/             17 architecture decision records
```

The core model requires seven fields — `specVersion`, `id`, `time`, `event`, `actor`, `resource`,
`application` — and offers nineteen optional context objects covering subject, delegation,
authentication, authorization, approval, request correlation, change, reason, evidence, integrity,
privacy, control categories, metadata and extensions.

Start with [specification/overview.md](specification/overview.md), then
[specification/event-model.md](specification/event-model.md).

## What is stable, and what is not

**Stable from 1.0**, under the rules of [ADR 0017](decisions/0017-versioning-and-compatibility.md):

- **The event schema.** `schemas/v1.0/` never changes. A later 1.x minor may add an optional field,
  add a value to an open vocabulary or an example, or raise a bound or widen a pattern where real
  data needs it — and nothing else.
- **The closed vocabularies.** Every `enum` in the schema stays closed — `actor.type`,
  `event.severity`, `event.outcome`, `authorization.decision`, `delegation.type` and the others;
  adding a value to any of them needs a new major version, because a consumer may rely on the list
  being complete.
- **The digest procedure**, including what it excludes. Changing it would invalidate every stored
  digest, so it does not change.
- **Event names.** A name does not silently change meaning; a new meaning gets a new name.
- **Extensions never weaken the core.**
- **Versions a consumer does not know are not evaluated.** `validate` reports them as such — never
  as conforming, and not as non-conforming either. The other commands never pass such an event, but
  in 1.0.0 they count it as they count a schema-invalid one; [ADR 0017](decisions/0017-versioning-and-compatibility.md)
  lists what each does.
- **The profile definition format.** `profile-definition/0.1` follows ADR 0017 §2 as the event schema
  does: a later version only adds, such as a new rule capability. Inheritance, composition and
  multi-profile checking are not implemented.

**Not stable, and labelled so:**

- **Profiles.** Ten are implemented and enforceable, and every one is marked `experimental`: their
  requirements are reasoned, not validated against real deployments. A revision moves a profile's
  version and publishes it at a new address; the old address keeps working.
- **Privacy rule thresholds and vocabularies.** A property of the tooling, not of the specification:
  hard-coded, with no configuration and no suppression mechanism.

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
schemas, selected by the specVersion each event declares:
  1.0  https://openauditmodel.org/schemas/audit-event/1.0/schema.json (schemas/v1.0/audit-event.schema.json)
  0.1  https://openauditmodel.org/schemas/audit-event/0.1/schema.json (schemas/v0.1/audit-event.schema.json)

ok    examples/valid/minimal-event.json

1 event checked: 1 valid, 0 invalid, 0 unreadable
```

A path may be a JSON file holding one event, a JSON file holding an array of events, a `.jsonl` or
`.ndjson` file holding one event per line, or a directory of those files.

`validate`, `verify-integrity`, `lint-privacy`, `check-profile` and `verify-chain` read a `.jsonl`
or `.ndjson` file a line at a time, and it may be any size: one event is held at a time, so a year
of production is checked with the memory one event needs. That holds for text output. With
`--format json` the report lists every event, so it grows with the archive and is held until it is
written. `verify-checkpoint`, `verify-proof` and `check-coverage` need the whole set at once and
still refuse a file above 8 MB.

A single JSON document is limited to 8 MB whichever command reads it, because a document whose shape
is unknown until its closing brace cannot be parsed in pieces; the same 8 MB is the limit for one
line. If a line cannot be parsed, reading that file stops there and it is reported with the line
number — the events read before it are still checked and counted, and the exit code is still `2`.
`verify-checkpoint` is the exception that proves the rule: it makes no comparison at all on an
archive it could not read in full, because an event that was not read is indistinguishable from one
that was deleted. See [ADR 0016](decisions/0016-events-are-read-as-a-stream.md).

A failure reports the JSON Pointer of every problem:

```text
FAIL  examples/invalid/delegation-without-subject.json
    /subject  missing required property "subject"  [required]
```

Exit codes: `0` valid, `1` at least one event failed validation, `2` usage error or a file that could
not be read or parsed, `3` no event failed and at least one was not evaluated because it declares a
specification version this tool does not implement.

Validation is one half of conformance. The rules a schema cannot express — do not record secrets, do
not misuse `subject` as a target, do not silently redefine an event name — are normative in the
specification and are not detectable by any validator. See
[specification/privacy.md](specification/privacy.md).

## How is an event's integrity verified?

An event MAY carry `integrity` material: a digest of itself, and a link to the previous event in a
chain. Four commands check it, all entirely offline.

```bash
auditmodel verify-integrity examples/integrity/valid/single-event-sha256.json
auditmodel verify-chain examples/integrity/valid/three-event-chain
auditmodel verify-checkpoint examples/integrity/valid/three-event-chain \
  --checkpoint examples/integrity/checkpoints/three-event-chain.checkpoint.json
auditmodel verify-proof examples/integrity/valid/three-event-chain/002.json \
  --proof examples/integrity/proofs/three-event-chain.002.proof.json
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
  head:      a7da7bab810f1386942e86d11b3277cbe56a5cc71f6bdc01da0eded57c829c00
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

**What is reported beyond the verdict.** Each chain's **head** — the declared hash of its
highest-sequence event — is printed, because it is the value to publish somewhere the store's
administrators do not control and the value a checkpoint is compared against. The sealing batches
events declare in `integrity.batchId` are listed as a note: reported, never judged, because a batch
is the group sealed together and not a verification scope. See
[ADR 0013](decisions/0013-batch-id-reported-not-judged.md).

**What chain verification cannot see.** Whether the events you supplied are all the events that
existed: chain verification proves consistency of the supplied set, and an attacker who removes the
_end_ of a chain leaves something internally consistent. Seeing that needs a **checkpoint** — the
chain's head, recorded and kept somewhere the store's administrators do not control — and
`verify-checkpoint` is the command that compares an archive with one. The published truncated chain
shows the two commands disagreeing on purpose:

```bash
auditmodel verify-chain examples/integrity/invalid/truncated-chain        # exit 0: consistent
auditmodel verify-checkpoint examples/integrity/invalid/truncated-chain \
  --checkpoint examples/integrity/checkpoints/three-event-chain.checkpoint.json   # exit 1
```

```text
  checkpoint: head at sequence 3
  FAIL
    the chain ends at sequence 2, but the checkpoint records a head at sequence 3  [tail-truncated]
```

A checkpoint is a small JSON document under its own schema
([`/schemas/checkpoint/0.1/schema.json`](https://openauditmodel.org/schemas/checkpoint/0.1/schema.json)):
the chain, the head's sequence and hash, when it was taken, optionally the event count and a
signature, and an **anchor** naming where the record was put beyond the store's reach. The anchor is
required by the schema and never dereferenced. The verdict is what the tool can honestly give, and it
says so after every run: the archive is consistent with the checkpoint it was handed; whether the
checkpoint is genuine and its anchor real is for whoever holds the anchor. A checkpoint from yesterday
does not fail today's archive — events after the head are noted as not covered — and an archive that
holds none of the chains the checkpoint names exits `3`, never `0`. Key generation, storage, rotation,
revocation and certificate parsing remain out of scope, regardless of whether a signature is present.
See [ADR 0014](decisions/0014-chain-checkpoints.md).

**Proving one event belongs to a published tree.** A checkpoint covers a chain; an **inclusion
proof** covers one event. It is a sidecar document
([`/schemas/proof/0.1/schema.json`](https://openauditmodel.org/schemas/proof/0.1/schema.json))
holding the event's `integrity.hash` as the leaf, the sibling hashes up to a Merkle root, and the
root with the same anchoring rule a checkpoint has. Nothing is added to the event. `verify-proof`
checks the proof's own consistency first — the path must have the shape the leaf's index and the
tree's size imply, and must recompute to the recorded root — then verifies the event exactly as
`verify-integrity` does and requires its hash to be the leaf. The hashing is RFC 6962's, written
into the schema so that an implementer in another language builds the same tree: a leaf is
`H(0x00 ‖ digest)`, a node is `H(0x01 ‖ left ‖ right)`, and an odd node is promoted unchanged. A
passing proof shows membership of the tree the root describes; the root's provenance is the
anchor's, and the tool says so. See [ADR 0015](decisions/0015-merkle-inclusion-proofs.md).

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
<path>`, a PEM-encoded public key for the declared algorithm — `Ed25519`, `ECDSA-P256-SHA256` or
`RSA-PSS-SHA256`, the three the schema's own description recommends; the key's type, curve and size
must match the algorithm, and a mismatch is reported as such rather than as a signature that "does
not match". It verifies over the same digest input as the hash, so a signed chain is exactly as
tamper-evident as a hashed one. Without the flag, a declared signature is
reported as present but not checked — never silently passed over — and an algorithm this verifier
does not implement fails verification whether or not a key is supplied. A signature currently
requires an accompanying `hash` to be checked at all. There is no key registry: `keyId` is never
dereferenced, and a verifying party supplies the key it already trusts. One key per run:
`verify-checkpoint` and `verify-proof` apply it to the document's own signature and to every event's,
so a checkpoint or root signed by a different party than the events is verified in two runs, one per
key. See [ADR 0012](decisions/0012-ed25519-signature-verification.md).

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

Exit codes: `0` no findings, `1` findings, `2` usage or input error, `3` no findings and at least one
input that is not a schema-valid event, so it was not scanned. Full
rule catalogue, thresholds, inspected paths and honest limits:
[specification/privacy.md](specification/privacy.md) §6 and
[ADR 0007](decisions/0007-deterministic-privacy-linting.md).

## How do I use it from an AI agent?

A remote MCP server exposes the same deterministic engines the CLI uses, so an agent writing
instrumentation can validate, privacy-lint and profile-check an event without cloning anything.

```bash
claude mcp add --transport http openauditmodel https://mcp.openauditmodel.org/mcp
```

Ten tools — `validate_event`, `verify_integrity`, `verify_chain`, `verify_checkpoint`,
`verify_proof`, `lint_privacy`, `check_profile`, `check_coverage`, `generate_event_template`,
`get_event_guidance` — three prompts, and thirty-seven read-only resources: seven specification
chapters, five schemas (the audit event schema for 1.0 and for 0.1, the profile definition schema,
the chain checkpoint schema and the inclusion proof schema), the semantic-conventions index and twelve
convention documents, the profile index and all ten profile definitions, and the examples index.

**It is a remote service, and this matters.** MCP tool inputs are processed ephemerally by the
OpenAuditModel MCP service. The service does not intentionally persist audit event content or
include tool arguments in application logs. Users should review their organization’s data-handling
requirements before submitting production audit events to a remote MCP service. Nothing here claims
your events stay on your machine — they do not. For regulated audit data, use the CLI, which sends
nothing anywhere.

No model runs inside the server: every tool is deterministic and read-only, and the prompts return
guidance text for your agent to act on. Findings never carry the value that produced them.

> Deployed and verified: `https://mcp.openauditmodel.org/mcp` answers, and the site above serves the
> canonical schemas. The MCP endpoint is public and unauthenticated, with no availability guarantee
> — see [mcp/README.md](mcp/README.md), "Public service risk".

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

### Checking an implementation in another language

[ADR 0001](decisions/0001-specification-first.md) promises that "an implementation in any language can
be checked against the same fixtures". [conformance-kit/manifest.json](conformance-kit/manifest.json)
is what makes that actionable: for all 327 published fixtures, 7 chains, 8 checkpoint cases and 6 proof cases it records the verdict each
engine returns — rule identifiers, JSON Pointers, statuses, severities and finding kinds.

Human-readable messages are deliberately absent. An implementation that words an error differently is
not wrong, and a kit that compared prose would fail every translation.

**The kit confers nothing.** No badge, no "compatible" status, no listing. An implementation that
reproduces every verdict has demonstrated that it answers the same as the reference implementation on
the cases this project chose to publish — which is worth having, and is not a claim about the
implementation in general. See [conformance-kit/README.md](conformance-kit/README.md).

### How much of a profile is my instrumentation reaching?

`check-profile` answers "does this event conform?". That is the second question. The first is whether
the profile reaches your events at all, and a summary line that counts only failures cannot tell you:
an export with no violations and an export the profile never governed look identical.

```bash
auditmodel check-coverage ./audit-export.jsonl --profile incident-management
```

```text
204 events checked: 0 conforming, 15 with violations, 189 not applicable, 0 core-invalid

rules: 15 in the profile, 6 selected, 6 applied
  INC-CORE-001      error    selected    15   applied    15   failed    15
  ...
  never selected (9): INC-STATE-002, INC-ASSIGN-001, INC-CLOSE-001, ...

event names: 30 distinct, 2 governed, 28 ungoverned
```

**It counts events, not obligations.** "6 of 15 rules selected" describes this event set. It is not a
percentage of conformance, a maturity score or a grade, and a low number is the normal state of a
narrow export rather than a defect. There is no threshold and no target, because a threshold would be
policy and this is a measurement.

Two lines in that report carry most of its value:

- **The ungoverned names.** They are what tell a producer that its vocabulary and the profile's have
  not met. No per-event verdict shows this, because every one of those events is individually
  `not-applicable` and individually unremarkable.
- **Selected but never applied.** A rule with a condition is selected by an event's name and then
  contributes nothing, because the condition did not hold. A profile requiring an approval _when the
  producer marks the closure as needing one_ is selected on every closure and applied on none against
  a producer that never writes the flag. Nothing fails and nothing is checked; only this line says so.

**It never exits `1`.** Coverage makes no pass or fail claim — `check-profile` is the command that
judges. It exits `0` when the profile governed at least one event, `3` when it governed none, and `2`
when it could not run.

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
7. **Not proven in production.** The specification is stable; whether it serves real deployments
   well is what the first adopters will show.

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

A single license was chosen deliberately. Splitting documentation under a separate content
license such as CC BY 4.0 is a reasonable thing for a standards project to do, and adds a licensing
boundary that contributors have to reason about on every change. If the project's governance later
justifies that boundary, the change will be recorded as an architecture decision. Until then, one
license applies to everything.

This repository contains no copyrighted control framework text, no proprietary framework content, no
licensed regulatory commentary and no vendor documentation.

## Status of this repository

Version 1.0 is a stable specification, a canonical schema and a conformance toolchain. The schema is
frozen and the tooling complete; production use is not yet proven; and there is no compliance
guarantee, in this version or any other.
