# Actor Model

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. The distinction the model exists to make

Modern applications rarely have a single participant in an operation. A request arrives at a gateway,
is forwarded to a service, executed by a worker, and performed against a resource owned by someone
else entirely. "Who did this?" has more than one answer, and an audit model that collapses them is
useless in exactly the situations that matter most.

OpenAuditModel separates three things:

| Concept      | Question it answers                          | Field      |
| ------------ | -------------------------------------------- | ---------- |
| **Actor**    | Who technically performed the operation?     | `actor`    |
| **Subject**  | On whose behalf was the operation performed? | `subject`  |
| **Resource** | What was the operation performed on?         | `resource` |

An administrator resetting a customer's password is the actor; the customer is the resource. An
administrator impersonating a customer to place an order is the actor; the customer is the subject;
the order is the resource. These are different events and the model MUST be able to tell them apart.

## 2. Principal

`actor` and `subject` share one shape, the **principal**.

### 2.1 Required

| Field  | Meaning                                                          |
| ------ | ---------------------------------------------------------------- |
| `type` | Kind of principal.                                               |
| `id`   | Stable identifier of the principal within its issuing authority. |

### 2.2 Optional

| Field            | Meaning                                 |
| ---------------- | --------------------------------------- |
| `displayName`    | Human-readable name. Personal data.     |
| `tenantId`       | Tenant the principal belongs to.        |
| `organizationId` | Organization the principal belongs to.  |
| `roles`          | Roles relevant to **this** operation.   |
| `attributes`     | Producer-defined additional attributes. |

## 3. Principal types

`type` MUST be one of:

| Value      | Meaning                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `user`     | A human-operated account.                                                                       |
| `service`  | A workload, service account or automated client acting under its own identity.                  |
| `system`   | The application itself, for operations with no external initiator, such as scheduled processes. |
| `admin`    | A human-operated account exercising administrative privilege for this operation.                |
| `external` | A principal originating outside the operator's identity boundary.                               |
| `unknown`  | The producer cannot determine the kind of principal.                                            |

Notes:

- `admin` is a statement about **this operation**, not a permanent property of an account. The same
  account may appear as `user` for ordinary operations and `admin` for privileged ones. Producers
  that cannot make this distinction reliably SHOULD use `user` and record privilege in `roles`.
- `unknown` MUST NOT be used to avoid deciding. It exists for imported and legacy data where the
  information genuinely does not exist.
- A principal kind that does not fit these values, such as a device, SHOULD use the closest core type
  and describe the detail in `attributes`. The vocabulary is closed in v0.1 and reopening it is an
  open question for v0.2.

## 4. Identifiers

- `id` MUST be stable for the lifetime of the principal. A value that changes when the principal is
  renamed, moves department or changes email address is not an identifier.
- `id` SHOULD be an opaque internal identifier rather than an email address, username or national
  identification number. Direct personal identifiers make audit data harder to minimize, harder to
  retain lawfully, and harder to share for analysis.
- Personally identifiable display names MUST NOT be required by an implementation. A stable
  identifier is sufficient to satisfy the model; `displayName` exists for systems that must present
  the event to humans without a directory lookup, and SHOULD be omitted otherwise.
- `roles` SHOULD contain only the roles relevant to the audited operation. An event is not the place
  to snapshot a principal's complete role inventory.

## 5. Subject

`subject` is the principal **on whose behalf** the actor performed the operation.

### 5.1 When to use it

| Situation                                                            | actor                       | subject       |
| -------------------------------------------------------------------- | --------------------------- | ------------- |
| An API service performing an operation for a signed-in user          | the service                 | the user      |
| An administrator impersonating a customer                            | the administrator           | the customer  |
| A background worker executing a previously requested operation       | the worker service account  | the requester |
| A delegated administrator performing an approved action for an owner | the delegated administrator | the owner     |

### 5.2 Rules

1. `subject` MUST NOT be used as a generic target of the operation. The audited target belongs in
   `resource`. This is the single most common modelling mistake this section exists to prevent.
2. `subject` MUST be omitted when the actor acted for itself. An event where actor and subject are
   the same principal carries no additional information and SHOULD NOT duplicate it.
3. When `delegation.type` is `impersonation`, `on-behalf-of` or `delegated`, `subject` is REQUIRED.
   The canonical schema enforces this.
4. Service-to-service operations do NOT automatically require a subject. A service that performs
   scheduled maintenance under its own authority has no subject. See
   [approval-and-delegation.md](approval-and-delegation.md).

### 5.3 Examples

A service acting for a user:

```json
{
  "actor": { "type": "service", "id": "service-account-reporting-worker" },
  "subject": { "type": "user", "id": "user-8842" },
  "delegation": { "type": "on-behalf-of", "reference": "export-request-4471" },
  "resource": { "type": "report", "id": "export-4471" }
}
```

An administrator acting **on** a user — no subject, because nobody delegated authority:

```json
{
  "actor": { "type": "admin", "id": "admin-4821" },
  "resource": { "type": "user", "id": "user-7391" }
}
```

## 6. Attributes

`attributes` carries producer-defined principal detail that has no core representation, such as a
workload class or an authentication realm.

`attributes` MUST NOT contain credentials, tokens, keys or session material, and SHOULD NOT contain
personal data beyond what the audit purpose requires. See [privacy.md](privacy.md).
