# Message broker management profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[message-broker-management profile](../../../profiles/message-broker-management/). The rules
themselves are in [profile.json](../../../profiles/message-broker-management/profile.json).

```bash
auditmodel check-profile examples/profiles/message-broker-management/valid --profile message-broker-management
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming** event. The
ones under `invalid/` fail the profile, not the core schema. That separation is the point: a profile
adds requirements to events the core already accepts.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate      examples/profiles/message-broker-management/valid
auditmodel lint-privacy  examples/profiles/message-broker-management/valid
auditmodel check-profile examples/profiles/message-broker-management/valid --profile message-broker-management
```

A profile that accepted an event the core rejects would break the core invariant. A profile that
accepted an event carrying a credential — or a message payload — would be worse than no profile.

## Valid fixtures

| File                          | Event                          | Demonstrates                                                    |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------- |
| `topic-create.json`           | `broker.topic.create`          | A non-destructive create, classified at the moment it is made   |
| `topic-retention-reduce.json` | `broker.topic.update`          | A configuration change that discards data, recorded as a change |
| `topic-delete.json`           | `broker.topic.delete`          | A destructive delete under a declared approval requirement      |
| `topic-delete-denied.json`    | `broker.topic.delete`          | The same operation refused by policy, with a classified failure |
| `queue-purge.json`            | `broker.queue.purge`           | A work-queue purge, with a count rather than the messages       |
| `acl-grant.json`              | `broker.acl.grant`             | Broker access control naming its subject and permission         |
| `quota-update.json`           | `broker.quota.update`          | A quota change naming the dimension it limits                   |
| `configuration-update.json`   | `broker.configuration.update`  | A cluster-scoped change made by a reconciliation service        |
| `consumer-group-delete.json`  | `broker.consumer-group.delete` | Consumer-group administration, selected by exact name           |
| `cluster-upgrade.json`        | `broker.cluster.upgrade`       | A cluster operation where no containing resource exists         |
| `offset-reset.json`           | `broker.offset.reset`          | Both consumer positions, recorded as opaque strings             |
| `message-replay.json`         | `broker.message.replay`        | A replay recording scope and count, never message content       |

Four of these produce a `BROKER-CORE-002` or `BROKER-RISK-002` **warning**. That is intentional and
worth reading:

- `cluster-upgrade.json` and `configuration-update.json` warn on `/resource/parentId`, because a
  cluster has no containing resource. The profile recommends the field rather than requiring it for
  exactly this reason.
- `configuration-update.json` also warns on `/authentication`, because it was produced by a
  reconciliation service with no interactive session — the case the rule is written to tolerate.
- `consumer-group-delete.json` and `topic-delete-denied.json` warn on `/approval`, because a
  destructive operation without a second signature should raise a question rather than fail a build.

A warning never fails conformance.

Three brokers appear across the fixtures — a log-structured event platform, a work-queue broker with
virtual hosts, and a cluster administered by tooling rather than a person — so the requirements are
exercised against more than one deployment shape.

## Invalid fixtures

Each removes exactly one profile-required value from a valid fixture, so it fails for one documented
reason. A test asserts both the rule and the pointer, and that **exactly one** error is produced.

| File                                          | Violates               | At                                       |
| --------------------------------------------- | ---------------------- | ---------------------------------------- |
| `topic-create-missing-authorization.json`     | `BROKER-CORE-001`      | `/authorization`                         |
| `topic-create-missing-cluster.json`           | `BROKER-CORE-001`      | `/metadata/broker/clusterId`             |
| `queue-purge-missing-destructive-flag.json`   | `BROKER-RISK-001`      | `/metadata/broker/operation/destructive` |
| `queue-purge-missing-reason.json`             | `BROKER-RISK-002`      | `/reason`                                |
| `topic-delete-missing-approval.json`          | `BROKER-RISK-003`      | `/approval`                              |
| `topic-delete-denied-missing-error-type.json` | `BROKER-FAIL-001`      | `/event/error/type`                      |
| `topic-create-missing-classification.json`    | `BROKER-LIFECYCLE-001` | `/resource/classification`               |
| `configuration-update-missing-change.json`    | `BROKER-CHANGE-001`    | `/change`                                |
| `acl-grant-missing-principal.json`            | `BROKER-ACL-001`       | `/subject`                               |
| `quota-update-missing-dimension.json`         | `BROKER-QUOTA-001`     | `/metadata/broker/quota/dimension`       |
| `offset-reset-missing-target.json`            | `BROKER-OFFSET-001`    | `/metadata/broker/offset/target`         |
| `message-replay-missing-scope.json`           | `BROKER-REPLAY-001`    | `/metadata/broker/replay/scope`          |

`queue-purge-missing-destructive-flag.json` is the subtle one. Removing the flag does not merely fail
`BROKER-RISK-001`: it also silences `BROKER-RISK-002`, because a condition whose path is absent does
not hold. That is precisely why the flag is required unconditionally, and the fixture records the
behaviour.

## Not-applicable fixtures

| File                            | Event                             | Why it is not governed              |
| ------------------------------- | --------------------------------- | ----------------------------------- |
| `message-publish.json`          | `broker.message.publish`          | Ordinary data plane                 |
| `message-consume.json`          | `broker.message.consume`          | Ordinary data plane                 |
| `consumer-group-rebalance.json` | `broker.consumer-group.rebalance` | Emitted by the broker, not a person |

All three are perfectly good audit events that this profile deliberately does not govern.
`check-profile` reports them as not applicable and exits with code `3`.

They exist to hold the exclusions in place. If a future edit widened a selector to a bare `broker.`,
`broker.message.` or `broker.consumer-group.` prefix, these fixtures would start conforming instead
of being skipped, and the test would fail — which is the point, because that edit would impose an
authorization decision, a justification and a destructiveness declaration on every message a broker
carries.

**Not applicable is not conformance.** It means the profile said nothing about the event.

## Vendor neutrality

No **event name**, cluster identifier, topic name, queue name, quota dimension, reset strategy or
replay scope in these fixtures names a real product, company, customer, jurisdiction or regulation.
They are illustrative lower-case tokens, not any organization's published vocabulary.

Two fixture values **do** name real broker implementations: `/metadata/broker/system` carries `kafka`
or `rabbitmq`. That is deliberate and is the one place the profile permits it — the field exists to
record which broker an operation was performed against, it is optional metadata rather than a
required vocabulary, and a producer running any other broker records its own token there. No rule
enumerates broker systems, and no requirement depends on the value.

## Payloads

No fixture contains a message. The purge records a count, the replay records a scope and a count, and
the offset reset records two positions. That is deliberate: this is the domain where payload capture
is easiest and most damaging, and a fixture set that leaked one would teach the wrong lesson far more
effectively than the specification text could correct it.
