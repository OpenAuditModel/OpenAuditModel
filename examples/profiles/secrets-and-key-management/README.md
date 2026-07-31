# Secrets and key management profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[secrets-and-key-management profile](../../../profiles/secrets-and-key-management/). The rules
themselves are in
[profile.json](../../../profiles/secrets-and-key-management/profile.json).

```bash
auditmodel check-profile examples/profiles/secrets-and-key-management/valid \
  --profile secrets-and-key-management
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming** event. The
ones under `invalid/` fail the profile, not the core schema. That separation is the point: a profile
adds requirements to events the core already accepts.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate      examples/profiles/secrets-and-key-management/valid
auditmodel lint-privacy  examples/profiles/secrets-and-key-management/valid
auditmodel check-profile examples/profiles/secrets-and-key-management/valid \
  --profile secrets-and-key-management
```

A profile that accepted an event the core rejects would break the core invariant. A profile for
_this_ domain that accepted an event carrying the material it describes would be worse than no
profile at all, so a further test scans every fixture — including the invalid and not-applicable ones
— for a scalar under any credential-shaped property name and fails if it finds one.

**No fixture contains a secret value, key material, a private key, a recovery phrase, a password, a
token, a client secret, a connection string or a fingerprint of any of them.** Every event records
that an operation happened and nothing about what was protected.

## Valid fixtures

| File                           | Event                  | Demonstrates                                                    |
| ------------------------------ | ---------------------- | --------------------------------------------------------------- |
| `secret-create.json`           | `secret.create`        | Material brought into custody, with a recorded owner            |
| `secret-rotate.json`           | `secret.rotate`        | Unattended scheduled rotation, recorded as a `change`           |
| `secret-reveal.json`           | `secret.reveal`        | Privileged human access with authentication and justification   |
| `secret-reveal-emergency.json` | `secret.reveal`        | Break-glass access with a retrospective, still-pending approval |
| `secret-export.json`           | `secret.export`        | Export naming its destination kind, under a declared approval   |
| `secret-revoke.json`           | `secret.revoke`        | Invalidation after suspected exposure                           |
| `secret-policy-update.json`    | `secret.policy.update` | A custody policy change recorded as before and after            |
| `key-generate.json`            | `key.generate`         | A key generated inside the custody module                       |
| `key-import.json`              | `key.import`           | Externally generated material accepted, and why                 |
| `key-destroy.json`             | `key.destroy`          | Irreversible destruction under an approval its policy required  |
| `key-export.json`              | `key.export`           | Key material leaving one custodian for another                  |
| `certificate-issue.json`       | `certificate.issue`    | Issuance recording when validity ends                           |

Two of these produce a **warning** and no error, which is intentional:

- `secret-rotate.json` has no `/reason`. A scheduled rotation has no justification beyond the policy
  that scheduled it, and `SECRET-CORE-003` recommends rather than requires one.
- `key-import.json` has no `/metadata/secret/expiresAt`. A key held for as long as the data it
  protects has no expiry to record, and `SECRET-KEY-002` recommends rather than requires one.

A warning never fails conformance.

## Invalid fixtures

Each removes exactly one required value from a valid fixture, so it fails for one documented reason.
A test asserts both the rule and the pointer, and that **exactly one** error is produced.

| File                                       | Violates               | At                                 |
| ------------------------------------------ | ---------------------- | ---------------------------------- |
| `secret-create-missing-authorization.json` | `SECRET-CORE-001`      | `/authorization`                   |
| `secret-rotate-missing-type.json`          | `SECRET-CORE-002`      | `/metadata/secret/type`            |
| `key-generate-missing-owner.json`          | `SECRET-LIFECYCLE-001` | `/resource/ownerId`                |
| `secret-rotate-missing-change.json`        | `SECRET-ROTATE-001`    | `/change`                          |
| `secret-reveal-missing-reason.json`        | `SECRET-ACCESS-001`    | `/reason`                          |
| `emergency-reveal-missing-approval.json`   | `SECRET-ACCESS-002`    | `/approval`                        |
| `secret-export-missing-destination.json`   | `SECRET-EXPORT-001`    | `/metadata/secret/destinationType` |
| `secret-revoke-missing-reason.json`        | `SECRET-DESTROY-001`   | `/reason`                          |
| `key-destroy-missing-approval.json`        | `SECRET-APPROVAL-001`  | `/approval`                        |
| `policy-update-missing-change.json`        | `SECRET-POLICY-001`    | `/change`                          |
| `certificate-issue-missing-expiry.json`    | `SECRET-CERT-001`      | `/metadata/secret/expiresAt`       |
| `key-import-missing-reason.json`           | `SECRET-KEY-001`       | `/reason`                          |

Two of them are worth reading together with the valid fixture they came from:

- `emergency-reveal-missing-approval.json` still declares `emergencyAccess: true`. That declaration
  is what makes the missing approval a violation; the identical event without the flag conforms.
- `key-destroy-missing-approval.json` still declares `approvalRequired: true`. The producer's own
  policy is what the rule enforces, so the same event under a deployment that declares `false`
  conforms.

## Not-applicable fixtures

| File                        | Event                  | Why it is out of scope                            |
| --------------------------- | ---------------------- | ------------------------------------------------- |
| `secret-retrieve.json`      | `secret.retrieve`      | A workload reading its own credential at start-up |
| `secret-cache-refresh.json` | `secret.cache-refresh` | The same workload refreshing its cached copy      |
| `key-decrypt.json`          | `key.decrypt`          | A cryptographic operation _with_ a key            |

These are perfectly good audit events that the profile deliberately does not govern.
`check-profile` reports each as not applicable with exit code 3, and each carries little more than
the core required fields — which is the shape an ungoverned custody event is expected to have.

They exist to hold the exclusion in place. If a future edit widened a selector to a bare `secret.` or
`key.` prefix, these fixtures would start conforming instead of being skipped, and the test would
fail — which is the point, because that edit would silently impose an authorization decision, a
classification and a material type on the highest-volume events a custody system emits.

## Vendor neutrality

No fixture names a real product, company, cloud provider, jurisdiction or regulation. Custody system
kinds (`software-vault`, `hardware-security-module`, `managed-key-service`,
`internal-certificate-authority`), material types, destination kinds, policy names and control
categories are illustrative tokens, not any vendor's or organization's scheme. Algorithm names are
public standard identifiers used as examples; the profile requires no particular algorithm and
asserts nothing about the adequacy of any of them.
