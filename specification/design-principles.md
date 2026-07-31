# Design Principles

**Specification version: 0.1 · Status: Experimental · This document: Normative**

These principles are the reason the model looks the way it does. They are normative in the sense that
a proposed change to the core model MUST be evaluated against them, and a change that violates one
MUST be rejected or must first change the principle.

## 1. The core stays small

The core model contains only concepts that are meaningful in **every** business application,
regardless of industry, jurisdiction or architecture.

A field belongs in the core only if all of the following hold:

1. It is meaningful to a document system, a payment system, a hospital system, a message broker
   console and an internal admin tool alike.
2. Omitting it would make an audit event ambiguous in a way no other field resolves.
3. It cannot be expressed as `metadata`, an extension, or a profile requirement without losing
   cross-application comparability.

Everything else belongs in `metadata`, `extensions` or a profile. A core model that grows to cover
every domain stops being a common model.

## 2. The core is explainable

An engineer MUST be able to read [event-model.md](event-model.md) and instrument an application
correctly without reading the rest of the specification. Concepts that require a diagram of five
interacting objects to explain are a sign that the model is wrong, not that the reader is slow.

## 3. Composition, not inheritance

The model has no type hierarchy, no discriminated event subclasses and no abstract base event.
An event is a flat set of optional context objects attached to a small required core. A privileged
configuration change is not a subclass of a change: it is an event with `change`, `approval`,
`authorization` and `controlCategories` populated.

This keeps the schema flat, keeps validation cheap, and keeps profiles additive.

## 4. Backend independence

The model MUST NOT require, assume or favour any storage system, message broker, telemetry pipeline,
SIEM, cloud provider or vendor product. An event MUST be equally valid when it is written to a file,
inserted into a table, published to a topic or held in memory.

Consequences that are enforced today:

- No field describes a storage location, index, partition key or retention backend.
- `application` describes the **producer**, never a collector or a store.
- Schema identifiers never have to be dereferenced: no `$ref` resolves remotely, so validation never requires a network call.
- Validation is fully offline.

See [ADR 0003](../decisions/0003-backend-and-transport-independence.md).

## 5. Transport independence

The model defines no transport, envelope or delivery guarantee. It MAY be carried by CloudEvents,
OpenTelemetry, HTTP, a broker, a file or a database write. Delivery concerns — retries, duplicates,
ordering, batching — are addressed by making the event **idempotent and self-describing**, not by
defining a protocol. See [delivery.md](delivery.md).

## 6. Machine-verifiable by default

Every rule that **can** be expressed in JSON Schema Draft 2020-12 **is** expressed there, so that
conformance is testable rather than aspirational. This includes conditional rules such as "a failure
carries an error" and "acting for a principal identifies that principal".

Where a rule cannot be machine-checked — such as "do not log secrets" — the specification says so
explicitly rather than pretending validation covers it. See [privacy.md](privacy.md).

Schema patterns MUST remain portable across regular expression engines: no look-around and no
back-references, so that the same schema behaves identically in JavaScript, Python, Go, Java and .NET
validators.

## 7. Strict where it matters, open where it must be

Core objects reject unknown properties. This is deliberate: silently accepting an unknown field means
a producer can believe it is recording something that no consumer will ever read.

Vocabularies are treated differently depending on whether the value space is universal:

| Kind                  | Enforcement                         | Examples                                                                  |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| **Closed vocabulary** | `enum` in the schema                | `event.outcome`, `event.severity`, `actor.type`, `authorization.decision` |
| **Open vocabulary**   | Form constrained, membership is not | `resource.type`, `resource.classification`, `application.environment`     |

A vocabulary is closed only when the value set is small, universal, and load-bearing for
interpretation. A vocabulary is open when organizations legitimately differ — classification schemes
and environment names differ between companies, and forcing them into a fixed list would produce
false data rather than comparable data.

Both are constrained in **form**: open vocabulary values are lower-case, hyphen-separated tokens, so
that they remain comparable even when they are not identical.

## 8. Privacy is a first-class constraint

Audit data is high-risk data: it concentrates who did what to whom. The model therefore:

- Prohibits specific values outright, in normative language.
- Prefers stable identifiers over personal identifiers.
- Prefers route templates over resolved URLs.
- Prefers changed field names over changed field values.
- Prefers references over embedded payloads.
- Treats capture as an **allowlist**: a producer records the fields it decided to record, never
  "whatever the request contained".

See [privacy.md](privacy.md).

## 9. Regulation-neutral, industry-neutral, jurisdiction-neutral

The core model MUST NOT contain a regulation identifier, an article number, a control identifier, a
country-specific field or an industry-specific field. Not because compliance does not matter, but
because a model that encodes one framework becomes unusable everywhere that framework does not apply,
and becomes wrong when the framework is revised.

Regulatory interpretation is a **mapping over** audit data, produced and maintained separately from
the data model. `controlCategories` exists to carry the neutral half of that relationship.

## 10. Stability of meaning

An event name, once published, keeps its meaning. A field, once defined, keeps its meaning. If the
meaning must change, the name changes.

Silent redefinition is worse than a breaking change: a breaking change is detected by a validator,
while a silent redefinition corrupts historical analysis without anyone noticing.

## 11. Specification before implementation

The normative model, the canonical schema and the conformance tooling come before production SDKs.
An SDK written first would freeze accidental implementation details into the standard. See
[ADR 0001](../decisions/0001-specification-first.md).

## 12. Do not confuse completeness with quality

An event that populates every optional object is not a better audit event than one that populates
five fields correctly. Optional fields exist so that applications with a real need can express it —
not as a checklist. Producers SHOULD populate what their audit purpose requires and omit the rest.
