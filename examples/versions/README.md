# Version selection fixtures

**Status: Informative.** These fixtures show what a validator does with the version an event
declares ([ADR 0017](../../decisions/0017-versioning-and-compatibility.md) §3). The conformance kit
records the expected answer for each, so an implementation in another language can check that it
selects the schema by the declared version instead of validating everything against the newest one.

| Fixture                                                  | Declares | Expected                                                                           |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| [valid-under-0.1.json](valid-under-0.1.json)             | `0.1`    | Valid, judged by the 0.1 schema                                                    |
| [parent-span-under-1.0.json](parent-span-under-1.0.json) | `1.0`    | Valid: `request.parentSpanId` exists from 1.0                                      |
| [parent-span-under-0.1.json](parent-span-under-0.1.json) | `0.1`    | Invalid: the 0.1 schema does not know `request.parentSpanId`                       |
| [newer-minor.json](newer-minor.json)                     | `1.1`    | Not evaluated — one issue at `/specVersion`, keyword `specVersion-not-implemented` |
| [other-major.json](other-major.json)                     | `2.0`    | Not evaluated, as above                                                            |
| [never-published.json](never-published.json)             | `0.2`    | Not evaluated, as above: a well-formed version that was never published            |
| [malformed-version.json](malformed-version.json)         | `v1.0`   | Invalid: not of the form `MAJOR.MINOR`, so judged by the current schema's `const`  |
| [leading-zero-version.json](leading-zero-version.json)   | `01.0`   | Invalid, as above: a number with a leading zero is not of the form                 |

"Not evaluated" is neither valid nor invalid. A validator reports it as the version not being one it
implements; `auditmodel validate` prints it as `SKIP` and exits 3 when nothing else failed.
