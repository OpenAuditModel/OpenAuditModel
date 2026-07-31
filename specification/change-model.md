# Change Model

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Purpose

`change` records **what the operation changed**. It is OPTIONAL.

The difficulty is that the most useful audit answer — "what was it before?" — is also the most
dangerous one to record. A naive implementation that serializes the whole record before and after
turns the audit log into a second, less protected copy of the production database. This document
exists to make the safe options first-class.

## 2. Structure

All fields are OPTIONAL; when the object is present it MUST contain at least one.

| Field           | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `type`          | Kind of change performed.                                  |
| `changedFields` | Paths of the fields that changed.                          |
| `before`        | Sanitized prior state, or the part of it that changed.     |
| `after`         | Sanitized resulting state, or the part of it that changed. |
| `beforeHash`    | Digest of the prior state.                                 |
| `afterHash`     | Digest of the resulting state.                             |
| `ticketId`      | Change or service ticket associated with the change.       |
| `incidentId`    | Incident associated with the change.                       |
| `deploymentId`  | Deployment or release associated with the change.          |

## 3. Change types

`type`, when present, MUST be one of:

```text
create   update   delete   restore   move   execute   none   other
```

Notes:

- `execute` describes an operation that ran something without changing stored state in the ordinary
  sense — resetting a consumer offset, triggering a job, rotating a key.
- `none` records that an operation completed without changing anything. This is meaningful for
  idempotent operations, where "nothing changed" is a real result rather than a missing value.
- `other` exists so that producers are not forced into a wrong value.

## 4. Complete state is never required

The schema MUST NOT require complete `before` and `after` objects. A producer MAY describe a change
in whichever of these ways fits its risk profile:

| Approach                | What it records                          | When to prefer it                                   |
| ----------------------- | ---------------------------------------- | --------------------------------------------------- |
| **Changed field names** | `changedFields` only                     | The fact of change matters; values are sensitive    |
| **Sanitized state**     | `before` and `after` for selected fields | Values are needed for review and are safe to record |
| **Hashes**              | `beforeHash` and `afterHash`             | Verification is needed without disclosure           |
| **References**          | `ticketId`, `incidentId`, `deploymentId` | The authoritative detail lives in another system    |

These compose. Recording `changedFields` together with hashes gives a reviewer the shape of a change
and the ability to verify a claimed prior state, while disclosing neither.

## 5. What MUST NOT go into before and after

`before` and `after` MUST NOT contain:

- Passwords, password hashes, or password history.
- Access tokens, refresh tokens, API keys, private keys or connection strings.
- Complete database records copied verbatim.
- Full request or response payloads.
- Special-category personal data that the audit purpose does not require.

A change to a credential MUST be recorded as the **fact** of the change, never as its values:

```json
{
  "event": { "name": "identity.credential.rotate", "category": "identity", "outcome": "success" },
  "change": { "type": "update", "changedFields": ["clientSecret"], "ticketId": "change-4410" }
}
```

Recording `{"before": {"clientSecret": "..."}}` is a defect, not a more complete audit event.

## 6. Guidance for before and after values

1. Producers SHOULD record only the fields named in `changedFields`, not the entire object.
2. Producers SHOULD apply the same masking rules to `before` and `after` that they apply to any other
   sensitive output, and SHOULD record `privacy.processing` when they do. See
   [privacy.md](privacy.md).
3. Large collections SHOULD be summarized rather than embedded. A permission change affecting 4,000
   users is better recorded as a count and a scope than as 4,000 identifiers.
4. `before` and `after` SHOULD be structurally comparable. Recording an object in one and a rendered
   string in the other prevents automated diffing.
5. Where a change is not expressible as a field diff — a document body replaced, a binary uploaded —
   producers SHOULD use hashes or an evidence reference instead. See
   [evidence-model.md](evidence-model.md).

## 7. Hashes

`beforeHash` and `afterHash` allow a reviewer to verify a claimed prior or resulting state without
the audit event containing it.

- The algorithm and encoding SHOULD be documented by the producer, and SHOULD match the algorithm
  recorded in `integrity.hashAlgorithm` where an integrity object is present.
- A hash of a low-entropy value is reversible by enumeration. Producers MUST NOT treat a hash of a
  small value space, such as a boolean flag or a status enumeration, as a privacy control.

## 8. Correlation to change management

`ticketId`, `incidentId` and `deploymentId` connect the technical change to the process that
authorized it. They are plain identifiers: the model deliberately does not define a change management
process, a ticket format or a workflow.

Where the change was approved, `approval` records the approval itself; `change.ticketId` records the
record it was approved under. See [approval-and-delegation.md](approval-and-delegation.md).

## 9. Example

```json
{
  "change": {
    "type": "update",
    "changedFields": ["sessionLifetimeMinutes", "requireReauthenticationForPrivilegedActions"],
    "before": {
      "sessionLifetimeMinutes": 720,
      "requireReauthenticationForPrivilegedActions": false
    },
    "after": {
      "sessionLifetimeMinutes": 60,
      "requireReauthenticationForPrivilegedActions": true
    },
    "ticketId": "change-9910",
    "deploymentId": "deployment-2026-03-16-3"
  }
}
```
