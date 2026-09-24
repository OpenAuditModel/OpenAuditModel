# 0017 — Versioning and compatibility from 1.0

## Status

Accepted — 2026-09-23. Introduces specification version 1.0. Implemented in tooling 1.0.0.

## Context

[overview.md](../specification/overview.md) §6.2 held back three decisions until after v0.1 and
said they would be made in an architecture decision record: what replaces the `const` on
`specVersion`, which changes are compatible, and what a consumer does with a version newer than it
knows. It also said implementations MUST NOT assume any strategy until then. That was the right
posture while the model was experimental and exactly one version existed. It cannot survive a 1.0:
the promise of a 1.0 is that the schema at its address will not change, and a promise about the
future needs rules for the future.

Three facts shaped the choices.

- **The schema is closed.** The root and every object in it declare `additionalProperties: false`.
  A property the schema does not know is an error, which is what keeps misspelled and invented
  fields out of audit records. It also means a schema can only judge events written for it: an
  event carrying a field added in a later version fails an earlier schema on that field alone.
- **The digest covers `specVersion`.** [integrity.md](../specification/integrity.md) §4 excludes
  only `/integrity/hash` and `/integrity/signature` from the digest input, so rewriting a sealed
  event's version breaks its seal. Whatever the rules say, a sealed event keeps the version it was
  sealed with.
- **Published addresses are permanent.** [ADR 0010](0010-official-domain-and-canonical-identifiers.md)
  §3 serves every published schema path forever. A version, once published, is published for good,
  which is why there is no 0.2: a rehearsal nobody consumed would have been an address kept forever
  for nothing.

## Decision

### 1. A version is `MAJOR.MINOR`, and each has its own schema

`specVersion` is a string of the form `MAJOR.MINOR`: two non-negative decimal integers joined by a
full stop, each written without a leading zero (`0|[1-9][0-9]*`). `"1.0"`, `"0.1"` and `"1.10"` are
of the form; `"01.0"`, `"1.00"`, `"1"`, `"v1.0"` and the number `1.0` are not. 1.0 is the first
stable version. Each
published version has its own schema at its own permanent address, and that schema fixes
`specVersion` to its own value with `const`:

```text
https://openauditmodel.org/schemas/audit-event/0.1/schema.json   specVersion: "0.1"
https://openauditmodel.org/schemas/audit-event/1.0/schema.json   specVersion: "1.0"
```

A validator selects the schema by the version the event declares. This keeps the `const`, which
§6.2 anticipated replacing with a range, and moves the choice to the validator instead. A schema
that accepted a range would judge a 1.1 event by 1.0's rules and report its new fields as errors;
with one schema per version, every verdict is reached against the rules the event says it follows.

### 2. What a minor version may change

Within a major version, a new minor may only:

- add an optional property, or a `$defs` entry that only optional properties use;
- add values to an open vocabulary, or examples to any property;
- raise an upper bound (`maxLength`, `maxItems`) or widen a pattern, where measurement shows the
  old bound refused real data.

Everything else needs a new major version: removing or renaming a property, changing its type,
making an optional property required, adding a required property, lowering a bound, narrowing a
pattern, closing an open vocabulary, and changing what a property or an event name means. The last
of these was already a rule — [event-model.md](../specification/event-model.md) §7.2 — and remains
one: a name whose meaning changes gets a new name, in any version.

So every event valid under `1.N` is valid under `1.M` for any `M ≥ N` once its `specVersion` says
`1.M`, and a consumer written for `1.N` can read a `1.M` event by ignoring the properties it does not
know.

### 3. What a consumer does with each version

| The event declares                                          | A consumer that implements it           | A consumer that does not  |
| ----------------------------------------------------------- | --------------------------------------- | ------------------------- |
| A version it implements                                     | Validates against that version's schema | —                         |
| A newer minor of a major it implements                      | —                                       | Does not evaluate it      |
| A major it does not implement, or a version never published | —                                       | Does not evaluate it      |
| No `specVersion`, or one not of the form `MAJOR.MINOR`      | Reports it non-conforming               | Reports it non-conforming |

"Does not evaluate" is a verdict of its own. A validator MUST NOT report such an event conforming,
because it has not checked it against the rules the event claims. It SHOULD NOT report it
non-conforming either, for the same reason in the other direction: its schema would reject the new
fields as unknown, and that says nothing about whether the event is correct. It reports that the
version is not one it implements and names the versions it does.

A consumer that only reads — one that stores, forwards or displays events — MAY accept a newer
minor of a major it implements, and MUST ignore the properties it does not know rather than reject
the event for them. It MUST NOT present the event as validated.

### 4. Which versions the tooling implements

