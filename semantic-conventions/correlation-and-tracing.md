# Semantic Conventions: Correlation and Tracing

**Specification version: 0.1 · Status: Experimental · This document: Informative**

> How to populate the identifiers that let an operator find every audit event, application log and
> error belonging to one operation — across services, messages and trace boundaries.

The normative rules referenced here live in
[specification/event-model.md §10](../specification/event-model.md). This document explains which
identifier to use, and why the distinctions matter.

**OpenAuditModel is not a tracing system.** It records no spans, builds no trace tree and stores no
timing. It carries the identifiers a tracing system already produced, so that an audit event can be
joined to whatever the operator already runs — and so that correlation still works when nothing is
running at all.

## 1. The five identifiers

| Field                    | Identifies                        | Stable across services? | Stable across messages? |
| ------------------------ | --------------------------------- | ----------------------- | ----------------------- |
| `/id`                    | one audit event                   | no — unique per event   | no                      |
| `/request/requestId`     | one inbound request               | usually no              | not applicable          |
| `/request/traceId`       | one distributed execution         | **yes**                 | yes, if continued       |
| `/request/spanId`        | one operation inside that trace   | no — new per operation  | no                      |
| `/request/correlationId` | one logical or business operation | **yes**                 | **yes**                 |

### 1.1 `/id` — the audit event identifier

Unique to a single audit record. Two events never share it, and it is the field a consumer
deduplicates on ([delivery.md](../specification/delivery.md)). It identifies the _record_, not the
operation the record describes.

### 1.2 `/request/requestId` — the current inbound request

The request currently being served. Scoped to one service handling one call: a downstream service
generally has its own, and a background job or message consumer has none at all.

`requestId` SHOULD NOT be propagated into asynchronous messages. A message consumer is not serving
the request that produced the message, and copying the value there makes two unrelated units of work
look like one.

Where the value comes from a caller-supplied header such as `X-Request-ID`, see §5.3.

### 1.3 `/request/traceId` — the distributed technical execution

The end-to-end technical execution, in the W3C Trace Context sense. It stays the same across every
service that participates in one execution, which is what makes it the primary join key between an
audit event and application logs.

A trace ends when the execution ends. It does not span a business process that pauses for an
overnight batch or a human approval — that is what `correlationId` is for.

### 1.4 `/request/spanId` — the active operation

The specific operation within the trace that produced this event. New for every operation, so it is a
locator inside a trace rather than a grouping key.

`spanId` SHOULD NOT be recorded without `traceId`. A span identifier alone cannot be resolved: there
is nothing to look it up in. This matches the OpenTelemetry log data model, which states that if
SpanId is present TraceId should be too. The schema does not enforce it, because a producer that has
only half the context is better served by recording what it has than by dropping the event.

### 1.5 `/request/correlationId` — the logical operation

The logical operation, workflow, job, conversation or business process the event belongs to. It may
span services, messages, trace boundaries and time.

This is the field that survives when nothing else does. When a consumer starts a fresh trace, the
`traceId` changes and the `requestId` is absent; `correlationId` is what still says _this belongs to
order 2026-004418_. A system with no tracing at all can populate `correlationId` alone and still get
useful correlation.

Because it is the identifier most likely to be set from business data, it is also the one most likely
to leak personal data. See §5.4.

## 2. Where the values come from

Obtain `traceId` and `spanId` from the **active trace context**, not by generating them for the audit
event. An identifier minted for the audit record correlates the record with nothing: it is
well-formed, passes validation, and matches no span in any backend.

| Situation                          | `traceId`           | `spanId`         |
| ---------------------------------- | ------------------- | ---------------- |
| Tracing active                     | from active context | from active span |
| Trace context received, not active | from `traceparent`  | omit             |
| No tracing                         | omit                | omit             |

Omitting a field is always correct. Inventing one is not.

### 2.1 Do not store the raw headers

Parse `traceparent`, extract the trace and span identifiers, and discard the rest. The version byte
and the sampled flag describe the tracing system's own decisions, not the audited operation.

`tracestate` SHOULD NOT be stored at all. It is vendor-specific, may carry tenant or account
identifiers, and is the only unbounded free-text value in the set. W3C Trace Context forbids putting
personal data in it, but that obligation binds the system that _writes_ the header — an audit
producer reading it cannot assume it was honoured.

The schema deliberately provides nowhere to put either header.

## 3. Correlation without tracing

None of this requires OpenTelemetry, or any tracing at all.

A system with no tracer populates `correlationId` — a job run identifier, a workflow instance, an
order number's non-reversible surrogate — and omits `traceId` and `spanId`. Correlation across
services still works, because `correlationId` is propagated by the application rather than by a
tracing library.

