# Backup and Recovery Profile

**Status: Experimental. Implemented in v0.1, 13 rules (12 enforceable).**

Scope: systems that create, verify, retain, delete and restore recovery points, and systems that move
service between sites — database and virtual machine backup products, storage snapshot managers,
object-storage archival tooling, replication and disaster-recovery orchestrators, and the backup
policy engines that decide what is protected.

The profile is vendor-neutral. It describes operations that any protection system performs, and
assumes no particular storage backend, transport, replication topology, scheduler, approval workflow
or regulatory framework. No rule names a product, a cloud, a filesystem or a protocol.

The enforceable rules are in [profile.json](profile.json).

```bash
auditmodel check-profile examples/profiles/backup-and-recovery/valid --profile backup-and-recovery
```

## Purpose

Backup and recovery tooling holds two things nothing else in an organization holds at once: standing
read access to the most complete copy of the data, and the ability to overwrite production with an
older version of it. A restore is simultaneously a recovery and a data-loss event. A backup deletion
destroys the only evidence of what was deleted. A failover moves production somewhere else, usually
in a hurry, usually under an incident.

These operations are also the ones most often audited least, because they are performed by service
accounts on a schedule and the volume is dominated by machinery. The profile draws the line at the
operations a human would be asked about afterwards, and requires of them the handful of facts that
cannot be reconstructed once the moment has passed.

## Scope

### Event families

| Family        | Events                                                                                   | Governed |
| ------------- | ---------------------------------------------------------------------------------------- | -------- |
| Backup set    | `backup.create`, `backup.complete`, `backup.verify`, `backup.delete`, `backup.expire`    | yes      |
| Backup policy | `backup.policy.*`                                                                        | yes      |
| Snapshot      | `snapshot.create`, `snapshot.delete`                                                     | yes      |
| Restore       | `restore.start`, `restore.complete`                                                      | yes      |
| Recovery      | `recovery.start`, `recovery.complete`, `recovery.failover`, `recovery.failback`          | yes      |
| Data plane    | `backup.chunk.write`, `backup.progress`, `restore.progress`, `storage.replica.heartbeat` | **no**   |

`backup.create` records that a protection run was requested or started; `backup.complete` records
that it finished, and on success that a restorable copy now exists. Producers that emit a single
event for the whole run should use `backup.complete`, because that is the event the profile asks for a
recovery point.

`/resource` always names the **protected source** — the database, volume, cluster or service whose
data is at stake — not the copy. The copy is named by `/metadata/backup/backupId` or
`/metadata/backup/snapshotId`. That convention is what lets a reviewer filter on one resource and see
its whole protection history: the runs, the verifications, the disposals and the restores.

### Explicit exclusions

The profile deliberately governs **none** of the following:

- **Chunk, block and segment writes.** A single backup run emits thousands. They are machinery, not
  decisions.
- **Progress and percentage-complete reports.** Heartbeats of an operation that is already audited at
  its start and its end.
- **Replication and health heartbeats.** Continuous telemetry about a standing arrangement.
- **Catalogue reads, index scans and backup listings.** Ordinary reads of protection metadata.

Requiring an authorization decision and a justification on each of these would add cost to the
highest-volume events in the system in exchange for almost no review value, and the requirement would
be switched off rather than met.

The exclusion is **structural**, not a matter of discipline. Every rule that governs a family other
than backup policy selects **exact event names**, and the only prefix in the whole profile is
`backup.policy.`. There is no bare `backup.`, `snapshot.`, `restore.`, `recovery.` or `storage.`
prefix anywhere, so `backup.chunk.write` and `restore.progress` match no rule at all and
`check-profile` reports them as not applicable. A test asserts this, because widening one selector
later would silently start governing every chunk write in every backup run in a deployment.

Excluded does not mean unaudited. A chunk write is still a conforming OpenAuditModel event; the
profile simply adds nothing to it.

### Failure is an outcome, not an event name

The profile defines no `backup.fail`, `restore.fail` or `recovery.fail` event. A failed backup run is
`backup.complete` with `event.outcome: "failure"` and an `event.error` descriptor, which the core
schema already requires. Encoding the outcome in the name doubles the vocabulary and turns "how often
do our restores fail?" into a string-matching problem; see
[event-naming.md §5](../../semantic-conventions/event-naming.md).

## Rules

