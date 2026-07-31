# Message Broker Management Profile

**Status: Experimental. Implemented in v0.1, 12 rules (11 enforceable).**

Scope: the **control plane** of message brokers, queues, streams and event logs — the administrative
operations performed by operators, platform teams and reconciliation tooling on clusters, topics,
queues, exchanges, streams, consumer groups, access control lists, quotas and broker configuration,
plus the two operational interventions that move data without changing it: offset resets and message
replay.

The profile is vendor-neutral. It describes operations that any broker performs, and assumes no
particular protocol, storage engine, management API or deployment model. It applies equally to a
log-structured event platform, a work-queue broker, a stream store and a hosted messaging service.

The enforceable rules are in [profile.json](profile.json).

```bash
auditmodel check-profile examples/profiles/message-broker-management/valid --profile message-broker-management
```

## Purpose

A broker is where an organization's data is in motion, and its control plane is the smallest set of
operations that can lose all of it. Deleting a topic, purging a queue, shortening a retention window
or rewinding a consumer group destroys or duplicates messages that no other system holds a copy of,
and the audit event is usually the only surviving record that the operation happened at all. Broker
access control is also where the confidentiality of every topic on a cluster is actually decided,
which is why this profile governs ACL administration rather than deferring it to the identity
domain.

## What this profile governs

| Event family                                                          | Governed             |
| --------------------------------------------------------------------- | -------------------- |
| `broker.cluster.create`, `.scale`, `.upgrade`, `.failover`, `.delete` | yes, by exact name   |
| `broker.topic.*`                                                      | yes                  |
| `broker.queue.*`                                                      | yes                  |
| `broker.exchange.*`                                                   | yes                  |
| `broker.stream.*`                                                     | yes                  |
| `broker.acl.*`, `broker.permission.*`                                 | yes                  |
| `broker.quota.*`                                                      | yes                  |
| `broker.configuration.*`                                              | yes                  |
| `broker.consumer-group.create`, `.update`, `.delete`                  | yes, by exact name   |
| `broker.offset.reset`                                                 | yes, by exact name   |
| `broker.message.replay`                                               | yes, by exact name   |
| `broker.message.publish`, `.consume`, `.acknowledge`, `.deliver`      | **no** — data plane  |
| `broker.consumer-group.rebalance`, `.lag-report`                      | **no** — automatic   |
| `broker.cluster.health-check` and other liveness or telemetry events  | **no** — operational |

### Explicit exclusions, and why

**The data plane.** A broker emits a publish or consume event for every message it carries. Requiring
an authorization decision, a destructiveness declaration and a cluster identifier on each of them
would add cost to the highest-volume event in the entire system in exchange for almost no review
value, and the requirement would be switched off rather than met.

The exclusion is **structural**, not a matter of discipline: every governed event is selected by
**exact name**, so an operation is governed because it appears in the profile, never because it
happens to share a family with one that does.

That matters more than it first appears. An earlier draft selected the administrative families by
prefix — `broker.topic.`, `broker.queue.`, `broker.stream.` — which reads as safe until you notice
that [event-naming.md](../../semantic-conventions/event-naming.md) tells producers to put the
**resource** in the middle segment. A publish to a topic is then plausibly `broker.topic.publish`,
and the profile's heaviest requirements would have landed on the highest-volume event in the estate.
Naming a data-plane operation `broker.message.publish` avoided it, but that was the producer's
discipline doing the work, not the profile's. Exact names remove the assumption.

Consumer-group and cluster administration are selected by exact name for the same reason, with an
additional one: `broker.consumer-group.rebalance` is emitted by the broker itself, has no human
actor and no authorization decision, and can fire many times a minute during a deployment.

The same reasoning applies to `broker.cluster.*`: cluster administration is selected by five exact
names, so a producer that emits `broker.cluster.health-check` from a liveness probe is not dragged
into scope. Tests assert each of these, because widening one prefix later would silently start
governing every message a broker delivers.

Excluded does not mean unaudited. A publish event is still a conforming OpenAuditModel event, and
[data-access.md](../../semantic-conventions/data-access.md) covers recording data-plane activity.