Where even that is unavailable, `/application` still identifies the producing service and
`/organization` its tenant, which is the same resource-level fallback OpenTelemetry uses for logs
with no trace context.

## 4. Scenarios

### 4.1 HTTP request

```json
{
  "id": "01J8ZC7Q2E4N6R8T0V2X4Z6A80",
  "request": {
    "requestId": "req-8f2c41",
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7"
  }
}
```

### 4.2 HTTP request that publishes a message

The same trace continues into the producer; `correlationId` is established here and travels with the
message.

```json
{
  "id": "01J8ZC7Q2E4N6R8T0V2X4Z6A81",
  "request": {
    "requestId": "req-8f2c41",
    "correlationId": "order-2026-004418",
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "1a2b3c4d5e6f7081"
  }
}
```

Propagate `traceparent` and the business `correlationId` in the message headers. Do not propagate
`requestId`.

### 4.3 Consumer that continues the trace

The trace and the correlation both survive. There is no `requestId`: no request is being served.

```json
{
  "id": "01J8ZC7Q2E4N6R8T0V2X4Z6A82",
  "request": {
    "correlationId": "order-2026-004418",
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "2b3c4d5e6f708192"
  }
}
```

### 4.4 Consumer that starts a new trace

Some consumers deliberately begin a new trace — long-running processors, or systems where the
producing trace has already been closed. The technical execution is new; the business operation is
not.

```json
{
  "id": "01J8ZC7Q2E4N6R8T0V2X4Z6A83",
  "request": {
    "correlationId": "order-2026-004418",
    "traceId": "9f8e7d6c5b4a39281706f5e4d3c2b1a0",
    "spanId": "3c4d5e6f708192a3"
  }
}
```

`correlationId` is the only identifier shared with §4.2. Without it, the business operation cannot be
reconstructed at all — which is the reason the field exists separately from `traceId`.

### 4.5 Workflow spanning several services and days

An approval that waits for a human outlives any trace. `correlationId` carries the process;
`/approval/workflowId` identifies the workflow definition or instance.

```json
{
  "id": "01J8ZC7Q2E4N6R8T0V2X4Z6A84",
  "request": {
    "requestId": "req-c41f09",
    "correlationId": "access-request-2026-0912",
    "traceId": "5c6d7e8f90a1b2c3d4e5f60718293a4b",
    "spanId": "4d5e6f7081920304"
  },
  "approval": {
    "workflowId": "wf-access-review-v3",
    "requestId": "ar-2026-0912"
  }
}
```

Both `requestId` fields are correct and mean different things: `/request/requestId` is the HTTP call
being served, `/approval/requestId` is the approval record. See §6.1.

### 4.6 Scheduled background job

No request, so no `requestId`. The job run is the logical operation.

```json
{
  "id": "01J8ZC7Q2E4N6R8T0V2X4Z6A85",
  "request": {
    "correlationId": "nightly-reconciliation-2026-07-30"
  },
  "metadata": {
    "recordsProcessed": 4187
  }
}
```

Every event emitted by one job run SHOULD share that `correlationId`. Do not use
`/integrity/batchId` for this; see §6.2.

### 4.7 Failed downstream operation

A failure belongs to the same execution as the work that failed, so the trace context is preserved.

```json
{
  "id": "01J8ZC7Q2E4N6R8T0V2X4Z6A87",
  "event": {
    "outcome": "failure",
    "error": { "code": "upstream-timeout" }
  },
  "request": {
    "correlationId": "order-2026-004418",
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "6f70819203040506"
  }
}
```

## 5. Trust and privacy

### 5.1 Correlation is not authorization

Correlation identifiers are **observational metadata**. They MUST NOT be treated as proof of
identity, authorization, authenticity, integrity or tenant isolation
([event-model.md §10.3](../specification/event-model.md)).

Every one of them can be supplied by a caller, guessed, replayed or copied between tenants. The model
has dedicated fields that do carry those guarantees — `/authentication`, `/authorization` and
`/integrity` — and a correlation identifier is not a substitute for any of them. Two events sharing a
`traceId` is evidence that someone propagated a header, not that they belong to the same principal.

### 5.2 Trace context is not causality

A shared `traceId` means two events belong to the same execution. It does not say which caused which,
in what order, or through what path. Ordering within a producer comes from `/sequence`; causal
relationships between messages are not modelled in the core schema at all (§7).

### 5.3 Inbound identifiers are untrusted input

A `correlationId` or `requestId` taken from a request header is caller-controlled. A producer SHOULD
either generate its own value, or record the supplied one while never relying on it — an attacker who
can set `X-Correlation-ID` can attach their own activity to another operation's identifier.

The schema bounds the damage: `identifier` caps at 256 characters and rejects leading and trailing
whitespace, so an identifier cannot become a log-injection payload or an unbounded index key.

