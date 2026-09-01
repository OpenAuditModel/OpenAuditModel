# Backup and Recovery Events

**Specification version: 0.1 · Status: Experimental**

## 1. Recommended event names

Three categories, because taking a backup, deleting one and changing a retention policy are different
kinds of operation:

| Family                                  | `event.category`       |
| --------------------------------------- | ---------------------- |
| Backup, snapshot and restore operations | `data-infrastructure`  |
| Deletion, expiry and failover           | `privileged-operation` |
| Retention and schedule policy           | `configuration`        |

### Backups and snapshots

| Name              | Operation                                          |
| ----------------- | -------------------------------------------------- |
| `backup.create`   | A backup was started                               |
| `backup.complete` | A backup finished, successfully or otherwise       |
| `backup.verify`   | A backup was tested for restorability              |
| `backup.expire`   | A backup passed its retention date and was removed |
| `backup.delete`   | A backup was deleted before its retention date     |
| `snapshot.create` | A point-in-time snapshot was taken                 |
| `snapshot.delete` | A snapshot was removed                             |

### Restore and recovery

| Name                | Operation                                     |
| ------------------- | --------------------------------------------- |
| `restore.start`     | A restore was started                         |
| `restore.complete`  | A restore finished, successfully or otherwise |
| `recovery.start`    | A recovery procedure was started              |
| `recovery.complete` | A recovery procedure finished                 |
| `recovery.failover` | Service was moved to a standby site or system |
| `recovery.failback` | Service was returned to the primary           |

### Policy

`backup.policy.update` records a change to a retention period, a schedule or a verification
requirement. It is the operation that decides whether the rest of this vocabulary will have anything
to describe.

## 2. These operations come in pairs

`backup.create` and `backup.complete`, `restore.start` and `restore.complete`, `recovery.start` and
`recovery.complete` are two events about one operation, because the operation takes long enough that
its beginning and its end are separately interesting.

**The pair MUST share a `request.correlationId`.** A start with no completion is precisely what an
auditor is looking for — a backup that never finished, a restore abandoned halfway — and it is only
findable when the two events can be joined. See
[correlation-and-tracing.md](correlation-and-tracing.md).

The outcome belongs on the completion event, in `event.outcome`, not in the name:
`backup.complete` with `outcome: failure` rather than a `backup.failed` name. See
[event-naming.md](event-naming.md) §5.

## 3. Progress events are deliberately ungoverned

A running backup emits progress continuously. `restore.progress` and `backup.chunk.write` appear in
the published fixtures as events the profile does **not** govern, and the reason is the one
[profiles/backup-and-recovery/README.md](../profiles/backup-and-recovery/README.md) gives: requiring
an authorization decision and a reason on every chunk written would put the heaviest requirements on
the highest-volume event, and the requirement would be switched off rather than met.

Producers MAY emit progress events. They are operational telemetry, and an audit trail that filled
with them would be reviewed by nobody.

## 4. What must never be recorded

**The backed-up content.** A backup event names a backup; it does not sample it, summarise it or
quote a record from it. A backup exists precisely because it holds everything, and an audit trail is
not the place to leak a row of it.

**Nothing that identifies the data subjects inside a backup.** A backup of a customer database is
described by its scope, its size and its source system, never by whose records it contains. A restore
event is the same: it records that data was restored, from which backup, to where, and by whom.

Credentials for the backup target, storage account keys and connection strings are out of bounds for
the ordinary reason — see [privacy.md](../specification/privacy.md) §6.

## 5. Which principal goes where

| Operation                                         | `actor`                 | `resource`      | `subject` |
| ------------------------------------------------- | ----------------------- | --------------- | --------- |
| A scheduled job takes a backup                    | the job's identity      | the **backup**  | absent    |
| An operator deletes a backup before its retention | the operator            | the **backup**  | absent    |
| An operator restores a database                   | the operator            | the **restore** | absent    |
| A platform fails service over to a standby        | the platform's identity | the **service** | absent    |

The system that was backed up is a **related resource**, not the primary one: what the event is about
is the backup or the restore, and that is what changed. `subject` does not appear in this domain — no
backup operation is performed on another principal's behalf in the sense
[actor-model.md](../specification/actor-model.md) §5 defines.

## 6. Early deletion is the event that matters

`backup.expire` is routine: a retention period elapsed and the platform did what it was configured to
do. `backup.delete` is not: a principal removed a backup before its retention date, and the recovery
position of whatever it protected is now different.

Where the producer distinguishes the two, the distinction SHOULD be in the name rather than in a
field, which is why both names exist. An early deletion SHOULD carry its justification in `reason`,
and where the producer's policy requires a second principal to agree, in `approval`.

## 7. Context to populate

| Field                   | Guidance                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| `authorization`         | The decision that permitted the operation                            |
| `request.correlationId` | Shared by the start and completion of one operation                  |
| `relatedResources`      | The system, database or volume the backup protects                   |
| `reason`                | Why an early deletion, a failover or an unscheduled restore was done |
| `approval`              | Where deletion or failover requires a second principal's decision    |
| `metadata.backup`       | Scope, size, retention class, target and verification state          |

## 8. Example

See
[examples/profiles/backup-and-recovery/valid/restore-start.json](../examples/profiles/backup-and-recovery/valid/restore-start.json)
for the start of a restore with the authorization decision, the correlation identifier that joins it
to its completion, and the backup it restores from.
