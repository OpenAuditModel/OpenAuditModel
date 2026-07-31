# 0006 — Event digest and chain verification

## Status

Accepted — 2026-07-30. Applies to specification version 0.1.

Supersedes the producer-defined digest procedure previously described in
[specification/integrity.md](../specification/integrity.md) §3.

Contains **two breaking schema corrections**; see Consequences.

## Context

Version 0.1 shipped an `integrity` object with `canonicalization`, `hashAlgorithm`, `hash`,
`previousHash`, `chainId`, `batchId` and `signature`, and normative prose about what tamper-evidence
does and does not provide. It did not say how a digest is calculated.

The gaps were not cosmetic. Nine assumptions were left to each producer:

1. **The exclusion set was producer-defined.** The specification said only "excluding the integrity
   fields that carry the digest itself" and required producers to document their own choice. Two
   conforming producers could therefore compute different digests for the same event, and no verifier
   could check either without reading the producer's documentation first.
2. **The digest encoding was ambiguous.** The shared `digest` definition accepted hexadecimal, base64
   and base64url in one field. A 64-character hexadecimal digest is also a well-formed base64
   character sequence, so a verifier could not determine the encoding from the value.
3. **No canonicalization identifier was normative.** `RFC8785` appeared only as an annotation example.
4. **Algorithm identifier casing was unspecified.** `SHA-256` and `sha256` both passed validation.
5. **No chain ordering rule existed.** `sequence` was optional and chains "MAY" use it.
6. **No first-event rule existed.** Nothing said whether a genesis event omits `previousHash`.
7. **Nothing stated the consequence of adding `observedTime` to a sealed event.**
8. **Nothing said what happens to an `integrity` object emptied by the exclusions.**
9. **Nothing required `hashAlgorithm` to agree with the digest length.**

Meanwhile the specification promised verification tooling that did not exist. Integrity material that
nobody verifies provides assurance to nobody, and unverifiable material is worse than none, because
it invites the belief that something is being checked.

## Decision

### 1. A normative digest procedure

Deep-clone the event, remove exactly `/integrity/hash` and `/integrity/signature`, serialize with RFC
8785, encode as UTF-8, hash, encode as lower-case hexadecimal, and compare as bytes. The full
procedure is [integrity.md](../specification/integrity.md) §4.

No other member is removed and **no empty container is pruned**: an `integrity` object left with no
members serializes as `{}`. The rule is arbitrary; it is fixed because it is arbitrary.

### 2. Chain metadata is inside the digest

Included: `sequence`, `integrity.previousHash`, `integrity.chainId`, `integrity.batchId`,
`integrity.hashAlgorithm`, `integrity.canonicalization`, and every other field.

Excluded: `integrity.hash` (self-referential) and `integrity.signature` (a later verification layer
over the same input).

Excluding chain metadata would let an attacker rewrite `previousHash`, `chainId` and `sequence` while
every event's hash still verified, which would make the chain decoration rather than evidence.
Including `hashAlgorithm` and `canonicalization` additionally prevents a silent downgrade of either.

### 3. Lower-case hexadecimal, and only that

`integrity.hash` and `integrity.previousHash` are lower-case hexadecimal with an even number of
digits, enforced by a new `hexDigest` schema definition.

Hexadecimal over base64url: fixed length per algorithm, no padding or alphabet variants, comparable by
eye in a report. The 33% size cost on a 32-byte digest is not material for an audit record.

The shared `digest` definition keeps its permissive form for `integrity.signature.value`,
`change.beforeHash`, `change.afterHash` and `evidence[].hash`, which are echoed from other systems and
are never recalculated by this tooling.

### 4. RFC 8785 by an existing implementation

Canonicalization uses the `canonicalize` package: Apache-2.0 — the same licence as this project — no
dependencies, pure ESM with type declarations, 16 KB, authored by the author of RFC 8785. Its
implementation sorts keys with the ECMAScript default string comparison (UTF-16 code unit order, as
§3.2.3 requires) and serializes primitives with `JSON.stringify`, whose number and string handling is
the behaviour §3.2.2.2 and §3.2.2.3 are defined against.

