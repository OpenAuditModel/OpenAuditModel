# Privileged Operations

**Specification version: 0.1 · Status: Experimental**

Category: `privileged-operation`

## 1. What counts as privileged

An operation is privileged when it can affect data or controls beyond the actor's ordinary scope.
Concretely, when at least one of these holds:

- It uses administrative authority rather than the actor's own entitlements.
- It bypasses or disables a control.
- It reaches across a tenant, customer or organization boundary.
- It acts on another principal's data or identity.
- It changes security-relevant configuration.
- It operates directly on infrastructure rather than through the application.

Privilege is a property of **the operation**, not of the account. The same account performs ordinary
and privileged operations, and the audit trail should distinguish them.

## 2. Recommended event names

| Name                                | Operation                                           |
| ----------------------------------- | --------------------------------------------------- |
| `identity.session.impersonate`      | A principal began acting as another                 |
| `privileged.access.request`         | Elevated access was requested                       |
| `privileged.access.grant`           | Elevated access was granted                         |
| `privileged.access.revoke`          | Elevated access was withdrawn                       |
| `privileged.break-glass.activate`   | An emergency access path was used                   |
| `privileged.break-glass.close`      | An emergency access episode was closed              |
| `privileged.control.disable`        | A control was switched off                          |
| `privileged.control.enable`         | A control was switched back on                      |
| `privileged.database.query-execute` | A direct data store query was run                   |
| `privileged.maintenance.execute`    | A maintenance operation was performed on production |

Domain-specific privileged operations keep their domain name and are marked privileged through
`controlCategories` and `severity`, rather than being renamed. `configuration.setting.update` on
production security configuration is a privileged operation with the name it already has.

## 3. Required signals

For an operation the producer considers privileged, it SHOULD:

1. Set `event.severity` to `high` or `critical`.
2. Include `privileged-access` in `controlCategories`.
3. Populate `authorization` with the decision that permitted it.
4. Populate `reason` with a business justification.
5. Populate `approval` where the operator requires approval, including `not-required` when that was
   evaluated.
6. Populate `authentication`, including `mfa`, where the operator requires re-authentication for
   privileged actions.
7. Populate `subject` and `delegation` where the operation was performed for someone else.

The value of a privileged-operation trail is that a reviewer can answer "was this justified?" without
asking the person who did it. An event with none of the fields above cannot answer that.

## 4. Break-glass access

Emergency access exists because controls sometimes have to be bypassed. The audit trail is what makes
that acceptable.

Producers SHOULD:

- Emit `privileged.break-glass.activate` at the start and `privileged.break-glass.close` at the end,
  so the episode has a duration rather than a single moment.
- Share one `request.correlationId` across every operation performed during the episode, so the
  entire episode can be reviewed as a unit.
- Record `reason` with a real justification, and `reason.reference` pointing at the incident.
- Set `event.severity` to `critical`.
- Record `approval` even when it was retrospective, using `approvedAt` to make the sequence visible.

## 5. Direct data store access

Running queries directly against a production data store bypasses every application-level control,
including the application's own audit trail.

Producers that support it SHOULD record:

- The store as `resource`, and the affected tables or collections in `relatedResources` where known.
- `metadata.statementType` — `select`, `update`, `delete` — and `metadata.affectedRowCount`.
- `metadata.queryHash` where a query needs to be identifiable across events.

Producers MUST NOT record query text or parameters automatically. Both routinely contain personal
data, and parameters in particular are the values of the very records being accessed. See
[privacy.md](../specification/privacy.md) §2.

## 6. Message broker and infrastructure operations

Operations on brokers, queues and caches are administrative operations on data-carrying
infrastructure, and are privileged when performed against production.

- Use the broker family as the domain segment: `kafka.consumer.offset-reset`,
  `rabbitmq.queue.purge`, `redis.key.delete`.
- Record the affected topic, queue or key space in `relatedResources`.
- Record offsets, partitions and counts in `metadata`.
- MUST NOT record message payloads. See
  [profiles/message-broker-management/](../profiles/message-broker-management/).

See
[examples/valid/kafka-consumer-offset-reset.json](../examples/valid/kafka-consumer-offset-reset.json).

## 7. Control changes

Disabling a control is the operation most worth auditing and the one most likely to go unaudited,
because it is often performed on the system that does the auditing.

Producers SHOULD emit `privileged.control.disable` and `privileged.control.enable` as a pair, record
the control in `resource`, and record the window in `metadata`. A control that was disabled and never
re-enabled should be visible as an open pair, not inferred from silence.
