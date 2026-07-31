# Deployment and Change Management Profile

**Status: Experimental. Implemented in v0.1, 13 rules, 11 of them enforceable.**

Scope: applications that build, approve, deploy, revert and reconfigure running systems — delivery
pipelines, release management, infrastructure automation, configuration management and change
management.

The profile is vendor-neutral. It describes operations that any delivery system performs, not the
feature list of any product, and it names no pipeline tool, cloud, orchestrator or version control
system. It assumes no branching model, no environment naming scheme, no versioning scheme and no
approval workflow engine.

The enforceable rules are in [profile.json](profile.json).

```bash
auditmodel check-profile examples/profiles/deployment-and-change-management/valid --profile deployment-and-change-management
```

## Purpose

A deployment trail answers three questions that nothing else in a system can answer: what is running
where, who decided it should be, and what happened when it was put there. Those answers are cheap to
record at the moment of the change and expensive to reconstruct afterwards, because the pipeline that
knew them has already moved on and the environment now shows only its current state.

This profile requires the fields that make those answers survive. It does not require a delivery
process, and it does not decide which changes are risky enough to need a person.

## Scope

| Event family                                                                                    | Governed |
| ----------------------------------------------------------------------------------------------- | -------- |
| `deployment.release.*` — `create`, `approve`, `deploy`, `promote`, `rollback`, `cancel`         | yes      |
| `deployment.infrastructure.*` — `apply` and its siblings                                        | yes      |
| `configuration.setting.create`, `.update`, `.delete`                                            | yes      |
| `configuration.secret.rotate`                                                                   | yes      |
| `configuration.feature.toggle`, `configuration.policy.update`, `configuration.retention.update` | yes      |
| `change.request.*` — `create`, `approve`, `reject`, `close`                                     | yes      |
| `configuration.secret.access`                                                                   | **no**   |
| `deployment.pipeline.*`, `deployment.build.*` and other pipeline telemetry                      | **no**   |

The vocabulary comes from
[configuration-and-change.md](../../semantic-conventions/configuration-and-change.md). This profile
invents no parallel names. It additionally governs `deployment.release.cancel` and
`deployment.release.promote`, which follow the same pattern and are reached through the
`deployment.release.` prefix; producers that do not emit them are unaffected.

## Explicit exclusions

**Pipeline telemetry.** A delivery platform emits far more events about itself than about change:
runners poll for work, build steps append log lines, health probes report, agents send heartbeats.
Requiring a change identifier, a target environment and an approval-policy flag on each of them would
add cost to the highest-volume events in the system for no review value, and the requirement would be
switched off rather than met.

**Secret reads.** `configuration.secret.access` records that a workload read a credential it needs to
start. In most deployments that happens on every process start, and
[configuration-and-change.md §6](../../semantic-conventions/configuration-and-change.md) already
warns that recording every read may be less useful than recording grants, rotations and
out-of-pattern access. Rotation is governed; reading is not.

**Builds and tests.** A build produces an artifact; it does not change a running system. Build
events are legitimate audit events, and this profile has nothing to add to them.

The exclusions are structural, not a matter of discipline. **No selector in this profile uses a bare
`deployment.`, `configuration.` or `change.` prefix**, and the configuration family is selected by
exact event name rather than by a `configuration.setting.` prefix, so a future
`configuration.setting.read` cannot be swept in by accident either. Three not-applicable fixtures and
a test hold that boundary, because widening one prefix later would silently impose requirements on
every poll in every pipeline. A further test requires every prefix to name an **object within a
category** rather than a whole category, so `deployment.` cannot be reintroduced by editing a list of
names.

The boundary is deliberately not symmetric, and the asymmetry is worth stating plainly. Exactly two
prefixes remain: `deployment.release.` and `deployment.infrastructure.`. A verb added under either
later — a `deployment.release.list`, a `deployment.infrastructure.plan` — would be governed without
anyone deciding that it should be, and would then have to carry a change identifier, a target
environment and an approval-policy flag.

The configuration and change-request families are selected by **exact name** instead.
`configuration.` already contains a read, and `change.request.` is worse: a change-management tool
emits comments, watches, views and list operations continuously, and governing
`change.request.comment` would have put an approval-policy flag on a comment. That is the trade in
both directions — a new `deployment.release.*` verb is far more likely to be material change than
telemetry, so governing it by accident costs a failing check rather than an unaudited change, while a
new `change.request.*` verb is far more likely to be chatter.

