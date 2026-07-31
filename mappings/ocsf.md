# OCSF Mapping

**Status: Informative. OCSF support is an OPTIONAL export mapping.**

The Open Cybersecurity Schema Framework standardizes **security telemetry**: authentication,
process activity, network activity, findings, and related classes consumed by security operations.

OpenAuditModel standardizes **business application audit**. The two overlap where a business
operation is also a security event, and diverge everywhere else.

## 1. What OCSF is for

OCSF is designed around the needs of a security operations centre: normalizing detections and
telemetry from many products into shared classes so that analytics work across sources.

That is a different problem from recording that a contract was shared with an external counterparty
under an approved justification. Both are audit data; only one is security telemetry.

## 2. Classes that map naturally

These OpenAuditModel events correspond closely to established OCSF activity classes, and an export
mapping is straightforward:

| OpenAuditModel                                                | OCSF area                            |
| ------------------------------------------------------------- | ------------------------------------ |
| `authentication.login`, `authentication.logout`               | Authentication                       |
| `authentication.factor.*`                                     | Authentication                       |
| Events with `authorization.decision`                          | Authorization / access decision      |
| `identity.user.*`, `identity.role.*`, `identity.permission.*` | Account and entitlement management   |
| `identity.session.impersonate`, `privileged.*`                | Privileged access                    |
| `data.record.read`, `document.file.download`                  | Data access, where security-relevant |
| `configuration.setting.update` on security settings           | Configuration and control changes    |

Field-level correspondences that generally hold:

| OpenAuditModel      | OCSF concept                |
| ------------------- | --------------------------- |
| `time`              | event time                  |
| `actor`             | actor / user                |
| `resource`          | resource or affected entity |
| `event.outcome`     | status                      |
| `event.error.code`  | status detail               |
| `application`       | metadata product / device   |
| `request.ipAddress` | source endpoint             |
| `request.traceId`   | correlation identifier      |

## 3. Concepts requiring extensions or partial mapping

These OpenAuditModel concepts have no direct OCSF equivalent, because they describe **business
process**, not security telemetry:

| Concept                          | Why it does not map                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `approval`                       | Human approval workflows, approvers and thresholds are not security telemetry                                                      |
| Workflow state                   | Case and request lifecycle is a business process                                                                                   |
| `reason`                         | Business justification has no security-telemetry analogue                                                                          |
| `change.before` / `change.after` | Field-level business state, with privacy constraints                                                                               |
| `evidence`                       | References to business records rather than detection artifacts                                                                     |
| `delegation`                     | Partially expressible; the distinction between impersonation, on-behalf-of and delegated is finer than most security schemas carry |
| `controlCategories`              | Governance framing rather than detection framing                                                                                   |
| `privacy`                        | Describes the record's own personal-data character                                                                                 |
| `integrity`                      | Per-event tamper-evidence for the audit record itself                                                                              |

Exporters SHOULD carry these through an OCSF extension rather than forcing them into unrelated
fields. Mapping `approval.status` onto a status enumeration that means something else produces data
that is worse than absent, because it looks correct.

## 4. Direction and granularity

- The mapping is **OpenAuditModel to OCSF**, for feeding security analytics.
- Not every OpenAuditModel event should be exported. A workflow stage advance is audit data and is
  not security telemetry; exporting it adds volume without adding detection value.
- Exporters SHOULD select by `event.category` and `controlCategories` rather than exporting
  everything.
- The original event SHOULD be retained. An OCSF document produced from this mapping is not
  convertible back into a conforming OpenAuditModel event.

## 5. Why not simply use OCSF

Because most of what a business application must record is not security telemetry, and because OCSF
does not impose the requirements this specification exists to impose: that a failure carries a
sanitized error, that acting for a principal identifies that principal, that core objects reject
unknown properties, and that a validator can prove it.

OpenAuditModel is not a replacement for OCSF, and does not attempt to model detections, findings,
network telemetry or process activity. Where an event is genuinely security telemetry, OCSF is the
better destination — reached, where useful, through this mapping.
