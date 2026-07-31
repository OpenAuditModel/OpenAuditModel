# Backup and recovery profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[backup-and-recovery profile](../../../profiles/backup-and-recovery/). The rules themselves are in
[profile.json](../../../profiles/backup-and-recovery/profile.json).

```bash
auditmodel check-profile examples/profiles/backup-and-recovery/valid --profile backup-and-recovery
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming** event. The
ones under `invalid/` fail the profile, not the core schema. That separation is the point: a profile
adds requirements to events the core already accepts.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate      examples/profiles/backup-and-recovery/valid
auditmodel lint-privacy  examples/profiles/backup-and-recovery/valid
auditmodel check-profile examples/profiles/backup-and-recovery/valid --profile backup-and-recovery
```

A profile that accepted an event the core rejects would break the core invariant. A profile that
accepted an event carrying a storage credential would be worse than no profile — and backup metadata
is where storage credentials go to hide.

## Valid fixtures

| File                          | Event                  | Demonstrates                                                        |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `backup-create.json`          | `backup.create`        | A scheduled run, authorized by the schedule rather than by a person |
| `backup-complete.json`        | `backup.complete`      | A successful run recording the recovery point it produced           |
| `backup-complete-failed.json` | `backup.complete`      | A failed run: no recovery point is required, an error is            |
| `backup-verify.json`          | `backup.verify`        | A restore rehearsal recording its verdict and its evidence          |
| `backup-delete.json`          | `backup.delete`        | Early disposal with a justification and a declared approval         |
| `backup-expire.json`          | `backup.expire`        | Retention-driven disposal naming the class that drove it            |
| `snapshot-create.json`        | `snapshot.create`      | A pre-change safeguard snapshot                                     |
| `snapshot-delete.json`        | `snapshot.delete`      | Owner disposal of a superseded snapshot, no approval required       |
| `restore-start.json`          | `restore.start`        | A production restore: source, recovery point, reason and approval   |
| `restore-complete.json`       | `restore.complete`     | The completion of the same operation, tied by `restoreId`           |
| `recovery-start.json`         | `recovery.start`       | A declared disaster recovery                                        |
| `recovery-failover.json`      | `recovery.failover`    | Service moved to a named secondary scope                            |
| `recovery-failback.json`      | `recovery.failback`    | Service returned to the primary scope, closing the same recovery    |
| `recovery-complete.json`      | `recovery.complete`    | The recovery closed, tied to every stage by `recoveryId`            |
| `policy-update.json`          | `backup.policy.update` | Protection reduced, recorded as a `change` with before and after    |

Three of these produce a **warning**, and every one of them is intentional. `backup-create.json` and
`backup-complete.json` warn under `BACKUP-CORE-002` for a missing `/reason`: a nightly scheduled run
has no business justification beyond the schedule itself, and the profile recommends rather than
requires one there. `snapshot-delete.json` warns under `BACKUP-DELETE-001` for a missing `/approval`,
which is precisely the case that rule's rationale describes — an owner removing a superseded copy of
their own service's data. A warning never fails conformance.

`backup-complete-failed.json` is the fixture that proves `BACKUP-SET-002` is conditional. It carries
no `/metadata/backup/recoveryPoint`, because a run that failed produced none, and it conforms. Flip
its `event.outcome` to `success` and the same event violates `BACKUP-SET-002` — a test does exactly
that.

`backup-delete.json`, `restore-start.json`, `recovery-failover.json` and `recovery-failback.json` all
declare `/metadata/backup/approvalRequired: true` and carry an approval. The other two directions of
the same rule are covered as well: `snapshot-delete.json` declares `approvalRequired: false` and
carries no approval, and `snapshot-create.json` declares nothing at all. All three cases conform,
which is how the conditional approval rule is meant to behave — the rule still matches the event, and
only its condition fails to hold.

## Invalid fixtures

Each removes exactly one profile-required value from a valid fixture, so it fails for one documented
reason. A test asserts both the rule and the pointer, and that **exactly one** error is produced.

