# Contributing to OpenAuditModel

Thank you for considering a contribution. This project is a specification first, so most valuable
contributions are arguments and evidence rather than code.

Disagreement with a recorded decision is welcome. The decisions in [decisions/](decisions/) each list
the alternatives that were rejected and why; if one of those reasons is wrong, say so.

## Before you start

- Read [specification/overview.md](specification/overview.md) and
  [specification/design-principles.md](specification/design-principles.md). Most proposals are
  accepted or rejected on the design principles, so knowing them saves everyone time.
- Read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Do not report security issues in the public tracker. See [SECURITY.md](SECURITY.md).

## Ground rules for every contribution

The project rejects, without exception:

- Product-specific, company-specific, country-specific or regulation-specific fields in the core
  model.
- Fictional domains in identifiers. URNs are used until an official domain is owned.
- Copyrighted control framework text, proprietary framework content, licensed regulatory commentary
  or vendor documentation.
- Weakening schema validation to make an example pass.
- New top-level properties for domain-specific data.

Documentation and identifiers are in English. JSON is formatted by Prettier.

## Development setup

Requires Node.js 22 or newer. Everything runs offline after `npm install`.

```bash
npm install
npm run build            # compile the CLI and tests
npm test                 # build, then run the full conformance suite
npm run lint
npm run format           # or format:check in CI
npm run validate:valid   # validate every example under examples/valid
npm run verify:integrity # verify the sealed examples and the published chain
npm run lint:privacy     # privacy-lint every published example that should be clean
npm run check:profile    # check the identity profile fixtures against their profile
npm run mcp:check-generated # fail if the generated MCP artifacts are stale
npm run verify           # every check above, plus fixtures:check and the packaging checks
```

Every published example outside `examples/privacy/findings` must produce **no** privacy findings. A
test enforces it, so a new rule that fires on ordinary audit data fails the build rather than
teaching contributors to ignore the linter. Fixtures added under `examples/privacy/findings/` must
use synthetic, non-functional values; see
[examples/privacy/README.md](examples/privacy/README.md).

The integrity fixtures under `examples/integrity/` are **generated**, never hand-edited: they carry
real digests, and a hand-corrected hash hides whatever the edit broke.

```bash
npm run fixtures:check      # fail if the fixtures drifted from the generator
npm run fixtures:integrity  # regenerate and reformat them
```

## Types of contribution

### 1. Proposing a core field

The bar is deliberately high. A field belongs in the core only if:

1. It is meaningful in **every** business application, across industries and architectures.
2. Omitting it leaves an audit event ambiguous in a way no other field resolves.
3. It cannot be expressed as `metadata`, an extension or a profile requirement without losing
   cross-application comparability.

Open a **specification change** issue containing:

- The question a reviewer cannot answer today.
- At least three unrelated application domains that need the field, with concrete scenarios.
- Why `metadata`, `extensions` and a profile are each insufficient.
- The proposed schema fragment, including whether the vocabulary is open or closed.
- The compatibility impact on existing producers and consumers.
- The conformance tests that would prove it works, including at least one negative fixture.

Expect to be asked to start as a semantic convention or a profile requirement instead. That is not a
rejection: it is how a field earns evidence of generality.

### 2. Proposing a semantic convention

Conventions are recommended vocabularies. They add no requirements, so the bar is lower.

Open a **specification change** issue containing:

- The operations covered.
- The proposed event names, and how they follow the rules in
  [event-naming.md](semantic-conventions/event-naming.md).
- At least two independent applications that would emit them.
- What goes wrong without the convention.

Check that names encode no outcome, mechanism, product, company or jurisdiction, and that failure
uses the same name as success with a different `outcome`.

### 3. Proposing a domain profile

Use the **profile proposal** template. A proposal must show:

- The domain, and the applications in it that are not related products.
- Which core-optional fields the profile would require, for which event classes.
- Which `metadata` fields it would define, with their meanings.
- Why the requirements cannot be met by the core plus a convention.
- The conformance fixtures the profile would add.

A profile must never relax the core, add top-level properties, redefine a core field, or introduce
product, company, country or regulation-specific fields. See
[ADR 0005](decisions/0005-core-and-profile-separation.md) and
[ADR 0008](decisions/0008-declarative-profile-conformance.md).

The most common reason a profile proposal is rejected is that it is one product's field list wearing
a domain's name.

**Adding a profile requires no code.** A profile is a JSON document at `profiles/<name>/profile.json`,
validated against [profiles/profile-definition.schema.json](profiles/profile-definition.schema.json),
plus fixtures under `examples/profiles/<name>/`. The rule vocabulary is documented in
[profiles/README.md](profiles/README.md); it has six capabilities and one conditional operator, and
deliberately no way to express relaxation.

Every fixture under a profile's `valid/` directory must pass `validate`, `lint-privacy` **and**
`check-profile`. A test enforces all three: a profile that accepted an event the core rejects would
break the core invariant, and one that accepted an event carrying a credential would be worse than no
profile.

### 4. Proposing an external mapping

