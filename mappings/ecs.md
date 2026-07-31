# ECS Mapping

**Status: Informative and initial. ECS support is an OPTIONAL export mapping.**

The Elastic Common Schema is a field vocabulary for indexing and searching events. Exporting
OpenAuditModel events into ECS makes them searchable alongside infrastructure and security data.

This is an **export** mapping: OpenAuditModel to ECS. See
[mappings/README.md](README.md) on why the reverse direction is lossy.

## 1. Initial field mapping

| OpenAuditModel            | ECS field                           | Notes                                               |
| ------------------------- | ----------------------------------- | --------------------------------------------------- |
| `id`                      | `event.id`                          |                                                     |
| `time`                    | `@timestamp`                        |                                                     |
| `observedTime`            | `event.ingested`                    |                                                     |
| `event.name`              | `event.action`                      | See §2                                              |
| `event.category`          | `event.category`                    | ECS `event.category` is a closed vocabulary; see §2 |
| `event.type`              | `event.type`                        | ECS `event.type` is also closed                     |
| `event.outcome`           | `event.outcome`                     | ECS permits `success`, `failure`, `unknown`; see §3 |
| `event.severity`          | `event.severity`                    | ECS expects a number; see §3                        |
| `event.summary`           | `message`                           |                                                     |
| `event.error.code`        | `error.code`                        |                                                     |
| `event.error.message`     | `error.message`                     |                                                     |
| `actor.id`                | `user.id`                           | For `actor.type` of `user` or `admin`               |
| `actor.displayName`       | `user.name`                         |                                                     |
| `actor.roles`             | `user.roles`                        |                                                     |
| `actor.id`                | `service.name`                      | For `actor.type` of `service`                       |
| `subject.id`              | `user.target.id`                    | Approximate; see §4                                 |
| `resource.id`             | `event.reference` or a custom field | ECS has no general resource concept; see §4         |
| `application.name`        | `service.name`                      | Conflicts with service actors; see §4               |
| `application.version`     | `service.version`                   |                                                     |
| `application.environment` | `service.environment`               |                                                     |
| `application.instance`    | `service.node.name`                 |                                                     |
| `request.traceId`         | `trace.id`                          |                                                     |
| `request.spanId`          | `span.id`                           |                                                     |
| `request.requestId`       | `http.request.id`                   | Where the request was HTTP                          |
| `request.ipAddress`       | `client.ip`                         |                                                     |
| `request.userAgent`       | `user_agent.original`               |                                                     |
| `request.method`          | `http.request.method`               |                                                     |
| `request.route`           | `url.path`                          | Route template, not a resolved URL                  |
| `organization.tenantId`   | `organization.id`                   | Approximate                                         |
| `tags`                    | `tags`                              |                                                     |

## 2. Vocabulary collisions

ECS `event.category` and `event.type` are **closed** vocabularies with their own defined values.
OpenAuditModel `event.category` is an open vocabulary with different members.

Exporters MUST NOT write an OpenAuditModel category into ECS `event.category` verbatim. They SHOULD:

- Map to the nearest ECS category, for example OpenAuditModel `identity` to ECS `iam`.
- Carry the OpenAuditModel value in a custom field so that nothing is lost.
- Write the full OpenAuditModel event name to `event.action`, which is a free field.

## 3. Outcome and severity

- ECS `event.outcome` has no equivalent for `partial`. Exporters SHOULD map `partial` to `failure`
  and carry the true value in a custom field, because silently mapping it to `success` misrepresents
  the operation.
- ECS `event.severity` is numeric. The mapping from OpenAuditModel's ordinal scale is
  exporter-defined, and the caveat in
  [opentelemetry.md](opentelemetry.md) §3 applies: audit significance is not log severity.

## 4. Structural mismatches

| Problem                             | Why it does not map cleanly                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `resource`                          | ECS has no general "thing acted upon". Closest equivalents are domain-specific (`file.*`, `user.target.*`) |
| `application.name` vs service actor | Both want `service.name`. Exporters MUST choose one and document it; `application.name` is recommended     |
| `subject`                           | `user.target.*` means "the user acted upon", which is closer to `resource` than to `subject`               |
| `actor.type`                        | ECS distinguishes user, service and host as separate field sets rather than a type discriminator           |

## 5. Concepts with no ECS representation

These OpenAuditModel concepts have **no ECS equivalent** and require custom fields:

- `subject` and `delegation` — acting on behalf of another principal
- `authorization` — decision, policy, policy version, permissions
- `approval` — status, approvers, thresholds, timestamps
- `reason` — business justification
- `change` — changed fields, before and after state, hashes
- `evidence` — references, hashes, retention, legal hold
- `integrity` — canonicalization, hashes, chains, signatures
- `privacy` — personal data categories, processing, retention class
- `controlCategories`
- `specVersion`

An exporter SHOULD carry these under a single namespaced object rather than inventing top-level
fields, and SHOULD retain the complete original event so that the audit record can be validated and
verified after export.

## 6. Round-tripping

An ECS document produced by this mapping cannot be converted back into a conforming OpenAuditModel
event unless the original event was retained. The fields in §5 have no source to come from, and
inventing them would produce audit data asserting more than was observed.

Where both representations are needed, retain the original event.
