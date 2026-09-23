# Compatibility corpus

Events written under an earlier specification version, kept so that the tooling is held to reading
them. See [ADR 0017](../../decisions/0017-versioning-and-compatibility.md).

## `v0.1/integrity/`

The integrity fixtures exactly as tooling 0.6.0 published them: events sealed with
`"specVersion": "0.1"`, the chains built from them, the checkpoints and proofs over those chains, and
the test keys they were signed with.

They are here because they cannot be anywhere else. `specVersion` is inside the digest, so a sealed
0.1 event cannot be migrated to 1.0 without being sealed again — and an archive keeps what was
sealed. The 1.x tooling therefore has to go on verifying 0.1 events for as long as the 1.x line
lasts, and `conformance/tests/compatibility.test.ts` holds it to that: every event digest and
signature here verifies, every intact chain stays intact, every damaged one stays broken, the
checkpoint still agrees and still catches the truncated chain, and the proof still verifies.

**Nothing regenerates this directory.** `npm run fixtures:integrity` writes `examples/integrity/`,
which is 1.0. A test fails if any event here stops declaring 0.1.

The `README.md` inside `v0.1/integrity/` is the one published with these fixtures in 0.6.0, with a
banner added at the top and its links repointed to where the files now are. Below the banner it
describes them as they were then.

## The rest of the published fixtures

Every other published fixture is validated twice by the same test, declaring 0.1 and declaring 1.0,
and must be judged the same way both times, except where it uses `request.parentSpanId`, which 0.1
does not have. That is ADR 0017 §5 in behavioural form: 1.0 is 0.1 with a new version number and
one optional field.
