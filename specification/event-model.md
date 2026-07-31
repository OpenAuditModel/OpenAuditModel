# Event Model

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Structure

An audit event is a JSON object with a small required core and a set of optional context objects.

### 1.1 Required fields

A conforming event MUST contain exactly these seven fields:

| Field         | Type   | Meaning                                   |
| ------------- | ------ | ----------------------------------------- |
| `specVersion` | string | Specification version. MUST be `"0.1"`.   |
| `id`          | string | Globally unique identifier of this event. |
| `time`        | string | When the audited operation occurred.      |
| `event`       | object | What happened and how it ended.           |
| `actor`       | object | Who technically performed the operation.  |
| `resource`    | object | What the operation acted upon.            |
| `application` | object | Which application produced the event.     |

### 1.2 Optional fields

| Field               | Type    | Defined in                                               |
| ------------------- | ------- | -------------------------------------------------------- |
| `observedTime`      | string  | This document, §4                                        |
| `sequence`          | integer | This document, §5                                        |
| `subject`           | object  | [actor-model.md](actor-model.md)                         |
| `delegation`        | object  | [approval-and-delegation.md](approval-and-delegation.md) |
| `relatedResources`  | array   | [resource-model.md](resource-model.md)                   |
| `organization`      | object  | This document, §9                                        |
| `authentication`    | object  | [authentication.md](authentication.md)                   |
| `authorization`     | object  | [authorization.md](authorization.md)                     |
| `approval`          | object  | [approval-and-delegation.md](approval-and-delegation.md) |
| `request`           | object  | This document, §10                                       |
| `change`            | object  | [change-model.md](change-model.md)                       |
| `reason`            | object  | This document, §11                                       |
| `evidence`          | array   | [evidence-model.md](evidence-model.md)                   |
| `integrity`         | object  | [integrity.md](integrity.md)                             |
| `privacy`           | object  | [privacy.md](privacy.md)                                 |
| `controlCategories` | array   | This document, §12                                       |
| `tags`              | array   | This document, §13                                       |
| `metadata`          | object  | [extension-model.md](extension-model.md)                 |
| `extensions`        | object  | [extension-model.md](extension-model.md)                 |

### 1.3 Strictness

The event object and every core object within it MUST reject unknown properties.

Domain-specific data MUST NOT be added as a new top-level property. It belongs in `metadata`,
`extensions`, an object's `attributes`, or a profile.

An OPTIONAL object, when present, MUST contain at least one property. An empty object carries no
information and is rejected, so that "the producer had nothing to say" and "the producer said
nothing" are not confused.

## 2. Event identity

`id` MUST be a globally unique, idempotent identifier for the event.

- The specification does NOT mandate an identifier technology.
- UUIDv4, UUIDv7 and ULID are RECOMMENDED. Any collision-resistant identifier is acceptable.
- A database-generated sequential integer MUST NOT be required by an implementation of this
  specification, because it is not unique across producers and is not available before the event is
  stored.
- A producer that retries emission of the same audited operation MUST reuse the same `id`, so that
  consumers can deduplicate. See [delivery.md](delivery.md).
- `id` SHOULD be opaque. It MUST NOT encode personal data.

## 3. Event time

`time` is when the audited operation **occurred**, as observed by the producer.

- MUST be an RFC 3339 compatible date-time string.
- UTC is RECOMMENDED. A producer that records a local offset MUST include the offset.
- `time` MUST reflect the operation, not the moment the event object was serialized, when those
  differ meaningfully.

## 4. Observed time

`observedTime` is when a collector, exporter, gateway or receiving system **observed** the event.

- MUST be an RFC 3339 compatible date-time string.
- MUST NOT be assumed equal to `time`. Queued, batched, retried and backfilled events legitimately
  have an observed time much later than their event time.
- A producer SHOULD NOT set `observedTime`; it is normally set by the first component that receives
  the event.
- A consumer that needs to reason about pipeline latency MUST use `observedTime`, and MUST NOT infer
  latency from `time` alone.

## 5. Sequence

`sequence` is a producer-assigned, monotonically increasing, non-negative integer used to order
events that share a timestamp.

- Ordering is meaningful only **within** a single producer, partition or integrity chain.
- A consumer MUST NOT assume that sequence numbers are comparable across producers, or that they are
  contiguous.

## 6. Event descriptor

The `event` object describes what happened.

### 6.1 Required

| Field      | Meaning                            |
| ---------- | ---------------------------------- |
| `name`     | Hierarchical event name. See §7.   |
| `category` | Coarse grouping of the event name. |
| `outcome`  | Result of the audited operation.   |

### 6.2 Optional

| Field      | Meaning                                                                      |
| ---------- | ---------------------------------------------------------------------------- |
| `type`     | Domain-independent activity classifier, such as `create`, `read`, `approve`. |
| `severity` | Audit significance of the event.                                             |
| `summary`  | Short human-readable description.                                            |
| `error`    | Sanitized failure descriptor. See §6.5.                                      |