| Rule                  | Applies to                                                       | Requires                                                         |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `BACKUP-CORE-001`     | every governed event                                             | `/authorization`                                                 |
| `BACKUP-CORE-002`     | every governed event                                             | _recommends_ `/reason`, `/request/correlationId` (**warning**)   |
| `BACKUP-SET-001`      | `backup.create/.complete/.verify/.delete/.expire`                | `/metadata/backup/backupId`, `/metadata/backup/backupType`       |
| `BACKUP-SET-002`      | `backup.complete` **when** `event.outcome` is `success`          | `/metadata/backup/recoveryPoint`                                 |
| `BACKUP-VERIFY-001`   | `backup.verify`                                                  | `/metadata/backup/verificationStatus`                            |
| `BACKUP-DELETE-001`   | `backup.delete`, `snapshot.delete`                               | `/reason`; recommends `/approval`                                |
| `BACKUP-EXPIRE-001`   | `backup.expire`                                                  | `/metadata/backup/retentionClass`                                |
| `BACKUP-SNAPSHOT-001` | `snapshot.create`, `snapshot.delete`                             | `/metadata/backup/snapshotId`                                    |
| `BACKUP-RESTORE-001`  | `restore.start`, `restore.complete`                              | `/reason`, `/metadata/backup/{restoreId,sourceId,recoveryPoint}` |
| `BACKUP-RECOVERY-001` | `recovery.start/.complete/.failover/.failback`                   | `/metadata/backup/recoveryId`                                    |
| `BACKUP-FAILOVER-001` | `recovery.failover`, `recovery.failback`                         | `/reason`, `/metadata/backup/targetScope`                        |
| `BACKUP-APPROVAL-001` | destructive and site-moving events **when** approval is declared | `/approval`                                                      |
| `BACKUP-POLICY-001`   | `backup.policy.*`                                                | `/change`, `/reason`, `/metadata/backup/policyId`                |

Each rule's full text and rationale is in [profile.json](profile.json). `BACKUP-CORE-002` is the only
rule with severity `warning`; every other rule is `error` and fails conformance.

## Metadata namespace

All profile requirements live under `/metadata/backup/`. Namespacing keeps two profiles from
assigning different meanings to the same key when an event is governed by both — a `recoveryPoint` on
a backup and a `retentionClass` on a document are not the same fact — and it matches the
`/metadata/role/…` and `/metadata/share/…` convention of the published IAM and document profiles.

| Field                | Type    | Meaning                                                                                                   |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `backupId`           | string  | Identifier of the backup copy the event acted on or produced                                              |
| `backupType`         | string  | Kind of copy. Open vocabulary; `full`, `incremental`, `differential`, `synthetic-full`, `transaction-log` |
| `snapshotId`         | string  | Identifier of the snapshot the event created or removed                                                   |
| `restoreId`          | string  | Identifier of the restore operation, shared by its start and its completion                               |
| `recoveryId`         | string  | Identifier of the recovery operation, shared by every stage of it                                         |
| `sourceId`           | string  | Identifier of the copy a restore read **from**                                                            |
| `recoveryPoint`      | string  | Timestamp of the data state the copy holds or the restore returned to                                     |
| `targetScope`        | string  | Logical destination — a site, region, cluster, replica or storage tier                                    |
| `verificationStatus` | string  | Verdict a verification reached about the copy                                                             |
| `retentionClass`     | string  | Producer-defined retention class governing the copy                                                       |
| `policyId`           | string  | Identifier of the backup policy a `backup.policy.*` event changed                                         |
| `approvalRequired`   | boolean | The producer's declaration that local policy required an approval for this operation                      |

