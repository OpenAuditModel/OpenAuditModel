# OpenAuditModel Core Specification — Overview

**Specification version: 0.1 · Status: Experimental · This document: Normative**

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

A JSON document is a **conforming OpenAuditModel v0.1 event** if and only if it validates against the
[OpenAuditModel Audit Event Schema](../schemas/v0.1/audit-event.schema.json), identified by:

```text
https://openauditmodel.org/schemas/audit-event/0.1/schema.json
```

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
| **Experimental** | Expected to change, possibly incompatibly, before version 1.0. All of version 0.1 is experimental.          |

Where a document is normative, only the capitalized keywords defined in
[terminology.md](terminology.md) express requirements.

Everything under [examples/](../examples/), [mappings/](../mappings/) and [profiles/](../profiles/)
is informative in v0.1. [semantic-conventions/](../semantic-conventions/) is normative only where it
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

### 6.1 Version 0.1

`specVersion` is a constant in v0.1:

```json
{ "specVersion": "0.1" }
```

The canonical schema enforces this with `const`. An event that declares any other value is not a
conforming v0.1 event.

Fixing the value keeps the experimental phase unambiguous: there is exactly one version of the model
in existence, and no producer can claim conformance to a version that has not been published.

### 6.2 Future versions

The compatibility strategy **is expected to change** after v0.1. Later versions may:

- Replace the `const` constraint with a range or a set of accepted versions.
- Define which changes are compatible and which require a version increment.
- Define how a consumer should behave when it receives a newer minor version.

None of that is decided in v0.1, and implementations MUST NOT assume any particular future strategy.
The decision will be recorded as an architecture decision record in [decisions/](../decisions/).

### 6.3 What is already committed to

Even in the experimental phase, two rules hold:

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

## 8. Stability warning

Version 0.1 is **experimental and not production-ready**. Field names, constraints, vocabularies and
the compatibility strategy may all change. It carries **no compliance guarantee** of any kind.
