# Message Broker Events

**Specification version: 1.0 · Status: Stable**

Category: `data-infrastructure`

## 1. Recommended event names

These names cover the **control plane** of a message broker: the operations that change what the
broker is, who may use it and what consumers will see. The data plane is out of scope — see §2.

### Cluster and configuration

| Name                          | Operation                               |
| ----------------------------- | --------------------------------------- |
| `broker.cluster.create`       | A cluster was provisioned               |
| `broker.cluster.delete`       | A cluster was decommissioned            |
| `broker.cluster.scale`        | Cluster capacity was changed            |
| `broker.cluster.upgrade`      | A cluster was upgraded                  |
| `broker.cluster.failover`     | Traffic was moved to another cluster    |
| `broker.configuration.update` | Broker or cluster configuration changed |

### Destinations

| Name                           | Operation                            |
| ------------------------------ | ------------------------------------ |
| `broker.topic.create`          | A topic was created                  |
| `broker.topic.update`          | A topic's configuration changed      |
| `broker.topic.delete`          | A topic was deleted                  |
| `broker.queue.create`          | A queue was created                  |
| `broker.queue.update`          | A queue's configuration changed      |
| `broker.queue.delete`          | A queue was deleted                  |
| `broker.queue.purge`           | A queue's messages were discarded    |
| `broker.exchange.create`       | An exchange was created              |
| `broker.exchange.update`       | An exchange's configuration changed  |
| `broker.exchange.delete`       | An exchange was deleted              |
| `broker.stream.create`         | A stream was created                 |
| `broker.stream.update`         | A stream's configuration changed     |
| `broker.stream.trim`           | A stream's retained records were cut |
| `broker.stream.delete`         | A stream was deleted                 |
| `broker.consumer-group.create` | A consumer group was created         |
| `broker.consumer-group.update` | A consumer group's settings changed  |
| `broker.consumer-group.delete` | A consumer group was removed         |

### Access and quotas

| Name                       | Operation                               |
| -------------------------- | --------------------------------------- |
| `broker.acl.grant`         | An access control entry was added       |
| `broker.acl.revoke`        | An access control entry was removed     |
| `broker.permission.grant`  | A permission was granted to a principal |
| `broker.permission.revoke` | A permission was removed                |
| `broker.quota.create`      | A quota was defined                     |
| `broker.quota.update`      | A quota was changed                     |
| `broker.quota.delete`      | A quota was removed                     |

### Position and replay

| Name                    | Operation                                         |
| ----------------------- | ------------------------------------------------- |
| `broker.offset.reset`   | A consumer group's position was moved             |
| `broker.message.replay` | Messages were re-delivered from a stored position |

## 2. The data plane is not an audit trail

A published message is not an audit event, and a broker that emitted one per message would produce
volume nobody reviews. Recording every publish and every consume also duplicates the broker's own
telemetry while adding the one thing telemetry must not carry: message content.

What belongs here is the operation that changed the broker, not the traffic that flowed through it.
Where a business operation happens to be carried by a message, the **application** records the
business event; the broker records that a destination or a permission changed.

`broker.queue.purge`, `broker.stream.trim`, `broker.offset.reset` and `broker.message.replay` are the
exceptions that prove the rule: each is a control-plane operation whose effect is on data, which is
exactly why they are governed.

## 3. Position changes deserve their own attention

`broker.offset.reset` and `broker.message.replay` change what consumers see without changing what was
written. A reset can hide a poison message, replay a day of financial instructions, or make a
downstream system process an order twice — and none of it leaves a trace in the destination itself.

An auditor reading a broker trail looks for these first. The event SHOULD carry the position moved
from and the position moved to in `metadata`, and the reason the position was moved in `reason`. Where
the operation was performed to recover from an incident, `request.correlationId` SHOULD tie it to the
incident's own events.

## 4. Which principal goes where

| Operation                                    | `actor`            | `resource`             | `subject` |
| -------------------------------------------- | ------------------ | ---------------------- | --------- |
| An operator creates a topic                  | the operator       | the **topic**          | absent    |
| An operator grants a service an ACL entry    | the operator       | the **topic or queue** | absent    |
| A platform job upgrades a cluster            | the job's identity | the **cluster**        | absent    |
| An operator resets a consumer group's offset | the operator       | the **consumer group** | absent    |

The principal receiving an ACL or a permission is a **related resource**, never a `subject`. `subject`
is the principal on whose behalf the actor acted, and a service being granted access delegated
nothing to the operator granting it. See [actor-model.md](../specification/actor-model.md) §5.

## 5. What must never be recorded

**Message payloads, keys and headers.** A broker carries other systems' data, and an audit event that
quoted a message would copy that data into a store with a different retention period, a different
access model and a different threat model. This includes a "sample" message, a truncated payload and a
payload hash that could confirm a guess.

Connection strings, SASL credentials and TLS private material are equally out of bounds — see
[privacy.md](../specification/privacy.md) §6.

## 6. Context to populate

| Field                   | Guidance                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| `authorization`         | The decision that permitted the control-plane operation                  |
| `change`                | `changedFields`, and before and after for configuration and quotas       |
| `relatedResources`      | The cluster the destination belongs to, and the principal granted access |
| `reason`                | Why a purge, trim, offset reset or replay was performed                  |
| `metadata.broker`       | The broker's own identifiers: cluster, destination, group, position      |
| `request.correlationId` | Shared with the incident or change request that prompted the operation   |

## 7. Example

See
[examples/profiles/message-broker-management/valid/offset-reset.json](../examples/profiles/message-broker-management/valid/offset-reset.json)
for a consumer-group offset reset with the authorization decision, the positions moved between and
the reason it was moved.
