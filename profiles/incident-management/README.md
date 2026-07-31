# Incident Management Profile

**Status: Experimental. Implemented in v0.1, 15 rules — 12 enforceable, 3 advisory.**

Scope: applications that manage the lifecycle of incidents, problems and corrective actions —
operations tooling, IT service management, quality management, safety reporting, regulatory event
handling.

The profile is vendor-neutral. It describes the lifecycle any incident system implements, not the
data model of any product. It assumes no priority scale, no escalation matrix, no approval process
and no service commitment framework.

The enforceable rules are in [profile.json](profile.json).

```bash
auditmodel check-profile examples/profiles/incident-management/valid --profile incident-management
```

## Purpose

An incident trail is not one event. Raising, triaging, escalating, resolving, analysing, remediating
and closing are separate operations performed hours or weeks apart, often by different applications
and different principals, and the questions asked afterwards are always about the sequence rather
than about any single step: who decided this was minor, when did we know, who was accountable, was
the fix ever verified, why was it closed, and why was it reopened.

The core model can carry all of that. This profile requires the parts without which the sequence
cannot be reconstructed at all.

## Scope

### Event families

| Family                                        | Governed | Notes                                             |
| --------------------------------------------- | -------- | ------------------------------------------------- |
| `incident.case.create`                        | yes      | Raising a case                                    |
| `incident.priority.change`                    | yes      | Reassessment of priority                          |
| `incident.assignment.change`                  | yes      | Change of accountable owner                       |
| `incident.major.declare`                      | yes      | Escalation to major                               |
| `incident.case.resolve`                       | yes      | Service restored                                  |
| `incident.case.close`, `incident.case.cancel` | yes      | Terminal transitions                              |
| `incident.case.reopen`                        | yes      | A new lifecycle transition, governed on its own   |
| `incident.rca.*`                              | yes      | Root cause analysis, including approval           |
| `incident.sla.breach`                         | yes      | A missed commitment; excluded from `INC-CORE-001` |
| `problem.case.create`, `problem.case.close`   | yes      | Problem management, where it is a separate record |
| `corrective-action.*`                         | yes      | Opening, verifying and closing an action          |
| `monitoring.alert.*`                          | **no**   | Alert observations                                |
| `incident.note.*`, `incident.timeline.*`      | **no**   | Working notes and timeline chatter                |
| `incident.case.view` and other reads          | **no**   | Reading a case record                             |

The names come from
[workflow-and-approval.md](../../semantic-conventions/workflow-and-approval.md), which already
defines the `incident.*` case lifecycle. Two families are added because that document stops at the
incident: `problem.case.*` for organizations that keep a problem record separate from the incidents
that revealed it, and `corrective-action.*` for the remediation that outlives both. Both follow the
core naming rules; `corrective-action.open` uses the two-segment form permitted where a resource
segment would be artificial, exactly as `authentication.login` does.

### Explicit exclusions

**Alert and monitoring observations.** A monitoring system emits alerts continuously, the
overwhelming majority of which clear on their own and never become a managed case. Requiring an
authorization decision, a lifecycle state and a priority on each of them would put the profile's
heaviest requirements on the highest-volume event in the estate, and the requirement would be
switched off rather than met. An alert that _does_ become a case is recorded by the
`incident.case.create` that follows it.

**Working notes and timeline entries.** During a major incident a case accumulates hundreds of notes,
status pings and chat-bridge entries. They are worth auditing and they are not lifecycle transitions.

**Reads.** Opening a case record in a console is a data-access event, covered by
[data-access.md](../../semantic-conventions/data-access.md).

The exclusion is structural, not a matter of discipline. **No selector in this profile uses a bare
`incident.`, `incident.case.`, `problem.` or `monitoring.` prefix.** The case lifecycle is selected by
exact event name precisely so that a future `incident.case.view` or `incident.case.subscribe` cannot
be swept in by a prefix nobody re-read. Only `incident.rca.` and `corrective-action.` are prefixes,
and both name low-volume families whose every member should be governed. Tests assert all of this,
because widening a selector later would silently impose the profile's requirements on every alert in
a production estate.