Mappings are informative and welcome, including for standards not yet covered.

A useful mapping states three things: what maps cleanly, what maps approximately and with what
caveat, and **what does not map at all**. A mapping claiming full fidelity is either wrong or is
describing a standard that already contains this model.

Mappings are documented from OpenAuditModel to the target. Where an inbound mapping is described,
state explicitly which fields have no source and must be omitted rather than defaulted.

### 5. Adding a vendor extension

You do not need permission, and there is nothing to register.

Use a reverse-domain namespaced key of at least three segments under `extensions`, in a namespace you
control:

```json
{ "extensions": { "com.example.workflow.stage": "legal-review" } }
```

Extensions must not weaken required core fields or change the meaning of existing ones. See
[extension-model.md](specification/extension-model.md).

If an extension proves general across unrelated products, propose it as a convention or a core field
with that evidence attached. Evidence of independent adoption is the argument; a well-designed field
used by one product is a product field.

## How compatibility is evaluated

Every proposal that touches the schema is assessed for its effect on **existing producers** and
**existing consumers**, separately.

| Change                                        | Producers                         | Consumers         | Verdict for v0.1                               |
| --------------------------------------------- | --------------------------------- | ----------------- | ---------------------------------------------- |
| Adding an optional field                      | unaffected                        | unaffected        | Compatible                                     |
| Adding a value to an open vocabulary          | unaffected                        | unaffected        | Compatible                                     |
| Adding a value to a closed enum               | unaffected                        | may not handle it | Compatible for producers only                  |
| Adding a required field                       | **breaks**                        | unaffected        | Breaking                                       |
| Removing a value from an enum                 | **breaks**                        | unaffected        | Breaking                                       |
| Tightening a pattern or length                | **breaks**                        | unaffected        | Breaking                                       |
| Adding a conditional requirement              | **breaks** some                   | unaffected        | Breaking                                       |
| Renaming a field                              | **breaks**                        | **breaks**        | Breaking                                       |
| Changing the meaning of a field or event name | silently corrupts historical data |                   | **Never acceptable** — change the name instead |

During the experimental phase, breaking changes are possible and must be labelled as such in the pull
request and recorded in [CHANGELOG.md](CHANGELOG.md). A change that alters the meaning of an existing
field or event name is not acceptable at any phase: introduce a new name.

Every schema change must state, in the pull request:

1. Which category above it falls into.
2. What an existing conforming event would do under the new schema.
3. Which conformance fixtures were added or changed, and why.

## How conformance tests are added

The test suite in [conformance/tests/](conformance/tests/) is the executable half of the
specification. Tests run offline and must never require network access.

- **A new valid construct** gets a positive test in `valid-examples.test.ts`, and a fixture in
  `examples/valid/` if it is worth publishing as an illustration.
- **A new constraint** gets a negative test in `invalid-examples.test.ts` asserting the **specific**
  failure — the JSON Pointer and the failing keyword — not merely that validation failed. A test that
  only asserts "it is invalid" passes for the wrong reason as easily as the right one.
- **A new published invalid fixture** must be added to the `EXPECTATIONS` table in
  `invalid-examples.test.ts` and to the table in `examples/invalid/README.md`. A test asserts the two
  are in step, so a fixture without a documented expectation fails the build.
- **A schema property change** should be checked against `schema-validation.test.ts`, which enforces
  strictness, regular expression portability and the absence of product, country and regulation
  specific concepts in the core schema.

Each published invalid fixture must be otherwise valid, so that it fails for exactly one documented
reason.

## Pull requests

1. Branch from `main`.
2. Keep the change focused. A schema change, a specification rewrite and a tooling refactor are three
   pull requests.
3. Run `npm run verify` before pushing.
4. Update [CHANGELOG.md](CHANGELOG.md) under the `Unreleased` section at the top of the file.
5. Update the specification, the schema, the fixtures and the tests **together**. A schema change
   without a specification change is a defect, and so is the reverse.
6. Explain the reasoning in the pull request description. For a decision of consequence, add an ADR in
   [decisions/](decisions/) using the existing format: Status, Context, Decision, Consequences (with
   negatives stated honestly), Alternatives considered.

## Releasing (maintainers)

1. Date the version's section in `CHANGELOG.md` and bump `package.json` (and the lock file). The
   release-checks workflow refuses a tag whose version or changelog entry does not match.
2. Merge to `main` with CI green.
3. Tag and push: `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`. The release-checks
   workflow runs every gate a fresh clone can run against the tag.
4. With the workflow green, publish by hand: `npm publish`. Publishing stays manual until 1.0;
   automated publishing with provenance moves into the workflow at that milestone.
5. Create the GitHub release from the tag, pasting the changelog section.
6. Deploy the site and containers per [deploy/README.md](deploy/README.md); that step is manual and
   operator-controlled by design.

## Licensing of contributions

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), the same license as the project. There is no separate contributor
license agreement.

Do not contribute content you do not have the right to license, and do not copy text from control
frameworks, regulations, vendor documentation or other proprietary sources.
