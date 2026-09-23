# Conformance kit

**Specification version: 1.0 · Status: Stable**

[ADR 0001](../decisions/0001-specification-first.md) promises that "an implementation in any language
can be checked against the same fixtures". The fixtures have always been published. What was missing
is what they are supposed to produce: that lived in twenty-two Node test files, which is not something
an implementer in another language can read a contract out of.

`manifest.json` is that contract, as data. For every published fixture it records the verdict each
applicable engine returns.

## What this kit does not claim

**It confers nothing.** There is no badge, no "compatible" status, no listing and no certification.
[overview.md](../specification/overview.md) §3.4 says conformance MUST NOT be presented as a
compliance statement, and a status this project handed out would be read as exactly that — by people
who would have no way to see it withdrawn.

An implementation that reproduces every verdict here has demonstrated one thing: that it answers the
same as the reference implementation, on the cases this project chose to publish. That is worth
having and it is not a claim about the implementation's fitness, completeness or correctness in
general.

**The corpus is not the world.** 366 fixtures, 7 chains, 8 checkpoint cases and 6 proof cases, chosen to cover the behaviour this
repository decided to pin. An implementation can pass all of them and still differ on an input nobody
here thought to write down.

## What is recorded

Rule identifiers, JSON Pointers, statuses, severities, confidences and finding kinds. Two
implementations that disagree about any of those disagree about conformance.

**Human-readable messages are deliberately absent.** An implementation that words an error
differently is not wrong, and a kit that compared prose would fail every translation and every
improvement to a sentence. The pointer says where; the rule identifier says which rule; the wording is
the implementation's own.

```jsonc
{
  "fixture": "examples/profiles/identity-and-access-management/invalid/privileged-role-without-mfa.json",
  "validate": { "valid": true, "notEvaluated": false, "issues": [] },
  "lintPrivacy": { "status": "clean", "findings": [] },
  "checkProfile": {
    "profile": "identity-and-access-management",
    "status": "violations",
    "matchedRules": ["IAM-CORE-001", "IAM-CORE-002", "IAM-ROLE-001", "IAM-ROLE-002"],
    "errors": [{ "ruleId": "IAM-ROLE-002", "path": "/authentication/mfa" }],
    "warnings": [],
  },
}
```

| Key               | Present for                                                   |
| ----------------- | ------------------------------------------------------------- |
| `validate`        | every fixture                                                 |
| `lintPrivacy`     | every fixture                                                 |
| `verifyIntegrity` | fixtures that declare an `integrity` object                   |
| `checkProfile`    | fixtures under `examples/profiles/<name>/`                    |
| `chains`          | directories verified as a set rather than per event           |
| `checkpoints`     | a checkpoint document compared with named archive directories |
| `proofs`          | a proof document verified against a named event               |

`verifyIntegrity` is recorded only where the fixture declares integrity material, because
`verify-integrity` reports "no integrity object" for everything else — a property of the command
rather than of the fixture.

A `checkpoints` record names a checkpoint document and the archive directories it was compared with,
and records the outcome, the finding kinds on the document itself, and per named chain its status and
comparison findings. The same document appears against several archives on purpose: the checkpoint
that agrees with `examples/integrity/valid/three-event-chain` is the one that reports
`examples/integrity/invalid/truncated-chain` as `tail-truncated` — while the `chains` record for
that same directory says `intact`. Both are right, and an implementation has to reproduce both.
Documents under `examples/integrity/checkpoints/` are not events and have no `fixtures` record.

A `proofs` record names a proof document and the event it was verified against, and records the
outcome, the finding kinds on the proof and its relation to the event, and the event's own
verification findings separately. The tree hashing an implementation must reproduce is RFC 6962's,
as the proof schema's description states. Documents under `examples/integrity/proofs/` are not
events either.

## Versions

The reference implements specification 1.0 and 0.1, and selects the schema by the `specVersion` each
fixture declares ([ADR 0017](../decisions/0017-versioning-and-compatibility.md)). Most fixtures
declare 1.0. The ones under `examples/compatibility/v0.1/` declare 0.1 and are judged by 0.1's
schema, and the ones under `examples/versions/` exercise the selection itself.

A fixture declaring a well-formed version the reference does not implement, such as `1.1` or `2.0`,
is recorded with `"valid": false`, `"notEvaluated": true` and a single issue at `/specVersion` with
the keyword `specVersion-not-implemented`. That record is a verdict of its own: the event was not
passed, and it was not failed either. An implementation that implements more versions than the
reference will answer differently for those fixtures, and is not wrong to. A fixture whose
`specVersion` is absent or malformed is an ordinary failure, with `"notEvaluated": false`.

The same fixtures record `lintPrivacy.status` as `"schema-invalid"`: the reference's linter, like its
other commands, counts an event it did not evaluate as one it could not scan (ADR 0017,
Consequences). An implementation that gives the linter a not-evaluated answer of its own follows the
ADR's recommendation, and will differ from the kit on those three records for that reason.

## How to use it

Read `manifest.json`, run your implementation over each `fixture` path, and compare. The paths are
relative to the repository root, so the kit and the fixtures travel together.

The kit **references** fixture paths rather than embedding fixture content. There is exactly one copy
of every event in this repository, so the kit cannot drift from what it describes.

## Where to get it

From the published package, alongside the corpus it names:

```text
node_modules/@openauditmodel/cli/conformance-kit/manifest.json
node_modules/@openauditmodel/cli/examples/
```

Pinning one version pins both halves, which is what the manifest needs: it names fixture paths
rather than embedding fixture content, so a manifest and a corpus from different releases would
describe each other wrongly. [scripts/verify-package.mjs](../scripts/verify-package.mjs) fails the
build if any fixture the manifest names is missing from the tarball.

A git checkout or a release archive pinned to a tag carries the same two directories, and is the
route for an implementation in a language with no npm at hand.

**Before installing this into a scanned environment:** eleven privacy fixtures hold synthetic
credential-shaped values — a fake PEM block, a fake bearer token, a password field — because that is
what the privacy linter has to be checked against. They are inert and each one says what it is, but
a secret scanner pointed at `node_modules` will find secret-shaped strings there. Releases before
0.4.2 left the corpus out for exactly that reason; the reversal is deliberate, because a conformance
kit nobody can install is not a conformance kit.

## How it stays true

`manifest.json` is generated from the same engines the `auditmodel` CLI uses, never written by hand.

```bash
npm run kit:build   # regenerate
npm run kit:check   # fail if it no longer matches the engines
```

`kit:check` is part of `npm run verify` and is asserted from the test suite, so an engine change that
moves a verdict either updates this file in the same commit or fails the build. The check compares
parsed content rather than bytes, so formatting stays Prettier's responsibility.