Excluded does not mean unaudited. Every one of those events is still a conforming OpenAuditModel
event.

## Rules

| Rule               | Applies to                                             | Requires                                                   |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| `INC-CORE-001`     | every governed event except `incident.sla.breach`      | `/authorization`, `/metadata/incident/status`              |
| `INC-CORE-002`     | every governed event                                   | _recommends_ `/request/correlationId`, `/relatedResources` |
| `INC-CREATE-001`   | `incident.case.create`, `problem.case.create`          | _recommends_ `/reason`, detection time, impact, urgency    |
| `INC-STATE-001`    | every state transition except reopen                   | `/change`                                                  |
| `INC-STATE-002`    | reprioritisation, escalation, closure, cancellation    | `/reason`                                                  |
| `INC-PRIORITY-001` | creation, reprioritisation, escalation, breach         | `/metadata/incident/priority`                              |
| `INC-ASSIGN-001`   | `incident.assignment.change`, `corrective-action.open` | `/metadata/incident/assigneeId`; recommends `/reason`      |
| `INC-RESOLVE-001`  | `incident.case.resolve`                                | `/metadata/incident/resolutionType`                        |
| `INC-CLOSE-001`    | closure or cancellation **declared to need approval**  | `/approval/status`                                         |
| `INC-REOPEN-001`   | `incident.case.reopen`                                 | `/change`, `/reason`; recommends `/evidence`               |
| `INC-RCA-001`      | `incident.rca.*`                                       | `/metadata/incident/rca/method`                            |
| `INC-RCA-002`      | `incident.rca.approve`                                 | `/approval/status`                                         |
| `INC-CAPA-001`     | `corrective-action.verify`                             | `/metadata/incident/correctiveAction/verificationMethod`   |
| `INC-SLA-001`      | `incident.sla.breach`                                  | `/metadata/incident/sla/target`                            |
| `INC-EVIDENCE-001` | `incident.rca.*`, `corrective-action.*`                | _recommends_ `/evidence`                                   |

Each rule's full text and rationale is in [profile.json](profile.json).

## Metadata namespace

Every metadata requirement lives under **`/metadata/incident/`**, and a test asserts it. Nested,
domain-namespaced keys keep two profiles from assigning different meanings to the same key when one
event is governed by both: `status` on an incident, on a share and on a deployment are not the same
fact, and a root-level `/metadata/status` would make them look like one.

| Path                                                     | Type    | Meaning                                            |
| -------------------------------------------------------- | ------- | -------------------------------------------------- |
| `/metadata/incident/status`                              | string  | Lifecycle state the record was left in             |
| `/metadata/incident/priority`                            | string  | Priority in force                                  |
| `/metadata/incident/impact`, `/urgency`                  | string  | Inputs a priority is usually derived from          |
| `/metadata/incident/detectedAt`, `/resolvedAt`           | string  | Timeline points the record cannot recompute        |
| `/metadata/incident/resolutionType`                      | string  | Workaround, permanent fix, duplicate, no fault     |
| `/metadata/incident/approvalRequired`                    | boolean | Producer's declaration that closure needs approval |
| `/metadata/incident/rca/method`                          | string  | How the analysis was conducted                     |
| `/metadata/incident/correctiveAction/verificationMethod` | string  | How the action was demonstrated to work            |
| `/metadata/incident/correctiveAction/id`, `/verifiedAt`  | string  | Links and timing for the remediation               |
| `/metadata/incident/sla/target`, `/breachedAt`           | string  | The commitment and when it was missed              |

The **vocabularies of these fields are deliberately open.** Priority, impact, urgency, resolution
type and verification method mean different things in a service desk, a manufacturing quality system
and a safety board. The profile requires the field to be recorded and does not tell an organization
what to put in it; a profile that closed these vocabularies would describe one product rather than a
domain.

`/metadata/incident/status` is required even though a transition also appears in `/change`. They are
different facts recorded for different readers. `/change` shows the movement; `status` names the
resulting state in a single typed field that the profile can check and a consumer can index, which
matters because the rule language cannot look inside `/change/after` and would otherwise have no way
to tell that a case was left closed rather than left cancelled.

