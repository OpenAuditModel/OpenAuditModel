# CloudEvents Mapping

**Status: Informative. CloudEvents is OPTIONAL and is never required for conformance.**

CloudEvents standardizes the **envelope** around an event: identity, source, type, time and payload,
carried consistently across transports. OpenAuditModel standardizes what is **inside** the payload.
They compose cleanly because neither one tries to do the other's job.

## Conceptual mapping

| OpenAuditModel                              | CloudEvents attribute | Notes                                                            |
| ------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| `id`                                        | `id`                  | Both are producer-assigned and used for deduplication            |
| `time`                                      | `time`                | Both are RFC 3339 date-times                                     |
| `event.name`                                | `type`                | See §2 on namespacing                                            |
| `application.name` or `application.service` | `source`              | See §3                                                           |
| the complete audit event                    | `data`                | Carried whole and unmodified                                     |
| —                                           | `datacontenttype`     | `application/json`                                               |
| —                                           | `dataschema`          | `https://openauditmodel.org/schemas/audit-event/0.1/schema.json` |
| `resource.type` and `resource.id`           | `subject` (optional)  | Only when it identifies the affected sub-resource. See §4        |
| `request.correlationId`                     | — (unmapped)          | No standard attribute. See §4                                    |

## 1. The event travels whole

The complete OpenAuditModel event SHOULD be carried as `data`, unmodified and unflattened.

Flattening audit fields into CloudEvents extension attributes is possible and is not recommended: the
event stops being validatable against the canonical schema without reassembly, and CloudEvents
extension attribute names cannot express the nested structure of `actor`, `change` or `integrity`.

```json
{
  "specversion": "1.0",
  "id": "018f1b70-2c18-7f3a-b46d-5e8a1c9d0b12",
  "source": "/services/document-service",
  "type": "com.example.audit.document.share.create",
  "time": "2026-03-14T11:47:52.108Z",
  "datacontenttype": "application/json",
  "dataschema": "https://openauditmodel.org/schemas/audit-event/0.1/schema.json",
  "data": {
    "specVersion": "0.1",
    "id": "018f1b70-2c18-7f3a-b46d-5e8a1c9d0b12",
    "time": "2026-03-14T11:47:52.108Z",
    "event": { "name": "document.share.create", "category": "data-access", "outcome": "success" },
    "actor": { "type": "user", "id": "user-5120" },
    "resource": { "type": "document", "id": "document-90311" },
    "application": { "name": "document-service", "environment": "production" }
  }
}
```

## 2. Type

CloudEvents recommends a reverse-DNS `type` prefixed with a domain the producer controls.
OpenAuditModel event names are deliberately **not** namespaced, because they are a shared vocabulary
rather than a per-producer one.

Producers therefore SHOULD compose the CloudEvents type from their own namespace and the event name:

```text
com.example.audit.document.share.create
```

The OpenAuditModel event name inside `data.event.name` remains the authoritative value. A consumer
that needs the audit event name MUST read it from `data`, not parse it out of `type`.

## 3. Source

`source` identifies the context the event occurred in. OpenAuditModel splits that across
`application.name`, `application.service`, `application.instance` and `application.environment`,
because those are independently useful for review.

There is no lossless single-field mapping. Producers SHOULD compose a stable `source` URI-reference
from the fields they consider identifying, and MUST NOT treat `source` as the authoritative producer
identity — `data.application` is.

## 4. Subject and correlation

`subject` describes the **subject of the event within the context of `source`** — typically the
affected resource or sub-resource. Where OpenAuditModel has an equivalent, it is `resource`, not a
correlation identifier.

Earlier revisions of this mapping suggested carrying `request.correlationId` in `subject` when the
producer had no better use for it. That was wrong: `subject` answers _what was this event about_,
while `correlationId` answers _which logical operation did it belong to_. Filling `subject` with a
correlation identifier makes routing and filtering on `subject` behave unpredictably for consumers
that use it as CloudEvents defines it, and it is not reversible — a consumer cannot tell whether a
given `subject` is a resource or a correlation value.

CloudEvents defines no core attribute for correlation. A producer that needs it at the envelope level
SHOULD define an explicitly documented [extension attribute](https://github.com/cloudevents/spec)
rather than overloading a core one, and MUST document its name and meaning. Otherwise leave it
unmapped: the value is already present in the `data` payload at `request.correlationId`, which is
where a consumer that understands OpenAuditModel will look.

For distributed tracing, CloudEvents has the **Distributed Tracing extension**, which carries
`traceparent` and `tracestate`. Note the difference in intent: that extension describes the trace of
the event's creation and originating transmission, whereas `request.traceId` and `request.spanId`
describe the audited operation. They are usually the same trace, but a producer MUST NOT assume so,
and OpenAuditModel does not store the raw headers; see
[specification/event-model.md §10.2](../specification/event-model.md).

## 5. Duplicated fields

`id` and `time` appear in both the envelope and the event. This duplication is deliberate:

- The envelope values let CloudEvents infrastructure deduplicate and route without parsing `data`.
- The event values let the audit event be validated, verified and stored independently of the
  envelope it arrived in.

Producers MUST keep them identical. A consumer that finds them different SHOULD trust `data`, because
that is what integrity material covers.

## 6. What CloudEvents does not carry

The envelope has no representation for anything OpenAuditModel actually models: actor, subject,
resource, authorization, approval, delegation, change, privacy or integrity. That is not a
deficiency in CloudEvents — it is the reason both specifications exist.

## 7. Integrity

Where `integrity.hash` or `integrity.signature` is present, it covers the OpenAuditModel event, not
the envelope. Enveloping, re-enveloping and transport rewriting do not affect verification, provided
the event in `data` is carried byte-preserving through any hop that must not invalidate it. See
[delivery.md](../specification/delivery.md) §7.