The package is permissive with values JSON cannot represent — it maps `undefined` in an array to
`null`, drops `undefined` members and honours `toJSON`. A guard rejects those inputs instead, so a
digest is never taken over something other than what the caller passed.

Conformance vectors were written for this project rather than copied from the RFC, and cover ordering
across cases and scripts, non-BMP characters, escapes, the ECMAScript number forms, and array order.

### 5. SHA-256, SHA-384 and SHA-512 are executable; the vocabulary stays open

The schema keeps `hashAlgorithm` open. The verifier implements exactly three identifiers, matched
case-sensitively, and reports anything else as `unsupported-algorithm`.

This is the "preserve the vocabulary, report from the verifier" option. Narrowing the schema to the
three implemented algorithms would freeze the algorithm set into the data model, which is exactly what
[integrity.md](../specification/integrity.md) §6 says it must not do — the model outlives any
particular hash function. Acceptance by the schema is not a claim of support, and the tooling says so
in its output.

### 6. Chains are ordered by `sequence`, and begin by omitting `previousHash`

Chain verification requires `chainId`, `hash` and `sequence` on every event, and one shared
`hashAlgorithm` and `canonicalization` per chain. The first event omits `previousHash`; no genesis
constant is defined, because a magic value has to be agreed, encoded and then distinguished from a
real digest by every verifier, while omission needs no agreement.

A set whose first event declares `previousHash` is reported as a **segment**, not a failure.
Verifying a window is legitimate; silently treating it as a whole chain is not.

### 7. Links compare against the predecessor's declared hash

`previousHash` is compared with the predecessor's declared `integrity.hash`, while every declared hash
is independently checked against its own recalculated digest. The two formulations are equivalent
whenever verification passes, and the chosen one localizes failure better: a modified event and a
broken link are reported as separate problems rather than one cascading into the other.

## Consequences

**Positive**

- The digest is deterministic. Any implementation in any language that follows §4 produces the same
  value, which is what makes cross-implementation conformance possible at all.
- Chain metadata is protected by the digest that covers it, so re-linking, re-sequencing or moving an
  event between chains invalidates that event.
- `verify-integrity` and `verify-chain` exist, so integrity material is now checkable rather than
  decorative. The published `privileged-configuration-change.json` example, which previously carried
  an invented hash, now verifies.
- Fixtures are generated from the same digest code the verifier uses, and a test compares them, so a
  fixture can never encode a procedure the implementation does not follow.
- The `broken-previous-hash` fixture passes per-event verification and fails chain verification,
  which demonstrates concretely what chaining adds.

**Negative — two breaking schema corrections**

1. **`integrity.hash` and `integrity.previousHash` are narrowed to lower-case hexadecimal.** An event
   that encoded either in base64 or upper-case hexadecimal was valid under the previous schema and is
   not valid now. No published example or fixture was affected.
2. **`integrity.canonicalization` becomes required when `integrity.hash` is present**, through
   `dependentRequired`. An event that declared a hash without a canonicalization was valid and is not
   valid now. No published example or fixture was affected.

Both are corrections rather than additions: the previous schema accepted events that could never be
verified by anyone, which is not a state a machine-verifiable model should call conforming. Both are
labelled breaking in [CHANGELOG.md](../CHANGELOG.md).

**Negative — other**

- A first dependency is added to the runtime dependency set. It is small, unmaintained-proof only in
  the sense that the algorithm is frozen by an RFC, and reviewable in one screen; it is not a
  transitive tree.
- The exclusion set is now fixed, so any future change to it is a breaking change to every stored
  digest, not only to new events.
- Including `observedTime` in the digest means a collector that adds it invalidates a sealed event.
  This follows from [delivery.md](../specification/delivery.md) §7 rather than contradicting it, but
  it is a sharp edge and is called out in §4.2.
