# Incident management profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[incident-management profile](../../../profiles/incident-management/). The rules themselves are in
[profile.json](../../../profiles/incident-management/profile.json).

```bash
auditmodel check-profile examples/profiles/incident-management/valid --profile incident-management
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming** event. The
ones under `invalid/` fail the profile, not the core schema. That separation is the point: a profile
adds requirements to events the core already accepts.

Read in order, the valid fixtures tell one story: a checkout latency incident raised from a
monitoring signal, escalated to major, reassigned, resolved with a workaround, analysed, remediated,
closed under approval, and then reopened when the problem came back. They share one
`request.correlationId`, which is what makes them assemble into that story rather than sit as thirteen
unrelated records.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate      examples/profiles/incident-management/valid
auditmodel lint-privacy  examples/profiles/incident-management/valid
auditmodel check-profile examples/profiles/incident-management/valid --profile incident-management
```

A profile that accepted an event the core rejects would break the core invariant. A profile that
accepted an event carrying a credential would be worse than no profile. The fixtures under
`invalid/` and `not-applicable/` are held to the same core and privacy standards; only the profile
result differs.

## Valid fixtures

| File                            | Event                        | Demonstrates                                                              |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `case-create.json`              | `incident.case.create`       | Raising a case with priority, impact, urgency and a detection time        |
| `priority-change.json`          | `incident.priority.change`   | Reprioritisation recorded as a transition with a justification            |
| `assignment-change.json`        | `incident.assignment.change` | The newly accountable principal named in `subject`, not `actor`           |
| `major-declare.json`            | `incident.major.declare`     | Escalation to major: transition, justification and the priority in force  |
| `case-resolve.json`             | `incident.case.resolve`      | A workaround, distinguished from a permanent fix by `resolutionType`      |
| `case-close.json`               | `incident.case.close`        | Closure the producer declared as needing approval, with the decision      |
| `case-reopen.json`              | `incident.case.reopen`       | A reopen as a new transition, on the original correlation identifier      |
| `problem-case-close.json`       | `problem.case.close`         | A closure declared as **not** needing approval, so the condition is quiet |
| `rca-create.json`               | `incident.rca.create`        | An analysis naming its method and referencing the document                |
| `rca-approve.json`              | `incident.rca.approve`       | An event that is itself an approval, recording the decision               |
| `corrective-action-open.json`   | `corrective-action.open`     | Remediation opened against a named owner                                  |
| `corrective-action-verify.json` | `corrective-action.verify`   | Verification recording **how** the fix was demonstrated                   |
| `sla-breach.json`               | `incident.sla.breach`        | A system observation, with no `/authorization` demanded of it             |

All thirteen conform with **no warnings**: every recommendation the profile makes is also satisfied.
That is a property of this fixture set, not a requirement — a warning never fails conformance.

Two fixtures are worth reading for what they leave out. `sla-breach.json` carries no
`/authorization`, because a missed commitment is detected by a monitor rather than decided by a
person, and `INC-CORE-001` deliberately excludes it. `problem-case-close.json` carries no
`/approval`, because it records `approvalRequired: false` — the flag is stated rather than omitted,
so the trail distinguishes "approval was not required" from "nobody said".

## Invalid fixtures

Each removes exactly one profile-required value from a valid fixture, so it fails for one documented
reason. A test asserts both the rule and the pointer, and that **exactly one** error is produced.

