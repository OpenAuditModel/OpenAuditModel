# Document management profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[document-management profile](../../../profiles/document-management/). The rules themselves are in
[profile.json](../../../profiles/document-management/profile.json).

```bash
auditmodel check-profile examples/profiles/document-management/valid --profile document-management
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming** event. The
ones under `invalid/` fail the profile, not the core schema. That separation is the point: a profile
adds requirements to events the core already accepts.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate      examples/profiles/document-management/valid
auditmodel lint-privacy  examples/profiles/document-management/valid
auditmodel check-profile examples/profiles/document-management/valid --profile document-management
```

A profile that accepted an event the core rejects would break the core invariant. A profile that
accepted an event carrying a credential would be worse than no profile.

## Valid fixtures

| File                    | Event                       | Demonstrates                                            |
| ----------------------- | --------------------------- | ------------------------------------------------------- |
| `file-upload.json`      | `document.file.upload`      | The core requirements alone                             |
| `file-download.json`    | `document.file.download`    | A governed read — download is in scope, view is not     |
| `file-delete.json`      | `document.file.delete`      | Deletion with a justification and an approval           |
| `share-internal.json`   | `document.share.create`     | An internal share, where no expiry is required          |
| `share-external.json`   | `document.share.create`     | An external share: expiry and justification required    |
| `share-revoke.json`     | `document.share.revoke`     | Withdrawal, which needs the recipient type but no grant |
| `permission-grant.json` | `document.permission.grant` | An access-policy change naming its subject              |
| `version-rollback.json` | `document.version.rollback` | A rollback naming the version it replaced               |
| `retention-update.json` | `document.retention.update` | A retention transition recorded as before and after     |
| `legal-hold-apply.json` | `document.legal-hold.apply` | A hold recording its resulting state                    |

Three of these produce a `DOC-CORE-002` **warning** for a missing `/reason`. That is intentional:
a routine upload or download often has no business justification beyond the user's job, and the
profile recommends rather than requires one. A warning never fails conformance.

## Invalid fixtures

Each removes exactly one required field from a valid fixture, so it fails for one documented reason.
A test asserts both the rule and the pointer, and that **exactly one** error is produced.

| File                                     | Violates            | At                               |
| ---------------------------------------- | ------------------- | -------------------------------- |
| `upload-missing-authorization.json`      | `DOC-CORE-001`      | `/authorization`                 |
| `download-missing-classification.json`   | `DOC-CORE-001`      | `/resource/classification`       |
| `share-missing-recipient-type.json`      | `DOC-SHARE-001`     | `/metadata/share/recipientType`  |
| `share-create-missing-permission.json`   | `DOC-SHARE-002`     | `/metadata/share/permission`     |
| `external-share-missing-expiry.json`     | `DOC-SHARE-003`     | `/metadata/share/expiresAt`      |
| `external-share-missing-reason.json`     | `DOC-SHARE-003`     | `/reason`                        |
| `permission-grant-missing-grantee.json`  | `DOC-PERM-001`      | `/metadata/permission/granteeId` |
| `version-rollback-missing-previous.json` | `DOC-VERSION-002`   | `/metadata/version/previousId`   |
| `delete-missing-reason.json`             | `DOC-DELETE-001`    | `/reason`                        |
| `retention-update-missing-class.json`    | `DOC-RETENTION-001` | `/metadata/retention/class`      |
| `legal-hold-missing-state.json`          | `DOC-HOLD-001`      | `/metadata/legalHold/active`     |

## Not-applicable fixture

`file-view.json` is a `document.file.view` event. It is a perfectly good audit event that this
profile deliberately does not govern, and `check-profile` reports it as not applicable with exit
code 3.

It exists to hold the exclusion in place. If a future edit widened a selector to a bare `document.`
prefix, this fixture would start conforming instead of being skipped, and the test would fail — which
is the point, because that edit would silently impose requirements on every view event in a document
system.

## Vendor neutrality

No fixture names a real product, company, jurisdiction or regulation. Retention classes, hold
references and policy names are illustrative strings, not any organization's scheme.
