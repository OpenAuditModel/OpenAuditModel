# Invalid examples

**Status: Informative.**

Every file in this directory MUST fail validation against the
[OpenAuditModel Audit Event Schema](../../schemas/v0.1/audit-event.schema.json). Each file is
otherwise a realistic, well-formed event with exactly one defect, so that a validator can be checked
for the precise error it reports rather than only for pass or fail.

The expectations below are asserted by
[`conformance/tests/invalid-examples.test.ts`](../../conformance/tests/invalid-examples.test.ts). If
a schema change alters any of these outcomes, the test fails and the change must be reviewed as a
compatibility question.

| File                                                               | Defect                                               | Expected error location | Failing keyword        |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------- | ---------------------- |
| [missing-actor.json](missing-actor.json)                           | No `actor`                                           | `/actor`                | `required`             |
| [missing-resource.json](missing-resource.json)                     | No `resource`                                        | `/resource`             | `required`             |
| [invalid-event-name.json](invalid-event-name.json)                 | `Document.Share.Create` is not lower-case            | `/event/name`           | `pattern`              |
| [failure-without-error.json](failure-without-error.json)           | `outcome` is `failure` but `error` is absent         | `/event/error`          | `required`             |
| [delegation-without-subject.json](delegation-without-subject.json) | `delegation.type` is `on-behalf-of` but no `subject` | `/subject`              | `required`             |
| [invalid-extension-name.json](invalid-extension-name.json)         | `clusterId` is not a reverse-domain key              | `/extensions/clusterId` | `propertyNames`        |
| [unknown-core-property.json](unknown-core-property.json)           | `actor.department` is not a core property            | `/actor/department`     | `additionalProperties` |

## Notes on the conditional failures

`failure-without-error.json` and `delegation-without-subject.json` fail through `if`/`then`
conditions rather than a plain `required` list. A validator reports both the conditional keyword and
the specific missing property; the table above lists the specific property, because that is what an
implementer needs to act on.

## What these examples are not

These files are not a complete negative test suite. Schema validation cannot detect a leaked secret,
a misused event name, or a `subject` that was populated with a target resource. Those failures are
addressed by [privacy.md](../../specification/privacy.md),
[event-naming.md](../../semantic-conventions/event-naming.md) and
[actor-model.md](../../specification/actor-model.md), and by review — not by the validator.
