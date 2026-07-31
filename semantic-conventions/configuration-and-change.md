# Configuration and Change Events

**Specification version: 0.1 · Status: Experimental**

Categories: `configuration`, `deployment`

## 1. Recommended event names

### Configuration

| Name                             | Operation                        |
| -------------------------------- | -------------------------------- |
| `configuration.setting.create`   | A setting was introduced         |
| `configuration.setting.update`   | A setting was changed            |
| `configuration.setting.delete`   | A setting was removed            |
| `configuration.secret.rotate`    | A secret was replaced            |
| `configuration.secret.access`    | A secret was read by a principal |
| `configuration.feature.toggle`   | A feature flag was switched      |
| `configuration.policy.update`    | A policy definition was changed  |
| `configuration.retention.update` | A retention rule was changed     |

### Deployment and release

| Name                              | Operation                             |
| --------------------------------- | ------------------------------------- |
| `deployment.release.create`       | A release was prepared                |
| `deployment.release.approve`      | A release was approved for deployment |
| `deployment.release.deploy`       | A release was deployed                |
| `deployment.release.rollback`     | A deployment was reverted             |
| `deployment.infrastructure.apply` | An infrastructure change was applied  |

### Change management

| Name                     | Operation                     |
| ------------------------ | ----------------------------- |
| `change.request.create`  | A change request was raised   |
| `change.request.approve` | A change request was approved |
| `change.request.reject`  | A change request was refused  |
| `change.request.close`   | A change request was closed   |

## 2. Configuration changes are high-value audit events

Configuration is where controls are switched off. A change to session lifetime, a retention rule, an
audit destination or a policy version can undo every other control in the system, and it usually
leaves no trace in business data.

Producers SHOULD:

- Record every change to security-relevant configuration, including failed attempts.
- Set `event.severity` to `high` or `critical` for production security configuration.
- Include `configuration-integrity` in `controlCategories`, and `change-approval` where approval
  applies.
- Record `application.environment` accurately. The same change is routine in `development` and
  critical in `production`.

## 3. Before and after

Configuration is the case where before and after values are usually both safe and necessary — a
reviewer needs to know that session lifetime went from 720 minutes to 60, not merely that it changed.

Nonetheless:

- Record only the settings that changed, named in `change.changedFields`.
- MUST NOT record secret values. A secret rotation records `changedFields: ["secret"]` and nothing
  more. See [change-model.md](../specification/change-model.md) §5.
- Where a setting's value is itself sensitive — an allowlist of addresses, an internal endpoint —
  record a hash or omit the value.

## 4. Correlating change to authorization

The three questions matter most here:

| Field             | Records                                       |
| ----------------- | --------------------------------------------- |
| `authorization`   | The policy decision that permitted the change |
| `approval`        | The human decision that sanctioned it         |
| `change.ticketId` | The change record it was performed under      |
| `reason`          | Why it was needed                             |

An emergency change with `approval.status` of `pending` and a successful outcome is a control bypass.
Producers MUST record it accurately rather than suppressing it, and SHOULD record the justification in
`reason`. That combination is exactly what a post-incident review looks for.

## 5. Deployments

`deployment.release.deploy` describes what was deployed, where, and from which source:

```json
{
  "resource": { "type": "deployment", "id": "deployment-2026-03-16-3" },
  "relatedResources": [{ "type": "service", "id": "service-checkout" }],
  "application": { "name": "delivery-service", "environment": "production" },
  "change": {
    "type": "execute",
    "deploymentId": "deployment-2026-03-16-3",
    "ticketId": "change-9910"
  },
  "metadata": { "sourceRevision": "9f2a4c1", "releaseVersion": "9.0.3", "strategy": "rolling" }
}
```

`application` describes the system that **performed** the deployment. The deployed service is a
resource. Producers routinely get this backwards.

Rollbacks SHOULD reference the deployment being reverted in `metadata`, so that the pair can be found
together.

## 6. Secret access

`configuration.secret.access` records that a principal read a secret. It MUST NOT record the secret,
any part of it, or a hash of it that would allow verification against a guess.

Where secret access is routine for a workload, producers SHOULD consider whether recording every read
is useful, or whether recording grants, rotations and out-of-pattern access is more valuable. Volume
that nobody reviews is not a control.

## 7. Example

See
[examples/valid/privileged-configuration-change.json](../examples/valid/privileged-configuration-change.json)
for a complete privileged configuration change with approval, sanitized before and after values, and
an integrity chain entry.
