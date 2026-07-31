# Identity and access management profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[identity-and-access-management profile](../../../profiles/identity-and-access-management/). The
rules themselves are in [profile.json](../../../profiles/identity-and-access-management/profile.json).

```bash
auditmodel check-profile examples/profiles/identity-and-access-management/valid \
  --profile identity-and-access-management
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming** event. The
ones under `invalid/` fail the profile, not the core schema. That separation is the point: a profile
adds requirements to events the core already accepts.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate       examples/profiles/identity-and-access-management/valid  # core-conforming
auditmodel lint-privacy   examples/profiles/identity-and-access-management/valid  # no privacy findings
auditmodel check-profile  examples/profiles/identity-and-access-management/valid --profile identity-and-access-management
```

A profile that accepted an event the core rejects would break the core invariant. A profile that
accepted an event carrying a credential would be worse than no profile. Neither can happen silently
while these tests pass.

## Valid fixtures

| Fixture                                                          | Event                             | Exercises                                                   |
| ---------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| [user-create.json](valid/user-create.json)                       | `identity.user.create`            | `IAM-USER-001` — principal type without personal data       |
| [user-disable.json](valid/user-disable.json)                     | `identity.user.disable`           | `IAM-USER-002` — offboarding with a stated reason           |
| [role-assign-standard.json](valid/role-assign-standard.json)     | `identity.role.assign`            | `IAM-ROLE-001` with `privileged: false`                     |
| [role-assign-privileged.json](valid/role-assign-privileged.json) | `identity.role.assign`            | `IAM-ROLE-002` — the conditional rule, satisfied            |
| [permission-revoke.json](valid/permission-revoke.json)           | `identity.permission.revoke`      | `IAM-PERM-001` — permission, scope and privilege            |
| [service-account-create.json](valid/service-account-create.json) | `identity.service-account.create` | `IAM-SVC-001` and `IAM-SVC-002` — purpose, owner, expiry    |
| [credential-rotate.json](valid/credential-rotate.json)           | `identity.credential.rotate`      | `IAM-CRED-001` — the kind of credential, never a credential |

`role-assign-privileged.json` is the one to read. It carries `metadata.role.privileged: true`, and so
must also carry `/approval`, `/authentication` and `/authentication/mfa` equal to `true`. Compare it
with `role-assign-standard.json`, which is identical in shape but not privileged, and to which
`IAM-ROLE-002` is matched but contributes nothing.

`credential-rotate.json` records `metadata.credential.type: "api-key"` and
`change.changedFields: ["secret", "rotatedAt"]`. The _fact_ of the rotation is fully auditable; the
secret appears nowhere. That is the shape the profile requires and the privacy linter accepts.

## Invalid fixtures

Each violates exactly one documented rule. Expectations are asserted by
[`profile-cli.test.ts`](../../../conformance/tests/profile-cli.test.ts).

| Fixture                                                                                  | Rule           | Pointer                            |
| ---------------------------------------------------------------------------------------- | -------------- | ---------------------------------- |
| [role-assign-missing-role-id.json](invalid/role-assign-missing-role-id.json)             | `IAM-ROLE-001` | `/metadata/role/id`                |
| [role-assign-missing-authorization.json](invalid/role-assign-missing-authorization.json) | `IAM-CORE-001` | `/authorization`                   |
| [privileged-role-without-approval.json](invalid/privileged-role-without-approval.json)   | `IAM-ROLE-002` | `/approval`                        |
| [privileged-role-without-mfa.json](invalid/privileged-role-without-mfa.json)             | `IAM-ROLE-002` | `/authentication/mfa`              |
| [permission-grant-missing-scope.json](invalid/permission-grant-missing-scope.json)       | `IAM-PERM-001` | `/metadata/permission/scope`       |
| [service-account-missing-owner.json](invalid/service-account-missing-owner.json)         | `IAM-SVC-001`  | `/metadata/serviceAccount/ownerId` |
| [credential-rotate-missing-reason.json](invalid/credential-rotate-missing-reason.json)   | `IAM-CRED-001` | `/reason`                          |

### Notes

**`privileged-role-without-mfa.json` is the most interesting failure.** It is approved, authenticated
and core-valid. It fails because `/authentication/mfa` is `false`: it records, accurately, that a
privileged role was granted from a single-factor session. `false` is _present_ — the profile's
presence rule counts it — so nothing but a required-**value** constraint could catch it.

**`role-assign-missing-authorization.json` produces two violations**, from `IAM-CORE-001` and
`IAM-ROLE-001`. Both genuinely require `/authorization`, and both are reported: a report that
deduplicated them would hide which rule a reader should go and read.

**Every invalid fixture passes `auditmodel validate`.** They are well-formed audit events that a
domain would consider incomplete, which is exactly what a profile exists to detect.

## Not applicable

[document-share.json](not-applicable/document-share.json) is a `document.share.create` event. No rule
in this profile governs it, so the result is `not-applicable` and the CLI exits `3`.

It is deliberately **not** reported as conforming. Silence is not conformance: a pipeline that checked
document events against an identity profile and saw a pass would conclude something it has no basis
for, and would keep concluding it after someone renamed the events it was meant to be checking.

## Synthetic content

No fixture contains real personal data, a real credential, a token or key material. Identifiers are
opaque (`user-7391`, `role-support-agent`), and domain names come from the ranges reserved for
documentation by RFC 2606. Contributors adding fixtures must do the same.
