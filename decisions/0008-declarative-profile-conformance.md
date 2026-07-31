# 0008 — Declarative profile conformance

## Status

Accepted — 2026-07-30. Applies to specification version 0.1.

No change to the canonical audit event schema was required. The profile definition schema is a
separate document that validates profile files and never constrains an audit event.

## Context

[ADR 0005](0005-core-and-profile-separation.md) split the model into a small universal core and
optional domain profiles, and gave the reason: "optional everywhere" means "guaranteed nowhere". A
document system needs every external share to record an expiry; a payment system does not. Putting
both requirements in the core makes the core large and enforces neither.

That decision left profiles as prose. Five placeholder documents described what a profile might
require, and nothing could check any of it. A requirement nobody can check is a suggestion.

The question this phase answers is what a profile **is**, mechanically. Three properties had to hold
simultaneously:

1. A profile can only add. If a profile could relax a core requirement, "conforming" would mean
   whatever the profile author wanted, and the core would stop being a floor.
2. A profile must be checkable without running code. Profiles will be contributed by domain
   communities, reviewed by people who are not compiler engineers, and executed by tools against
   audit data. A profile that can execute is a profile that can be weaponised.
3. A profile must be readable. A reviewer should be able to answer "does this rule apply to my event,
   and what does it demand?" by reading the profile, not by running it.

## Decision

### 1. Profiles are declarative data, not code

A profile is a JSON document listing rules. Each rule has a selector and a set of requirements.
Evaluation reads values and compares them; it never builds a function, interprets an expression, or
resolves anything outside the event it was given.

Every check in the v0.1 vocabulary is one of three things: a presence test, a JSON type test, or a
strict scalar equality. That is the whole language.

### 2. The rule vocabulary has no keyword that can remove a requirement

This is the core invariant, and it is enforced structurally rather than by review. The rule schema is
closed, and its property list contains `requiredPaths`, `requiredMetadata`, `requiredValues` and
`recommendedPaths`. There is no `optionalPaths`, no `exemptPaths`, no `overrides`. A profile author
cannot express relaxation because no syntax for it exists.

A test asserts this directly, by reading the rule schema's property names and failing if any of them
matches a relaxation-shaped word. Core validation also runs **first**, and a core-invalid event is
reported as core-invalid with its profile rules **not evaluated**, so a profile can never be the
thing that passes an event the core rejects.

### 3. Profiles are not JSON Schemas for complete events

A profile could have been expressed as a JSON Schema applied alongside the canonical one. It is not,
for three reasons.

A schema describes a whole document. A profile describes a **conditional obligation** on a subset of
events: "when this is a privileged role assignment, approval is required". Expressing that in JSON
Schema means nested `if`/`then`/`allOf` over an event-name `const`, which is unreadable at the
twenty-rule scale and unreviewable by a domain expert.

A schema cannot be prevented from relaxing. Any schema keyword can be combined into a document that
accepts events the core rejects — `anyOf` with a permissive branch is enough. The property that makes
this design safe is that the vocabulary is small and additive, and that is a property of a purpose-built
format, not of JSON Schema.

A schema has one outcome. Profiles need three: conforming, violating, and **not applicable**, plus
non-failing recommendations. A schema would report the document-sharing event as valid against the
identity profile, which is exactly the false assurance this design exists to prevent.

### 4. The initial rule language is deliberately small

Six capabilities: two selector forms, three requirement forms, one recommendation form, and one
conditional. Nothing else.

The IAM profile — eleven rules covering user lifecycle, roles, permissions, service accounts and
credential rotation, including the privileged-access conditional — is expressed entirely within it,
with no TypeScript. That was the test of whether the vocabulary was sufficient, and it passed.

Every capability that was not needed to express a real profile was left out. A rule language grows
one convenient keyword at a time until it is a programming language nobody chose to design.

### 5. No expressions, no scripts, no regular expression selectors

Rego, CEL, JMESPath, JavaScript expressions and user-supplied code are all excluded. So are regular
expression event selectors.

