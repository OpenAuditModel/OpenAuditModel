# Evidence Model

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Purpose

`evidence` points to material that supports the event: a signed document, an approval record, a
screenshot, a trace, a ticket. It is OPTIONAL.

The single design rule is that **evidence is referenced, never embedded**.

## 2. Structure

`evidence` is an array. When present it MUST contain at least one entry. Each entry is an object.

### 2.1 Required

| Field       | Meaning                                                  |
| ----------- | -------------------------------------------------------- |
| `type`      | Kind of evidence being referenced.                       |
| `reference` | Locator or identifier of the evidence in its own system. |

### 2.2 Optional

| Field            | Meaning                                   |
| ---------------- | ----------------------------------------- |
| `hash`           | Digest of the referenced evidence.        |
| `contentType`    | Media type of the referenced evidence.    |
| `createdAt`      | When the evidence was created.            |
| `retentionUntil` | When the owning system may dispose of it. |
| `legalHold`      | Whether disposal is currently suspended.  |

## 3. Evidence types

`type` MUST be one of:

```text
document   log        metric     trace       screenshot
ticket     approval   signature  external-record   other
```

## 4. Normative rules

1. Large binary documents MUST NOT be embedded in an audit event. An audit event is a record of an
   operation, not a container for the artifacts of that operation.
2. OpenAuditModel does **not** define evidence storage. Where the evidence lives, how it is retained
   and how it is retrieved are outside this specification entirely.
3. Evidence references MUST point to access-controlled locations. The reference itself SHOULD be
   treated as sensitive: the existence and identifier of a document can disclose information even
   when its content is protected.
4. A reference MUST NOT expose credentials. It MUST NOT contain a username and password, an access
   token, a shared access signature, a pre-signed URL, an API key, or any other value that grants
   access to the evidence by possession of the audit event.
5. A consumer MUST NOT assume a reference is resolvable. References may point to systems the consumer
   cannot reach, or to material that has since been disposed of under its retention policy.
6. `hash`, where present, allows a reviewer to verify that retrieved evidence is the material the
   event referred to. Producers SHOULD record it when the evidence is immutable in its own system.

## 5. Reference forms

The specification does not mandate a reference syntax. Any of these are acceptable, provided rule 4
holds:

```text
records/root-cause-analysis/rca-2026-0418        internal path
urn:example:incident:rca-2026-0418               URN
ticket-8123                                      opaque identifier in a known system
workflow-incident-closure/approval-request-9921  compound identifier
```

Producers SHOULD choose a form that remains resolvable after the referencing system changes hosting,
and SHOULD document how references are interpreted.

Producers SHOULD NOT use a URL that embeds a query string containing identifiers or search terms, for
the same reasons `request.route` rejects query strings. See [privacy.md](privacy.md).

## 6. Retention and legal hold

`retentionUntil` and `legalHold` describe the state of the **referenced evidence in its own system**,
as known to the producer at the time of the event. They are informational.

They MUST NOT be interpreted as instructions to the audit pipeline, and they MUST NOT be interpreted
as a guarantee that the evidence still exists. Retention of the audit event itself is a separate
concern, described by `privacy.retentionClass` and governed by the operator.

The specification defines no legal hold process, no disposal workflow and no retention enforcement.
Recording that something is under hold is not the same as holding it.

## 7. Example

```json
{
  "evidence": [
    {
      "type": "document",
      "reference": "records/root-cause-analysis/rca-2026-0418",
      "hash": "9f2a4c1d5e6b7a8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e",
      "contentType": "application/pdf",
      "createdAt": "2026-03-14T17:30:00Z",
      "retentionUntil": "2033-03-14T00:00:00Z",
      "legalHold": false
    },
    {
      "type": "approval",
      "reference": "workflow-incident-closure/approval-request-9921"
    }
  ]
}
```
