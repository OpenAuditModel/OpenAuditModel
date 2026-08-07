# CADF Comparison

**Status: Informative. CADF is prior art this model draws on, not an export target in v0.1.**

The Cloud Auditing Data Federation (DMTF DSP0262) is a full audit event model: a data format with
schema definitions, extensible taxonomies for actions, outcomes and resource types, and interfaces
for submitting, querying and federating event records. It is a standard rather than a set of ideas,
and it predates this work by roughly a decade.

Its central insight — that an audit event is fundamentally _initiator, action, target, outcome,
observer_ — is correct and is reflected in this model.

This document is a **comparison**, not a mapping. It explains what OpenAuditModel took from CADF's
conceptual framing and where it deliberately differs.

## 1. Conceptual correspondence

| CADF concept | OpenAuditModel                           | Notes                                                                   |
| ------------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| Initiator    | `actor`                                  | The principal that performed the operation                              |
| Target       | `resource`                               | The thing acted upon                                                    |
| Action       | `event.name` (+ `event.type`)            | CADF uses a taxonomy of actions; OpenAuditModel uses hierarchical names |
| Outcome      | `event.outcome`                          | OpenAuditModel adds `partial`                                           |
| Observer     | `application`                            | See §3 — the semantics differ meaningfully                              |
| Event time   | `time`                                   | OpenAuditModel separates `observedTime`                                 |
| Reason       | `event.error` and `authorization.reason` | CADF's reason blends failure cause and decision explanation             |
| Attachments  | `evidence`, `metadata`, `extensions`     | OpenAuditModel separates references from interpretation data            |
| Measurements | —                                        | Not modelled; metrics belong in telemetry                               |

## 2. Where OpenAuditModel goes further

CADF has no first-class representation for concepts that dominate modern business application audit:

- **Subject and delegation.** CADF's initiator is singular. The distinction between who acted and
  whose authority was used is the defining problem of impersonation, service accounts and delegated
  administration, and it needs its own field.
- **Approval.** Human approval, approvers and thresholds are business process, and are frequently the
  most important fact about a privileged operation.
- **Business justification.** `reason` separates "why was this done" from "why did this fail".
- **Change context.** Changed fields, sanitized before and after state, and hashes, with explicit
  privacy constraints.
- **Privacy.** The personal-data character of the audit record itself.
- **Integrity.** Per-event tamper-evidence with canonicalization and chaining.
- **Machine verification.** A canonical JSON Schema, conformance fixtures and a validator, so that
  conformance is testable rather than asserted.

## 3. Observer

CADF's observer is the component that **observed and reported** the event, which may or may not be the
component that performed the operation.

OpenAuditModel deliberately narrows this. `application` MUST describe the **producer** — the
application in which the operation happened. Pipeline components are not permitted to rewrite it, and
the only thing a collector may contribute is `observedTime`. See
[delivery.md](../specification/delivery.md) §7.

The reason is practical: audit trails in which every event claims to originate from the log pipeline
are common, and they destroy provenance. Making the field mean one thing removes the ambiguity that
allows it to happen.

## 4. Taxonomies

CADF defines controlled taxonomies for actions, outcomes and resource types.

OpenAuditModel closes only the vocabularies that are small, universal and load-bearing — outcome,
severity, principal type, authorization decision, delegation type — and leaves resource types, event
names, categories and classifications open with a constrained form. The reasoning is in
[design-principles.md](../specification/design-principles.md) §7: a fixed taxonomy of resource types
is exactly what makes a general model unusable in a domain nobody anticipated.

## 5. Focus

CADF was designed for infrastructure and cloud service auditing, where the operations are largely
provisioning and control-plane actions on well-known resource kinds.

OpenAuditModel is focused on **business application audit instrumentation and conformance**: the
operations an application performs on its own domain objects, the human and policy decisions around
them, and a toolchain that can prove an event is well formed before it is stored for seven years.

The models are compatible in outlook. This one is narrower in target and stricter in enforcement.
