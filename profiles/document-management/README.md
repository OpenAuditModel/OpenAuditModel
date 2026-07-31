# Document Management Profile

**Status: Experimental. Implemented in v0.1, 11 rules.**

Scope: applications that store, version, share and retain documents — content platforms, contract
systems, records management, engineering document control, knowledge bases.

The profile is vendor-neutral. It describes operations that any document system performs, not the
feature list of any product. It assumes no particular storage backend, approval workflow or
regulatory framework.

The enforceable rules are in [profile.json](profile.json).

```bash
auditmodel check-profile examples/profiles/document-management/valid --profile document-management
```

## What this profile governs

| Event                                            | Governed |
| ------------------------------------------------ | -------- |
| `document.file.upload`, `.delete`, `.download`   | yes      |
| `document.share.*`                               | yes      |
| `document.permission.*`                          | yes      |
| `document.version.*`                             | yes      |
| `document.retention.*`                           | yes      |
| `document.legal-hold.*`                          | yes      |
| `document.file.view` and other high-volume reads | **no**   |

### Why reads are excluded

A document system emits a view event every time anyone opens anything. Requiring an authorization
decision, a classification and a justification on each of them would add cost to the highest-volume
event in the system in exchange for very little review value, and the requirement would be switched
off rather than met.

The exclusion is structural, not a matter of discipline: **no selector in this profile uses a bare
`document.` prefix**, so `document.file.view` matches no rule and `check-profile` reports it as not
applicable. A test asserts that, because widening one prefix later would silently start governing
every read in a deployment.

Excluded does not mean unaudited. A view event is still a conforming OpenAuditModel event, and
[data-access.md](../../semantic-conventions/data-access.md) covers recording reads.

## Rules

| Rule                | Applies to                       | Requires                                                     |
| ------------------- | -------------------------------- | ------------------------------------------------------------ |
| `DOC-CORE-001`      | every governed event             | `/authorization`, `/resource/classification`                 |
| `DOC-CORE-002`      | every governed event             | _recommends_ `/reason`, `/resource/parentId`, correlation ID |
| `DOC-SHARE-001`     | `document.share.*`               | `/metadata/share/recipientType`                              |
| `DOC-SHARE-002`     | `document.share.create`          | `/metadata/share/permission`; recommends an expiry           |
| `DOC-SHARE-003`     | external `document.share.create` | `/reason`, `/metadata/share/expiresAt`                       |
| `DOC-PERM-001`      | `document.permission.*`          | `/metadata/permission/granteeId`, `/metadata/permission/id`  |
| `DOC-VERSION-001`   | `document.version.*`             | `/metadata/version/id`                                       |
| `DOC-VERSION-002`   | `document.version.rollback`      | `/reason`, `/metadata/version/previousId`                    |
| `DOC-DELETE-001`    | `document.file.delete`           | `/reason`; recommends `/approval`                            |
| `DOC-RETENTION-001` | `document.retention.*`           | `/change`, `/reason`, `/metadata/retention/class`            |
| `DOC-HOLD-001`      | `document.legal-hold.*`          | `/reason`, `/metadata/legalHold/active`                      |

Each rule's full text and rationale is in [profile.json](profile.json).

## Design decisions

**External sharing is the only conditional rule.** `DOC-SHARE-003` fires only when the producer has
declared `/metadata/share/recipientType` to be `external`. The profile does not try to decide what
external means for a given deployment — a partner tenant is external to some organizations and
internal to others — so the producer makes that call and the profile enforces the consequence.

This is the same shape as the IAM profile's privileged-role rule, and it is the only conditional
mechanism v0.1 offers: one path compared for equality against one scalar.

**Expiry is recommended generally and required externally.** Indefinite internal access is often a
deliberate and correct choice. Indefinite external access rarely is.

**Approval is recommended, never required.** Many document systems legitimately let an owner delete
their own draft or reclassify their own file. A rule that required approval for every deletion would
describe one organization's process and be ignored by everyone else.

**Metadata is namespaced.** Requirements use `/metadata/share/...`, `/metadata/version/...`,
`/metadata/retention/...` rather than flat keys, matching the IAM profile's `/metadata/role/...`
convention. Namespacing keeps two profiles from assigning different meanings to the same key when an
event is governed by both — `expiresAt` on a share and on a credential are not the same fact.

**Retention and legal hold record state, not obligations.** The profile requires that the resulting
retention class and hold condition be recorded, and that the change be justified. It says nothing
about how long anything must be kept, what any class means, or what any jurisdiction requires.
Conformance with these rules is not compliance with any legal duty.

**Array contents are never inspected.** The v0.1 rule language checks presence, JSON type and scalar
equality. It cannot assert that `/evidence` contains an entry of a particular type, and this profile
does not pretend otherwise.

## Not required, and why

- **Watermarking, password protection, download permissions.** Real controls, but product features
  rather than universal document operations. They belong in `metadata` or an extension.
- **A document approval event family.** Approval is already modelled by `workflow.approval.*` in
  [workflow-and-approval.md](../../semantic-conventions/workflow-and-approval.md), and by the core
  `/approval` object. Inventing `document.approval.*` would duplicate both.
- **`/organization/workspaceId` as an alternative to `/resource/parentId`.** The earlier placeholder
  proposed "one or the other", which the rule language cannot express — there is no disjunction.
  `parentId` is recommended rather than required, so a flat repository is not forced to invent a
  container.

## Fixtures

[examples/profiles/document-management/](../../examples/profiles/document-management/) — ten valid,
eleven invalid, one not-applicable. Every valid fixture is core-conforming and privacy-clean; every
invalid fixture is core-**valid** and fails exactly one profile rule.

## Open questions

- Is a share to an internal group meaningfully different from a share to an external recipient, or is
  `recipientType` sufficient? The profile currently assumes the producer's declaration is enough.
- How should a share whose scope changes over time be modelled: as revoke plus create, or as an
  update? The profile accepts either and requires the recipient type in both.
- Should `document.file.download` of a restricted document require stronger evidence, such as
  multi-factor authentication? Expressing that needs a producer-set discriminator like the IAM
  profile's `privileged` flag, and there is no adoption evidence yet for what it should be called.