`/metadata/incident/status` is also **not** `event.severity`. `event.severity` grades the audit
significance of the record; the incident's own priority is business data and lives in
`/metadata/incident/priority`. The profile keeps a single business scale — priority — rather than
requiring both a priority and a severity, because organizations that use two scales already derive
one from the other, and an audit trail that carried both would invite them to disagree.

## Conditional-policy fields

The profile has exactly one conditional rule, and it fires on one producer-set flag.

```json
{ "when": { "path": "/metadata/incident/approvalRequired", "equals": true } }
```

Whether closing a case needs a second pair of eyes is an organizational policy, not something this
specification can decide. A service desk closing thousands of routine tickets a week and a safety
board closing a reportable event are both conforming. The producer declares the obligation; the
profile enforces the consequence. This is the same shape as the IAM profile's `role.privileged` flag
and the document profile's `share.recipientType`, and it is the entire conditional mechanism v0.1
offers: one path, compared for equality, against one scalar.

When the flag is absent the condition does not hold and the rule contributes nothing. Recording
`approvalRequired: false` explicitly is better practice than omitting it, because it distinguishes
"approval was not required" from "nobody said".

## Approval model

**Approval is never required universally.** Only two rules mention `/approval`, and a test asserts
that no other rule can quietly acquire one:

- `INC-RCA-002` requires it on `incident.rca.approve`, an event that _is_ an approval. Requiring the
  approval state there is not process imposition; it is a requirement that the event describe itself.
- `INC-CLOSE-001` requires it on a closure **only** where the producer declared it necessary.

Both require the approval **status** to be present, not to be favourable. An event whose approval is
still pending or was rejected and whose outcome is `success` describes a control bypass, and
[workflow-and-approval.md](../../semantic-conventions/workflow-and-approval.md) §3 says producers
MUST record that accurately. A rule demanding `status: "approved"` would make the honest record
non-conforming and quietly reward rewriting it.

Approvers and approval timestamps are recommended, never required: an automated approval gate has no
human approver to name.

### Reopening

A reopen is treated as **a new auditable lifecycle transition and nothing more**. `INC-REOPEN-001`
requires the transition and the reason, and recommends supporting evidence.

The profile does **not** assert that reopening invalidates the earlier closure or the approval
attached to it. That closure remains a true historical record of what was decided, by whom, on the
evidence available at the time; a trail that retroactively voided it would destroy the very thing a
reviewer needs in order to ask why the original decision looked right. Whether a fresh approval is
owed before the case can be closed again is an organizational process, and the profile expresses it
the only honest way available: through `approvalRequired` on the next closure. A test asserts that no
rule requires an approval on a reopen.

Reusing the **same `request.correlationId`** across the original handling and the reopen is what keeps
the record readable as one story rather than two unrelated cases. It is recommended by
`INC-CORE-002` rather than required, because a producer may have no correlation facility at all.

## Privacy considerations

Incident records are among the most personal-data-dense artifacts an organization keeps. A case can
describe a customer complaint, a safety event involving a named individual, an HR investigation or a
security breach with victims, and the free-text fields are where that leaks.

This profile requires **no free text anywhere**. Every requirement is a token, a boolean, a timestamp
or a structural object. Specifically:

- Requirements ask for `reason` as an object, whose `code` is a token. `reason.text` is scanned by the
  privacy linter and should stay a short, factual sentence.
- Nothing in the profile asks for a reporter's identity, a complainant, an affected customer or any
  contact detail. Principals are referenced by opaque identifier through `actor` and `subject`.
- `/evidence` references material; it never embeds it. An analysis document stays in the record
  system it belongs to, under that system's access control, and the audit event carries a pointer.
- `/metadata/incident/rca/*` must not become a place to paste an investigation narrative. The profile
  requires the method, not the findings.

