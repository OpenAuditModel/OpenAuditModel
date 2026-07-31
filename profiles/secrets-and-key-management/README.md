# Secrets and Key Management Profile

**Profile version: 0.1 · Core versions: 0.1 · Status: Experimental · Implemented, 14 rules (12
enforceable).**

Additional conformance requirements for the **custody** of secrets, cryptographic keys and
certificates: the operations a secret store, a key management service, a hardware custody module or a
certificate authority performs on the material it holds.

The enforceable rules are in [profile.json](profile.json).

```bash
auditmodel check-profile examples/profiles/secrets-and-key-management/valid \
  --profile secrets-and-key-management
```

## Purpose

Custody operations are the ones an attacker performs after gaining a foothold and before doing
anything visible, and they are the ones an organization is least able to reconstruct afterwards —
because the evidence is material that was replaced, copied or destroyed. This profile requires the
handful of fields that make such an event reviewable months later: who decided it was allowed, how
sensitive the material was, what kind of material it was, who owns it, what changed, and why.

**The one thing this domain must never do is record the material itself.** An event records _that_ a
secret was rotated, revealed or exported. No rule in this profile requires a value, a hash of a
value, a key fingerprint or anything else from which material could be reconstructed or verified
against a guess, and no fixture contains one.

## Scope

Applications that hold material on behalf of other systems — secret stores and vaults, key management
services, hardware custody modules, certificate authorities and the credential-issuing parts of
platform services.

The profile is vendor-neutral. It describes operations that any custody system performs, not the
feature list of any product, and it assumes no particular storage backend, cryptographic provider,
approval workflow or deployment model.

## Event families

| Family                   | Events                                                                         | Governed |
| ------------------------ | ------------------------------------------------------------------------------ | -------- |
| Secret lifecycle         | `secret.create`, `.update`, `.rotate`, `.revoke`, `.delete`                    | yes      |
| Secret value access      | `secret.reveal`, `secret.export`                                               | yes      |
| Key lifecycle            | `key.generate`, `.import`, `.rotate`, `.enable`, `.disable`, `.destroy`        | yes      |
| Key material export      | `key.export`                                                                   | yes      |
| Certificate lifecycle    | `certificate.issue`, `.renew`, `.revoke`, `.delete`                            | yes      |
| Custody policy           | `secret.policy.*`, `key.policy.*`                                              | yes      |
| Routine secret retrieval | `secret.retrieve`, `secret.cache-refresh`                                      | **no**   |
| Cryptographic data plane | `key.encrypt`, `key.decrypt`, `key.sign`, `key.verify`, `certificate.validate` | **no**   |

Names follow [event-naming.md](../../semantic-conventions/event-naming.md): the two-segment form is
used where the domain _is_ the object acted on, and the three-segment form where a distinct object —
a policy — is acted on within the domain.

## Explicit exclusions

**Routine automated retrieval is not governed.** A workload that reads its own credential at start-up
and refreshes it on a timer produces the highest-volume event a custody system emits. Requiring an
authorization decision, a classification, a material type and a justification on each of them would
add cost to that event in exchange for very little review value, and the requirement would be
switched off rather than met.

**The cryptographic data plane is not governed either.** `key.encrypt`, `key.decrypt`, `key.sign` and
`key.verify` are operations _with_ a key, not operations _on_ a key. They run millions of times a day
and they do not change the custody state of anything.

The exclusion is structural, not a matter of discipline: **no selector in this profile uses a bare
`secret.`, `key.` or `certificate.` prefix**. Every governed name is either listed exactly or sits
under a `.policy.` prefix, so `secret.retrieve` and `key.decrypt` match no rule and `check-profile`
reports them as not applicable. A test asserts that, because widening one prefix later would silently
start governing every secret read in a deployment.

Excluded does not mean unaudited. Those are conforming OpenAuditModel events, and
[data-access.md](../../semantic-conventions/data-access.md) covers recording reads. Where retrieval
volume is high, [configuration-and-change.md](../../semantic-conventions/configuration-and-change.md)
§6 is the relevant guidance: recording grants, rotations and out-of-pattern access is usually worth
more than recording every read.

