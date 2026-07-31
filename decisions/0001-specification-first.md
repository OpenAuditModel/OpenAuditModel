# 0001 — Specification-first development

## Status

Accepted — 2026-07-30. Applies to specification version 0.1.

## Context

OpenAuditModel could be started in two ways: by writing an SDK that produces audit events and
extracting a specification from it, or by writing the specification first and building tooling that
verifies conformance to it.

The first approach produces working code sooner and is how most audit libraries begin. It also
produces a specification that is a description of one implementation's accidents: its language's type
system, its serialization defaults, its author's domain, its framework's request model. Every one of
those becomes a de facto requirement for anyone who adopts it, and none of them was ever a decision.

The project's stated goal is a model usable regardless of language, framework, architecture and
industry. An SDK-derived specification cannot credibly claim that, because the first SDK's language
and framework are baked into it before anyone else has read a line.

A specification also has a different failure mode from an SDK. An SDK that is wrong can be fixed in a
minor release. A model that is wrong is embedded in seven years of retained audit records that were
produced by systems that have since been decommissioned.

## Decision

The normative model, the canonical JSON Schema and the conformance toolchain are defined before any
production SDK is written.

Specifically for v0.1:

1. The normative specification is the source of truth.
2. The canonical JSON Schema machine-verifies what can be machine-verified.
3. The conformance toolchain — CLI, fixtures and tests — proves the schema behaves as specified.
4. No production SDK is published. Any SDK that follows must conform to the specification, not
   redefine it.
5. Conformance is defined as validating against the canonical schema plus satisfying the normative
   rules a schema cannot express.

## Consequences

**Positive**

- The model is language-neutral by construction, because no language was involved in deriving it.
- Conformance is testable from day one: an implementation in any language can be checked against the
  same fixtures.
- Design decisions are explicit and reviewable, rather than being discovered later in an
  implementation's behaviour.
- Later SDKs in different languages start from the same definition rather than from a translation of
  the first one.

**Negative**

- Slower to a usable artifact. There is no library to install at v0.1, only a schema and a validator.
- Risk of specifying constructs that turn out to be awkward to implement. Mitigated by keeping v0.1
  experimental and by requiring that every constraint is exercised by a fixture.
- Adoption is harder to demonstrate early, because there is no download count to point at.

**Neutral**

- The conformance CLI is production-quality code, but it is tooling, not an SDK. It validates events;
  it does not produce them.

## Alternatives considered

**Write a reference SDK first, extract the specification later.** Rejected: the specification would
encode one language's and one framework's assumptions, and the project's neutrality claim would be
false from the start.

**Write specification and SDK simultaneously.** Rejected for v0.1: with one author and no external
review, the SDK's convenience wins every disagreement, which is the outcome this decision exists to
prevent. Reconsider once the model has independent implementations.

**Adopt an existing standard instead.** Rejected, and documented in [mappings/](../mappings/). The
existing standards solve envelope, transport, search and security-telemetry problems. None of them
states what a business application MUST record about an auditable operation.

**Publish only prose, no schema.** Rejected: a specification nobody can validate against is a
specification everybody implements differently.