Every published fixture is required by test to pass `auditmodel lint-privacy` as well as
`auditmodel validate`. Nothing here weakens [specification/privacy.md](../../specification/privacy.md);
a profile-conforming event can still carry a secret, and the linter is what looks for one.

## Known rule-language limitations

The v0.1 rule language checks presence, JSON type and strict scalar equality against one condition.
These consequences are real, and the profile does not paper over them:

1. **Array contents cannot be inspected.** The profile cannot require that `/evidence` contains an
   entry of type `document`, or that `/relatedResources` includes the incident an analysis belongs to.
   `INC-EVIDENCE-001` therefore _recommends_ `/evidence` rather than requiring it and pretending to
   verify it. The placeholder that preceded this profile proposed "an `evidence` entry of type
   `document` REQUIRED on `incident.rca.*`"; that requirement cannot be expressed and is not claimed.
2. **Numeric ranges cannot be checked.** `INC-SLA-001` requires the commitment to be _named_. It
   cannot assert that a breach duration exceeded a threshold, that `requiredApprovals` was at least
   two, or that a corrective action was verified before its due date.
3. **Fields cannot be compared to each other.** The profile cannot require that the approver differs
   from the actor, that `resolvedAt` is later than `detectedAt`, or that `status` agrees with
   `/change/after`. Separation of duties is recorded as facts and evaluated elsewhere;
   OpenAuditModel is not a policy engine.
4. **There is no disjunction.** "Priority or severity" cannot be expressed, which is one reason the
   profile settles on a single required scale.
5. **One condition per rule.** "Approval required _and_ the incident is major" needs two rules or one
   producer-set flag. The profile uses the flag.
6. **Cross-event invariants are out of reach.** Nothing can require that a closure be preceded by a
   resolution, or that every major incident eventually produce an analysis. A rule sees one event.

Where a requirement could not be expressed honestly, it appears above as guidance rather than in
`profile.json` as a rule that does not do what its name suggests.

## Cross-profile overlaps

