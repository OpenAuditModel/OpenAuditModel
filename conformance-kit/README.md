# Conformance kit

**Specification version: 0.1 · Status: Experimental**

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

**The corpus is not the world.** 320 fixtures and 5 chains, chosen to cover the behaviour this
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
  "validate": { "valid": true, "issues": [] },
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

| Key               | Present for                                         |
| ----------------- | --------------------------------------------------- |
| `validate`        | every fixture                                       |
| `lintPrivacy`     | every fixture                                       |
| `verifyIntegrity` | fixtures that declare an `integrity` object         |
| `checkProfile`    | fixtures under `examples/profiles/<name>/`          |
| `chains`          | directories verified as a set rather than per event |

`verifyIntegrity` is recorded only where the fixture declares integrity material, because
`verify-integrity` reports "no integrity object" for everything else — a property of the command
rather than of the fixture.

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
