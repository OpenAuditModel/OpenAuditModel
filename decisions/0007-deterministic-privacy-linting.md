# 0007 — Deterministic privacy linting

## Status

Accepted — 2026-07-30. Applies to specification version 0.1.

No schema change was required. Every rule reads values the canonical schema already permits.

## Context

[privacy.md](../specification/privacy.md) §1 lists eight values that MUST NEVER be recorded and §2
lists seven kinds of data that MUST NOT be captured automatically. Until now, nothing checked any of
it, and §6 said so: schema validation passes an event containing a password, because a password is a
valid string in a valid free-form object.

That leaves the strongest requirements in the specification enforced by nothing but review. Audit
events are produced by instrumentation written once and rarely revisited, retained for years, and
replicated to systems with weaker access control than the production database. A secret that reaches
an audit store is a secret in the worst possible place.

The question is not whether to check, but what a checker can honestly claim. Secret detection is
undecidable in general: a password can be a dictionary word in a field named `note`. Any tool here
will miss things, and a tool that is trusted to be complete is worse than no tool.

## Decision

### 1. Deterministic, local, read-only

`auditmodel lint-privacy` performs static analysis in process. It sends nothing anywhere, resolves
nothing, fetches no URL, opens no file an event references, uses no model or remote scanning service,
and never modifies, redacts or rewrites an event.

Every consequence of this follows from one property: **the linter is most often run against events
that contain secrets**. Anything it transmits, it transmits at exactly the wrong moment. A remote
detection service would upload the material it was asked to protect; a redaction feature would
rewrite an audit record, which is the one thing an audit record must not have done to it.

Determinism is a second requirement: the same event must always produce the same findings, so that a
CI failure is reproducible and a rule can be argued about rather than re-rolled.

### 2. Findings never carry the offending value

No output — human or JSON — contains the matched value, any part of it, a preview, a prefix, a suffix
or a decoded JWT claim. A finding carries a rule identifier, severity, confidence, JSON Pointer,
message and recommendation.

Linter output goes to CI logs, pull request comments and issue trackers, which are less protected
than the audit store. A tool that echoed its matches would move secrets from a controlled system to
an uncontrolled one, and would do it precisely when a secret was present. Tests assert that no
synthetic fixture value appears in either output format, and a companion test asserts those values
are still in the fixtures, so the assertion cannot silently become vacuous.

### 3. Schema validation first, and no deep linting of invalid events

An event is validated before it is linted. A schema-invalid event is reported and not traversed.

Traversing an arbitrary structure produces findings whose JSON Pointers do not correspond to any
defined location, and a reviewer cannot tell a real exposure from an artefact of a malformed
document. A schema-invalid event exits non-zero rather than reporting a clean privacy result, because
"clean" for an event that was never linted is a lie.

### 4. Exact normalized name matching, never substring

Property names are matched exactly after lower-casing and removing `-`, `_`, `.` and spaces. Extension
keys are additionally tested on their final dot-separated segment, since a reverse-domain key names
its field there.

Substring matching is what makes name-based linters unusable. `passwordPolicy`,
`secretRotationEnabled`, `tokenCount`, `authorizationDecision`, `cookieConsent` and `requestBodyHash`
are all legitimate audit fields, and all would be flagged by a rule looking for a keyword anywhere in
a name. A linter that fires on those is switched off within a week, and a switched-off linter finds
nothing.

### 5. Entropy is secondary, low confidence, and heavily gated

The entropy rule applies only to strings of 24 to 4096 characters, with no whitespace, drawn from the
token alphabet, using at least 3 of 4 character classes, with entropy of at least 4.0 bits per
character, and not matching a known-safe format. It reports at `medium` severity and `low` confidence,
rising to `medium` confidence only when the surrounding property name is itself suspicious.

Entropy cannot distinguish a secret from an identifier; it only distinguishes structured from
unstructured. Every gate exists to keep it quiet, because it is the rule most likely to be wrong and
the one whose noise would discredit the rest.

Severity and confidence are kept separate throughout for the same reason. A field named `password` is
`critical`/`high`. A random-looking string in an arbitrary field is `medium`/`low`. Collapsing those
into one number would force a choice between under-reporting the first and over-reporting the second.

### 6. Known-safe identifiers are excluded from entropy only

UUIDs, ULIDs, trace and span identifiers, hexadecimal digests, RFC 3339 timestamps, numeric
identifiers, lower-case separated identifiers and paths, and anything containing `://` are ignored by
the entropy rule.

An audit event is full of long random-looking strings that are supposed to be there. Without these
exclusions the rule fires on every well-formed event and the output is worthless. The exclusions
apply to entropy alone: a value under a property named `password` is reported whatever it looks like.

### 7. No automatic redaction

The linter reports. It never edits.

Redacting an audit event destroys the record the event exists to be, and would invalidate any
integrity digest covering it. The fix for a secret in an audit event is to change the instrumentation
that produced it and rotate the credential — not to quietly rewrite history and carry on.

### 8. Suppressions deferred

No inline suppression marker and no event-level ignore field is provided.

Suppression is the mechanism by which a security tool is silently disabled: a marker added once to
unblock a release is never removed, and the exposure it hides looks identical to no exposure at all.
Suppression needs a design that makes suppressions visible, attributable and expiring, and that design
is a separate piece of work.

### 9. No configuration in v0.1

Thresholds, name registries and rule identifiers are hard-coded and documented in
[privacy.md](../specification/privacy.md) §6.7 and §6.8. Rules are implemented as separate modules so
that configuration can be added later without restructuring.

Configuration before there is field experience produces defaults chosen by guesswork and then frozen
by the first user who depends on them.

## Consequences

**Positive**