### 6.3 Outcome

`outcome` MUST be one of:

| Value     | Meaning                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `success` | The operation completed as requested.                                                     |
| `failure` | The operation did not complete.                                                           |
| `partial` | The operation completed for some targets and failed for others.                           |
| `unknown` | The producer cannot determine the result, for example after a timeout on a remote system. |

A denied authorization is a `failure` outcome with an `authorization.decision` of `deny`. It is not a
separate outcome value.

### 6.4 Severity

`severity`, when present, MUST be one of `debug`, `info`, `low`, `medium`, `high`, `critical`.

Severity describes the **audit significance** of the operation, not the severity of a software fault.
A successful privileged configuration change in production is `critical` even though nothing went
wrong. A failed read of a public resource is `info` even though it failed.

The scale is closed in v0.1 because an ordinal scale with producer-defined members cannot be
compared. Reopening it is an open question for v0.2.

### 6.5 Error

When `event.outcome` is `failure`, the event MUST contain `event.error`.

`event.error` MUST contain `code`, a stable machine-readable failure code defined by the producer.
It MAY contain `type`, `message` and `retryable`.

When `outcome` is `partial`, the event SHOULD contain `event.error` describing the failing portion.

`event.error` MUST NOT contain:

- Secrets, tokens, credentials or connection strings.
- Personal data beyond what the audit purpose requires.
- Full request or response payloads.
- Internal stack traces, unless explicitly permitted by the operator's policy.

Error text is for humans. A consumer MUST NOT parse `message` to make decisions; that is what `code`
is for.

### 6.6 Summary

`summary` is optional human-readable text. A consumer MUST NOT parse it. It MUST NOT contain values
prohibited by [privacy.md](privacy.md).

## 7. Event naming

### 7.1 Form

Event names are hierarchical, lower-case, dot-separated names of the general form:

```text
domain.resource.action
```

At least two segments are REQUIRED. Segments are lower-case and may contain digits and hyphenated
words, for example `offset-reset`.

```text
authentication.login
identity.role.assign
document.share.create
incident.case.close
configuration.setting.update
deployment.release.approve
queue.consumer.offset-reset
```

The core schema MUST NOT enumerate event names. Recommended names are published as
[semantic conventions](../semantic-conventions/event-naming.md), which producers SHOULD follow.

### 7.2 Rules

1. Event names MUST be stable across releases.
2. Event names MUST NOT contain product names.
3. Event names MUST NOT contain company names.
4. Event names MUST NOT contain jurisdiction names.
5. Event names MUST describe the audited operation, not the implementation method. `identity.role.assign`,
   not `identity.role.update-via-graph-api`.
6. Success and failure of the same operation SHOULD use the **same** event name with different
   `outcome` values. `authentication.login` with `outcome: failure`, not `authentication.login-failed`.
7. The meaning of an event name MUST NOT change silently between versions. If the meaning changes,
   the name changes.

## 8. Application context

`application` describes the **producer** of the event.

### 8.1 Required

| Field         | Meaning                                             |
| ------------- | --------------------------------------------------- |
| `name`        | Stable name of the producing application.           |
| `environment` | Deployment environment the producer was running in. |

### 8.2 Optional

`version`, `instance`, `service`, `component`, `region`, `zone`, `deploymentId`.

### 8.3 Rules

1. `application` MUST describe the application that **produced** the event. It MUST NOT describe a
   collector, forwarder, gateway, storage backend or SIEM that later received it. An audit trail in
   which every event claims to come from the log pipeline is not an audit trail.
2. `application.name` SHOULD be stable across releases and SHOULD be lower-case and hyphenated.
3. `environment` is an open vocabulary. The RECOMMENDED values are `local`, `development`, `test`,
   `staging`, `production`, `disaster-recovery` and `unknown`. Organizations that use additional
   environment names, such as a user acceptance environment, MAY use their own token rather than
   forcing it into one of the recommended values.
4. `region` and `zone` are operator-defined identifiers. They MUST NOT be assumed to follow any
   particular provider's naming.

## 9. Organization context

`organization` is OPTIONAL and MAY contain `tenantId`, `organizationId`, `departmentId`,
`workspaceId` and `businessUnitId`.

Not every application is multi-tenant. The core specification MUST NOT require organization context,
and a consumer MUST NOT treat its absence as an error.

Where a tenant applies to a specific principal or resource rather than to the operation as a whole,
`actor.tenantId` and `resource.tenantId` are the more precise place to record it.

## 10. Request and correlation context

`request` is OPTIONAL and describes how the operation was requested.

| Field                             | Notes                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| `requestId`                       | The inbound request currently being served.                 |
| `correlationId`                   | The logical operation the event belongs to. See §10.1.      |
| `traceId`, `spanId`               | W3C Trace Context compatible. See §10.2.                    |
| `ipAddress`, `forwardedFor`       | IPv4 or IPv6 literals. Personal data in many jurisdictions. |
| `userAgent`, `protocol`, `method` | Client and protocol context.                                |
| `route`                           | Route template. See §10.4.                                  |