Expression languages are excluded because a profile decides whether audit data is conforming, and an
expression language turns that decision into arbitrary computation over the audit event — running in
whatever CI job checks it, over whatever the event contains. The attack surface is not worth the
convenience, and the reviewability cost is immediate: nobody reviews a Rego policy the way they review
a list of required fields.

Regular expression selectors are excluded for a milder reason: a profile is a published statement
about which events it governs, and a pattern language turns "does this rule apply to my event?" into a
question only a tool can answer. Exact names and dotted prefixes are enough, and prefixes must end
with a dot so that `identity.role.` cannot match `identity.roles-export`.

### 6. Evaluation is deterministic

The same event and profile always produce the same findings, in the same order. Rules are evaluated in
definition order. Conditions compare with `Object.is`, so `1` does not equal `true` and `"true"` does
not equal `true`. When a condition's path is absent the condition does not hold, and the rule
contributes nothing.

That last choice is worth stating: the alternative — treating an absent privileged flag as possibly
privileged and demanding approval — would fail every event that omitted a flag the rule was never
meant to govern. The profile requires the flag separately, through `requiredMetadata`, which is where
that requirement belongs.

### 7. Profiles load only from the repository, by name

`--profile <name>` resolves to `profiles/<name>/profile.json`. The name is checked against a strict
token pattern before it is joined to the directory, so `../` and absolute paths cannot escape. There
is no path argument, no remote registry and no `$ref` resolution.

A profile decides whether audit data is conforming. Letting a caller point that at an arbitrary file
makes conformance mean whatever the caller wants it to mean, which is the same failure as letting a
profile relax the core, arriving by a different route.

### 8. Not applicable is a distinct outcome

An event no rule governs is `not-applicable`, and the CLI exits `3`. It is not reported as conforming.

Silence is not conformance. A pipeline that checked document events against an identity profile and
saw exit 0 would conclude something it has no basis for, and would keep concluding it after someone
renamed the events it was supposed to be checking.

### 9. IAM is the first profile

Identity and access management was chosen because its requirements are the least contested. Every
organization that audits anything audits access changes; the fields involved — role, permission,
scope, privileged, approval, multi-factor authentication — are the same everywhere; and the domain
exercised every capability the vocabulary needed, including the conditional.

The alternative candidates each had a problem. Document management depends on a share model that
differs between products. Incident management depends on priority scales that are organization-defined.
Message broker administration is technology-shaped. Deployment depends on a delivery model — requiring
approval on every production deployment describes one delivery model and rejects another, as the
placeholder for that profile already noted.

### 10. Regulatory mappings remain out

A profile requires audit fields. It does not cite a regulation, an article, a control identifier or a
jurisdiction, and the profile definition schema gives it nowhere to put one.

Regulations are revised on their own schedules, are interpreted differently by different auditors, and
apply to different organizations. A profile that encoded one becomes wrong when the regulation is
revised, and useless everywhere it does not apply — the reasoning in
[design-principles.md](../specification/design-principles.md) §9, applied one layer up.
`controlCategories` carries the regulation-neutral half of that relationship, and mapping it to a
framework stays an external artifact.

## Consequences

**Positive**

- Profile requirements are checkable, in CI, offline, with per-rule and per-pointer findings.
- The core invariant is structural rather than aspirational: there is no syntax for relaxation, core
  validation runs first, and both are tested.
- A profile is reviewable as a document. `profile.json` for IAM is readable end to end by someone who
  has never seen the implementation.
- The engine is reusable independently of the CLI, so an editor integration or test helper can call it.
- Adding a profile requires no code. That is the property that lets domain communities contribute.

**Negative**

- The rule language cannot express everything a domain wants. It cannot say "the primary resource must
  be the target principal", which is the most important IAM requirement and is semantic. That
  requirement is documented normatively in the profile and is not checkable — stated plainly rather
  than approximated by a rule that would be wrong.
- Only one conditional operator exists. A requirement conditioned on two facts must be split into
  rules or dropped.
- No inheritance and no composition, so shared requirements are repeated across profiles. With one
  profile this costs nothing; with ten it will.
- `matchedRules` includes rules whose condition did not hold. They govern the event and contributed
  nothing, which is accurate but needs explaining.