A producer that needs a read-only verb under either remaining prefix should raise it against this
profile rather than route around it.

Excluded does not mean unaudited. Every excluded event is still a conforming OpenAuditModel event.

## Event families and what each one must carry

| Family                                            | Beyond the core requirements                                   |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Everything governed                               | change identifier, target environment, approval-policy flag    |
| `deployment.release.*`                            | the version concerned                                          |
| `deployment.infrastructure.*`                     | the version concerned                                          |
| Events that change what is running                | the version replaced                                           |
| Rollback and cancellation                         | authorization decision, justification                          |
| Configuration, feature, policy, retention, secret | authorization decision, the names of the settings that changed |
| Approval decisions                                | the resulting approval status                                  |
| Anything executed under a required approval       | the approval status it ran under                               |
| Anything flagged as bypassing the path            | a justification                                                |
| Anything that failed or partly applied            | the state the target was left in                               |

## Rules

| Rule                    | Severity | Applies to                                            | Requires                                                      |
| ----------------------- | -------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `DEPLOY-CORE-001`       | error    | every governed event                                  | `/metadata/deployment/id`, `/metadata/deployment/environment` |
| `DEPLOY-CORE-002`       | error    | every governed event                                  | `/metadata/deployment/approvalRequired` (boolean)             |
| `DEPLOY-CORE-003`       | warning  | every governed event                                  | _recommends_ `/reason`, correlation ID, pipeline ID           |
| `DEPLOY-RELEASE-001`    | error    | `deployment.release.*`, `deployment.infrastructure.*` | `/metadata/deployment/version`                                |
| `DEPLOY-RELEASE-002`    | error    | deploy, promote, rollback, infrastructure apply       | `/metadata/deployment/previousVersion`                        |
| `DEPLOY-REVERT-001`     | error    | `deployment.release.rollback`, `.cancel`              | `/authorization`, `/reason`                                   |
| `DEPLOY-CONFIG-001`     | error    | the configuration family                              | `/authorization`, `/change/changedFields`                     |
| `DEPLOY-APPROVAL-001`   | error    | events that are approval decisions                    | `/approval/status`                                            |
| `DEPLOY-APPROVAL-002`   | error    | executing events, when approval was required          | `/approval/status`                                            |
| `DEPLOY-EMERGENCY-001`  | error    | every governed event, when flagged emergency          | `/reason`                                                     |
| `DEPLOY-FAILURE-001`    | error    | every governed event, when `outcome: failure`         | `/metadata/deployment/resultingState`                         |
| `DEPLOY-FAILURE-002`    | error    | every governed event, when `outcome: partial`         | `/metadata/deployment/resultingState`                         |
| `DEPLOY-AUTOMATION-001` | warning  | executing events performed by a service               | _recommends_ `/subject`, `/delegation`                        |

Each rule's full text and rationale is in [profile.json](profile.json).

## Metadata namespace

Every metadata requirement lives under `/metadata/deployment/`. Namespacing keeps two profiles from
assigning different meanings to the same key when an event is governed by both: a `version` on a
release and a `version` on a document are not the same fact.

| Field              | Type    | Required                           | Records                                                        |
| ------------------ | ------- | ---------------------------------- | -------------------------------------------------------------- |
| `id`               | string  | always                             | The deployment, release or change record this event belongs to |
| `environment`      | string  | always                             | The environment the change was applied **to**                  |
| `approvalRequired` | boolean | always                             | Whether policy required an approval for this change            |
| `version`          | string  | release and infrastructure events  | The version the event concerns                                 |
| `previousVersion`  | string  | events that change what is running | The version replaced                                           |
| `resultingState`   | string  | on `failure` and `partial`         | The state the target was left in                               |
| `emergency`        | boolean | never; conditional trigger         | Whether the normal change path was bypassed                    |
| `pipelineId`       | string  | recommended                        | The pipeline or automation that produced the change            |

Producers may add further fields under the namespace. The fixtures show `strategy`,
`instancesUpdated`, `secretType` and `riskLevel` as examples; none of them is required and none is
interpreted by this profile.

