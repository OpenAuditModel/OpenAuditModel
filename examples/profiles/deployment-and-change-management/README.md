# Deployment and change management profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[deployment-and-change-management profile](../../../profiles/deployment-and-change-management/). The
rules themselves are in
[profile.json](../../../profiles/deployment-and-change-management/profile.json).

```bash
auditmodel check-profile examples/profiles/deployment-and-change-management/valid --profile deployment-and-change-management
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming** event. The
ones under `invalid/` fail the profile, not the core schema. That separation is the point: a profile
adds requirements to events the core already accepts.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate      examples/profiles/deployment-and-change-management/valid
auditmodel lint-privacy  examples/profiles/deployment-and-change-management/valid
auditmodel check-profile examples/profiles/deployment-and-change-management/valid --profile deployment-and-change-management
```

A profile that accepted an event the core rejects would break the core invariant. A profile that
accepted an event carrying a pipeline credential would be worse than no profile.

## Valid fixtures

| File                           | Event                             | Demonstrates                                                               |
| ------------------------------ | --------------------------------- | -------------------------------------------------------------------------- |
| `release-create.json`          | `deployment.release.create`       | A release candidate prepared automatically; nothing is running yet         |
| `release-approve.json`         | `deployment.release.approve`      | An approval decision, recorded on the event that is the decision           |
| `deploy-automated.json`        | `deployment.release.deploy`       | Fully automated delivery with no human approval, and no rule demanding one |
| `deploy-approved.json`         | `deployment.release.deploy`       | A gated production deployment, where `approvalRequired` is `true`          |
| `deploy-failed.json`           | `deployment.release.deploy`       | A failure that left the target untouched                                   |
| `deploy-partial.json`          | `deployment.release.deploy`       | `outcome: partial` — part of the fleet moved, so two versions are serving  |
| `release-cancel.json`          | `deployment.release.cancel`       | A rollout stopped in flight, authorized and justified                      |
| `rollback-emergency.json`      | `deployment.release.rollback`     | An emergency rollback executed while its approval was still `pending`      |
| `infrastructure-apply.json`    | `deployment.infrastructure.apply` | Automation as `actor` and the change's author as `subject`                 |
| `configuration-update.json`    | `configuration.setting.update`    | An approved configuration change with sanitized before and after values    |
| `secret-rotate-emergency.json` | `configuration.secret.rotate`     | A rotation that records the changed field name and never the secret        |
| `change-request-approve.json`  | `change.request.approve`          | The change record whose identifier ties the whole sequence together        |

Two of these produce a `DEPLOY-CORE-003` **warning** for a missing `/metadata/deployment/pipelineId`:
`configuration-update.json`, a change made by an administrator from a console, and
`change-request-approve.json`, an approval recorded in a change management system. Neither came from
a pipeline, so neither has a pipeline identifier. That is exactly why the field is recommended rather
than required, and a warning never fails conformance.

`deploy-automated.json` also shows why the target environment is recorded separately from the core
`application.environment`: the delivery platform runs in `production` and deploys into `staging` on
the same event.

## Invalid fixtures

Each removes exactly one profile-required value from a valid fixture, so it fails for one documented
reason. A test asserts both the rule and the pointer, and that **exactly one** error is produced.

| File                                              | Derived from                   | Violates               | At                                      |
| ------------------------------------------------- | ------------------------------ | ---------------------- | --------------------------------------- |
| `deploy-missing-deployment-id.json`               | `deploy-automated.json`        | `DEPLOY-CORE-001`      | `/metadata/deployment/id`               |
| `deploy-missing-environment.json`                 | `deploy-automated.json`        | `DEPLOY-CORE-001`      | `/metadata/deployment/environment`      |
| `deploy-missing-approval-required.json`           | `deploy-automated.json`        | `DEPLOY-CORE-002`      | `/metadata/deployment/approvalRequired` |
| `deploy-missing-version.json`                     | `deploy-automated.json`        | `DEPLOY-RELEASE-001`   | `/metadata/deployment/version`          |
| `deploy-missing-previous-version.json`            | `deploy-automated.json`        | `DEPLOY-RELEASE-002`   | `/metadata/deployment/previousVersion`  |
| `cancel-missing-authorization.json`               | `release-cancel.json`          | `DEPLOY-REVERT-001`    | `/authorization`                        |
| `cancel-missing-reason.json`                      | `release-cancel.json`          | `DEPLOY-REVERT-001`    | `/reason`                               |
| `configuration-update-missing-authorization.json` | `configuration-update.json`    | `DEPLOY-CONFIG-001`    | `/authorization`                        |
| `secret-rotate-missing-changed-fields.json`       | `secret-rotate-emergency.json` | `DEPLOY-CONFIG-001`    | `/change/changedFields`                 |
| `secret-rotate-missing-reason.json`               | `secret-rotate-emergency.json` | `DEPLOY-EMERGENCY-001` | `/reason`                               |
| `change-request-approve-missing-approval.json`    | `change-request-approve.json`  | `DEPLOY-APPROVAL-001`  | `/approval/status`                      |
| `deploy-approved-missing-approval.json`           | `deploy-approved.json`         | `DEPLOY-APPROVAL-002`  | `/approval/status`                      |
| `deploy-failed-missing-resulting-state.json`      | `deploy-failed.json`           | `DEPLOY-FAILURE-001`   | `/metadata/deployment/resultingState`   |
| `deploy-partial-missing-resulting-state.json`     | `deploy-partial.json`          | `DEPLOY-FAILURE-002`   | `/metadata/deployment/resultingState`   |

Every enforceable rule in the profile has at least one negative fixture here.
`DEPLOY-CORE-003` and `DEPLOY-AUTOMATION-001` have none, because a warning cannot fail conformance
and a fixture that failed nothing would prove nothing.

The `cancel-*` fixtures start from `release-cancel.json` rather than from `rollback-emergency.json`
even though both are governed by `DEPLOY-REVERT-001`. Removing `/reason` from the emergency rollback
would break two rules at once — `DEPLOY-REVERT-001` and `DEPLOY-EMERGENCY-001` — and a negative
fixture that fails for two reasons cannot show which rule it is testing.

## Not-applicable fixtures

| File                    | Event                         | Why it is out of scope                                   |
| ----------------------- | ----------------------------- | -------------------------------------------------------- |
| `pipeline-poll.json`    | `deployment.pipeline.poll`    | A runner asking whether there is work; nothing changed   |
| `build-log-append.json` | `deployment.build.log-append` | Build output; a build produces an artifact, not a change |
| `secret-access.json`    | `configuration.secret.access` | A workload reading the credential it starts with         |

`check-profile` reports each as not applicable with exit code 3. That is not conformance — it says
the profile had nothing to say about the event.

They exist to hold the exclusions in place. If a future edit widened a selector to a bare
`deployment.` or `configuration.secret.` prefix, these fixtures would start being checked instead of
skipped and the test would fail. That is the point: such an edit would silently impose a change
identifier, a target environment and an approval-policy flag on every poll, every build log line and
every process start in a deployment.

## Vendor neutrality

No fixture names a real product, company, cloud, pipeline tool, orchestrator, version control system,
jurisdiction or regulation. Environments, version strings, pipeline identifiers, policy names and
change record identifiers are illustrative strings, not any organization's scheme. The profile
requires none of them to take a particular form, and `production` appears only as an example value.

## Privacy

No fixture contains a credential, token, key, connection string, endpoint, commit hash, email address
or personal name. The secret rotation records `change.changedFields: ["secret"]` and nothing else
about the secret, which is the disclosure the profile asks for and the whole of it.