## Rules

| Rule                   | Applies to                                                                                      | Requires                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SECRET-CORE-001`      | every governed event                                                                            | `/authorization`, `/resource/classification`                                  |
| `SECRET-CORE-002`      | every governed event                                                                            | `/metadata/secret/type` string                                                |
| `SECRET-CORE-003`      | every governed event                                                                            | _recommends_ `/reason`, `/request/correlationId`, `/metadata/secret/provider` |
| `SECRET-LIFECYCLE-001` | `secret.create`, `key.generate`, `key.import`, `certificate.issue`                              | `/resource/ownerId`                                                           |
| `SECRET-ROTATE-001`    | `secret.rotate`, `key.rotate`, `certificate.renew`                                              | `/change`; recommends `/change/changedFields`                                 |
| `SECRET-ACCESS-001`    | `secret.reveal`, `secret.export`, `key.export`                                                  | `/authentication`, `/reason`; recommends `/approval`                          |
| `SECRET-ACCESS-002`    | the same, **when** `/metadata/secret/emergencyAccess` is `true`                                 | `/approval`, and `/authentication/mfa` equal to `true`                        |
| `SECRET-EXPORT-001`    | `secret.export`, `key.export`                                                                   | `/metadata/secret/destinationType` string                                     |
| `SECRET-DESTROY-001`   | `secret.revoke`, `secret.delete`, `key.disable`, `key.destroy`, `certificate.revoke`, `.delete` | `/reason`; recommends `/approval`                                             |
| `SECRET-APPROVAL-001`  | every governed event, **when** `/metadata/secret/approvalRequired` is `true`                    | `/approval`                                                                   |
| `SECRET-POLICY-001`    | `secret.policy.*`, `key.policy.*`                                                               | `/change`, `/reason`; recommends `/approval`                                  |
| `SECRET-CERT-001`      | `certificate.issue`, `certificate.renew`                                                        | `/metadata/secret/expiresAt` string; recommends `/metadata/secret/algorithm`  |
| `SECRET-KEY-001`       | `key.import`                                                                                    | `/reason`; recommends `/approval`                                             |
| `SECRET-KEY-002`       | `key.generate`, `key.import`, `key.rotate`                                                      | _recommends_ `/metadata/secret/algorithm`, `/metadata/secret/expiresAt`       |

`SECRET-CORE-003` and `SECRET-KEY-002` are `warning` rules: they never fail conformance. Each rule's
full text and rationale is in [profile.json](profile.json).

## Metadata namespace

Every requirement this profile places on `metadata` sits under `/metadata/secret/`. The namespace
names the **control domain** — secrets and key management — not only password-shaped material, so a
key and a certificate event use it too.

| Field                               | Type    | Status                                        | Records                                       |
| ----------------------------------- | ------- | --------------------------------------------- | --------------------------------------------- |
| `/metadata/secret/type`             | string  | REQUIRED on every governed event              | The kind of protected material                |
| `/metadata/secret/provider`         | string  | RECOMMENDED                                   | The kind of custody system holding it         |
| `/metadata/secret/algorithm`        | string  | RECOMMENDED for keys and certificates         | The cryptographic algorithm                   |
| `/metadata/secret/expiresAt`        | string  | RECOMMENDED on keys; REQUIRED on certificates | When the material stops being valid           |
| `/metadata/secret/destinationType`  | string  | REQUIRED on export                            | The kind of destination material was moved to |
| `/metadata/secret/approvalRequired` | boolean | Producer declaration                          | That local policy requires approval           |
| `/metadata/secret/emergencyAccess`  | boolean | Producer declaration                          | That this was break-glass access              |

Illustrative values, all open vocabularies: `type` — `database-credential`, `service-credential`,
`signing-key`, `encryption-key`, `certificate`; `provider` — `software-vault`,
`hardware-security-module`, `managed-key-service`, `internal-certificate-authority`;
`destinationType` — `hardware-security-module`, `managed-key-service`, `offline-backup`,
`operator-console`, `external-party`.

`provider` and `destinationType` record the **kind** of system, not a product name and not an
address. A product name dates the trail and an address is frequently sensitive itself; neither is
comparable across deployments.

Namespacing keeps two profiles from assigning different meanings to the same key when one event is
governed by both. `expiresAt` on a share, on a service account and on a certificate are not the same
fact.

**A scalar must never be placed at `/metadata/secret` itself.** The container is a descriptor; a
string there would be read as the secret, and `auditmodel lint-privacy` reports it as one.

## Conditional policy fields

The rule language offers exactly one conditional mechanism: one path compared for equality against
one scalar. This profile spends it twice, and in both cases on a **producer declaration** rather than
on the profile's own guess.

- `/metadata/secret/approvalRequired` — `true` makes `/approval` required by `SECRET-APPROVAL-001`.
- `/metadata/secret/emergencyAccess` — `true` makes `/approval` and multi-factor authentication
  required by `SECRET-ACCESS-002`.

Neither flag is itself required, and **an absent flag does not hold**: a rule whose condition path is
missing contributes nothing. The alternative — treating an absent flag as possibly true — would fail
every event that omitted a field the rule was never meant to govern. A recorded `false` is an answer,
not an absence, and the profile treats it as one.

## Approval model

**Approval is never required unconditionally**, and a test enforces that no rule requires `/approval`
without a `when` condition.

Requiring approval for every rotation would describe one organization's process and be ignored by
everyone else: automated rotation and unattended certificate renewal are the healthy paths in this
domain, they run thousands of times a day without a human anywhere near them, and a profile that
punished them would push deployments back towards long-lived material. So the profile **recommends**
approval where it is often appropriate — reveal, export, destruction, policy change — and
**requires** it in exactly two places: where the producer's own policy declared it necessary, and
where the producer declared the access to be break-glass.

Both rules require the `/approval` **object**, not an `approved` status. Emergencies are frequently
approved retrospectively, and `status: pending` on a completed operation is an accurate record of a
control bypass — precisely what a post-incident review looks for. Making that unrepresentable would
encourage producers to suppress it, which is the outcome the model exists to prevent. See
[configuration-and-change.md](../../semantic-conventions/configuration-and-change.md) §4.

## Privacy considerations

The following MUST NOT appear in any event governed by this profile, in any field, under any
property name:

1. Secret values, old or new, whole or partial.
2. Private or symmetric key material, wrapped or unwrapped.
3. Recovery phrases, key shares, unwrapping keys and passphrases.
4. Passwords, client secrets, tokens and API credentials.
5. Connection strings, in `metadata`, in `change.before`/`change.after` or anywhere else.
6. A hash or fingerprint of any of the above that would allow verification against a guess.

This is a requirement of the profile that **no rule in it can check**, and the profile says so rather
than approximating it with a rule that would be wrong. Checking values is
[`auditmodel lint-privacy`](../../specification/privacy.md), a separate and complementary command: a
profile says which fields must be present, the linter says which values must not. Every published
fixture here is required by test to pass both, and is additionally scanned field by field for a
scalar under any credential-shaped property name.

A rotation records `change.changedFields: ["secret", "version", "rotatedAt"]` and version identifiers
in `change.before` and `change.after`. The fact of the rotation is fully auditable; the material
appears nowhere. See [change-model.md](../../specification/change-model.md) §5.

No rule requires a personal identifier. `/resource/ownerId` is satisfied by an owning team or service
and needs no individual's name; `/metadata/secret/type` describes material, not people.

## Known rule-language limitations

These are requirements or checks the v0.1 rule language cannot express. They are stated rather than
approximated.

1. **No numeric comparison.** `SECRET-CERT-001` can require an expiry to be present and to be a
   string. It cannot check that it is after the event time, that a certificate lifetime is below a
   maximum, or that a rotation interval in a policy change did not get longer.
2. **No cross-field comparison.** The profile cannot require that `change.before` and `change.after`
   differ, so a rotation that changed nothing and a rotation that worked are indistinguishable to it.
3. **No array-content predicates.** It cannot assert that `change.changedFields` names the member
   that was replaced, that `approval.approvers` holds two distinct principals, or that
   `receivedApprovals` reached `requiredApprovals`.
4. **No disjunction.** "either an expiry or a declared non-expiring justification" is unexpressible;
   the profile requires the strictly weaker thing and documents the rest here.
5. **One condition per rule.** "emergency access to material classified `secret`" cannot be written;
   `SECRET-ACCESS-002` fires on the emergency declaration alone.
6. **Semantics are unverifiable.** A checker can confirm `/resource/id` is present. It cannot confirm
   that it names the material acted on, that the actor is the operator rather than the custody
   service, or that `/metadata/secret/type` is truthful.
7. **Absence of material is unverifiable by a profile.** Rule evaluation is presence, JSON type and
   scalar equality. Nothing in it could detect a secret placed in a field the profile requires.

## Cross-profile overlaps

Four families in this repository touch secrets, and they are deliberately separated by **whose control
domain the event belongs to**, not by what the material is called.

| Event                                    | Owned by                                                                              | Why                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `identity.credential.rotate`             | [identity-and-access-management](../identity-and-access-management/) (`IAM-CRED-001`) | The credential belongs to a **principal**. The reviewable fact is whose access it grants.                             |
| `configuration.secret.rotate`, `.access` | configuration and change conventions                                                  | The secret is an application **setting**. The reviewable fact is that a deployed configuration changed.               |
| `api-key.*`                              | [api-and-integration-management](../api-and-integration-management/)                  | The credential is an **interface grant** to a caller. The reviewable fact is who may call what.                       |
| `secret.*`, `key.*`, `certificate.*`     | **this profile**                                                                      | The material is held **in custody**. The reviewable fact is what the custodian did with material it holds for others. |

This profile **does not govern** `identity.credential.rotate`, `configuration.secret.*` or
`api-key.*`, and duplicates none of their rules. `IAM-CRED-001` already requires authorization, a
justification and `/metadata/credential/type` for principal credentials; adding a second rule over
the same name would mean two profiles disagreeing about one event. The separation is also structural:
no selector here uses a `key.` prefix, so `api-key.create` could not match this profile even by
accident.

A deployment whose secret store _is_ its configuration system should pick one domain and use it
consistently rather than emitting both. Where an operation genuinely belongs to two domains — a
custody rotation that also rotates a service account's credential — emit the event of the system that
performed it and reference the other through `relatedResources` or `/request/correlationId`.

There is one further overlap outside the profiles: [integrity.md](../../specification/integrity.md)
§8 (10) states that key management — generation, storage, rotation, revocation, distribution and
custody — is outside the core specification. That remains true. This profile governs **audit events
about** key management; it defines no key management behaviour, no algorithm requirement and no trust
model.

## Fixtures

[examples/profiles/secrets-and-key-management/](../../examples/profiles/secrets-and-key-management/)
— twelve valid, twelve invalid, three not applicable.

| Fixture                        | Event                  | Rules exercised                                         |
| ------------------------------ | ---------------------- | ------------------------------------------------------- |
| `secret-create.json`           | `secret.create`        | `CORE-001`, `CORE-002`, `LIFECYCLE-001`                 |
| `secret-rotate.json`           | `secret.rotate`        | `ROTATE-001`, unattended rotation with no justification |
| `secret-reveal.json`           | `secret.reveal`        | `ACCESS-001`                                            |
| `secret-reveal-emergency.json` | `secret.reveal`        | `ACCESS-002` with a retrospective approval              |
| `secret-export.json`           | `secret.export`        | `ACCESS-001`, `EXPORT-001`, `APPROVAL-001`              |
| `secret-revoke.json`           | `secret.revoke`        | `DESTROY-001`                                           |
| `secret-policy-update.json`    | `secret.policy.update` | `POLICY-001`                                            |
| `key-generate.json`            | `key.generate`         | `LIFECYCLE-001`, `KEY-002`                              |
| `key-import.json`              | `key.import`           | `KEY-001`, `LIFECYCLE-001`                              |
| `key-destroy.json`             | `key.destroy`          | `DESTROY-001`, `APPROVAL-001`                           |
| `key-export.json`              | `key.export`           | `ACCESS-001`, `EXPORT-001`                              |
| `certificate-issue.json`       | `certificate.issue`    | `CERT-001`, `LIFECYCLE-001`                             |

Every enforceable rule has exactly one negative fixture, listed in the
[fixture README](../../examples/profiles/secrets-and-key-management/README.md). Each removes one
required value from a valid fixture and fails for one documented reason.

### Not-applicable rationale

`secret-retrieve.json`, `secret-cache-refresh.json` and `key-decrypt.json` are ordinary,
well-formed audit events that this profile deliberately does not govern: a workload reading its own
credential at start-up, the same workload refreshing its cached copy, and a service decrypting a
record with a key it is permitted to use. `check-profile` reports each as not applicable, with exit
code 3.

They exist to hold the exclusion in place. If a future edit widened a selector to a bare `secret.` or
`key.` prefix, these fixtures would start conforming instead of being skipped and the test would fail
— which is the point, because that edit would silently impose an authorization decision, a
classification and a material type on every secret read and every cryptographic operation in a
production system.

## Not required, and why

- **Trace identifiers.** `/request/traceId` presupposes a tracing discipline a conforming producer
  may not have. `/request/correlationId` is recommended, never required, including for rotation.
- **A justification for scheduled rotation.** Automated rotation is the behaviour the profile wants
  to encourage; a required `/reason` would make the safest path the most expensive one.
- **`/request/protocol`, `/request/ipAddress`, `/request/userAgent`.** Real signals for interactive
  access, but they describe one access mechanism. A custody operation performed by a scheduler has
  none of them.
- **Key fingerprints and material hashes.** They are exactly what an attacker needs to confirm a
  guess. `/resource/id` identifies the material without describing it.
- **Quorum, key shares and split knowledge.** Genuine controls in high-assurance custody, but the
  rule language cannot inspect `approval.approvers`, and requiring the object without being able to
  check its contents would suggest a guarantee the tool does not give.
- **A `secret.approval.*` event family.** Approval is already modelled by `workflow.approval.*` in
  [workflow-and-approval.md](../../semantic-conventions/workflow-and-approval.md) and by the core
  `/approval` object.

## Open questions

- Is a single `/metadata/secret/type` enough, or do keys need a separate usage field — signing,
  encryption, key-wrapping — that a rotation cannot change? The profile currently folds usage into
  the type vocabulary.
- Should `secret.reveal` by a service actor be treated differently from a reveal by a human? The
  profile requires `/authentication` for both and lets `actor.type` carry the distinction, because
  automated reveal is real in migration tooling and rejecting it would push producers to mislabel it.
- Should `key.export` require an approval unconditionally? It is the operation with the largest
  irreversible consequence in the profile, but disaster-recovery replication performs it on a
  schedule in deployments that are not doing anything wrong.
- Is `/metadata/secret/destinationType` the right granularity, or is an external-versus-internal
  boolean the fact reviewers actually filter on, as the document profile's `recipientType` suggests?

## Compatibility

The profile version is independent of the core specification version. `coreVersions` declares which
core versions the profile applies to; an event declaring any other `specVersion` is **not applicable**
rather than in violation. Adding a rule is a breaking change for producers, in the same sense as
adding a required core field.

## Not a compliance statement

Conformance to this profile means an event carries the fields this profile requires. It is not
compliance with any law, regulation, standard, certification scheme or contract, and MUST NOT be
presented as evidence of one. Nothing here asserts that any cryptographic algorithm, key length,
rotation interval or custody arrangement is adequate.