`targetScope` is a **logical name**, never an endpoint, URL, bucket URI or connection string. See
[Privacy considerations](#privacy-considerations).

### `/integrity/batchId` is not a backup identifier

This profile never uses `/integrity/batchId`, and neither should a producer of backup events. In this
repository `batchId` identifies an **integrity sealing or verification batch**: the group of events
whose digests were computed, or whose chain was verified, together. It does not identify a job run, a
backup set or any business operation, and a consumer must not read it as one — see
[integrity.md §2.1](../../specification/integrity.md).

The identifiers for a protection operation are `/metadata/backup/backupId`, `snapshotId`, `restoreId`
and `recoveryId`; the identifier for the logical run that spans several events is
`/request/correlationId`. A test asserts that no rule reaches into `/integrity` and that no fixture
carries a `batchId`, so this cannot drift.

## Conditional-policy fields

The v0.1 rule language offers exactly one conditional mechanism: one path compared for equality
against one scalar. This profile spends it twice.

**`BACKUP-SET-002` conditions on the outcome.** A backup run that failed produced no recovery point,
so requiring one unconditionally would force producers to fabricate a value for the failure case. The
rule fires only on `event.outcome: "success"`, where the claim "a restorable copy now exists as of
this moment" is being made and must be substantiated. A condition is one equality test and nothing
else, so `partial` and `unknown` also fall outside it: a `backup.complete` recorded as `partial` is
not asked for a recovery point. Producers that record a partially successful run SHOULD record the
recovery point anyway when the run produced one, because a consumer cannot tell the two cases apart.

**`BACKUP-APPROVAL-001` conditions on a producer declaration.** See below.

When a condition's path is absent the condition does not hold and the rule contributes nothing. That
is why an event omitting `approvalRequired` is not failed for missing approval.

## Approval model

**Routine backup creation is never asked for an approval.** `backup.create`, `backup.complete` and
`snapshot.create` are outside `BACKUP-APPROVAL-001` entirely, and a test asserts it. A profile that
demanded an approval on every scheduled nightly run would be describing a process no organization
operates, and would be switched off within a week.

**Approval is conditional for the five operations that destroy or move.** `backup.delete`,
`snapshot.delete`, `restore.start`, `recovery.failover` and `recovery.failback` must carry
`/approval` **when the producer has set `/metadata/backup/approvalRequired` to `true`**. The profile
does not decide which deployments need an approval — that is an organizational judgement, and a rule
that imposed one answer would describe a single company's process. The producer declares the answer
and the profile enforces the consequence: an event that states approval was required and carries no
approval record documents an operation performed without the control its own system said was needed.

**The profile requires the record, not a particular decision.** It does not require
`approval.status: "approved"`. A rule carries at most one condition, and that one is already spent on
`approvalRequired`; requiring `approved` unconditionally would fail an event that correctly records a
restore that was requested, rejected and did not proceed. Recording the rejection is exactly the
behaviour an audit trail should encourage.

**Approval is recommended, never required, for deletion generally.** `BACKUP-DELETE-001` recommends
`/approval` so that its absence prompts a question rather than a build failure. Many deployments
legitimately let an owner remove a failed or superseded copy of their own service's data.

## Privacy considerations

Backup metadata is an unusually attractive place to leak infrastructure secrets, because the fields a
producer reaches for — "where did this go?", "how did we reach it?" — are exactly the ones that
contain credentials.

**Never record in a backup event:** storage account keys, access key identifiers or secret access
keys, pre-signed or time-limited URLs, SAS tokens, repository passwords or passphrases, encryption
keys or key material, database connection strings, SSH keys, or credentials of any kind belonging to
the backup agent, the storage target or the restored system.

Record instead a **logical** name for the destination — `targetScope: "region-south-secondary"`, not
an endpoint, bucket URI or connection string — and a **key identifier** rather than a key, where the
encryption key needs to be identified at all.

`event.error.message` on a failed run must be sanitized. Backup agents habitually surface the whole
transport error, and the whole transport error habitually contains the URL, which habitually contains
the signature.

Recovery events also touch personal data indirectly: a restore returns data that may include personal
records, and `/privacy` is the place to record that the event itself was minimized. The profile
requires no personal data anywhere, and no rule requires a display name, an email address or an
account identifier.

Every fixture in this profile is checked by `auditmodel lint-privacy` in the test suite, and the
linter is complementary to the profile rather than replaced by it: a profile says which fields must be
present, the linter says which values must not.

## Known rule-language limitations

The v0.1 rule vocabulary checks presence, JSON type and scalar equality, and nothing else. The profile
states the strongest honest rule available and records the rest here as informative guidance.

- **A recovery point is only checked as a present string.** The engine cannot verify that
  `recoveryPoint` is a valid RFC 3339 timestamp, that it precedes `time`, or that the gap between
  them is within any recovery point objective. Producers SHOULD record it as an RFC 3339 timestamp;
  consumers should not assume the profile validated it.
- **No numeric ranges.** The profile cannot express "`receivedApprovals` must be at least
  `requiredApprovals`", "the copy must be no older than 24 hours" or any threshold. Those comparisons
  need a policy engine; OpenAuditModel records decisions and does not evaluate them.
- **No cross-field comparison.** `BACKUP-RESTORE-001` requires both `sourceId` and `recoveryPoint`
  but cannot assert that the recovery point is the one the source copy actually holds.
- **No disjunction.** A rule cannot say "`backupId` **or** `snapshotId`". That is why the backup and
  snapshot families are governed by separate rules with separate identifiers rather than one rule
  accepting either.
- **One condition per rule.** `BACKUP-APPROVAL-001` cannot additionally condition on the outcome, so
  it requires the approval record rather than an approved status; see
  [Approval model](#approval-model).
- **A condition is one equality test, so it cannot express "not a failure".** `BACKUP-SET-002` fires
  on `event.outcome: "success"` and therefore leaves `partial` and `unknown` unchecked. Expressing
  "any outcome other than `failure`" needs negation or disjunction, and the v0.1 vocabulary has
  neither.
- **Array contents are never inspected.** `BACKUP-VERIFY-001` recommends `/evidence` but cannot
  require that it contains an entry of type `document`, and `BACKUP-POLICY-001` requires `/change`
  but cannot require a particular entry in `change.changedFields`.
- **Verification and retention vocabularies are open.** The profile requires that
  `verificationStatus`, `backupType` and `retentionClass` be recorded as strings. It fixes none of
  their values, because what verification means ranges from a checksum comparison to a full restore
  rehearsal, and retention classes are an organizational scheme this specification does not set.

## Not required, and why

- **`/request/correlationId`.** Recommended by `BACKUP-CORE-002` and by three family rules, never
  required. Correlation infrastructure is not universal, and an appliance emitting events with no
  request context would otherwise be pushed to invent one. It remains the field that ties a restore's
  start to its completion, and the one this profile recommends most insistently.
- **Trace and span identifiers.** Never required. A backup appliance may have no tracing at all.
- **`/approval` universally.** See [Approval model](#approval-model).
- **`/metadata/backup/approvalRequired` itself.** The IAM profile requires its `privileged` flag
  because privilege is a property of the role — a fact about the object, knowable from the object.
  Whether an approval was required is a property of the **organization's process**, and forcing every
  producer to assert one on every restore would make the profile a statement about how companies
  ought to be run rather than about what an event must record.
- **A verification schedule, an RPO or an RTO target.** These are policy values, not event facts. A
  profile that required them would be encoding one organization's service levels.
- **The storage destination of a backup.** Not required, because the honest answer is frequently a
  URL with a signature in it. `targetScope` is available for a logical name and is required only
  where the destination is the point of the event, on failover and failback.
- **`event.error` on a failed operation.** Already required by the core schema whenever
  `event.outcome` is `failure`; a profile rule would duplicate it.
- **Immutability, retention-lock or worm claims.** A producer may record them in metadata, but the
  profile requires nothing of the sort and asserts nothing about storage guarantees. This
  specification uses the term _tamper-evident_ and only that term; see
  [integrity.md §1](../../specification/integrity.md).

## Cross-profile overlaps

- **`identity-and-access-management`.** Rotating the credential a backup agent uses is
  `identity.credential.rotate` and belongs to the IAM profile; this profile governs what the agent
  then does. The two never select the same event name.
- **`document-management`.** Both profiles use a `retentionClass` concept, and they mean different
  things: a document's retention class governs a business record, a backup's governs a copy of a
  system. Namespacing keeps them apart — `/metadata/retention/class` versus
  `/metadata/backup/retentionClass` — and no event is selected by both profiles.
- **`incident-management`.** A failover is usually performed during an incident. The incident's own
  lifecycle belongs to that profile; the failover belongs here. `/reason/reference` and
  `/request/correlationId` are the fields that join them, which is why this profile recommends the
  correlation identifier on every recovery event.
- **`deployment-and-change-management`.** A backup policy change is a configuration change, and a
  producer may reasonably emit both a `backup.policy.update` and a change-management event for the
  same approval. `BACKUP-POLICY-001` requires `/change`, which is the same core object that profile
  uses, so the two descriptions agree rather than compete.
- **Integrity.** Sealing and chain verification are described by `/integrity` and are orthogonal to
  this profile. See [`/integrity/batchId` is not a backup identifier](#integritybatchid-is-not-a-backup-identifier).

## Fixtures

[examples/profiles/backup-and-recovery/](../../examples/profiles/backup-and-recovery/) — fifteen
valid, twelve invalid, three not-applicable. Every fixture is core-conforming and privacy-clean; each
invalid fixture is core-**valid** and fails exactly one profile rule at one pointer. Every event name
a rule selects has a valid fixture, and every rule with severity `error` has an invalid one; tests
hold both directions.

## Open questions

- Should `backup.create` and `backup.complete` remain two events, or should the profile push all
  producers to a single completion event? Two-event runs are common enough that requiring one shape
  would exclude real systems, but the split means `backup.create` carries no recovery point.
- Is `verificationStatus` the right level of granularity, or does a useful verification record need to
  distinguish a checksum comparison from a mounted restore rehearsal? The profile currently leaves the
  vocabulary open and records the verdict only.
- Should a failover distinguish a rehearsal from an emergency response with a producer-set boolean, in
  the way `BACKUP-APPROVAL-001` uses `approvalRequired`? There is no adoption evidence yet for what
  the field should be called, so the fixtures illustrate `rehearsal` without any rule depending on it.
- Should `restore.start` on a production environment require multi-factor authentication, as the IAM
  profile requires for privileged role changes? Expressing that needs a discriminator the profile does
  not yet have, since `application.environment` is an open vocabulary and `"production"` is a
  recommendation rather than a fixed token.
