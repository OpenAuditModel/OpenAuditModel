# Workflow and Approval Events

**Specification version: 0.1 · Status: Experimental**

Category: `workflow`

## 1. Recommended event names

### Requests and approvals

| Name                         | Operation                                          |
| ---------------------------- | -------------------------------------------------- |
| `workflow.request.create`    | A request entered a workflow                       |
| `workflow.request.submit`    | A request was submitted for decision               |
| `workflow.approval.request`  | Approval was requested from one or more principals |
| `workflow.approval.grant`    | An approver approved                               |
| `workflow.approval.reject`   | An approver refused                                |
| `workflow.approval.expire`   | An approval request lapsed undecided               |
| `workflow.approval.delegate` | Approval authority was passed to another principal |
| `workflow.stage.advance`     | A workflow moved to the next stage                 |
| `workflow.request.cancel`    | A request was withdrawn                            |
| `workflow.request.close`     | A request reached a terminal state                 |

### Case and incident lifecycle

| Name                         | Operation                             |
| ---------------------------- | ------------------------------------- |
| `incident.case.create`       | An incident was raised                |
| `incident.priority.change`   | Priority was reassessed               |
| `incident.assignment.change` | Ownership changed                     |
| `incident.major.declare`     | An incident was escalated to major    |
| `incident.case.resolve`      | An incident was resolved              |
| `incident.case.close`        | An incident was closed                |
| `incident.case.reopen`       | A closed incident was reopened        |
| `incident.rca.create`        | A root cause analysis was recorded    |
| `incident.rca.approve`       | A root cause analysis was approved    |
| `incident.sla.breach`        | A service level commitment was missed |

## 2. The approval object versus approval events

Both exist, and they answer different questions.

| Question                                        | Where it is answered                  |
| ----------------------------------------------- | ------------------------------------- |
| Was this operation approved?                    | `approval` on the **operated** event  |
| Who approved what, when, and did anyone refuse? | Separate `workflow.approval.*` events |

A configuration change carries `approval` describing the state of its approval. The approval decisions
themselves — each approver, each timestamp, each rejection — are their own events, because they are
separate auditable operations performed by different principals at different times.

Producers SHOULD emit both. Recording only the summary loses who decided; recording only the decisions
makes it impossible to tell what they authorized.

## 3. Approval status transitions

Recommended transitions, and the event that records each:

```text
not-required                          (no approval event; recorded on the operated event)
pending    → approved                 workflow.approval.grant
pending    → rejected                 workflow.approval.reject
pending    → expired                  workflow.approval.expire
```

An operated event whose `approval.status` is `pending`, `rejected` or `expired` and whose outcome is
`success` describes a control bypass. Producers MUST record it accurately.

## 4. Context to populate

| Field                        | Guidance                                                           |
| ---------------------------- | ------------------------------------------------------------------ |
| `resource`                   | The request, case or workflow instance                             |
| `relatedResources`           | The resource the workflow governs, and any affected services       |
| `approval.approvers`         | Only the principals whose decisions counted                        |
| `approval.requiredApprovals` | The policy threshold, so a reviewer can see whether it was met     |
| `change`                     | Status transitions, as `changedFields` with before and after       |
| `evidence`                   | The approval record, the analysis document, the ticket             |
| `reason`                     | Why the decision was made, where a justification is required       |
| `request.correlationId`      | Shared across the whole workflow, so its events can be assembled   |
| `controlCategories`          | `change-approval`, `separation-of-duties`, `incident-traceability` |

## 5. Correlation across a workflow

A workflow produces many events over hours or weeks, from different applications and principals. They
are assembled by correlation, not by timestamp.

Producers SHOULD:

- Use one `request.correlationId` for the life of the workflow instance.
- Use the workflow instance identifier consistently in `approval.workflowId`.
- Reference the same case identifier in `change.incidentId` or `reason.reference`.

## 6. Separation of duties

Where policy requires that the approver differ from the requester, the audit trail must make the
comparison possible. Producers SHOULD:

- Record `actor` on the operated event and `approval.approvers` such that both are identifiable.
- Include `separation-of-duties` in `controlCategories`.
- Emit the event even when the check **passes**. A control that only produces evidence when it fails
  cannot be shown to have been operating.

The model records the facts. It does not evaluate the rule: OpenAuditModel is not a policy engine.

## 7. Example

See [examples/valid/incident-case-close.json](../examples/valid/incident-case-close.json) for an
incident closure with approvals, evidence references, status transition and trace correlation.
