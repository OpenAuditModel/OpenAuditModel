# OpenTelemetry Mapping

**Status: Informative. OpenTelemetry is OPTIONAL and is never required for conformance.**

OpenAuditModel is **not a replacement for OpenTelemetry**, and OpenTelemetry is not a replacement for
OpenAuditModel. OpenTelemetry is an excellent way to transport, collect and correlate audit events.
It does not define the audit semantics those events need to carry.

## 1. Representing an event as a LogRecord

An OpenAuditModel event maps naturally onto an OpenTelemetry LogRecord.

| OpenAuditModel           | LogRecord field                   | Notes                               |
| ------------------------ | --------------------------------- | ----------------------------------- |
| `time`                   | `Timestamp`                       | When the operation occurred         |
| `observedTime`           | `ObservedTimestamp`               | When the pipeline observed it       |
| `request.traceId`        | `TraceId`                         | Same 16-byte value, hex encoded     |
| `request.spanId`         | `SpanId`                          | Same 8-byte value, hex encoded      |
| `event.severity`         | `SeverityText` / `SeverityNumber` | See §3 — the mapping is approximate |
| `event.name`             | Event name attribute              | See §4                              |
| the complete audit event | `Body`                            | RECOMMENDED, see §2                 |
| `application.*`          | Resource attributes               | See §5                              |

## 2. Body or attributes

Two representations are possible.

**Body (RECOMMENDED).** Place the complete audit event in the LogRecord body as structured data. The
event survives the pipeline intact, can be validated on arrival against the canonical schema, and
integrity material still verifies.

**Attributes.** Flatten the event into attributes such as `audit.actor.id`. This makes the fields
directly queryable in backends that index attributes but not bodies. It is lossy: attribute values
are scalars and arrays of scalars, so `change.before`, `evidence` and nested `metadata` cannot be
represented without serializing them to strings.

Producers that flatten SHOULD also carry the complete event in the body, so that verification and
revalidation remain possible. A flattened-only representation is an export, not a transport.

## 3. Severity

OpenAuditModel severity describes **audit significance**. OpenTelemetry severity describes **log
record severity**. They are not the same scale, and the mapping is approximate.

| OpenAuditModel | Approximate SeverityNumber | Caveat                                                        |
| -------------- | -------------------------- | ------------------------------------------------------------- |
| `debug`        | DEBUG                      |                                                               |
| `info`         | INFO                       |                                                               |
| `low`          | INFO                       | Collapses with `info`                                         |
| `medium`       | WARN                       | A successful operation is not a warning                       |
| `high`         | WARN or ERROR              | Ambiguous                                                     |
| `critical`     | ERROR                      | A `critical` audit event is often a completely successful one |

The mismatch is fundamental: a successful privileged configuration change is `critical` for audit
purposes and is not an error. Consumers that need audit significance MUST read `event.severity` from
the event, not `SeverityNumber`.

## 4. Event name

The OpenAuditModel `event.name` SHOULD be carried in the LogRecord's event name attribute so that it
is available without parsing the body.

The authoritative value remains `event.name` inside the event. Where OpenTelemetry semantic
conventions define an event name for a similar operation, the two SHOULD both be recorded rather than
one being rewritten into the other — they are different vocabularies with different stability
guarantees.

## 5. Resource attributes

`application` describes the producer, which is what OpenTelemetry resource attributes describe:

| OpenAuditModel               | Resource attribute concept      |
| ---------------------------- | ------------------------------- |
| `application.name`           | service name                    |
| `application.version`        | service version                 |
| `application.instance`       | service instance identifier     |
| `application.environment`    | deployment environment          |
| `application.region`, `zone` | cloud or deployment region/zone |

Because these are duplicated, producers MUST keep them consistent. Where they disagree, `application`
inside the event is authoritative: resource attributes are attached by the SDK and may describe the
collector's view rather than the producer's.

## 6. Trace correlation

This is the strongest part of the relationship. `request.traceId` and `request.spanId` are defined to
be W3C Trace Context compatible precisely so that an audit event can be joined to the distributed
trace of the request that caused it, without OpenAuditModel depending on any telemetry stack.

An investigator can move from "who approved this change" to "what did the request actually do" in one
join. That is worth more than any field-level mapping in this document.

## 7. What OpenTelemetry does not currently define

OpenTelemetry does not define semantics for:

- Subject and delegation — acting on behalf of another principal.
- Authorization decisions as an auditable record.
- Human approval, approvers and thresholds.
- Business justification.
- Before and after change state with privacy constraints.
- Evidence references.
- Tamper-evidence and hash chaining.
- Privacy classification of the record itself.

This document does not claim that OpenTelemetry defines OpenAuditModel semantics. It claims only that
OpenTelemetry can carry them.

## 8. Sampling

Telemetry pipelines sample. Audit trails must not be sampled: an audit event that was dropped for
cost reasons is indistinguishable from an operation that never happened.

Operators that transport audit events over an OpenTelemetry pipeline MUST ensure audit events are
excluded from sampling and from any lossy buffering, or MUST accept and document that the trail is
incomplete. See [delivery.md](../specification/delivery.md) §6.
