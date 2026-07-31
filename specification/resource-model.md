# Resource Model

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Purpose

`resource` answers "what was acted upon". It is REQUIRED, because an audit event that records an
action without a target cannot be reviewed, correlated or scoped to a data subject.

## 2. Structure

### 2.1 Required

| Field  | Meaning                                                        |
| ------ | -------------------------------------------------------------- |
| `type` | Kind of resource. Open vocabulary.                             |
| `id`   | Stable identifier of the resource within the producing system. |

### 2.2 Optional

| Field            | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `name`           | Human-readable resource name.                                      |
| `parentId`       | Containing resource: folder, workspace, project, cluster, account. |
| `classification` | Data classification of the resource. Open vocabulary.              |
| `ownerId`        | Owning principal or team.                                          |
| `tenantId`       | Tenant the resource belongs to.                                    |
| `attributes`     | Producer-defined additional attributes.                            |

## 3. Resource types are open-ended

`resource.type` is an **open vocabulary**. The core schema MUST NOT enumerate resource types, and a
consumer MUST NOT reject a resource type it does not recognise.

Types observed across the domains this model targets include:

```text
user            role            document        incident
configuration   deployment      database-record api-key
consumer-group  topic           queue           workflow
tenant          report          session         share-link
policy          secret          cluster         service
```

This list is illustrative, not exhaustive and not normative. A hard-coded list of resource types is
the fastest way to make a general model unusable in a domain nobody thought of.

Resource types MUST be lower-case, hyphen-separated tokens, so that independently produced events
remain comparable in form even when the vocabularies differ.

## 4. Identifiers and names

- `id` MUST be stable for the lifetime of the resource. A path or display name that changes when the
  resource is moved or renamed is not an identifier.
- `id` MUST be recorded even when the operation failed, when the producer knows what was attempted.
- `name` is OPTIONAL, and MAY itself be sensitive. Document titles, incident summaries and file names
  routinely contain personal data, customer names and unreleased business information. Producers
  SHOULD consider whether recording `name` is necessary for the audit purpose. See
  [privacy.md](privacy.md).
- `resource.attributes` MUST NOT contain the **contents** of the resource. An audit event records
  that a document was downloaded; it does not carry the document.

## 5. Classification

`classification` describes the sensitivity of the resource. It is an **open vocabulary**, because
classification schemes are defined by organizations and differ legitimately in the number of levels
and their names.

RECOMMENDED values:

```text
public  internal  confidential  restricted  secret  unknown
```

Organizations that use a different scheme MAY use their own tokens. Where a mapping to the
recommended values is possible, producers SHOULD publish it so that cross-system reporting remains
meaningful.

`classification` describes the **resource**, not the event. The sensitivity of the audit event itself
is described by [privacy.md](privacy.md).

## 6. Related resources

`relatedResources` is an OPTIONAL array of additional resources affected by, or required to
interpret, the same operation. Each entry has the same shape as `resource`.

Rules:

1. `resource` MUST hold the **primary** target. `relatedResources` MUST NOT be used as an alternative
   to choosing one.
2. `relatedResources`, when present, MUST contain at least one entry.
3. `relatedResources` SHOULD be used for genuinely affected resources, not for arbitrary context. A
   consumer group reset affects the consumer group primarily and the topic secondarily; both belong.
   The cluster's monitoring dashboard does not.
4. A bulk operation over many resources SHOULD be recorded as one event per resource where the
   resources are individually significant, and as a single event with a representative primary
   resource and a count in `metadata` where they are not. Producers SHOULD document which approach
   they use, because the two are not interchangeable for review purposes.

Example:

```json
{
  "resource": { "type": "consumer-group", "id": "payments-settlement-consumer" },
  "relatedResources": [
    { "type": "topic", "id": "payments.settlement.completed" },
    { "type": "cluster", "id": "cluster-streaming-production" }
  ]
}
```

## 7. Resource is not subject

`resource` is what the operation acted **on**. `subject` is the principal the operation was performed
**for**. When an administrator disables a user account, the user is a `resource` — nobody delegated
authority to the administrator. See [actor-model.md](actor-model.md).
