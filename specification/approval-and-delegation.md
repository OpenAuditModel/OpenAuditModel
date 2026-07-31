# Approval and Delegation

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Three questions that are routinely confused

| Question                                               | Field            | Nature                                |
| ------------------------------------------------------ | ---------------- | ------------------------------------- |
| How did the actor prove who it is?                     | `authentication` | Identity evidence                     |
| Is the actor permitted to do this?                     | `authorization`  | Policy evaluation, usually automatic  |
| Did someone decide this may proceed?                   | `approval`       | Decision by principals, usually human |
| How did the actor obtain authority to act for another? | `delegation`     | Transfer of authority                 |

They are independent. An operation may be authenticated and authorized but unapproved; approved but
denied by policy; or performed by a delegated actor whose own authorization is what was evaluated.
Each has its own object, and a producer MUST NOT use one to express another.

## 2. Approval

`approval` records a decision, usually by humans, that the operation may proceed. It is OPTIONAL.

### 2.1 Structure

All fields are OPTIONAL; when the object is present it MUST contain at least one.

| Field               | Meaning                                                |
| ------------------- | ------------------------------------------------------ |
| `status`            | State of the approval at the time of the event.        |
| `workflowId`        | Approval workflow definition or instance.              |
| `requestId`         | The approval request itself.                           |
| `requiredApprovals` | Number of approvals required by policy.                |
| `receivedApprovals` | Number of approvals received at the time of the event. |
| `approvers`         | Principals that approved.                              |
| `approvedAt`        | When the approval reached its current status.          |

### 2.2 Status

`status`, when present, MUST be one of:

| Value          | Meaning                                                           |
| -------------- | ----------------------------------------------------------------- |
| `not-required` | Policy determined that no approval was needed for this operation. |
| `pending`      | Approval was requested and has not been decided.                  |
| `approved`     | The required approvals were received.                             |
| `rejected`     | Approval was refused.                                             |
| `expired`      | The approval request lapsed before it was decided.                |
| `unknown`      | The producer cannot determine the approval state.                 |

`not-required` is not the same as omitting the object. `not-required` asserts that the question was
asked and answered; omission says nothing at all. Producers that evaluate approval requirements
SHOULD record `not-required` explicitly, because "no approval was needed" is itself an auditable
statement.

### 2.3 Rules

1. Approval MUST NOT be required for all events. Most operations in most applications have no
   approval step, and forcing an approval object onto them produces noise, not evidence.
2. A profile MAY require approval for a specific class of events. That requirement belongs to the
   profile, never to the core model. See [profiles/](../profiles/).
3. `approvers` SHOULD identify the principals whose decisions were counted, not everyone who was
   notified.
4. `receivedApprovals` SHOULD be consistent with the length of `approvers` when both are present. The
   schema does not enforce this, because an approver may legitimately be recorded without being
   identifiable to the producing application.
5. An event with `status` of `pending` or `rejected` and a successful outcome describes a control
   bypass. Producers SHOULD record it accurately rather than suppressing it; that combination is
   exactly what a reviewer needs to find.

## 3. Delegation

`delegation` records **how the actor obtained authority to act for the subject**. It is OPTIONAL.

### 3.1 Structure

| Field        | Required | Meaning                                                  |
| ------------ | -------- | -------------------------------------------------------- |
| `type`       | Yes      | Kind of delegation.                                      |
| `reason`     | No       | Why delegation was used.                                 |
| `reference`  | No       | Grant, ticket or session that authorized the delegation. |
| `approvedBy` | No       | Principal that approved the delegation.                  |

`type` is REQUIRED when the object is present. Delegation without a type cannot be interpreted, and
the conditional rule in §3.3 depends on it.

### 3.2 Types

| Value           | Meaning                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `impersonation` | The actor assumed the subject's identity. The system behaved as if the subject acted.         |
| `on-behalf-of`  | The actor acted for the subject using its own identity.                                       |
| `delegated`     | Authority was granted to the actor in advance, for example a delegated administrator.         |
| `service-chain` | The operation traversed intermediate services. Describes transport, not a person's authority. |

### 3.3 Subject requirement

When `delegation.type` is `impersonation`, `on-behalf-of` or `delegated`, the event MUST contain
`subject`. The canonical schema enforces this.

The reason is simple: each of these types asserts that someone else's authority was used. An
assertion of borrowed authority that does not say whose authority was borrowed is not auditable.

`service-chain` does **not** require a subject. Service-to-service operations are routine and often
have no human principal behind them at all. Requiring a subject for every service call would force
producers to invent one, which is worse than recording nothing.

### 3.4 Impersonation

Impersonation is the highest-risk case in this model, because the system's own records elsewhere will
show the subject acting. Producers that support impersonation:

- MUST record `actor` as the impersonating principal, never as the subject.
- SHOULD record `reason` and `reference`.
- SHOULD record `approvedBy` where the impersonation required approval.
- SHOULD include `privileged-access` in `controlCategories`.

## 4. Worked example

An administrator impersonates a customer to reproduce a fault, with an approved support case:

```json
{
  "event": {
    "name": "identity.session.impersonate",
    "category": "identity",
    "outcome": "success",
    "severity": "critical"
  },
  "actor": { "type": "admin", "id": "admin-4821" },
  "subject": { "type": "user", "id": "user-7391" },
  "delegation": {
    "type": "impersonation",
    "reason": "Reproducing a reported checkout failure.",
    "reference": "support-case-3391",
    "approvedBy": { "type": "user", "id": "user-1180" }
  },
  "resource": { "type": "session", "id": "session-impersonation-5f21" },
  "authorization": { "decision": "allow", "policy": "support-impersonation" },
  "approval": {
    "status": "approved",
    "requestId": "approval-request-7781",
    "requiredApprovals": 1,
    "receivedApprovals": 1,
    "approvedAt": "2026-03-14T10:02:00Z"
  },
  "controlCategories": ["privileged-access", "change-approval"]
}
```

Note what each object contributes: `authorization` says policy permitted it, `approval` says a person
sanctioned it, `delegation` says whose authority was used, and `subject` says who that was.
