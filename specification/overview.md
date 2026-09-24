# OpenAuditModel Core Specification — Overview

**Specification version: 1.0 · Status: Stable · This document: Normative**

> OpenAuditModel defines a common, verifiable and backend-independent audit event model for business
> applications.

## 1. Purpose

Business applications record auditable operations. Almost every application invents its own shape for
those records, so audit data cannot be validated, correlated, reviewed or exported without bespoke
work in every system. OpenAuditModel defines one shape for that data.

The specification describes **what an audit event is**, not where it is stored, how it is
transported, or which regulation it satisfies.

## 2. Scope

This specification defines:

1. The structure of an audit event.
2. The meaning of each field in that structure.
3. The rules a conforming event MUST satisfy.
4. The rules a conforming producer and consumer MUST satisfy.
5. The extension mechanism by which vendors and domains add their own data.

This specification does not define:

- A storage format, database, index or retention system.
- A transport protocol, wire encoding or delivery guarantee.
- A query language or reporting model.
- An authorization or policy evaluation engine.
- A mapping to any regulation, standard or control framework.

See [design-principles.md](design-principles.md) for why these exclusions exist, and the repository
[README](../README.md) for the full list of non-goals.

## 3. Conformance

### 3.1 Conforming event

A JSON document is a **conforming OpenAuditModel 1.0 event** if and only if it validates against the
[OpenAuditModel Audit Event Schema 1.0](../schemas/v1.0/audit-event.schema.json), identified by:

```text
https://openauditmodel.org/schemas/audit-event/1.0/schema.json
```

An event written against an earlier version conforms to that version by validating against that
version's schema; [0.1](../schemas/v0.1/audit-event.schema.json) stays published. The version an
event declares selects the schema it is judged by — see §6.

Schema validation is necessary but **not sufficient** for a good audit event. Rules that a schema
cannot express — a `subject` used as a target resource, a secret placed in `metadata`, an event name
that changed meaning between releases — are stated normatively in this specification and MUST be
satisfied by conforming producers even though a validator cannot detect their violation.

### 3.2 Conforming producer

A conforming producer:

- MUST emit events that validate against the canonical schema.
- MUST set `specVersion` to the version of the specification the event conforms to.
- MUST NOT record the values listed as prohibited in [privacy.md](privacy.md).
- MUST keep the meaning of an event name stable across releases, as required by
  [event-model.md](event-model.md).
- SHOULD populate only the optional fields its audit purpose requires.

### 3.3 Conforming consumer

A conforming consumer:

- MUST accept any event that validates against the canonical schema, including events that use only
  the required fields.
- MUST NOT reject an event because it carries `metadata` or `extensions` the consumer does not
  recognise.
- MUST treat `event.summary` as human-readable text and MUST NOT parse it for machine decisions.
- SHOULD deduplicate events by `id`, as described in [delivery.md](delivery.md).

### 3.4 Conformance is not compliance

Conformance to this specification is a statement about the **shape and semantics of data**. It is not
a statement about regulatory, legal or contractual compliance, and it MUST NOT be presented as one.

## 4. Document status labels

Every document in this repository is labelled with one of:

| Label            | Meaning                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| **Normative**    | Defines requirements. Conforming implementations MUST satisfy them.                                         |
| **Informative**  | Explains, illustrates or maps. Carries no requirements, even where it uses examples that look prescriptive. |
| **Stable**       | Changes only as §6 allows: a later minor adds, and nothing an event relies on is taken away.                |
| **Experimental** | Expected to change, possibly incompatibly. Profiles are experimental; the core specification is stable.     |

Where a document is normative, only the capitalized keywords defined in
[terminology.md](terminology.md) express requirements.

Everything under [examples/](../examples/), [mappings/](../mappings/) and [profiles/](../profiles/)
is informative. [semantic-conventions/](../semantic-conventions/) is normative only where it
says so explicitly; its recommended vocabularies are otherwise SHOULD-level guidance.

## 5. Specification documents

