# Delivery

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. OpenAuditModel defines no transport

The model defines the **event**, not how it moves. There is no OpenAuditModel protocol, wire format,
endpoint, envelope or delivery guarantee, and none will be introduced.

An event is equally valid when it is:

- Written to a local file or standard output.
- Inserted into a table.
- Published to a topic or queue.
- Sent as an HTTP request body.
- Emitted as an OpenTelemetry log record.
- Wrapped in a CloudEvents envelope.
- Held in memory in a test.

Producers MUST NOT be required to adopt any pipeline in order to conform. See
[ADR 0003](../decisions/0003-backend-and-transport-independence.md).

## 2. Producing

A producer:

1. MUST emit events that validate against the canonical schema.
2. SHOULD emit an event for an auditable operation regardless of its outcome. Recording only
   successes produces an audit trail that cannot answer the questions failures raise.
3. SHOULD emit the event as close to the operation as possible, so that `time` reflects the operation
   rather than a later batch.
4. SHOULD NOT make the success of the audited operation depend on the success of audit emission,
   unless the operator has explicitly chosen that trade-off. This is a genuine design decision:
   dropping audit records under load and refusing business operations when the audit path is down are
   both defensible, and the specification does not choose for the operator.
5. MUST record the decision it made, in its own documentation. A consumer cannot tell from the data
   whether missing events mean "nothing happened" or "the buffer overflowed".

## 3. Identity and idempotency

`id` is the basis of safe delivery.

- A producer that retries emission of the same audited operation MUST reuse the same `id`.
- A producer MUST NOT reuse an `id` for a different operation.
- A consumer SHOULD deduplicate by `id`.
- A consumer MUST NOT assume that receiving an event twice means the operation happened twice.

This is what makes at-least-once transports safe to use for audit data, and it is why `id` is
required rather than optional.

## 4. Time and observation

`time` is when the operation occurred. `observedTime` is when a component in the path observed the
event.

- A producer SHOULD set `time` and SHOULD NOT set `observedTime`.
- The first component that receives an event MAY set `observedTime`. Later components SHOULD NOT
  overwrite it.
- A consumer MUST NOT assume the two are equal, and MUST NOT compute pipeline latency from `time`
  alone. Backfilled, queued and replayed events legitimately arrive long after they occurred.
- Clocks differ. A consumer MUST NOT assume that `time` values from different producers are directly
  comparable at fine resolution, and SHOULD NOT reconstruct causality from timestamps alone.
  `request.traceId` and `request.correlationId` group events that belong to the same execution or
  logical operation; neither establishes which event caused another. See
  [event-model.md §10.3](event-model.md).

## 5. Ordering

The model provides no global ordering and no total order.

- `sequence` orders events **within** one producer, partition or chain. It is meaningless across
  producers.
- A consumer MUST NOT assume events arrive in `time` order, in `sequence` order, or in the order the
  operations occurred.
- A consumer that needs ordering MUST establish it from `sequence` within a chain, and MUST tolerate
  gaps. Trace context groups related events but does not order them.

## 6. Loss, duplication and gaps

Any realistic pipeline will duplicate or drop events. The model responds to this by being explicit
rather than by promising a guarantee it cannot enforce:

| Situation          | What the model provides                               |
| ------------------ | ----------------------------------------------------- |
| Duplicate delivery | `id` for deduplication                                |
| Reordering         | `sequence` within a chain; trace context for grouping |
| Silent loss        | `integrity.previousHash` chains make gaps detectable  |
| Delay              | `observedTime` separate from `time`                   |

Detecting a gap requires that something was chained or counted. A pipeline with no chain and no
counter cannot distinguish a quiet period from a broken exporter, and operators SHOULD monitor
production rates independently of the audit data itself.

## 7. Enrichment

Components between producer and consumer MAY enrich events. When they do:

1. They MUST NOT alter `event`, `actor`, `subject`, `resource`, `application`, `change`,
   `authorization`, `approval` or `id`. Those describe what the producer observed, and a collector
   was not there.
2. They MUST NOT set `application` to describe themselves. `application` is the producer. A pipeline
   that rewrites it destroys the provenance of the entire trail.
3. They MAY set `observedTime` if it is not already present.
4. They MAY add `extensions` under their own reverse-domain namespace.
5. They MUST NOT invalidate an event. Any enriched event MUST still validate against the canonical
   schema.
6. They MUST NOT modify an event that carries `integrity.hash` or `integrity.signature`, because any
   modification invalidates it. Enrichment of a sealed event MUST be carried alongside it, not inside
   it. This includes `observedTime`: every field except the two excluded pointers is part of the
   digest, so adding an observation timestamp to a sealed event breaks its verification. See
   [integrity.md](integrity.md) §4.2.

## 8. Batching

Batching is a transport concern, and the model defines no batch envelope. Producers that batch:

- MUST keep each event individually valid. A batch is a list of complete events, not a shared header
  plus fragments.
- MAY record `integrity.batchId` to identify the batch an event was sealed with.
- SHOULD NOT let batching distort `time`.

## 9. Optional envelopes

Where an envelope is used, the complete audit event SHOULD be carried as the envelope's payload
without being flattened or restructured, so that it can be validated on arrival exactly as it was
produced. Conceptual mappings for CloudEvents and OpenTelemetry are described in
[mappings/](../mappings/), which is informative.

Using an envelope MUST NOT change the event. An event that is only valid after being unwrapped and
transformed is not a conforming event.

## 10. Storage

Out of scope, deliberately and permanently. The specification says nothing about schemas for storage,
indexes, partitioning, retention enforcement, compaction or query. It says only that whatever the
store does, it MUST be able to return the event as it was produced if the trail is to mean anything.