The reference tooling of the 1.x line implements 0.1 and every 1.x minor published up to its own
release. 0.1 events stay readable and verifiable for as long as the 1.x line lasts: archives written
under 0.1 exist, and many of them are sealed. Producers SHOULD emit the newest version their
consumers implement, which today is 1.0.

### 5. What 1.0 changes relative to 0.1

Two things.

- **`specVersion` is `"1.0"`.**
- **`request.parentSpanId`**, optional, the W3C Trace Context identifier of the span that caused the
  one in `request.spanId`. Without it, a set of events sharing a trace can be ordered but not
  arranged into the tree of calls that produced them; with it, a consumer can tell which operation
  caused which. It is a pure addition of the kind §2 permits, and it has an immediate consumer in
  the viewer's Observed Flow.

Everything else in 0.1 is carried into 1.0 unchanged, deliberately. The open vocabularies stay open
and the array bounds stay where they are: closing a vocabulary is the one change that cannot be
undone in a minor version, and there is no evidence yet from any producer to close one on. So every
0.1-valid event is a 1.0-valid event once its `specVersion` says `"1.0"`. A sealed 0.1 event cannot
be migrated without being sealed again and SHOULD NOT be: an archive keeps what was sealed.

### 6. The other document formats

The checkpoint, inclusion proof and profile definition formats are versioned independently of the
event schema and keep their identifiers — `checkpoint/0.1`, `proof/0.1`, `profile-definition/0.1`.
From 1.0 the rules in §2 apply to them as well: a later version of a format only adds. Their numbers
do not mean they are less stable than the event schema; they mean each format has had one version so
far.

§3 does not carry over as it stands. Each format has one version, and the tooling reads that one. A
checkpoint or a proof declaring any other version is reported as a document the command cannot read,
with exit 2, rather than as not evaluated. That is also no verdict, which is what §3 requires of a
version the tool does not implement. The distinction becomes worth drawing when a format has a
second version.

## Consequences

- `schemas/v1.0/audit-event.schema.json` is published at
  `https://openauditmodel.org/schemas/audit-event/1.0/schema.json`. `schemas/v0.1/` is unchanged and
  stays published.
- Every command that validates selects the schema by the declared version. `validate` reports an
  event declaring a version the tool does not implement as not evaluated, and exits 3 when no event
  failed and at least one was not evaluated, since no verdict was produced.
- The other commands meet §3's MUST and not yet its SHOULD. They never pass such an event, but each
  counts it the way it counts a schema-invalid event: `verify-integrity`, `verify-proof` and
  `check-profile` fail it with exit 1, and name it as not evaluated; `lint-privacy` gives no verdict
  with exit 3, and names it too; `verify-chain` leaves it out of every chain, so a chain that ran
  through it reports a missing link; `verify-checkpoint` does not report its chain as agreeing, and
  says that some of its events could not be verified; `check-coverage` counts it as core-invalid and
  leaves it out of every count. Giving each of them a not-evaluated verdict of its own is a tooling
  change for a later 1.x release.
- Every profile is republished with `coreVersions: ["0.1", "1.0"]`, because a profile applies only
  to the core versions it names. The rules are unchanged, so every version number moves by one step
  and nothing else does.
- The published examples move to 1.0, because they are what producers copy. The sealed 0.1
  integrity fixtures are kept, exactly as 0.6.0 published them, as a compatibility corpus that a
  test holds to verifying. The same test holds every other published fixture to §5: declared as 0.1
  and declared as 1.0, it gets the same verdict, except where it uses `request.parentSpanId`, which
  0.1 does not have.

## Alternatives considered

**A range in one schema** (`"pattern": "^1\\.[0-9]+$"`). Rejected under §1: a closed schema would
reject a later minor's new properties and report the event non-conforming for being newer.

**Opening the schema to unknown properties**, so that one schema could accept later minors.
Rejected: `additionalProperties: false` is what catches a misspelled field in an audit record, and
an audit record whose fields are quietly misnamed is worse than one that fails validation.

**Validating a newer minor against the newest schema known**, reporting only the errors outside the
new properties. Rejected: the validator cannot tell a property added in 1.1 from one the producer
invented, so it would pass invented fields or fail genuine ones. Not evaluating is the answer that
does not guess.

**A 0.2 before 1.0.** Rejected in the release plan for the reason in the Context: a version nobody
consumes would be served forever for nothing.

## Security considerations

- A newer version is never read as permission. An event declaring a version the tool does not
  implement is neither conforming nor non-conforming; a pipeline that treats anything other than
  exit 0 as a failure keeps treating it as one.
- `specVersion` is inside the digest, so relabelling an event to a version that would be checked
  more leniently — or not at all — breaks its seal.
- Selecting the schema by a declared value lets a producer choose which rules it is judged by. It
  can only choose among published versions, each of which is itself a conforming model; the choice
  is visible in the event and covered by its digest.
