# Examples

**Status: Informative.** Examples illustrate the model; they are not normative and they do not
extend or restrict the [OpenAuditModel Core Specification](../specification/overview.md).

Every file in [valid/](valid/) MUST validate against the
[OpenAuditModel Audit Event Schema](../schemas/v0.1/audit-event.schema.json). Every file in
[invalid/](invalid/) MUST fail validation, each for a single documented reason. Both properties are
enforced by the conformance test suite, so the examples act as regression fixtures rather than
decoration.

## Validating the examples

```bash
npm run build
node dist/conformance/src/cli.js validate examples/valid
node dist/conformance/src/cli.js validate examples/invalid   # expected to exit 1
```

## Valid examples

| File                                                                               | Event                             | Demonstrates                                                                        |
| ---------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| [minimal-event.json](valid/minimal-event.json)                                     | `data.record.update`              | The seven required fields and nothing else                                          |
| [user-role-assignment.json](valid/user-role-assignment.json)                       | `identity.role.assign`            | Administrative action with authorization, approval, reason, change and organization |
| [document-external-share.json](valid/document-external-share.json)                 | `document.share.create`           | External sharing with authentication, privacy, control categories and an extension  |
| [incident-case-close.json](valid/incident-case-close.json)                         | `incident.case.close`             | Workflow closure with approvals, evidence references and trace correlation          |
| [privileged-configuration-change.json](valid/privileged-configuration-change.json) | `configuration.setting.update`    | Privileged change with sanitized before and after state and an integrity chain      |
| [kafka-consumer-offset-reset.json](valid/kafka-consumer-offset-reset.json)         | `kafka.consumer.offset-reset`     | Message broker operation with related resources and offsets, without payloads       |
| [service-account-data-export.json](valid/service-account-data-export.json)         | `data.export.create`              | Service actor acting on behalf of a user subject, with privacy context              |
| [order-api-publish.json](valid/order-api-publish.json)                             | `order.submission.accept`         | HTTP entry point establishing request, trace and correlation identifiers            |
| [order-consumer-new-trace.json](valid/order-consumer-new-trace.json)               | `order.fulfilment.start`          | Message consumer starting a new trace while keeping the business correlation        |
| [nightly-reconciliation-job.json](valid/nightly-reconciliation-job.json)           | `billing.reconciliation.complete` | Scheduled job correlated by job run, with no request or trace context               |
| [access-request-approval.json](valid/access-request-approval.json)                 | `iam.access-request.approve`      | Approval workflow where request and approval identifiers coexist                    |

None of these examples name a real product, company, jurisdiction or regulation. Domain names used
in example values are drawn from the ranges reserved for documentation by RFC 2606.

## Invalid examples

Each invalid example is a realistic event that has exactly one defect, so that a validator's output
can be checked precisely. See [invalid/README.md](invalid/README.md) for the expected failure of
each file.

## Integrity fixtures

[integrity/](integrity/) holds a separate, **generated** fixture set for tamper-evidence
verification: sealed events, a linked chain, and events that have been modified, re-linked,
re-sequenced or relabelled. Every one of them is a schema-valid event — they fail verification, not
validation, which is why they live apart from the sets above. See
[integrity/README.md](integrity/README.md).

```bash
node dist/conformance/src/cli.js verify-integrity examples/integrity/valid/single-event-sha256.json
node dist/conformance/src/cli.js verify-chain examples/integrity/valid/three-event-chain
```

## Optional fields are optional

`minimal-event.json` is deliberately small. An event is not "better" because it fills more fields.
Producers SHOULD populate the fields their audit purpose requires and omit the rest; see
[design-principles.md](../specification/design-principles.md).
