# Identity and Access Management Profile

**Profile version: 0.1 · Core versions: 0.1 · Status: Experimental · Implemented**

Additional conformance requirements for identity and access management audit events: accounts, roles,
permissions, service accounts and credential rotation.

```bash
auditmodel check-profile examples/profiles/identity-and-access-management/valid \
  --profile identity-and-access-management
```

The rules live in [profile.json](profile.json) and are enforced by the declarative engine described in
[profiles/README.md](../README.md). Nothing in this profile is implemented in code.

## Why this profile first

Access changes are the operations every organization audits, and the fields involved are the same
everywhere: which role, which permission, at what scope, was it privileged, who approved it, was the
session multi-factor authenticated. Unlike document sharing or incident priority, none of that
depends on a product's data model or on an organization's scales. See
[ADR 0008](../../decisions/0008-declarative-profile-conformance.md) §9.

## Rules

| Rule           | Applies to                                                     | Requires                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IAM-CORE-001` | `identity.` prefix                                             | `/authorization`                                                                                                                                                                                  |
| `IAM-CORE-002` | `identity.` prefix                                             | _Recommends_ `/reason`, `/request/correlationId`                                                                                                                                                  |
| `IAM-ROLE-001` | `identity.role.assign`, `identity.role.revoke`                 | `/authorization`, `/reason`, `/metadata/role/id` string, `/metadata/role/privileged` boolean. _Recommends_ `/approval`, `/request/correlationId`                                                  |
| `IAM-ROLE-002` | the same, **when** `/metadata/role/privileged` is `true`       | `/approval`, `/authentication`, and `/authentication/mfa` equal to `true`                                                                                                                         |
| `IAM-PERM-001` | `identity.permission.` prefix                                  | `/authorization`, `/reason`, `/metadata/permission/id` string, `/metadata/permission/scope` string, `/metadata/permission/privileged` boolean. _Recommends_ `/approval`, `/request/correlationId` |
| `IAM-PERM-002` | the same, **when** `/metadata/permission/privileged` is `true` | `/approval`, `/authentication`, and `/authentication/mfa` equal to `true`                                                                                                                         |
| `IAM-USER-001` | `identity.user.create`, `.disable`, `.delete`                  | `/metadata/user/type` string                                                                                                                                                                      |
| `IAM-USER-002` | `identity.user.disable`, `identity.user.delete`                | `/reason`. _Recommends_ `/approval`                                                                                                                                                               |
| `IAM-SVC-001`  | `identity.service-account.create`, `.disable`                  | `/metadata/serviceAccount/purpose` string, `/metadata/serviceAccount/ownerId` string                                                                                                              |
| `IAM-SVC-002`  | `identity.service-account.create`                              | _Recommends_ `/metadata/serviceAccount/expiresAt`                                                                                                                                                 |
| `IAM-CRED-001` | `identity.credential.rotate`                                   | `/authorization`, `/reason`, `/metadata/credential/type` string. _Recommends_ `/request/correlationId`                                                                                            |

Recommendations produce warnings and never fail conformance.

### Why the privileged flag is required rather than inferred

`role.privileged` and `permission.privileged` are required booleans because no external reader can
determine whether `role-4471` is privileged. Recording the answer at the moment of the change is the
only point at which it is known, and it is what makes `IAM-ROLE-002` and `IAM-PERM-002` able to demand
approval and multi-factor authentication exactly where they matter.

An event that omits the flag fails `IAM-ROLE-001` rather than silently escaping the conditional rule.
The conditional itself does not fire on a missing flag; the presence requirement is what closes that
gap.

### Multi-factor authentication

`IAM-ROLE-002` and `IAM-PERM-002` require `/authentication/mfa` to **equal `true`**, not merely to be
present. `mfa: false` is a conforming core event and a profile violation: it records, accurately, that
a privileged access change was made from a single-factor session.

## Normative requirements this profile cannot check

These are requirements of the profile. No tool verifies them, and that is stated rather than
approximated by a rule that would be wrong.

1. **The primary resource MUST identify the target** — the principal, role, permission or service
   account the operation acted upon. A checker can confirm `/resource/id` is present; it cannot
   confirm it names the right thing. See [actor-model.md](../../specification/actor-model.md): the
   target of an identity operation is a `resource`, and `subject` appears only when someone's
   authority was borrowed.
2. **The actor and the target MUST NOT be represented ambiguously.** An administrator disabling an
   account is the `actor`; the account is the `resource`. Recording the account as both is
   structurally valid and semantically wrong.
3. **Organization and tenant context is not required globally.** Not every application is
   multi-tenant, and the profile does not assume one.
4. **Personally identifiable attributes are never required.** No rule requires a display name, an
   email address or any other direct personal identifier. `/metadata/user/type` records the kind of
   principal — employee, contractor, partner, test — which is what an access review needs, and needs
   no personal data at all.

## Credentials and secrets

**Service account secrets, keys and tokens MUST NOT be placed in an audit event.** Neither must the
old or new value of a rotated credential, private key material, or any token.

`identity.credential.rotate` records the _kind_ of credential in `/metadata/credential/type` and
nothing about its value. `IAM-SVC-001` requires a purpose and an owner, and requires no credential at
all.

This profile does **not** check for secrets. That is
[`auditmodel lint-privacy`](../../specification/privacy.md), which is a separate, complementary
command: a profile says which fields must be present, the linter says which values must not. Every
published fixture in this profile is required by test to pass both, and the credential and service
account fixtures are additionally checked field by field for secret-shaped members.

## Fixtures

[examples/profiles/identity-and-access-management/](../../examples/profiles/identity-and-access-management/)
holds seven conforming events, seven that violate exactly one rule, and one event the profile does not
govern.

## Compatibility

The profile version is independent of the core specification version. `coreVersions` declares which
core versions the profile applies to; an event declaring any other `specVersion` is **not applicable**
rather than in violation.

Adding a rule is a breaking change for producers, in the same sense as adding a required core field.

## Not a compliance statement

Conformance to this profile means an event carries the fields this profile requires. It is not
compliance with any law, regulation, standard or contract, and MUST NOT be presented as evidence of
one.
