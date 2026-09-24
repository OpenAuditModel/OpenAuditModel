# Secret and Key Events

**Specification version: 1.0 · Status: Stable**

## 1. Recommended event names

This domain spans four categories, because the operations differ in kind rather than in subject: a
key generation is a security operation, reading a secret is data access, and changing a rotation
policy is configuration.

| Family                              | `event.category`       |
| ----------------------------------- | ---------------------- |
| Secret and key lifecycle            | `security`             |
| Reading a secret or exporting a key | `data-access`          |
| Emergency and break-glass access    | `privileged-operation` |
| Rotation and expiry policy          | `configuration`        |

### Secrets

| Name            | Operation                                    |
| --------------- | -------------------------------------------- |
| `secret.create` | A secret was stored                          |
| `secret.update` | A secret's value was replaced in place       |
| `secret.rotate` | A secret was replaced on a rotation schedule |
| `secret.reveal` | A principal read a secret's value            |
| `secret.export` | A secret left the store                      |
| `secret.revoke` | A secret was invalidated before its expiry   |
| `secret.delete` | A secret was removed from the store          |

### Keys

| Name                | Operation                                       |
| ------------------- | ----------------------------------------------- |
| `key.generate`      | A key was created inside the store              |
| `key.import`        | A key created elsewhere was brought in          |
| `key.rotate`        | A new key version replaced the active one       |
| `key.enable`        | A key was made usable                           |
| `key.disable`       | A key was made unusable without being destroyed |
| `key.export`        | Key material left the store                     |
| `key.destroy`       | A key was destroyed and cannot be recovered     |
| `key.policy.update` | The policy attached to a key was changed        |

### Certificates

| Name                 | Operation                                |
| -------------------- | ---------------------------------------- |
| `certificate.issue`  | A certificate was issued                 |
| `certificate.renew`  | A certificate was reissued before expiry |
| `certificate.revoke` | A certificate was revoked                |
| `certificate.delete` | A certificate was removed                |

### Policy

`secret.policy.update` records a change to the rules governing rotation, expiry or access for a
secret or a class of secrets.

`key.policy.update` records a change to the policy attached to a cryptographic key: who may use
it and for what, its rotation schedule, or whether it may be exported. The operation is real and
common — a key management service's key policy, a key vault's access policy, an HSM's key usage
attributes — and it is distinct from `secret.policy.update` because a key is used rather than read.
It is governed by the same rules as `secret.policy.update`: the change and the reason are required.

Named in 1.0. Until then the profile selected the prefix `key.policy.` with no name published under
it; the prefix now has one. Event names are an open vocabulary, so a later minor version may add a
name the same way ([ADR 0017](../decisions/0017-versioning-and-compatibility.md) §2).

## 2. The overlap with `configuration.secret.access`

[configuration-and-change.md](configuration-and-change.md) §6 publishes `configuration.secret.access`
for a principal reading a secret held as application configuration. This document publishes
`secret.reveal` for a principal reading a secret from a secret store, which is what the
secrets-and-key-management profile enforces.

Resolved in 1.0 by keeping both and saying what separates them, which is where the secret is held.
Neither name is withdrawn: `event-model.md` §7.2 makes name stability a MUST, and a producer already
emitting either is conforming.

- `configuration.secret.access` — the secret is a value in the application's own configuration, read
  as part of reading configuration.
- `secret.reveal` — the secret is held by a secret store that is a system of its own, and a
  principal asked that store for it. This is the operation the secrets-and-key-management profile
  governs.

A producer SHOULD NOT emit both for one read. A consumer that wants every read of a secret selects
both names; they are two views of one kind of act, not two acts.

## 3. What must never be recorded

**The material itself.** Not the secret, not the key, not a private key, not a certificate's private
half, not a fragment, not a prefix, and not a hash that would let a reader confirm a guess. This is
the domain where the rule matters most, because the events are about material whose whole value is
that nobody else has it.

An event records that a secret was read, by whom, under what authorization, and which secret — by
identifier. It does not record what the secret was. See
[privacy.md](../specification/privacy.md) §6, and note that the privacy linter is a backstop for
this rule, not the control that enforces it.

`keyId` names a key and MUST NOT carry key material — [integrity.md](../specification/integrity.md)
§6.1 already says so for the integrity object, and the same holds here.

## 4. Which principal goes where

| Operation                                            | `actor`      | `resource`     | `subject`    |
| ---------------------------------------------------- | ------------ | -------------- | ------------ |
| An engineer reads a secret                           | the engineer | the **secret** | absent       |
| A service reads a secret at start-up                 | the service  | the **secret** | absent       |
| An operator generates a key for an application       | the operator | the **key**    | absent       |
| An operator reveals a secret for an on-call engineer | the operator | the **secret** | the engineer |

The last row is the only one where `subject` appears, and only because the operator acted on someone
else's behalf. The application a secret belongs to is a **related resource**, not a subject — see
[actor-model.md](../specification/actor-model.md) §5.

## 5. Emergency access

Break-glass reads are the events this domain exists for. Where a producer distinguishes emergency
access from routine access, the event SHOULD carry that distinction in `metadata` and SHOULD record
the justification in `reason`. An emergency read with no recorded reason is the finding an auditor is
looking for.

Where the producer's own policy requires approval for a class of access, the decision belongs in
`approval` — including when approval was evaluated and found not to be required.

## 6. Context to populate

| Field                     | Guidance                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| `authorization`           | The decision that permitted the operation                            |
| `resource.classification` | How sensitive the secret or key is, in the producer's own vocabulary |
| `approval`                | Where the operation required a second principal's decision           |
| `reason`                  | Why a reveal, export, revoke or destroy was performed                |
| `metadata.secret`         | The store's own identifiers, the secret type, and the rotation state |
| `relatedResources`        | The application or service the secret or key serves                  |

## 7. Example

See
[examples/profiles/secrets-and-key-management/valid/secret-reveal-emergency.json](../examples/profiles/secrets-and-key-management/valid/secret-reveal-emergency.json)
for an emergency secret read with the authorization decision, the justification and the approval that
permitted it — and no trace of the secret itself.