| File                                             | From                     | Violates              | At                                    |
| ------------------------------------------------ | ------------------------ | --------------------- | ------------------------------------- |
| `backup-create-missing-authorization.json`       | `backup-create.json`     | `BACKUP-CORE-001`     | `/authorization`                      |
| `backup-complete-missing-backup-id.json`         | `backup-complete.json`   | `BACKUP-SET-001`      | `/metadata/backup/backupId`           |
| `backup-complete-missing-recovery-point.json`    | `backup-complete.json`   | `BACKUP-SET-002`      | `/metadata/backup/recoveryPoint`      |
| `backup-verify-missing-verification-status.json` | `backup-verify.json`     | `BACKUP-VERIFY-001`   | `/metadata/backup/verificationStatus` |
| `backup-delete-missing-reason.json`              | `backup-delete.json`     | `BACKUP-DELETE-001`   | `/reason`                             |
| `backup-expire-missing-retention-class.json`     | `backup-expire.json`     | `BACKUP-EXPIRE-001`   | `/metadata/backup/retentionClass`     |
| `snapshot-create-missing-snapshot-id.json`       | `snapshot-create.json`   | `BACKUP-SNAPSHOT-001` | `/metadata/backup/snapshotId`         |
| `restore-start-missing-source-id.json`           | `restore-start.json`     | `BACKUP-RESTORE-001`  | `/metadata/backup/sourceId`           |
| `restore-start-missing-approval.json`            | `restore-start.json`     | `BACKUP-APPROVAL-001` | `/approval`                           |
| `recovery-failover-missing-recovery-id.json`     | `recovery-failover.json` | `BACKUP-RECOVERY-001` | `/metadata/backup/recoveryId`         |
| `recovery-failover-missing-target-scope.json`    | `recovery-failover.json` | `BACKUP-FAILOVER-001` | `/metadata/backup/targetScope`        |
| `policy-update-missing-change.json`              | `policy-update.json`     | `BACKUP-POLICY-001`   | `/change`                             |

There is one invalid fixture for every enforceable rule, and a test fails if a rule with severity
`error` acquires no negative fixture. A second test holds the positive direction: every event name a
rule selects is illustrated by a valid fixture, so adding an event to a selector without showing what
a conforming one looks like fails the suite.

Some of these also produce a **warning**, and that is expected: removing `/reason` warns under
`BACKUP-CORE-002` as well as failing `BACKUP-DELETE-001`, and removing `/approval` warns under
`BACKUP-RESTORE-001` as well as failing `BACKUP-APPROVAL-001`. Warnings are not errors, and the
"exactly one reason" test counts errors.

## Not-applicable fixtures

| File                             | Event                       | Why it is out of scope                                  |
| -------------------------------- | --------------------------- | ------------------------------------------------------- |
| `backup-chunk-write.json`        | `backup.chunk.write`        | One of thousands of data-plane writes per run           |
| `restore-progress.json`          | `restore.progress`          | A percentage-complete heartbeat of an audited operation |
| `storage-replica-heartbeat.json` | `storage.replica.heartbeat` | Continuous replication telemetry                        |

Each is a perfectly good audit event that this profile deliberately does not govern, and
`check-profile` reports it as not applicable with exit code 3.

They exist to hold the exclusion in place. Every rule outside the `backup.policy.` family selects
**exact event names**, so these three match nothing. If a future edit widened a selector to a bare
`backup.`, `restore.` or `storage.` prefix, these fixtures would start conforming instead of being
skipped and the test would fail — which is the point, because that edit would silently impose an
authorization decision and a justification on every chunk write in every backup run.

Note that `backup-chunk-write.json` carries `/metadata/backup/backupId` even though nothing requires
it. An ungoverned event is not a worse event; the profile simply adds nothing to it.

## Vendor neutrality

No fixture names a real product, company, cloud, filesystem, jurisdiction or regulation. Backup types,
retention classes, verification verdicts, policy names and scope names are illustrative strings, not
any organization's scheme. Identifiers are opaque and lower-case (`backup-2026-0314-0200`,
`region-south-secondary`), never customer names, account numbers or endpoints.

No fixture contains a credential, token, pre-signed URL, storage connection string, encryption key or
personal identifier, and no fixture uses `/integrity/batchId` — which identifies an integrity sealing
batch and never a backup set. Tests assert both.
