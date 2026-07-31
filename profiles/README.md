# Profiles

**Specification version: 0.1 · Status: Experimental**

A **profile** is an optional, stricter set of requirements for a specific domain, layered on top of
the core model.

```bash
auditmodel check-profile <path...> --profile identity-and-access-management
```

## The invariant

**A profile only ever adds constraints.**

A profile MAY:

- Require fields the core model leaves OPTIONAL, for a specific class of events.
- Require a field to have a particular JSON type.
- Require a field to equal a particular scalar.
- Recommend fields, producing warnings that never fail conformance.

A profile MUST NOT:

- Relax, replace or reinterpret any core requirement.
- Add a top-level property to an audit event.
- Redefine the meaning of a core field.
- Introduce product-specific, company-specific, country-specific or regulation-specific fields.

**Every profile-conforming event is a core-conforming event.** The reverse does not hold.

This is enforced structurally rather than by review. The rule vocabulary has no keyword that could
remove a requirement — there is no `optionalPaths`, no `exemptPaths`, no `overrides` — and core
validation runs first, so an event that fails the core schema is reported as core-invalid with its
profile rules **not evaluated**. Both properties are covered by tests. See
[ADR 0008](../decisions/0008-declarative-profile-conformance.md).

## Status in v0.1

| Profile                                                               | Status                    |
| --------------------------------------------------------------------- | ------------------------- |
| [identity-and-access-management](identity-and-access-management/)     | **Implemented**, 11 rules |
| [document-management](document-management/)                           | **Implemented**, 11 rules |
| [incident-management](incident-management/)                           | **Implemented**, 15 rules |
| [message-broker-management](message-broker-management/)               | **Implemented**, 12 rules |
| [deployment-and-change-management](deployment-and-change-management/) | **Implemented**, 13 rules |
| [financial-transaction-management](financial-transaction-management/) | **Implemented**, 12 rules |
| [secrets-and-key-management](secrets-and-key-management/)             | **Implemented**, 14 rules |
| [customer-and-account-management](customer-and-account-management/)   | **Implemented**, 13 rules |
| [backup-and-recovery](backup-and-recovery/)                           | **Implemented**, 13 rules |
| [api-and-integration-management](api-and-integration-management/)     | **Implemented**, 13 rules |

All ten profiles are enforceable and carry fixtures. There are no placeholder profiles left in v0.1.

## Profile definition format

A profile is a JSON document at `profiles/<name>/profile.json`, validated against
[profile-definition.schema.json](profile-definition.schema.json). That schema validates **profile
documents**; it is not part of the canonical audit event schema and never constrains an audit event.

```json
{
  "profileVersion": "0.1",
  "name": "identity-and-access-management",
  "version": "0.1",
  "status": "experimental",
  "coreVersions": ["0.1"],
  "title": "Identity and Access Management Profile",
  "description": "Additional conformance requirements for identity and access management audit events.",
  "rules": []
}
```

`version` is the profile's own version and moves independently of the core specification.
`coreVersions` lists the core versions the profile applies to; an event declaring any other
`specVersion` is **not applicable** rather than in violation.

### Rules

Each rule has an `id` and a `description`, and MAY have a `rationale` and a `severity`.

```json
{
  "id": "IAM-ROLE-002",
  "description": "A privileged role change is approved and performed from a multi-factor authenticated session.",
  "rationale": "Privileged access is the control that protects every other control.",
  "severity": "error",
  "events": ["identity.role.assign", "identity.role.revoke"],
  "when": { "path": "/metadata/role/privileged", "equals": true },
  "requiredPaths": ["/approval", "/authentication"],
  "requiredValues": [{ "path": "/authentication/mfa", "equals": true }]
}
```

Rule severities are `info`, `warning` and `error`. Only `error` fails conformance. These are the
profile vocabulary and are **unrelated** to the privacy linter's severities, which describe a
different kind of risk.

### Selectors

A rule MUST have at least one selector.

| Selector        | Matches                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `events`        | Exact event names                                                                                                                 |
| `eventPrefixes` | Event names starting with the prefix. A prefix MUST end with a dot, so that `identity.role.` cannot match `identity.roles-export` |

