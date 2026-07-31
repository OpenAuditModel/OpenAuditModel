# 0005 — Core and profile separation

## Status

Accepted — 2026-07-30. Applies to specification version 0.1.

**Amended.** This ADR was written when no profile was implemented, and its statements that profiles
are "not implemented in v0.1" and that `check-profile` does not exist described the repository at
that time. Both are now false: ten enforceable profiles ship and `auditmodel check-profile` is
implemented. See [ADR 0008](0008-declarative-profile-conformance.md) for the conformance mechanism.
The separation this ADR decides — that a profile may only add constraints and never relax the core —
is unchanged and is enforced by the engine.

## Context

Different domains need different guarantees from an audit trail.

A document management system needs to know that every external share records an expiry and a
recipient type. An incident management system needs to know that every major incident closure records
an approval and a root cause reference. A message broker console needs to know that every destructive
production operation records a justification.

Each of those is a legitimate requirement, and none of them is universal. Requiring an expiry field
on every audit event in every application would be absurd; so would requiring approval on every event.

There are three ways to handle this:

1. Put every domain's requirements in the core model, with everything optional. The core becomes
   large, most fields are irrelevant to any given adopter, and no requirement is actually enforced —
   "optional everywhere" means "guaranteed nowhere".
2. Let each domain define its own model. Nothing is comparable across domains, which is the situation
   the project exists to fix.
3. Define a small universal core, and layer optional domain profiles that add requirements on top.

## Decision

The model is split into a **core** and optional **profiles**.

**The core** contains only concepts meaningful in every business application, and defines the
requirements every conforming event satisfies. Membership is governed by
[design principle 1](../specification/design-principles.md#1-the-core-stays-small).

**A profile** is an optional, stricter set of requirements for a specific domain. A profile MAY:

- Require fields the core leaves OPTIONAL, for a specific class of events.
- Define expected `metadata` fields and their meaning.
- Define a recommended event name vocabulary for its domain.
- Define additional conformance fixtures.

A profile MUST NOT:

- Relax any core requirement.
- Add top-level properties.
- Redefine the meaning of a core field.
- Introduce product-specific, company-specific, country-specific or regulation-specific fields.

**Therefore:** every profile-conforming event is a core-conforming event. The reverse does not hold.
Profile conformance is strictly additional, never alternative.

Profiles are **not implemented in v0.1**. The documents in [profiles/](../profiles/) record intended
scope and are informative placeholders.

## Consequences

**Positive**

- The core stays small enough to read in one sitting and instrument correctly without a domain
  specialist.
- Domain requirements can be strict, because they only apply where they make sense. A document
  profile can require share expiry without imposing it on a payment system.
- Profiles can evolve on their own schedule without a core version bump, which matters because
  domains mature at different rates.
- A consumer that understands only the core can process every event from every profile. Profile
  awareness is an optimization, not a prerequisite.
- Profiles give domain communities somewhere to contribute without pressure to expand the core.

**Negative**

- Two levels of conformance is more to explain than one, and "conforming" becomes a question of "to
  what?".
- A field can be required by one profile and absent in another domain's events, so cross-domain
  analysis still needs to handle absence.
- Profiles can drift: two profiles may model the same concept differently in `metadata`. Preventing
  that requires review, which requires governance the project does not yet have.
- Tooling is more complex. `auditmodel check-profile` is planned and does not exist in v0.1, so
  profile requirements are currently unenforceable even once written.
- There is a risk that profiles become the place where product-specific fields are smuggled in under
  a domain name. The constraint against it is stated, and depends on review.

**Neutral**

- Profiles overlap with semantic conventions. The distinction is that a convention recommends and a
  profile requires. A concept usually starts as a convention and becomes a profile requirement when a
  domain agrees it is not optional.

## Alternatives considered

**One large core with everything optional.** Rejected: it produces a model where nothing is
guaranteed, which is only marginally better than no model. The value of an audit standard is in what
it requires.

**Independent per-domain models with no shared core.** Rejected: it reproduces the current situation
in which no two applications' audit data can be read together.

**Profiles as separate schemas that redefine the event.** Rejected: it allows a profile to relax the
core, and it means a consumer must know which profile an event follows before it can validate it.
Profiles constrain; they do not replace.

**Profiles implemented in v0.1.** Rejected as scope. Profile requirements written before the core has
been used in anger would encode guesses. The placeholders record intent and collect the open questions
that real use will answer.