Guidance on choosing between these identifiers is in
[semantic-conventions/correlation-and-tracing.md](../semantic-conventions/correlation-and-tracing.md),
which is informative.

### 10.1 Correlation identifiers

`requestId` identifies the inbound request currently being served. It is scoped to one service
handling one call, and SHOULD NOT be propagated into asynchronous messages: a message consumer is not
serving the request that produced the message.

`correlationId` identifies the logical operation, workflow, job, conversation or business process the
event belongs to. It MAY span services, messages, trace boundaries and time, and it is the identifier
that remains stable when a `traceId` does not.

### 10.2 Trace identifiers

`traceId` MUST be 32 lower-case hexadecimal characters and `spanId` MUST be 16 lower-case
hexadecimal characters, matching W3C Trace Context. The all-zero value is invalid for both.

This makes audit events correlatable with distributed traces without requiring any particular
telemetry stack. See [mappings/opentelemetry.md](../mappings/opentelemetry.md), which is informative.

Producers SHOULD obtain `traceId` and `spanId` from the active trace context rather than generating
identifiers specifically for the audit event. An identifier minted for the audit record is
well-formed and correlates with nothing.

`spanId` SHOULD be recorded only together with `traceId`. A span identifier alone cannot be resolved,
because there is nothing to resolve it against.

Raw `traceparent` and `tracestate` values SHOULD NOT be stored. Producers SHOULD extract the trace and
span identifiers and discard the remainder: the version and flag fields describe the tracing system's
own decisions, and `tracestate` is vendor-specific and may carry tenant or account information.

### 10.3 Trust and independence

Correlation identifiers — `requestId`, `correlationId`, `traceId` and `spanId` — are **observational
metadata**. They MUST NOT be used as proof of identity, authorization, authenticity, integrity or
tenant isolation. Each can be supplied by a caller, guessed, replayed or copied between tenants.
`authentication`, `authorization` and `integrity` are the fields that carry those guarantees.

A shared `traceId` indicates that two events belong to the same execution. It does NOT establish
which event caused another, nor the order in which they occurred. Ordering within a producer is
established by `sequence`; see [delivery.md](delivery.md).

Audit event generation MUST NOT depend on trace sampling. An audit event MUST be produced whether or
not a trace is sampled, recorded or retained, and a `traceId` that resolves to no stored trace is a
normal outcome rather than an error.

Personal data, credentials, account numbers and sensitive business values SHOULD NOT be used as
correlation identifiers. A non-reversible surrogate SHOULD be used instead; see
[privacy.md](privacy.md).

### 10.4 Route templates

`route` SHOULD be the **route template**, not the resolved URL:

```text
/users/{userId}/roles          ← RECOMMENDED
/users/472918/roles            ← NOT RECOMMENDED
```

The resolved identifier belongs in `resource.id`, where it is structured and can be redacted
independently.

Query strings and fragments are rejected by the schema. Producers MUST NOT capture query strings
automatically: they routinely carry search terms, filters, tokens and personal identifiers that no
one decided to audit.

## 11. Reason

`reason` is OPTIONAL and records **why** the operation was performed: a business justification,
support request, change ticket, incident response or emergency access explanation.

| Field       | Meaning                                                |
| ----------- | ------------------------------------------------------ |
| `code`      | Machine-readable justification code.                   |
| `text`      | Human-readable justification.                          |
| `reference` | Identifier of the record that justifies the operation. |

`reason` MUST NOT be used for technical error information. A justification explains intent; an error
explains failure. An event may legitimately carry both.

## 12. Control categories

`controlCategories` is an OPTIONAL array of regulation-neutral labels describing the kind of control
this event provides evidence for:

```text
authentication-logging
privileged-access
data-access-logging
external-data-sharing
change-approval
separation-of-duties
configuration-integrity
incident-traceability
```

Control categories MUST NOT contain regulation names, article numbers, control framework identifiers
or jurisdiction names. Mapping a control category to a specific framework is the job of a separate,
optional mapping artifact maintained outside the core specification.

## 13. Tags

`tags` is an OPTIONAL array of producer-defined labels for filtering and routing. Tags carry no
normative meaning, and a consumer MUST NOT derive audit semantics from them.

## 14. Complete minimal event

```json
{
  "specVersion": "0.1",
  "id": "018f1b5c-6d2a-7c3e-9a1b-4f5e6d7c8b9a",
  "time": "2026-03-14T09:24:31.412Z",
  "event": {
    "name": "data.record.update",
    "category": "data-modification",
    "outcome": "success"
  },
  "actor": { "type": "user", "id": "user-123" },
  "resource": { "type": "record", "id": "resource-123" },
  "application": { "name": "application-service", "environment": "production" }
}
```

This is a complete, conforming audit event. Nothing else is required.
