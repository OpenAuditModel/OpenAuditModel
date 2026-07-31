# 0003 — Backend and transport independence

## Status

Accepted — 2026-07-30. Applies to specification version 0.1.

## Context

Audit tooling normally arrives attached to something: a storage backend, a SaaS product, a SIEM
connector, an agent, a collector. The model is defined by what that thing needs, and adopting the
model means adopting the thing.

That coupling has predictable results. The model acquires fields that exist for the backend's benefit
— index hints, partition keys, tenancy fields shaped by the storage layout. Applications cannot adopt
the model without adopting the pipeline. Data cannot be moved between backends without translation.
And the audit trail, which may need to be readable in a decade, depends on a product that may not
exist then.

The project's users span SaaS platforms, financial services, healthcare, government, infrastructure
tooling and internal enterprise applications. They have nothing in common in their storage,
transport or telemetry choices. A model that requires any of those choices is unusable for most of
them.

## Decision

The model MUST NOT require, assume or favour any specific collector, database, storage system, SaaS
service, SIEM, message broker, cloud provider or transport protocol.

Concretely:

1. **No transport is defined.** There is no OpenAuditModel protocol, endpoint or wire format, and none
   will be introduced. Delivery concerns are addressed by making the event idempotent and
   self-describing.
2. **No storage concept appears in the model.** No field describes a location, index, partition,
   shard, bucket or retention backend.
3. **`application` describes the producer.** Collectors and forwarders MUST NOT rewrite it. The only
   field a pipeline component may contribute is `observedTime`.
4. **Schema identifiers do not have to be dereferenced.** Validation is offline: no `$ref` resolves to
   a remote location, and no network call is ever required. **Superseded in part by
   [ADR 0010](0010-official-domain-and-canonical-identifiers.md)**, which replaced the original
   `urn:openauditmodel:*` identifiers with HTTPS URLs once the project owned
   `openauditmodel.org`. The identifier is now dereferenceable, but dereferencing it remains
   unnecessary — the offline property this decision protects is unchanged.
5. **Envelopes are optional.** CloudEvents and OpenTelemetry MAY carry events. Neither is required,
   and an event is valid standalone.
6. **Mappings are informative and one-directional.** ECS, OCSF and CADF are export targets, not
   requirements, and are documented as lossy where they are lossy.
7. **No engine is privileged.** `authorization.engine` and `authorization.policy` are free
   identifiers so that no policy engine's vocabulary enters the model.

## Consequences

**Positive**

- An application can adopt the model with no infrastructure change: write events to a file, a table
  or standard output.
- Events survive backend migration. The data does not encode where it was going to be stored.
- Validation requires no network access, which matters in air-gapped environments and makes CI
  hermetic.
- No vendor gains a structural advantage from the model's shape, which is a precondition for the
  project being adopted as a common standard rather than one company's format.

**Negative**

- The project provides no ingestion path. Adopters must connect events to their own pipeline, and
  there is no "install this and you are done" story.
- Some fields that a specific backend would find useful — a partition hint, a routing key — are
  deliberately absent, and adopters must derive them.
- Without a required transport, delivery guarantees vary between deployments. The model can only make
  duplication safe and gaps detectable; it cannot make delivery reliable.
- Interoperability with existing tools requires mapping work that a coupled model would have done.

**Neutral**

- The reference tooling is written in TypeScript and runs on Node.js. That is a property of the
  tooling, not of the model, and any language can implement conformance from the schema and fixtures.

## Alternatives considered

**Define a transport, such as an OpenAuditModel HTTP ingestion API.** Rejected: it would put the
project in competition with every pipeline it should be compatible with, and it would make adoption
an infrastructure decision rather than an instrumentation decision.

**Require CloudEvents as the envelope.** Rejected: CloudEvents is a good fit and is documented as
such, but requiring it excludes applications that write audit events to a table or a file, which is
most of them.

**Require OpenTelemetry as the transport.** Rejected for the same reason, with an additional concern:
telemetry pipelines sample and drop under load, which is acceptable for observability and not
acceptable for an audit trail. The model must not push adopters toward a pipeline whose default
behaviour is lossy. See [mappings/opentelemetry.md](../mappings/opentelemetry.md) §8.

**Use HTTPS URLs as schema identifiers.** Rejected _at the time_: a schema identifier that stops
resolving is worse than one that never claimed to, and the project owned no domain. This was revisited
once `openauditmodel.org` was acquired; see
[ADR 0010](0010-official-domain-and-canonical-identifiers.md).