| Document                                                 | Covers                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| [terminology.md](terminology.md)                         | Normative keywords and the vocabulary used throughout           |
| [design-principles.md](design-principles.md)             | The constraints that shape every decision in the model          |
| [event-model.md](event-model.md)                         | Top-level structure, identity, time, event descriptor, outcomes |
| [actor-model.md](actor-model.md)                         | Who acted, and on whose behalf                                  |
| [resource-model.md](resource-model.md)                   | What was acted upon                                             |
| [authentication.md](authentication.md)                   | How the actor was authenticated                                 |
| [authorization.md](authorization.md)                     | Which decision permitted or denied the operation                |
| [approval-and-delegation.md](approval-and-delegation.md) | Human approval and transferred authority                        |
| [change-model.md](change-model.md)                       | What changed, without leaking the data that changed             |
| [evidence-model.md](evidence-model.md)                   | Referencing supporting material                                 |
| [privacy.md](privacy.md)                                 | What MUST NOT be recorded, and how personal data is described   |
| [integrity.md](integrity.md)                             | Tamper-evidence, and what it does and does not guarantee        |
| [delivery.md](delivery.md)                               | Producing, transporting and receiving events                    |
| [extension-model.md](extension-model.md)                 | `metadata`, `extensions` and profile boundaries                 |

## 6. Versioning and compatibility

### 6.1 Versions

`specVersion` is a string of the form `MAJOR.MINOR`: two non-negative decimal integers joined by a
full stop, each without a leading zero. `"1.0"` and `"1.10"` are of the form; `"01.0"`, `"1.00"`,
`"1"` and `"v1.0"` are not. Each published version has its own schema at its own permanent address,
and that schema fixes `specVersion` to its own value:

| Version | Schema                                                           | Status                                        |
| ------- | ---------------------------------------------------------------- | --------------------------------------------- |
| `1.0`   | `https://openauditmodel.org/schemas/audit-event/1.0/schema.json` | Stable. What producers emit.                  |
| `0.1`   | `https://openauditmodel.org/schemas/audit-event/0.1/schema.json` | Pre-1.0. Still read; its schema never changes |

1.0 is 0.1 with a new version number and one optional field, `request.parentSpanId`. Every event
valid under 0.1 is valid under 1.0 once its `specVersion` says `"1.0"`. A sealed event is not
migrated: `specVersion` is inside its digest, and an archive keeps what was sealed.

### 6.2 Compatibility

The rules are recorded in [ADR 0017](../decisions/0017-versioning-and-compatibility.md) and are
normative from 1.0.

Within a major version, a minor version MAY only add an optional property (with any `$defs` entry
only optional properties use), add values to an open vocabulary or examples to any property, or raise
an upper bound or widen a pattern where measurement shows the old one refused real data. Every other
change requires a new major version.

A validator MUST select the schema by the version an event declares:

- An event declaring a version the validator implements is validated against that version's schema.
- An event declaring any other well-formed version — a newer minor, another major, or a version never
  published — is **not evaluated**. A validator MUST NOT report it conforming and SHOULD NOT report it
  non-conforming: it reports that the version is not one it implements, and names the versions it
  does.
- An event with no `specVersion`, or one not of the form `MAJOR.MINOR`, is non-conforming.

A consumer that only stores, forwards or displays events MAY accept a newer minor of a major it
implements, MUST ignore the properties it does not know, and MUST NOT present such an event as
validated.

### 6.3 What is already committed to

Two rules predate ADR 0017 and hold in every version:

1. **Event names do not silently change meaning.** If the meaning of an event name changes, the name
   changes. See [event-model.md](event-model.md).
2. **Extensions never weaken the core.** An extension MUST NOT remove a required field, relax a
   constraint, or redefine the meaning of a core field. See
   [extension-model.md](extension-model.md).

## 7. Relationship to other standards

OpenAuditModel is an **event model**, not a transport, a telemetry pipeline or a security taxonomy.
It is designed to be carried by, and mapped to, the standards that already exist:

- **CloudEvents** MAY carry an OpenAuditModel event as its `data` payload.
- **OpenTelemetry** MAY transport, collect and correlate audit events, and `request.traceId` /
  `request.spanId` are defined to be compatible with W3C Trace Context.
- **ECS** and **OCSF** MAY be produced from OpenAuditModel events by export mappings.
- **CADF** is a conceptual reference for audit semantics.
- **OSCAL** may later be used for control and assessment mappings.

None of these are required. An OpenAuditModel event is valid on its own, with no envelope and no
pipeline. See [mappings/](../mappings/), which is informative.

## 8. Stability

Version 1.0 is **stable**: the schema at its address will not change, and later versions follow §6.
It is **not yet proven in production**, and it carries **no compliance guarantee** of any kind.