There is no regular expression selector. A profile is a published statement about which events it
governs, and a pattern language turns "does this rule apply to my event?" into a question only a tool
can answer.

### Requirements

| Keyword            | Path syntax                              | Meaning                                                  |
| ------------------ | ---------------------------------------- | -------------------------------------------------------- |
| `requiredPaths`    | Absolute JSON Pointer                    | The value must be **present**                            |
| `requiredMetadata` | JSON Pointer **relative to `/metadata`** | The value must be present and of a JSON type             |
| `requiredValues`   | Absolute JSON Pointer                    | The value must be present and strictly equal to a scalar |
| `recommendedPaths` | Absolute JSON Pointer                    | Absence produces a warning, never a failure              |

`requiredMetadata` paths are relative because every one of them starts `/metadata`; `/role/id` means
`/metadata/role/id`. All other paths are absolute pointers into the event. Findings always report the
**full** pointer, so a report never needs the reader to know which convention a keyword used.

Supported metadata types: `string`, `number`, `integer`, `boolean`, `object`, `array`. `integer` is a
subset of `number`. Profiles do not embed schema fragments in v0.1.

### Presence

A required path is satisfied only when the value:

- exists, **and**
- is not `null`, **and**
- is not an empty string, **and**
- is not an empty array, **and**
- is not an empty object.

`false` and `0` **are** present. They are answers, not absences: a profile that could not require
`mfa: false` to be recorded would be unable to distinguish "not recorded" from "recorded as false".

This differs deliberately from the privacy linter's notion of a populated value, which excludes
booleans because a credential cannot be `true`.

### Conditional requirements

A rule MAY carry one `when` condition: one path compared for equality against one scalar.

```json
{ "when": { "path": "/metadata/role/privileged", "equals": true } }
```

That is the entire conditional mechanism. There are no boolean combinations, no nesting, no
comparison operators other than equality, and no expression language.

Comparison is strict: `1` does not equal `true`, and `"true"` does not equal `true`. **When the
condition's path is absent, the condition does not hold** and the rule contributes nothing. The
alternative — treating an absent flag as possibly true — would fail every event that omitted a field
the rule was never meant to govern. Profiles requiring such a flag require it separately, through
`requiredMetadata`.

## Results

| Status           | Meaning                                                           | Exit |
| ---------------- | ----------------------------------------------------------------- | ---- |
| `conforming`     | At least one rule matched and every requirement was satisfied     | 0    |
| `violations`     | A rule matched and a requirement was not satisfied                | 1    |
| `core-invalid`   | The event fails the core schema; profile rules were not evaluated | 1    |
| `not-applicable` | No rule in the profile governs this event                         | 3    |

**`not-applicable` is not conformance.** An event no rule governs is reported as out of scope, never
as conforming, so that a pipeline cannot read "the profile said nothing" as "the profile was
satisfied". Exit code `3` exists for the same reason.

When a run mixes conforming and not-applicable events, the exit code is `0`. Exit `3` means nothing
checked was governed at all.

## What profiles are not

**Profiles are not regulatory mappings.** A profile requires audit fields. It cites no regulation,
article, control identifier or jurisdiction, and the profile definition schema gives it nowhere to put
one. Regulations are revised on their own schedules and interpreted differently by different auditors;
a profile that encoded one would be wrong when the regulation changed and useless everywhere it did
not apply.

**Profile conformance is not legal or regulatory compliance**, and MUST NOT be presented as evidence
of it. It is a statement that an event carries the fields a domain agreed it should carry.

**Profiles do not replace privacy linting.** A profile says which fields must be present; the privacy
linter says which values must not. They are complementary and independent: a profile-conforming event
can still carry a secret, and `auditmodel lint-privacy` is what looks for one. Every published
profile fixture is required by test to pass both.

**Profiles are not a policy engine.** OpenAuditModel records decisions; it does not evaluate them.

## Proposing a profile

Use the profile proposal issue template. A proposal must show that the domain has requirements the
core cannot express and that those requirements are shared across independent products — not one
product's field list wearing a domain's name. See [CONTRIBUTING.md](../CONTRIBUTING.md).

Adding a profile requires **no code**: a profile is a JSON document plus fixtures.