| File                                           | Derived from                    | Violates           | At                                                       |
| ---------------------------------------------- | ------------------------------- | ------------------ | -------------------------------------------------------- |
| `case-close-missing-authorization.json`        | `case-close.json`               | `INC-CORE-001`     | `/authorization`                                         |
| `case-create-missing-status.json`              | `case-create.json`              | `INC-CORE-001`     | `/metadata/incident/status`                              |
| `assignment-change-missing-change.json`        | `assignment-change.json`        | `INC-STATE-001`    | `/change`                                                |
| `case-close-missing-reason.json`               | `case-close.json`               | `INC-STATE-002`    | `/reason`                                                |
| `priority-change-missing-priority.json`        | `priority-change.json`          | `INC-PRIORITY-001` | `/metadata/incident/priority`                            |
| `assignment-change-missing-assignee.json`      | `assignment-change.json`        | `INC-ASSIGN-001`   | `/subject`                                               |
| `case-resolve-missing-resolution-type.json`    | `case-resolve.json`             | `INC-RESOLVE-001`  | `/metadata/incident/resolutionType`                      |
| `case-close-missing-approval.json`             | `case-close.json`               | `INC-CLOSE-001`    | `/approval/status`                                       |
| `case-reopen-missing-change.json`              | `case-reopen.json`              | `INC-REOPEN-001`   | `/change`                                                |
| `case-reopen-missing-reason.json`              | `case-reopen.json`              | `INC-REOPEN-001`   | `/reason`                                                |
| `rca-create-missing-method.json`               | `rca-create.json`               | `INC-RCA-001`      | `/metadata/incident/rca/method`                          |
| `rca-approve-missing-approval.json`            | `rca-approve.json`              | `INC-RCA-002`      | `/approval/status`                                       |
| `corrective-action-verify-missing-method.json` | `corrective-action-verify.json` | `INC-CAPA-001`     | `/metadata/incident/correctiveAction/verificationMethod` |
| `sla-breach-missing-target.json`               | `sla-breach.json`               | `INC-SLA-001`      | `/metadata/incident/sla/target`                          |

There is one invalid fixture for **every requirement of every enforceable rule**, which is why
`INC-CORE-001` and `INC-REOPEN-001` have two each: each of them requires two different things, and a
fixture that removed only one of them would leave the other requirement untested. A test derives that
list from `profile.json` and fails if a requirement is added without a fixture that holds it in place.
The three advisory rules — `INC-CORE-002`, `INC-CREATE-001` and `INC-EVIDENCE-001` — have no invalid
fixture by construction: a recommendation produces a warning and can never fail.

`case-close-missing-approval.json` also emits two warnings, for the recommended `/approval/approvers`
and `/approval/approvedAt` that vanished with the object. Warnings are not errors, and the fixture
still fails for exactly one reason.

## Not-applicable fixtures

| File                          | Event                    | Why it is out of scope                                                                    |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `monitoring-alert-raise.json` | `monitoring.alert.raise` | A threshold alert that cleared itself in 45 seconds and never became a managed case       |
| `note-create.json`            | `incident.note.create`   | A working note appended to an incident timeline — high volume, not a lifecycle transition |
| `case-view.json`              | `incident.case.view`     | Reading a closed case in a console; a data-access event, not a change to the case         |

`check-profile` reports each as **not applicable**, with exit code 3. Not applicable is not
conformance: the tool says the profile is silent about the event, never that the profile is satisfied.

They exist to hold the exclusions in place. If a future edit widened a selector to a bare `incident.`
or `incident.case.` prefix, these fixtures would start conforming instead of being skipped, and the
test would fail — which is the point, because that edit would put the profile's heaviest requirements
on every alert, every note and every record view in a service management system.

`case-view.json` carries `/metadata/incident/status` even though nothing asks it to. That is
deliberate: an event is out of scope because of its **name**, not because it happens to lack the
fields the profile would have wanted.

## Vendor neutrality

No fixture names a real product, company, person, jurisdiction or regulation. Priority values,
resolution types, verification methods, policy names and commitment names are illustrative tokens,
not any organization's scheme, and the profile closes none of those vocabularies.

Identifiers are opaque and lower-case (`incident-2026-0418`, `user-5140`, `service-checkout`). No
fixture contains a credential, a token, a personal email address, a real name or free text describing
an individual — the profile requires no free-text field, and these fixtures are checked by
`auditmodel lint-privacy` in CI to keep it that way.