### `environment` is not `application.environment`

`application` describes the system that **performed** the change, not the system that received it.
A delivery platform runs in one environment and deploys into many, so
`application.environment: production` and `metadata.deployment.environment: staging` on the same
event is correct and common — [valid/deploy-automated.json](../../examples/profiles/deployment-and-change-management/valid/deploy-automated.json)
is exactly that case. Conflating the two makes every environment-scoped review wrong, which is why
the profile requires the target environment separately rather than reusing a core field that means
something else.

The profile requires the field and says nothing about its values. It does not require `production`
to exist, or to be spelled that way.

## Conditional-policy fields

Three paths turn rules on: two producer-set flags under the profile's own namespace, and the core
`event.outcome`. Each condition has the same shape, which is the only conditional mechanism v0.1
offers: one path compared for equality against one scalar.

| Flag                                    | When it equals | The profile then requires                 |
| --------------------------------------- | -------------- | ----------------------------------------- |
| `/metadata/deployment/approvalRequired` | `true`         | `/approval/status` on the executing event |
| `/metadata/deployment/emergency`        | `true`         | `/reason`                                 |
| `/event/outcome`                        | `failure`      | `/metadata/deployment/resultingState`     |
| `/event/outcome`                        | `partial`      | `/metadata/deployment/resultingState`     |

`approvalRequired` is itself required by `DEPLOY-CORE-002`. A conditional rule contributes nothing
when its path is absent, so a flag nobody had to record would make the rule optional in practice:
silence would read as "no approval was required" when it may mean "nobody recorded whether one was".
`emergency` is deliberately **not** required — an ordinary change is not obliged to declare that it
is ordinary — which does mean a producer can avoid `DEPLOY-EMERGENCY-001` by omitting the flag. That
is a limitation the rule language cannot close, and it is recorded below rather than papered over.

## Approval model

**The profile does not decide which deployments need a human.** Continuous delivery deploys to
production many times a day with no per-change approval; a regulated release process approves every
one; an outage is repaired by whoever is on call and approved afterwards. All three are legitimate,
and a profile that mandated approval for every production deployment would describe one of them and
be switched off by everyone else. The producer declares the policy in `approvalRequired`, and
`DEPLOY-APPROVAL-002` enforces the consequence.

**Approval is required of the executing event, not only of the approving one.** The question a review
asks is not whether an approval exists somewhere but whether the change that actually reached the
environment was covered by one.

**The status is required; `approved` is not.** A change executed while its approval was still pending
is a control bypass, and
[configuration-and-change.md §4](../../semantic-conventions/configuration-and-change.md) requires
producers to record that honestly rather than suppress it. A rule that accepted only `approved` would
make the single most important event in the trail unrepresentable, and would be met by dropping the
flag rather than by improving the process.
[valid/rollback-emergency.json](../../examples/profiles/deployment-and-change-management/valid/rollback-emergency.json)
is that event: a successful production rollback with `approval.status: pending`, recorded as it
happened.

**`not-required` is an answer.** Where policy required no approval, `approval.status: not-required`
records that a decision was reached rather than skipped, and satisfies the recommendation in
`DEPLOY-REVERT-001`.

## Automation and the human behind it

Automation performs most material change, so the `actor` on a deployment event is usually a service
and the person who decided the change should happen is not in the event at all. The core model can
express the link in two ways, and this profile picks one:

- The service that carried the change out is the `actor`.
- The principal it acted for is the `subject`.
- `delegation.type` says how authority moved between them; `on-behalf-of` is the usual answer.

Recording the author under `metadata` instead would work for one product and be unreadable across
two. `DEPLOY-AUTOMATION-001` is a **warning** rather than a requirement because unattended
automation — drift correction, a scheduled reconciliation, an autoscaler — genuinely has no human
author, and in that case the warning is the correct signal to a reviewer rather than a defect to fix.

## Privacy considerations

- **A secret rotation records that the secret changed, never the secret.**
  `change.changedFields: ["secret"]` is the whole disclosure, and it is why this profile requires
  field **names** rather than before and after values.
- **`change.before` and `change.after` are never required.** They are useful for configuration and
  dangerous for credentials, so the choice stays with the producer. Where a setting's value is itself
  sensitive, record a hash or omit it; see
  [change-model.md](../../specification/change-model.md) §5.
