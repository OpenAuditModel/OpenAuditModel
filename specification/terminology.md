# Terminology

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Normative keywords

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY** and **OPTIONAL** in this specification
are to be interpreted as described in RFC 2119 and RFC 8174.

These words are normative **only when they appear in capital letters**. The same words in lower case
carry their ordinary English meaning and impose no requirement. A sentence such as "an implementation
should usually record the reason" is guidance; "an implementation SHOULD record the reason" is a
normative recommendation.

Normative keywords apply only inside documents labelled **Normative**. In an **Informative** document
they are illustrative even when capitalized, unless the document states otherwise for a specific
section.

## 2. Interpretation of the keywords

| Keyword                     | Meaning in this specification                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| MUST, REQUIRED, SHALL       | An absolute requirement. An implementation that violates it is not conforming.                                             |
| MUST NOT, SHALL NOT         | An absolute prohibition.                                                                                                   |
| SHOULD, RECOMMENDED         | There may exist valid reasons to ignore this, but the full implications must be understood and weighed before doing so.    |
| SHOULD NOT, NOT RECOMMENDED | There may exist valid reasons to do this anyway, but the full implications must be understood and weighed before doing so. |
| MAY, OPTIONAL               | Genuinely optional. An implementation that omits it is conforming, and one that includes it is conforming.                 |

A consumer MUST NOT require an OPTIONAL field to be present, and MUST NOT fail on an OPTIONAL field
it does not use.

## 3. Vocabulary

### 3.1 Core concepts

**Audit event** — A structured record of a single auditable operation, describing who performed it,
what it acted upon, what the result was, and the context needed to review it later. Defined by
[event-model.md](event-model.md).

**Auditable operation** — An operation whose occurrence is significant to security, accountability,
governance or dispute resolution, independent of whether it succeeded.

**Core model** — The fields defined by this specification and enforced by the canonical schema.
Universal across industries, jurisdictions and architectures.

**Core object** — A top-level object defined by the core model, such as `event`, `actor` or
`application`. Core objects reject unknown properties.

**Canonical schema** — The JSON Schema document that machine-verifies the core model, identified by
`https://openauditmodel.org/schemas/audit-event/0.1/schema.json`.

### 3.2 Participants

**Principal** — Any entity that can act or be acted on behalf of: a person, a service, an automated
system or an external party. Represented by the shared shape used for `actor` and `subject`.

**Actor** — The principal that **technically performed** the operation. Always present.

**Subject** — The principal **on whose behalf** the operation was performed, when that differs from
the actor. Never the target of the operation. See [actor-model.md](actor-model.md).

**Resource** — The thing the operation **acted upon**. See [resource-model.md](resource-model.md).

**Producer** — The application that creates and emits audit events. Described by `application`.

**Collector** — Any component that receives, buffers, enriches or forwards events between a producer
and a consumer. A collector is not the producer, and MUST NOT be described in `application`.

**Consumer** — Any system that reads audit events: a store, an analysis pipeline, a review tool, an
export job.

### 3.3 Context

**Authentication context** — Evidence of _how the actor proved its identity_. See
[authentication.md](authentication.md).

**Authorization context** — The _policy decision_ that permitted or denied the operation. See
[authorization.md](authorization.md).

**Approval context** — A _decision made by one or more principals_, usually humans, that the
operation may proceed. See [approval-and-delegation.md](approval-and-delegation.md).

**Delegation** — The transfer of authority from a subject to an actor.

**Evidence** — A reference to material that supports the event, held in its own system. Evidence is
referenced, never embedded. See [evidence-model.md](evidence-model.md).

**Control category** — A regulation-neutral label describing the kind of control an event provides
evidence for, such as `privileged-access`. Control categories are not regulation identifiers.

### 3.4 Extension points

**Metadata** — Domain-specific audit interpretation data with no core representation, carried in
`metadata`. Keys are plain names.

**Extension** — Vendor-specific or domain-specific data carried in `extensions` under a
reverse-domain namespaced key. See [extension-model.md](extension-model.md).

**Profile** — An optional, stricter set of requirements for a specific domain, layered on top of the
core model. A profile MAY require fields the core model leaves optional; it MUST NOT relax the core.
See [profiles/](../profiles/).

**Semantic convention** — A recommended vocabulary or naming rule that makes independently produced
events comparable. See [semantic-conventions/](../semantic-conventions/).

### 3.5 Vocabularies

**Closed vocabulary** — A fixed set of values enforced by the canonical schema through `enum`. A
value outside the set makes the event invalid.

**Open vocabulary** — A set of RECOMMENDED values that the schema constrains only in form, not in
membership. Producers MAY use values outside the recommended set. Open vocabularies exist where the
value space genuinely varies between organizations, such as resource types and data classifications.

### 3.6 Integrity

**Tamper-evident** — A property of data that makes unauthorized alteration **detectable**. This
specification uses only this term.

**Immutable** — Deliberately **not** used for event-level or SDK-level guarantees. An audit event
model cannot make anything immutable; only a storage system can. See [integrity.md](integrity.md).

**Canonicalization** — Producing a deterministic byte representation of an event so that a hash or
signature over it is reproducible. RFC 8785 is RECOMMENDED.

**Chain** — An ordered sequence of events linked by `integrity.previousHash`, so that removal or
alteration of a member becomes detectable. Chains may be per instance, per partition or per batch.

## 4. Notation

- Field paths are written as JSON Pointers or dotted paths: `/event/outcome` or `event.outcome`.
- Code blocks labelled `json` are examples, and are informative.
- "The schema" without qualification means the canonical schema for the specification version of the
  document.