| Neighbour                            | Overlap                                                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow.approval.*` events         | An approval decision is its own event; `/approval` on a governed event summarises the outcome. Both should be emitted. This profile requires the summary, never the decision events.                                              |
| Deployment and change management     | A corrective action is frequently delivered as a change. The link belongs in `change.ticketId` / `change.deploymentId` and in `/relatedResources`; this profile does not govern the deployment event and requires no field on it. |
| Identity and access management       | A break-glass access grant during a major incident is an `identity.*` event governed by that profile. Correlating them is what `request.correlationId` is for.                                                                    |
| Document management                  | An analysis document has its own lifecycle under `document.*`. This profile references it through `/evidence` and never governs it.                                                                                               |
| Message broker / data infrastructure | An incident about a broker names the broker in `/relatedResources`. Nothing here governs data-plane events.                                                                                                                       |

A single event governed by two profiles must satisfy both. Namespaced metadata is what makes that
possible without collision.

## Fixture matrix

[examples/profiles/incident-management/](../../examples/profiles/incident-management/) — thirteen
valid, fourteen invalid, three not-applicable. Every fixture is core-conforming and privacy-clean;
every invalid fixture is core-**valid** and fails exactly one profile rule with exactly one error.
There is one invalid fixture per _requirement_, not per rule, so the two rules that require two
things each carry two fixtures; a test derives that obligation from `profile.json`.

| Rule               | Valid fixture                                           | Invalid fixture                                                            |
| ------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `INC-CORE-001`     | all governed fixtures                                   | `case-close-missing-authorization.json`, `case-create-missing-status.json` |
| `INC-CORE-002`     | all governed fixtures                                   | advisory, never fails                                                      |
| `INC-CREATE-001`   | `case-create.json`                                      | advisory, never fails                                                      |
| `INC-STATE-001`    | `assignment-change.json`                                | `assignment-change-missing-change.json`                                    |
| `INC-STATE-002`    | `case-close.json`                                       | `case-close-missing-reason.json`                                           |
| `INC-PRIORITY-001` | `priority-change.json`                                  | `priority-change-missing-priority.json`                                    |
| `INC-ASSIGN-001`   | `assignment-change.json`, `corrective-action-open.json` | `assignment-change-missing-assignee.json`                                  |
| `INC-RESOLVE-001`  | `case-resolve.json`                                     | `case-resolve-missing-resolution-type.json`                                |
| `INC-CLOSE-001`    | `case-close.json`                                       | `case-close-missing-approval.json`                                         |
| `INC-REOPEN-001`   | `case-reopen.json`                                      | `case-reopen-missing-change.json`, `case-reopen-missing-reason.json`       |
| `INC-RCA-001`      | `rca-create.json`                                       | `rca-create-missing-method.json`                                           |
| `INC-RCA-002`      | `rca-approve.json`                                      | `rca-approve-missing-approval.json`                                        |
| `INC-CAPA-001`     | `corrective-action-verify.json`                         | `corrective-action-verify-missing-method.json`                             |
| `INC-SLA-001`      | `sla-breach.json`                                       | `sla-breach-missing-target.json`                                           |
| `INC-EVIDENCE-001` | `rca-create.json`                                       | advisory, never fails                                                      |

`problem-case-close.json` and `major-declare.json` exercise the problem domain and the escalation
path; `problem-case-close.json` is also the fixture that proves the closure-approval condition stays
quiet when the producer declares approval was not required.

## Not-applicable rationale

Three fixtures under `not-applicable/` prove the exclusions hold:

| Fixture                       | Event                    | Why it is ungoverned                                                                              |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| `monitoring-alert-raise.json` | `monitoring.alert.raise` | A threshold alert that cleared in 45 seconds and never became a managed case                      |
| `note-create.json`            | `incident.note.create`   | A working note on the incident timeline — high volume, not a lifecycle transition                 |
| `case-view.json`              | `incident.case.view`     | Reading a case record; a data-access event, and the reason the case lifecycle is selected by name |

`check-profile` reports each as not applicable with exit code 3. **Not applicable is not
conformance**: the tool says the profile is silent, never that the profile is satisfied.

These fixtures exist to hold the exclusions in place. If a future edit widened a selector to a bare
`incident.` prefix, they would start conforming instead of being skipped and the test would fail —
which is the point, because that edit would impose the profile's heaviest requirements on every alert
and every note in a production estate.

## Not required, and why

- **Impact and urgency as requirements.** Recommended on creation only. Many organizations record a
  priority directly, and demanding a derivation they do not perform produces invented values.
- **`relatedResources` as a requirement on declaration and closure.** The placeholder proposed it.
  An incident about a process, a supplier or a person has no affected service to name, and the rule
  language cannot check what an array contains anyway, so it is recommended by `INC-CORE-002`.
- **Trace identifiers.** `traceId` and `spanId` presume distributed tracing exists. Correlation is
  recommended; tracing is never required.
- **`request.protocol`.** A case can be closed from a console, an API, an email gateway or a batch
  reconciliation. The protocol is not the audit fact.
- **A closure approval for every case.** See the approval model above.
- **A defined priority or severity scale.** See the metadata namespace above.
- **An `incident.capa.*` family.** The placeholder proposed it. `corrective-action.*` says the same
  thing without requiring the reader to know that `capa` is quality-management jargon.

## Open questions

- Should a corrective action be a resource with its own lifecycle, as modelled here, or metadata on
  the incident? Modelling it as a resource lets it outlive the incident, which is usually what
  happens in practice, at the cost of more events. Adoption evidence is thin either way.
- Should `incident.sla.breach` be emitted by the incident system or derived by a consumer? The
  profile governs it if it is emitted and says nothing if it is not. Emitting it makes the trail
  self-contained; deriving it avoids duplicating a computation that changes when the commitment does.
- Is a single `status` field sufficient for organizations that track an incident state and a workflow
  state separately? The profile currently assumes the producer picks the one a reviewer would ask
  about.
- Would a producer-set `major` flag be a better conditional discriminator than `approvalRequired` for
  the closure rule? It would tie the obligation to the incident's own severity rather than to a
  policy declaration, but it would also let the profile guess at a process it cannot see.