**Message payloads.** They are never recorded, by any rule in this profile, in any circumstance. See
[Privacy considerations](#privacy-considerations).

## Rules

| Rule                   | Applies to                                                                     | Requires                                                              |
| ---------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `BROKER-CORE-001`      | every governed event                                                           | `/authorization`, `/metadata/broker/system`, `.../clusterId`          |
| `BROKER-CORE-002`      | every governed event                                                           | _recommends_ reason, authentication, parent, correlation ID           |
| `BROKER-RISK-001`      | every governed event                                                           | `/metadata/broker/operation/destructive` as a boolean                 |
| `BROKER-RISK-002`      | declared-destructive operations                                                | `/reason`; recommends `/approval`                                     |
| `BROKER-RISK-003`      | operations declared to need approval                                           | `/approval`                                                           |
| `BROKER-FAIL-001`      | governed events with outcome failure                                           | `/event/error/type`; recommends `/event/error/retryable`              |
| `BROKER-LIFECYCLE-001` | topic, queue, stream, exchange create                                          | `/resource/classification`; recommends `/resource/ownerId`            |
| `BROKER-CHANGE-001`    | configuration, ACL, quota, resource and consumer-group `.update`, offset reset | `/change`; recommends `/change/changedFields`                         |
| `BROKER-ACL-001`       | `broker.acl.*`, `broker.permission.*`                                          | `/metadata/broker/acl/principalId`, `/metadata/broker/acl/permission` |
| `BROKER-QUOTA-001`     | `broker.quota.*`                                                               | `/metadata/broker/quota/dimension`                                    |
| `BROKER-OFFSET-001`    | `broker.offset.reset`                                                          | `/reason`, `/metadata/broker/offset/previous` and `.../target`        |
| `BROKER-REPLAY-001`    | `broker.message.replay`                                                        | `/reason`, `/metadata/broker/replay/scope`                            |

`BROKER-CORE-002` is the only rule with severity `warning`; the other eleven fail conformance. Each
rule's full text and rationale is in [profile.json](profile.json).

`BROKER-CHANGE-001` deliberately does not select `broker.cluster.scale` or `broker.cluster.upgrade`.
A cluster operation is frequently driven by a release pipeline that already records the transition in
its own deployment event, and requiring `/change` here would push producers into duplicating it under
two names — the coupling described under [cross-profile overlaps](#cross-profile-overlaps). The
`cluster-upgrade` fixture records `/change` anyway, because a producer that holds the version
transition should write it down.

## Metadata namespace

Every metadata requirement in this profile lives under `/metadata/broker/`.

| Path                                     | Type    | Required by         | Meaning                                                 |
| ---------------------------------------- | ------- | ------------------- | ------------------------------------------------------- |
| `/metadata/broker/system`                | string  | `BROKER-CORE-001`   | Broker family or protocol the operation targeted        |
| `/metadata/broker/clusterId`             | string  | `BROKER-CORE-001`   | Broker deployment the operation acted on                |
| `/metadata/broker/operation/destructive` | boolean | `BROKER-RISK-001`   | Whether the operation discards data or withdraws access |
| `/metadata/broker/approvalRequired`      | boolean | —                   | Producer's declaration that approval policy applied     |
| `/metadata/broker/acl/permission`        | string  | `BROKER-ACL-001`    | Permission granted, changed or withdrawn                |
| `/metadata/broker/acl/effect`            | string  | _recommended_       | Whether the rule allows or denies                       |
| `/metadata/broker/quota/dimension`       | string  | `BROKER-QUOTA-001`  | Dimension of consumption the quota limits               |
| `/metadata/broker/offset/previous`       | string  | `BROKER-OFFSET-001` | Consumer position before the reset                      |
| `/metadata/broker/offset/target`         | string  | `BROKER-OFFSET-001` | Consumer position after the reset                       |
| `/metadata/broker/offset/strategy`       | string  | _recommended_       | How the target position was chosen                      |
| `/metadata/broker/replay/scope`          | string  | `BROKER-REPLAY-001` | How much was replayed                                   |
| `/metadata/broker/replay/messageCount`   | number  | _recommended_       | How many messages the replay covered                    |

All values are open vocabularies. The profile does not enumerate broker families, quota dimensions,
reset strategies or replay scopes, because each is a moving target across products and none can be
closed without excluding a broker somebody runs. Nested, namespaced keys are used throughout so that
two profiles governing the same event cannot assign different meanings to one key — an `expiresAt`
on a share and a `scope` on a replay are not the same fact as anything else called `expiresAt` or
`scope`.

### Deliberate non-requirements in metadata

- **The managed resource type is not duplicated into metadata.** `resource.type` is already REQUIRED
  by the core model and already carries `topic`, `queue`, `stream`, `exchange`, `consumer-group` or
  `cluster`. A `/metadata/broker/resourceType` alongside it would be a second copy of a core field,
  which [event-model.md](../../specification/event-model.md) prohibits, and two copies eventually
  disagree.
- **The resource name is not required.** `resource.id` is REQUIRED by the core model, and topic and
  queue names routinely encode customer, tenant or product information. `resource.name` remains
  available where the producer judges it safe.
- **Partition, node and broker identifiers are not required.** They are meaningful on some broker
  families and meaningless on others. `/metadata/broker/offset/partition` appears in the fixtures as
  an illustration, not as a requirement.

## Conditional-policy fields

The v0.1 rule language offers exactly one conditional mechanism: one path compared for equality
against one scalar. This profile uses it three times, and each condition is a fact the **producer**
declares, because none of the three can be inferred from an event name.

| Condition                                          | Rule              | Consequence                                     |
| -------------------------------------------------- | ----------------- | ----------------------------------------------- |
| `/metadata/broker/operation/destructive` is `true` | `BROKER-RISK-002` | `/reason` becomes required, `/approval` advised |
| `/metadata/broker/approvalRequired` is `true`      | `BROKER-RISK-003` | `/approval` becomes required                    |
| `/event/outcome` is `"failure"`                    | `BROKER-FAIL-001` | `/event/error/type` becomes required            |

`destructive` and `approvalRequired` are deliberately separate facts. Destructiveness is a property
of the **operation** — does it discard messages, positions or access? Approval need is a property of
the **organization's policy** for that operation, and differs by cluster, environment and team. Only
destructiveness is required to be recorded, because only it is knowable by the producing system
without reference to a policy the audit model does not hold.

When a condition's path is absent the condition does **not** hold and the rule contributes nothing.
That is why `BROKER-RISK-001` requires the destructiveness flag unconditionally: without it,
`BROKER-RISK-002` would quietly stop applying to every producer that omitted the field.

## Approval model

**Approval is never required unconditionally.** A very large share of legitimate broker
administration is unilateral and should be — clearing a development queue, creating a topic for a
team's own service, raising a quota the same operator lowered an hour earlier. A rule that demanded a
second signature for all of it would describe one organization's change process and be ignored
everywhere else.

Instead:

- `BROKER-RISK-002` **recommends** `/approval` for any operation the producer declared destructive,
  so an unapproved destructive operation produces a warning and a reviewable signal.
- `BROKER-RISK-003` **requires** `/approval` only when the producer declared that approval policy
  applied to this operation.

`BROKER-RISK-003` requires the approval object to be **present**, not to be granted. A rejected,
expired or pending approval satisfies it. An audit trail that could only record approved changes
would be unable to record the most interesting event in the domain: the change a control stopped.

## Privacy considerations

**Message payloads MUST NOT be captured.** This is a core rule
([privacy.md](../../specification/privacy.md) §2), restated here because this is the domain where it
is most often violated: a broker console has the payload in hand and recording it is one line of
code. No rule in this profile requires message content, and no fixture contains any.

- An offset reset records two **positions**, never the messages between them.
- A replay records a **scope and a count**, never what was replayed.
- A purge records **how many** messages were discarded, never which.
- An ACL change records a **permission and a principal identifier**, never a credential, connection
  string or bootstrap address.

Where an operator has a genuine need to preserve message content — a dispute over what was published
— that content is **evidence**, stored under its own access controls and referenced from the event.
See [evidence-model.md](../../specification/evidence-model.md).

Broker identifiers are also a disclosure surface. `clusterId`, topic names and consumer-group names
should be stable, opaque, lower-case identifiers. Host names, ports, bootstrap servers and
connection strings expose internal infrastructure and are rejected by `auditmodel lint-privacy`;
none appears in any fixture.

## Known rule-language limitations

The v0.1 rule language checks presence, JSON type and scalar equality. These requirements are real
and are documented here rather than pretended into rules:

- **Positions cannot be compared.** `BROKER-OFFSET-001` requires both the previous and the target
  position, but nothing can assert that they differ, that the target is earlier, or how many messages
  lie between them. A reviewer reads both values; the engine only confirms they were recorded.
- **Numeric ranges cannot be checked.** A quota change records its dimension; the engine cannot say
  whether the new limit is an increase, a decrease or a hundredfold jump, and a limit is only
  meaningful against a deployment's own baseline anyway.
- **Positions are typed as strings.** Broker position types are irreconcilable — a 64-bit log offset,
  a stream entry identifier, a composite message identifier — and the rule language has no union
  type. A string carries all of them; a number would exclude most brokers.
- **Cross-field consistency cannot be expressed.** The profile cannot require that an event whose
  authorization decision is `deny` also has outcome `failure`, because that needs two conditions.
- **Array contents are never inspected.** The profile cannot assert that `relatedResources` contains
  the affected cluster, or that `/approval/approvers` holds someone other than the actor.
- **Only one condition per rule.** "Destructive **and** in production" is not expressible; a producer
  that wants environment-sensitive strictness must express it in its own policy engine.
- **A prefix cannot exclude a verb.** Seven families are selected by prefix, so a read-shaped name
  inside a governed family — `broker.acl.list`, `broker.topic.describe` — is selected too, and
  `BROKER-ACL-001` or `BROKER-CHANGE-001` then asks it for a `/subject` or a `/change` that a listing
  does not have. There is no negative selector in v0.1, and enumerating every mutating verb every
  broker exposes would exclude the next one. This profile therefore assumes the prefixed families
  carry operations that change something; a producer that audits administrative reads as well should
  give them their own domain segment rather than a governed prefix. The same shape appears in
  `document-management`, where `document.permission.` requires `/subject`, so it is a property of the
  rule language rather than of this profile. The exclusions that matter — the data plane, automatic
  rebalancing and liveness probes — are held by exact-name selection instead, which a prefix cannot
  undo.

## Cross-profile overlaps

- **Identity and access management.** Broker ACL administration is governed here, not by
  `identity.*`. A broker ACL is scoped to a broker resource, expressed in a broker's permission
  vocabulary and administered by the platform team that runs the cluster; routing it into the
  identity domain would require that profile to understand topic patterns and permission types it
  has no reason to model. The event may still carry `/subject`, `/authorization` and identity-shaped
  resources, and an organization that reviews all access changes together can select on
  `event.type` (`grant`, `revoke`) across both profiles.
- **Deployment and change management.** A broker upgrade is both a cluster operation and a release.
  `broker.cluster.upgrade` is governed here; a pipeline that also emits a deployment event should
  correlate the two through `/request/correlationId` or `/change/deploymentId` rather than
  duplicating one event under two names.
- **Incident management.** Offset resets, purges and replays are usually performed during an
  incident. This profile requires the justification; the incident record itself belongs to the
  incident domain, linked through `/change/incidentId` and `/reason/reference`.
- **Backup and recovery.** Replaying from a dead-letter queue is a broker operation; restoring a
  cluster from a snapshot is a recovery operation. The dividing line is whether the data came back
  from the broker or from a backup.

## Fixture matrix

[examples/profiles/message-broker-management/](../../examples/profiles/message-broker-management/) —
twelve valid, twelve invalid, three not-applicable.

| Family                | Valid fixture                  | Negative fixture                                                                  |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| Topic lifecycle       | `topic-create`, `topic-delete` | missing authorization, cluster, classification, approval                          |
| Topic configuration   | `topic-retention-reduce`       | —                                                                                 |
| Failed administration | `topic-delete-denied`          | missing error type                                                                |
| Queue administration  | `queue-purge`                  | missing destructive flag, missing reason                                          |
| Access control        | `acl-grant`                    | missing subject                                                                   |
| Quota                 | `quota-update`                 | missing dimension                                                                 |
| Broker configuration  | `configuration-update`         | missing change                                                                    |
| Consumer group        | `consumer-group-delete`        | —                                                                                 |
| Cluster               | `cluster-upgrade`              | —                                                                                 |
| Offset                | `offset-reset`                 | missing target position                                                           |
| Replay                | `message-replay`               | missing scope                                                                     |
| Data plane            | —                              | `message-publish`, `message-consume`, `consumer-group-rebalance` (not applicable) |

Every fixture — valid, invalid and not-applicable alike — is core-conforming and privacy-clean. Every
invalid fixture is core-**valid** and fails exactly one profile rule, at one pointer.

## Not-applicable rationale

Three fixtures exist to hold the exclusions in place rather than to demonstrate a requirement:

- `message-publish.json` and `message-consume.json` are ordinary data-plane events. If a future edit
  widened any selector to a bare `broker.` or `broker.message.` prefix, they would start conforming
  instead of being skipped, and the test would fail — which is the point, because that edit would
  impose an authorization requirement on every message a broker carries.
- `consumer-group-rebalance.json` is emitted by the broker itself, with a `system` actor and no
  authorization decision. It holds the decision to select consumer-group administration by exact
  name.

`check-profile` reports all three as not applicable and exits `3`. **Not applicable is not
conformance**: it means the profile said nothing about the event, not that the event satisfied it.

## Relationship to the existing `kafka.*` examples

The repository already ships
[examples/valid/kafka-consumer-offset-reset.json](../../examples/valid/kafka-consumer-offset-reset.json),
which follows the family-scoped naming that
[privileged-operations.md](../../semantic-conventions/privileged-operations.md) §6 suggests
(`kafka.consumer.offset-reset`, `rabbitmq.queue.purge`, `redis.key.delete`). This profile governs the
vendor-neutral `broker.*` vocabulary only, and does **not** select family-scoped names. Two reasons:

1. A family-scoped prefix such as `kafka.` cannot be used as a selector without sweeping in
   `kafka.message.publish`, which reintroduces exactly the data-plane problem the profile is
   structured to avoid — and enumerating one family's admin names invites doing it for every broker
   anyone runs.
2. The broker family is carried as data, in `/metadata/broker/system`, where it can be filtered,
   aggregated and extended without a new event name and without a new rule.

The consequence is recorded honestly rather than hidden: `kafka.consumer.offset-reset` is
**not applicable** to this profile.

It is a real inconsistency, not a curiosity. §6 recommends family-scoped names **and** links to this
profile in the same list, so a producer that follows the convention literally arrives at a profile
that governs none of its events. The two documents have to be reconciled, and there are only two
ways to do it: §6 starts recommending the vendor-neutral `broker.*` names, or this profile gains
family-scoped exact-name selectors for the operations §6 enumerates — exact names, never a `kafka.`
prefix. Either edit reaches outside this directory, which is why it is written down here rather than
left to be discovered by the first producer to run `check-profile` and be told its offset reset is
not applicable.

## Open questions

- Should a multi-partition or multi-topic offset reset be one event or one event per partition? The
  profile accepts either; `resource` holds the consumer group and `relatedResources` the topics.
- Cache and key-space operations (`redis.key.delete` and its equivalents) can affect an unbounded
  number of keys. A scope declaration would be the right requirement, but there is not yet enough
  adoption evidence to say whether it should be a pattern, a count or a named key space.
- Should `broker.subscription.*` be governed? A durable subscription is administrative on some
  platforms and a per-client, per-session operation on others, where governing it would recreate the
  data-plane problem. It is currently out of scope, and subscriptions that are genuinely
  administrative should be recorded as queues or consumer groups.
- Is `destructive` the right discriminator, or should the profile distinguish "discards data" from
  "withdraws access"? A single flag is currently enough to make the reviewable set small.