- Exit code `3` is new. A caller that treats any non-zero exit as failure will treat not-applicable as
  failure, which is why the code is documented in the CLI help and in the profile documentation.

**Neutral**

- The privacy linter's `OAM-PRIV-001` rule was refined in this phase: a credential-named property is
  reported when it holds a scalar, and a container under such a name is treated as a descriptor whose
  members are inspected individually. The IAM profile requires `/metadata/credential/type` for
  rotation events, and the previous rule flagged every conforming rotation event as a critical
  finding. The refinement is recorded in [ADR 0007](0007-deterministic-privacy-linting.md) and
  [privacy.md](../specification/privacy.md) §6.9.

## Alternatives considered

**Express profiles as JSON Schemas.** Rejected; see decision 3.

**Adopt an existing policy language such as Rego or CEL.** Rejected. Both are well designed for
authorization decisions and both are the wrong tool here: they bring an evaluation engine, an
execution surface and a reviewability cost, in exchange for expressiveness no profile has yet needed.
OpenAuditModel is also explicit that it is not a policy engine.

**Implement IAM rules in TypeScript.** Rejected. It would have been faster and it would have made
every future profile a code change, which puts profile authorship in the hands of people who can
submit a pull request to this repository rather than domain experts. The declarative format is the
deliverable; IAM is the proof it works.

**Allow profiles to be loaded from an arbitrary path.** Rejected; see decision 7. May be reconsidered
with an explicit trust mechanism.

**Report an unmatched event as conforming.** Rejected; see decision 8.

**Support profile composition, so an organization could layer requirements.** Deferred. Composition
raises questions this phase does not need to answer — whether a composed profile can be conforming to
one member and not another, and how findings attribute to a source. One profile at a time is enough
to learn from.

## Security considerations

- **Nothing from a profile is executed.** Rule evaluation is presence tests, JSON type tests and
  `Object.is`. There is no expression parser, no function construction and no dynamic dispatch. A test
  passes a definition value that would be dangerous in an expression language and asserts it is
  treated as a string.
- **Profiles are loaded only from the repository's `profiles/` directory, by name.** The name is
  validated against a token pattern before path joining, so traversal is not possible. Tests cover
  `../schemas`, `..`, `/etc/passwd` and `a/b`.
- **Profile definitions are validated against a closed schema.** An unknown rule property, selector or
  operator is a rejection, not something ignored. A typo that turned a requirement into nothing would
  be worse than a malformed file.
- **Profile files are size-limited** to 256 KiB, and pointers are depth-limited to 32 segments.
- **JSON Pointer resolution reads own properties only**, using `Object.hasOwn`. `__proto__`,
  `constructor` and inherited members are unreachable; tests cover each.
- **No remote anything.** No registry, no `$ref` resolution, no network. All tests are offline.
- **Findings carry pointers, rule identifiers and messages, never event values.** A test checks the
  CLI output of every valid fixture for distinctive fixture strings.
- **Input events are never mutated.** Tested by comparing a serialized snapshot before and after.

## Compatibility considerations

- **Profile version and core version are independent.** A profile declares `coreVersions`, and an
  event declaring a version outside that list is `not-applicable` rather than in violation. This is
  what lets a profile be revised without a core release, and a core release without invalidating
  every profile.
- **Adding a rule to a profile is a breaking change for producers**, in the same sense as adding a
  required core field: events that conformed may stop conforming. Profile versions are therefore
  independent of the core version and are expected to move.
- **Relaxing a rule is compatible for producers and may break consumers** that relied on a field being
  present. The compatibility table in [CONTRIBUTING.md](../CONTRIBUTING.md) applies to profile changes
  as it does to core changes.
- **The profile definition format itself is versioned** through `profileVersion`, pinned to `0.1` by a
  `const`. A future vocabulary change is a format version change, not a silent extension.
- **The profile definition schema is not part of the canonical audit event schema** and never will be.
  It validates profile documents. Nothing in it can constrain an audit event, which is what keeps a
  profile from reaching into the core.
- **Profile conformance is not legal or regulatory compliance**, and is not evidence of it. It is a
  statement that an event carries the fields a domain agreed it should carry.