- **No source control identity is required.** Commit authors, branch names and repository URLs are
  personal data or internal topology in many organizations. The profile asks for a `subject`
  identifier, which can be opaque.
- **Nothing in this profile asks for a token, key, connection string or endpoint.** A pipeline
  credential has no place in an audit event, and `auditmodel lint-privacy` runs against every fixture
  here by test.

## Known rule-language limitations

- **No disjunction.** `DEPLOY-FAILURE-002` is a duplicate of `DEPLOY-FAILURE-001` with a different
  condition, because a rule may carry exactly one equality condition. Stating the requirement twice
  is better than leaving the `partial` case ungoverned, but it is duplication and it should collapse
  into one rule if the language ever gains an `in` operator.
- **A rule cannot require a flag it is conditioned on.** `emergency` is optional, so a producer that
  never sets it never triggers `DEPLOY-EMERGENCY-001`. Requiring `emergency` on every governed event
  was considered and rejected: it would force every routine deployment to declare `false`, and the
  value would be copied from a template rather than derived.
- **No cross-field comparison.** The profile cannot check that `version` differs from
  `previousVersion`, that `resultingState` is consistent with `outcome`, that a rollback's target
  version was ever deployed, or that `approvedAt` precedes `time`.
- **No numeric ranges.** `requiredMetadata` checks JSON type only. A profile can require
  `receivedApprovals` to be an integer; it cannot require it to be at least `requiredApprovals`.
- **No array-content predicates.** The profile cannot require that `relatedResources` contains a
  service, or that `changedFields` excludes a particular name.
- **No vocabulary constraint on open fields.** `environment`, `version` and `resultingState` are
  required to be present strings and nothing more, because deployment environments, versioning
  schemes and what counts as partially applied are all organization decisions.

## Cross-profile overlaps

- **`identity-and-access-management`.** `identity.credential.rotate` and
  `configuration.secret.rotate` are different operations on different objects: a principal's
  credential versus a system's configured secret. Neither profile governs the other's event, and the
  metadata namespaces (`/metadata/credential/`, `/metadata/deployment/`) do not collide.
- **`document-management`.** No overlap. `configuration.retention.update` changes a retention
  **rule**; `document.retention.*` changes a document's retention state.
- **`incident-management`.** A rollback performed during an incident is governed here, and the
  incident it responded to is referenced through the core `change.incidentId` field rather than
  through a metadata key this profile defines. Incident lifecycle events themselves are out of scope.
- **`message-broker-management`.** A broker topic or ACL change made through a delivery pipeline
  produces **two events**, not one governed twice: a `broker.*` event governed by the broker profile
  and a `deployment.*` or `change.*` event governed by this one. An event has exactly one
  `event.name`, and neither profile selects the other's names, so no single event is ever checked
  against both. `/request/correlationId` is what joins them.

## Not required, and why

- **A change ticket on every change.** `change.ticketId` is recommended where an approval was
  required and never required outright. Teams that deliver continuously have no ticket, and a rule
  that demanded one would be satisfied with a generated placeholder.
- **Trace identifiers.** Distributed tracing may not exist in the system that performs a change, and
  a deployment is frequently not a request at all. `request.correlationId` is recommended;
  `traceId` and `spanId` are not mentioned.
- **`request.protocol`, `request.method`, `request.route`.** A change applied by a reconciler that
  polls a repository has no request to describe.
- **A source revision.** The earlier placeholder proposed requiring `metadata.sourceRevision`. It was
  dropped: not every change comes from source control, a revision identifier is meaningless without
  the repository it belongs to, and naming the repository is exactly the kind of internal topology the
  privacy guidance discourages. Producers that have one should record it under the namespace.
- **`application.component`.** What was deployed is a `resource`, and the systems it changed belong in
  `relatedResources`, which `DEPLOY-RELEASE-001` recommends. Requiring a component name as well would
  force a single-target deployment to duplicate its own resource.