- The strongest requirements in the specification are now checkable, in CI, offline.
- The rules dogfood: a test asserts that every published example outside `examples/privacy` is clean,
  which caught a real false positive during implementation — path-shaped evidence references were
  tripping the entropy rule.
- Findings are safe to paste into an issue, because they contain nothing sensitive.
- The linter is reusable independently of the CLI, so an MCP server, an editor integration or a test
  helper can call it without shelling out.

**Negative**

- False negatives are certain and numerous. A secret in an unpublished format, under a harmless name,
  below the entropy threshold, or in all lower case with a separator, is invisible. Most personal data
  is not shaped like a secret at all and is invisible by construction.
- False positives will happen, most likely from the entropy and size rules.
- The rules encode published credential prefixes, which will age as issuers change formats. They live
  in one table and are covered by positive and negative tests, but they will need maintenance.
- Recognising vendor credential formats sits uneasily beside the project's neutrality commitment.
  The resolution is that these live in **tooling**: the specification, the canonical schema and the
  semantic conventions name no vendor, and no lint rule adds a field, vocabulary or concept to the
  model. The existing neutrality test scans the schema and continues to pass.
- Hard-coded thresholds will not suit everyone, and there is no way to adjust them in v0.1.
- Running the linter takes time proportional to event size, and it has not been profiled.

**Neutral**

- A recognised redaction placeholder under a credential name is not reported. This is a deliberate
  false negative: a tool that flags `"password": "[REDACTED]"` punishes the behaviour the
  specification asks for.
- **Refined in the profile phase.** `OAM-PRIV-001` reports a credential-named property holding a
  **scalar**; a container under such a name is a descriptor whose members are inspected individually.
  The identity-and-access-management profile requires `/metadata/credential/type` for rotation
  events, and the original rule flagged every conforming rotation event as critical — the false
  positive that trains people to ignore the tool. The accepted cost is a secret under a harmless
  member name inside such a container. See
  [ADR 0008](0008-declarative-profile-conformance.md) and
  [privacy.md](../specification/privacy.md) §6.9.

## Alternatives considered

**Use an existing secret-scanning library.** Rejected. The mature ones are built for source
repositories, carry substantial dependency trees, and — decisively — report matched values by design,
because a developer scanning a repository wants to see what was found. Adopting one would have meant
fighting its output model, which is the property this decision cares about most.

**Call a cloud secret-detection API.** Rejected outright. It would upload the exact material the tool
exists to protect, at the exact moment it is present, to a third party.

**Use a model to classify values.** Rejected. Non-deterministic, unauditable, unreproducible in CI,
and it would require sending event content somewhere.

**Report only high-confidence deterministic rules and drop entropy entirely.** Tempting, and
rejected: an unpublished token format under a harmless name is a realistic exposure, and the
heuristic is the only thing that would see it. Keeping it at low confidence, heavily gated, is the
compromise.

**Enforce privacy rules in the JSON Schema.** Rejected, and not possible. A schema cannot express
"this string is not a password". Adding size limits to the schema was also rejected for this phase:
it would make an oversized `change.before` a conformance failure rather than a reviewable finding,
which is too blunt for a heuristic.

**Redact and re-emit events.** Rejected; see decision 7.

## Security considerations

- **No value ever leaves the process.** Findings carry paths and rule identifiers. Errors carry
  parser positions, never file content. Tests assert both.
- **No network, no filesystem beyond the inputs.** No remote reference is resolved, no evidence URL is
  fetched, no referenced file is opened. All tests are offline.
- **JWT claims are decoded and discarded.** Decoding is needed to distinguish a token from three
  arbitrary dot-separated strings. The decoded header and payload are checked for shape and never
  retained, returned or printed.
- **Regular expressions are reviewed for worst-case behaviour.** Every pattern is anchored with
  bounded quantifiers and contains no nested quantifier and no back-reference, so none can backtrack
  catastrophically. No pattern uses look-behind, which keeps them portable. Private key detection uses
  substring search, so there is no pattern at all.
- **URL parsing uses the WHATWG parser**, not a regular expression, because a hand-written URL pattern
  disagrees with a real parser exactly on the inputs an attacker chooses.
- **Traversal is safe.** Own enumerable properties only, no prototype access, no accessor invocation,
  and a depth limit of 64 so that a deeply nested document cannot exhaust the stack. The existing
  8 MiB document limit applies unchanged.
- **The linter is not a control by itself.** It is one check among several, and
  [privacy.md](../specification/privacy.md) §6.4 states plainly that a clean result does not mean an
  event is safe.

## False-positive strategy

1. Match property names exactly after normalization; never by substring.
2. Give the heuristic rules low confidence, and separate confidence from severity so a reviewer can
   filter on either.
3. Exclude the identifier formats that legitimately fill audit events from the entropy rule.
4. Report an uncredentialed connection string under its own low-severity rule rather than calling it
   a credential.
5. Do not report recognised redaction placeholders.
6. Dogfood: a test requires every published example outside `examples/privacy` to be clean, so a rule
   that starts firing on ordinary audit data fails the build.
7. State in every heuristic recommendation that the rule is a heuristic.

## False-negative strategy

1. Accept them explicitly rather than compensating with aggressive rules. The heuristics are tuned to
   stay quiet, and that choice trades recall for the tool remaining switched on.
2. Say so where it matters: [privacy.md](../specification/privacy.md) §6.3, §6.4 and §6.9 state what
   is not detected, and the CLI help states that a clean result does not mean an event is safe.
3. Keep the strong rules broad enough to be useful: names are matched in every nested object and in
   extension key segments, not only at the top level.
4. Rely on the allowlist model as the primary control. §3 remains the requirement; the linter is a
   backstop for when it was not followed, not a replacement for following it.
5. Leave the door open: rules are separate modules with a stable finding shape, so new detectors and,
   later, configuration can be added without redesign.