- Chain verification requires `sequence`, which the core model leaves optional. A producer that chains
  without sequencing cannot use `verify-chain` in v0.1.
- Verification cost is linear in event count and event size, and every event is canonicalized twice
  during chain verification once for its own digest, once at most as a predecessor. Neither is
  material at audit volumes; neither has been profiled.

**Neutral**

- `sealEvent` is exported alongside the verification functions. A verifier-only library cannot
  produce test data, and every consumer reimplementing the sealing half is how implementations drift
  apart. It performs no signing and touches no key material.

## Alternatives considered

**Leave the exclusion set producer-defined, as v0.1 shipped.** Rejected: it makes cross-producer
verification impossible, which removes the only reason to standardize a digest at all.

**Exclude chain metadata from the digest.** Rejected: it lets `previousHash`, `chainId` and `sequence`
be rewritten freely without invalidating any event hash, so the chain would assert nothing.

**Support both hexadecimal and base64url.** Rejected: the two alphabets overlap for realistic digest
lengths, so a verifier would have to guess, and "guess, then compare" is not verification.

**Narrow the schema to the three implemented hash algorithms.** Rejected: it freezes the algorithm set
into the data model and would make adopting a future algorithm a breaking change to the schema rather
than an update to a verifier.

**Define a genesis constant such as 64 zero characters.** Rejected: it must be agreed, encoded and
then distinguished from a real digest by every implementation. Omission needs none of that.

**Order chains by following `previousHash` links instead of `sequence`.** Rejected for v0.1: linkage
ordering cannot distinguish a reordering from a fork, and it cannot detect a removed tail any better
than sequence ordering can. It may be worth adding later as an explicit mode for producers that chain
without sequencing.

**Write the canonicalizer rather than take a dependency.** Rejected: RFC 8785 is short enough in
JavaScript to be tempting and subtle enough — lone surrogates, negative zero, exponent thresholds — to
get quietly wrong. An Apache-2.0, zero-dependency implementation by the RFC's author is a better
starting point than a fresh one, and the conformance vectors test it either way.

**Implement signing in the same phase.** Rejected as scope. Signing brings key generation, storage,
rotation, custody and trust decisions, none of which belong in a phase whose goal is to make digests
deterministic. `signature` is carried and excluded from the digest input so that a signing layer can
be added over the same canonical bytes later.

## Security considerations

- **Comparison.** Digests are compared as bytes with `timingSafeEqual` after both values are checked
  against the accepted encoding. `Buffer.from(value, "hex")` truncates silently on invalid input, so
  validating the encoding first is what actually prevents a malformed value being coerced into a
  comparison. Constant-time comparison of a public digest is defence in depth rather than a
  requirement.
- **No reinterpretation.** Malformed encodings, unimplemented algorithms and unimplemented
  canonicalizations are reported. Nothing is guessed, upper-cased, padded or truncated to make a
  comparison succeed.
- **No content in reports.** Failure output contains file paths, JSON Pointers, digests and finding
  kinds — never event content — so that running a verifier over an event containing a mistakenly
  recorded secret does not copy that secret into a CI log. A test asserts this.
- **Bounded input.** Documents above 8 MiB are refused, and structures nested more than 200 levels are
  rejected before recursion exhausts the stack. Both bounds are far above any realistic audit event.
- **Nothing is executed or fetched.** No remote reference is resolved, no evidence URL is retrieved,
  and no content of an event is evaluated. Verification is entirely offline.
- **Downgrade resistance.** Because `hashAlgorithm` and `canonicalization` are inside the digest,
  relabelling a SHA-256 event as some weaker algorithm invalidates it rather than changing how it is
  checked.
- **What remains unaddressed.** Tail truncation is undetectable without an external checkpoint; a
  party who controls the store can recompute an entire chain; and a verifier reading events and
  expected digests from the same untrusted store has verified nothing. These are properties of hash
  chaining, not defects in this implementation, and are stated in
  [integrity.md](../specification/integrity.md) §8.