### 5.4 Do not put sensitive values in identifiers

Personal data, credentials, account numbers and sensitive business values SHOULD NOT be used as
correlation identifiers. An email address used as a `correlationId` is personal data in the audit
store, in every application log that echoes it, and in every index built over it.

Use a non-reversible surrogate — a random identifier, or a keyed hash of the business key — and keep
the business value in the field that was designed for it, where it can be redacted independently.

The privacy linter does **not** inspect `/request/correlationId` or `/request/requestId`
([privacy.md §6.6](../specification/privacy.md)). These fields hold high-entropy values by design and
scanning them would report a finding on every well-formed event. Nothing will warn a producer that
put an email address there.

### 5.5 Cardinality

Every distinct correlation identifier is an index entry. Deriving one per record in a large batch, or
per retry, produces indexes that cost more than the queries they serve. Prefer one identifier per
logical operation.

## 6. Identifiers that are not correlation identifiers

### 6.1 `/approval/requestId` is not `/request/requestId`

`/request/requestId` identifies the inbound call being served. `/approval/requestId` identifies an
approval record that may exist for days and be referenced by many calls. An event may carry both; see
§4.5.

### 6.2 `/integrity/batchId` is not a job or processing batch

`/integrity/batchId` identifies an **integrity sealing or verification batch** — the group of events
sealed together when digests were computed. It does **not** identify a job run, a processing batch, an
import batch or any business operation, and its boundaries are set by the sealing process rather than
by the work.

Use `/request/correlationId` for job runs, processing batches and imports (§4.6).

Likewise `/integrity/chainId` identifies a tamper-evidence chain, and `/sequence` orders events within
one producer, partition or chain. Neither is a correlation identifier.

### 6.3 `/authentication/sessionId`

A session correlation identifier, scoped to one authenticated session. It is not an operation
identifier, and it must never be a usable session token or cookie value.

## 7. Experimental: messaging causation

**Experimental. Not a stable core field, not a required convention, and not part of the v0.1
conformance surface.** Nothing validates it, and it may change or be withdrawn.

The core schema deliberately has no `causationId`. A shared `traceId` groups events; it does not say
which event caused which. Where that relationship must be recorded, producers MAY use the reserved
extension:

```json
{
  "extensions": {
    "org.openauditmodel.correlation": {
      "causes": [{ "type": "audit-event", "id": "01J8ZC7Q2E4N6R8T0V2X4Z6A81" }]
    }
  }
}
```

`causes` is an **array** because a single scalar cannot express fan-in — an operation triggered by
several messages has several causes, and OpenTelemetry reached the same conclusion when it chose span
links over a single parent for messaging. `type` names the kind of cause (`audit-event`, `message`);
`id` is the identifier of that cause.

It stays an extension rather than a core field for two reasons. There is not enough production
adoption evidence to freeze its shape, and a field whose shape later has to change would be a
breaking change to a published identifier — which the project does not permit. An extension can
evolve; `/request` cannot.

Extension keys are inspected by the privacy linter, so ordinary care about their contents applies.

## 8. Logging interoperability

The point of all of this is that one query returns everything. For that, application logs must carry
the **same values** under whatever names their stack already uses.

| OpenAuditModel           | OpenTelemetry | ECS        |
| ------------------------ | ------------- | ---------- |
| `/request/traceId`       | `trace_id`    | `trace.id` |
| `/request/spanId`        | `span_id`     | `span.id`  |
| `/request/correlationId` | attribute     | label      |

The values are byte-identical across all three, so a log backend needs a field alias, not a
transformation. Emit `traceId` and `spanId` into application logs, error logs, producer logs and
consumer logs, and a search for one trace identifier returns the audit events alongside them.

OpenAuditModel keeps its own `camelCase` naming rather than adopting `trace.id`, because that naming
is used consistently throughout the schema and correlation is not a good place to make it
inconsistent. See [mappings/](../mappings/) for the full informative mappings.

## 9. Sampling independence

**Audit event generation MUST NOT depend on trace sampling**
([event-model.md §10.3](../specification/event-model.md)).

Tracing is a sampled diagnostic; auditing is a complete record. An audit event emitted only when a
span is recording is a sampled audit log, and the gap is invisible until the missing event is the one
that matters.

| Situation                              | Behaviour                                        |
| -------------------------------------- | ------------------------------------------------ |
| Trace sampled and stored               | Record the identifiers; they resolve.            |
| Trace exists but is not sampled        | Record the identifiers anyway.                   |
| No tracing backend retains the trace   | Record them anyway. The audit event is complete. |
| Identifier resolves to no stored trace | Expected. Not an error, and not a defect.        |

A `traceId` that leads nowhere is a normal outcome of sampling, and it still correlates the audit
event with the application logs of the same execution.
