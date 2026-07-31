# API and integration management profile fixtures

**Status: Informative.** These fixtures illustrate and regression-test the
[api-and-integration-management profile](../../../profiles/api-and-integration-management/). The
rules themselves are in
[profile.json](../../../profiles/api-and-integration-management/profile.json).

```bash
auditmodel check-profile examples/profiles/api-and-integration-management/valid --profile api-and-integration-management
```

Every fixture here — valid, invalid and not-applicable alike — is a **core-conforming** event. The
ones under `invalid/` fail the profile, not the core schema. That separation is the point: a profile
adds requirements to events the core already accepts.

## The guarantee these fixtures carry

Each file under `valid/` must satisfy all three commands, and a test enforces it:

```bash
auditmodel validate      examples/profiles/api-and-integration-management/valid
auditmodel lint-privacy  examples/profiles/api-and-integration-management/valid
auditmodel check-profile examples/profiles/api-and-integration-management/valid --profile api-and-integration-management
```

A profile that accepted an event the core rejects would break the core invariant. A profile about
API credentials that accepted an event carrying one would be worse than no profile.

## Valid fixtures

| File                                    | Event                              | Demonstrates                                                       |
| --------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `api-key-create.json`                   | `api-key.create`                   | Issuance by a person: authentication context, scope and expiry     |
| `api-key-rotate.json`                   | `api-key.rotate`                   | Machine rotation — `actor.type` is `service`, so no session is due |
| `api-key-revoke.json`                   | `api-key.revoke`                   | Withdrawal with a justification and a recorded approval            |
| `webhook-create.json`                   | `webhook.create`                   | A destination classified, not a callback URL recorded              |
| `webhook-update.json`                   | `webhook.update`                   | Reconfiguration carrying `/change` and changed field names         |
| `webhook-disable.json`                  | `webhook.disable`                  | Disablement during an outage, justified                            |
| `webhook-test.json`                     | `webhook.test`                     | A connectivity check — governed, but nothing is withdrawn          |
| `integration-connect.json`              | `integration.connect`              | Locally declared approval requirement, satisfied                   |
| `integration-disconnect.json`           | `integration.disconnect`           | An `admin` actor, exercising the second authentication rule        |
| `integration-configuration-update.json` | `integration.configuration.update` | A prefix-selected settings change carrying `/change`               |
| `integration-sync-start.json`           | `integration.sync.start`           | A workflow step carrying the correlation identifier                |
| `integration-sync-cancel.json`          | `integration.sync.cancel`          | Manual override of a running sync, justified                       |
| `integration-reauthorize-failure.json`  | `integration.reauthorize`          | A failure classified beyond its code                               |

Three of these — `api-key-rotate.json`, `webhook-test.json` and `integration-sync-start.json` —
produce an `INTEGRATION-CORE-002` **warning** for a missing `/approval`. That is intentional: a
scheduled rotation, a connectivity check and a nightly sync have no approval to record, and the
profile recommends rather than requires one. A warning never fails conformance.

The other ten record `approval: { "status": "not-required" }` or a real approval. That is the
recommended shape: it answers the reviewer's question instead of leaving a hole where the answer
would be.

## Invalid fixtures

Each removes exactly one profile-required value from a valid fixture, so it fails for one documented
reason. A test asserts both the rule and the pointer, and that **exactly one** error is produced.

| File                                                          | Violates                 | At                                          |
| ------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| `api-key-create-missing-authorization.json`                   | `INTEGRATION-CORE-001`   | `/authorization`                            |
| `webhook-create-missing-type.json`                            | `INTEGRATION-CORE-001`   | `/metadata/integration/type`                |
| `integration-connect-missing-approval-status.json`            | `INTEGRATION-CORE-003`   | `/approval/status`                          |
| `api-key-create-missing-authentication.json`                  | `INTEGRATION-AUTHN-001`  | `/authentication`                           |
| `integration-disconnect-missing-authentication.json`          | `INTEGRATION-AUTHN-002`  | `/authentication`                           |
| `api-key-rotate-missing-credential-reference.json`            | `INTEGRATION-KEY-001`    | `/metadata/integration/credentialReference` |
| `webhook-disable-missing-reason.json`                         | `INTEGRATION-REVOKE-001` | `/reason`                                   |
| `webhook-create-missing-endpoint-class.json`                  | `INTEGRATION-HOOK-001`   | `/metadata/integration/endpointClass`       |
| `webhook-update-missing-change.json`                          | `INTEGRATION-CONFIG-001` | `/change`                                   |
| `integration-configuration-update-missing-connection-id.json` | `INTEGRATION-CONN-001`   | `/metadata/integration/connectionId`        |
| `integration-sync-start-missing-correlation-id.json`          | `INTEGRATION-FLOW-001`   | `/request/correlationId`                    |
| `integration-reauthorize-missing-error-type.json`             | `INTEGRATION-FAIL-001`   | `/event/error/type`                         |

Two of these are worth reading closely.

`integration-connect-missing-approval-status.json` keeps the `/approval` object and removes only its
`status`. Deleting the whole object would fail two required paths and the fixture would stop showing
which one it tests.

`api-key-create-missing-authentication.json` and `integration-disconnect-missing-authentication.json`
remove the same field and fail different rules. The first has `actor.type: "user"` and fails
`INTEGRATION-AUTHN-001`; the second has `actor.type: "admin"` and fails `INTEGRATION-AUTHN-002`. The
two rules exist separately because the v0.1 rule language allows one equality condition per rule and
no disjunction, and this pair is what keeps both halves of that workaround honest.

Several invalid fixtures also produce warnings — `webhook-update-missing-change.json` loses its
recommended `changedFields` along with `/change`, and `webhook-disable-missing-reason.json` trips
both the requirement and the recommendation for `/reason`. Warnings are not violations, and the test
counts only errors.

## Not-applicable fixtures

| File                             | Event                       | Why it is not governed                           |
| -------------------------------- | --------------------------- | ------------------------------------------------ |
| `api-request.json`               | `api.request`               | An ordinary data-plane API call                  |
| `webhook-delivery.json`          | `webhook.delivery.attempt`  | A successful delivery, including any retry of it |
| `integration-sync-progress.json` | `integration.sync.progress` | A per-page progress event from a polling sync    |

`check-profile` reports each with exit code 3.

These exist to hold the exclusion in place. Every selector in the profile is an exact event name or
the single narrow prefix `integration.configuration.`; if a future edit widened one to a bare
`api-key.`, `webhook.` or `integration.` prefix, these fixtures would start conforming instead of
being skipped, and the test would fail — which is the point, because that edit would silently impose
an authorization decision and an integration classification on every request, delivery and poll in a
deployment.

## Vendor neutrality

No fixture names a real product, company, jurisdiction or regulation. Providers are logical
placeholders (`partner-billing-platform`, `partner-crm-platform`, `partner-logistics-platform`),
policies and integration types are illustrative strings, and no identifier resolves to anything.

No fixture contains an API key, an access or refresh token, a client secret, a webhook signing
secret, an authorization header or a callback URL — not even a fake one. `credentialReference` values
are opaque handles, and destinations appear only as an `endpointClass`. That is the shape the profile
exists to encourage, so the examples have to show it.