- **An authorization decision on a deployment.** `DEPLOY-CONFIG-001` and `DEPLOY-REVERT-001` require
  `/authorization`; deploy, promote and infrastructure apply do not. The asymmetry is intentional. A
  configuration change and a revert are performed **against** the normal path, usually by a person
  under time pressure, and the policy decision is the evidence that they were allowed to be. A
  pipeline that delivers what was merged frequently has no policy engine in the path at all, and a
  rule demanding a decision that was never made would be satisfied with a synthesised
  `decision: allow` — which is worse evidence than an honest absence.
  [valid/deploy-automated.json](../../examples/profiles/deployment-and-change-management/valid/deploy-automated.json)
  is that case. Where a deployment does pass a gate, recording it is right; the profile simply does
  not make silence a failure.
- **Approval on every production deployment.** See the approval model above. This is the decision the
  profile exists to get right.

## Fixture matrix

[examples/profiles/deployment-and-change-management/](../../examples/profiles/deployment-and-change-management/)
— twelve valid, fourteen invalid, three not-applicable.

| Rule                    | Valid fixture                  | Invalid fixture                                                                                |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `DEPLOY-CORE-001`       | all twelve                     | `deploy-missing-deployment-id.json`, `deploy-missing-environment.json`                         |
| `DEPLOY-CORE-002`       | all twelve                     | `deploy-missing-approval-required.json`                                                        |
| `DEPLOY-CORE-003`       | all twelve                     | none; warnings never fail                                                                      |
| `DEPLOY-RELEASE-001`    | `release-create.json`          | `deploy-missing-version.json`                                                                  |
| `DEPLOY-RELEASE-002`    | `deploy-automated.json`        | `deploy-missing-previous-version.json`                                                         |
| `DEPLOY-REVERT-001`     | `release-cancel.json`          | `cancel-missing-authorization.json`, `cancel-missing-reason.json`                              |
| `DEPLOY-CONFIG-001`     | `configuration-update.json`    | `configuration-update-missing-authorization.json`, `secret-rotate-missing-changed-fields.json` |
| `DEPLOY-APPROVAL-001`   | `change-request-approve.json`  | `change-request-approve-missing-approval.json`                                                 |
| `DEPLOY-APPROVAL-002`   | `deploy-approved.json`         | `deploy-approved-missing-approval.json`                                                        |
| `DEPLOY-EMERGENCY-001`  | `secret-rotate-emergency.json` | `secret-rotate-missing-reason.json`                                                            |
| `DEPLOY-FAILURE-001`    | `deploy-failed.json`           | `deploy-failed-missing-resulting-state.json`                                                   |
| `DEPLOY-FAILURE-002`    | `deploy-partial.json`          | `deploy-partial-missing-resulting-state.json`                                                  |
| `DEPLOY-AUTOMATION-001` | `infrastructure-apply.json`    | none; warnings never fail                                                                      |

Every fixture — valid, invalid and not-applicable alike — is core-conforming and privacy-clean. The
ones under `invalid/` fail the profile, not the core schema, and each fails for exactly one reason.

## Not-applicable rationale

`deployment.pipeline.poll`, `deployment.build.log-append` and `configuration.secret.access` are
perfectly good audit events that this profile deliberately does not govern. `check-profile` reports
each of them as not applicable with exit code 3, which is not conformance: it says the profile had
nothing to say.

They exist to hold the exclusions in place. If a future edit widened a selector to a bare
`deployment.` or `configuration.secret.` prefix, these fixtures would start being checked instead of
skipped and the test would fail — which is the point, because that edit would silently impose a
change identifier, a target environment and an approval-policy flag on every poll, every build log
line and every process start in a deployment.

## Open questions

- Should `resultingState` have a recommended vocabulary? The fixtures use `unchanged`,
  `partially-applied` and `rolled-back`. Three values are not evidence of a convention, and fixing one
  too early would be worse than leaving the field open.
- Is `emergency` the right name for a flag that also covers a break-glass repair and an overridden
  pipeline gate? They are the same fact from an audit point of view — the normal path was not
  followed — but producers may not recognize their case in the word.
- Should a promotion between environments record the environment it came from as well as the one it
  went to? `previousVersion` answers the version question but not the provenance question, and there
  is no adoption evidence yet for what the field should be called.
- A change request and the change that executes it are two events with two resources. This profile
  ties them through `/metadata/deployment/id`. Whether that is better than
  `relatedResources` for the general case is unresolved.
