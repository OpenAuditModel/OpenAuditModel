# 0012 — Ed25519 signature verification

## Status

Accepted — 2026-08-04. Applies to specification version 0.1; no schema change.

## Context

`integrity.signature` has been part of the schema since v0.1: an object with `algorithm`, `value` and
an optional `keyId`, recommending `Ed25519`, `ECDSA-P256-SHA256` and `RSA-PSS-SHA256`. Signature
verification was explicitly out of scope for the initial release — see
[integrity.md](../specification/integrity.md) §9 as it read before this decision — because the
project's first job was a normative digest procedure and a verifier for it ([ADR 0006](0006-event-digest-and-chain-verification.md)).
A schema field with no verifier behind it is not a defect by itself: `integrity` is optional, and a
producer that populates `signature` today is recording something for a _future_ verifier to check.
That future arrived from a real integration question, not a scheduling convenience: a consumer
building their own tamper-evident audit chain asked whether OpenAuditModel's verifier could be
extended to also accept `HMAC-SHA256`, since that is the keyed hash their chain already used
internally.

It cannot, and the reason is the same reason this ADR exists. `hash`/`previousHash` and a MAC solve
different problems. A plain hash lets _any_ holder of an event recompute and compare it — the model's
entire "portable to any backend or auditor" premise depends on that. An HMAC requires the same secret
key to verify as to produce; sharing that key with every external verifier removes its own protection
(anyone who can verify can also forge a consistent-looking replacement), and withholding it removes
external verifiability entirely, which is the property being asked for in the first place. Published
precedent for third-party-verified tamper-evident logs — AWS CloudTrail's digest files, Certificate
Transparency's signed tree heads, Sigstore/Rekor's transparency log — uses hashing plus an _asymmetric_
signature for exactly this reason: a private key that only the producer holds, verified with a public
key that can be shared freely without weakening anything. `integrity.signature` already models this
correctly; it only needed an implementation.

## Decision

### 1. Ed25519 only, for now

`verify-integrity` and `verify-chain` implement Ed25519 signature verification. `ECDSA-P256-SHA256` and
`RSA-PSS-SHA256` remain schema-recommended, unimplemented identifiers, reported
`unsupported-signature-algorithm` exactly as an unimplemented hash algorithm has always been reported
`unsupported-algorithm` — acceptance by the schema was never a claim of verifier support, for either
vocabulary. Ed25519 was chosen to go first because it needs no key-size or hash-algorithm parameter,
has a fixed 64-byte signature, and is implemented natively by Node's `crypto` module, so it adds no
dependency. It is also the algorithm the specification's own illustrative example already used
(integrity.md §11), before any of it was verifiable.

### 2. A signature is verified over the same digest input as the hash

Signing input is `buildDigestInput` — the canonicalized event with `/integrity/hash` and
`/integrity/signature` removed — identical to what `hash` is calculated over. `sequence`,
`previousHash` and `chainId` are therefore covered by the signature exactly as they are covered by the
hash, and a signed chain is exactly as tamper-evident as a hashed one, not a weaker parallel mechanism.

### 3. `--public-key`, not a key registry

v0.1 defines no trust store, no certificate parsing and no key resolution service; `keyId` "MUST NOT
contain key material" and is never dereferenced by this verifier. `verify-integrity` and `verify-chain`
accept `--public-key <path>`, a single PEM-encoded (SPKI) Ed25519 public key, applied to every signature
present in the input. A verifying party obtains the key out of band, by whatever means it already
trusts — that determination is explicitly not this tool's job, the same way key generation, storage,
rotation and revocation are not (integrity.md §8, items 9–10).

### 4. Absent `--public-key`, a declared signature is invisible, not merely unverified

Without the flag, `integrity.signature` is neither checked nor mentioned in output. This was chosen
over emitting an informational note for two reasons. First, every existing invocation of both commands
now behaves byte-for-byte as it did before this change — no output changes unless a caller opts in.
Second, `EventVerificationResult` has no `notes` concept the way `ChainVerificationResult` does; adding
one for a single, narrow case was a larger surface change than the capability justified. A future
signature algorithm or a genuine reason to surface "present but unchecked" can add it then.

### 5. A signature currently requires an accompanying hash

`verify-integrity` still reports `hash-missing` for an event whose `integrity` object carries only
`signature` — this is unchanged from before this decision, since `hash` was already required
unconditionally. Restructuring the function so hash and signature verification run independently, so
that a signature-only event could be checked on its own, was judged a larger and riskier change than
this decision needed: the motivating use case signs an existing hash, not a bare event. A signature-only
event is possible future work, not a defect in this one — see Consequences.

### 6. The MCP server verifies signatures too

`verify_integrity` and `verify_chain` accept an optional `publicKeyPem` argument — a PEM string, not a
path, since this server touches no filesystem — applied exactly as `--public-key` is applied by the
CLI, through the same `verifyEventIntegrity`/`verifyChains` functions. A public key carries no
confidentiality concern by definition, so accepting one as a tool argument over the network raises
nothing the server's existing "no persistence, nothing logged beyond a category" model does not
already handle for every other input. This was drafted as a deferred, separate decision in an earlier
version of this ADR — see the retired alternative below — and folded in once that reasoning was
checked and did not hold up.

## Consequences

**Positive.**

- `integrity.signature` goes from a documented-but-inert field to a checked one, for the one algorithm
  the specification already used as its example.
- The fix requested — "make our keyed chain interoperable" — is answered correctly rather than
  accommodated incorrectly: the consumer's internal HMAC chain keeps the property a keyed MAC actually
  provides (nobody without the key can forge a consistent replacement, including someone with database
  access alone), while a separate, genuinely exportable Ed25519 signature provides third-party
  verifiability, which HMAC structurally cannot.
- No new runtime dependency: Node's `crypto` module signs and verifies Ed25519 natively.
- No schema change. `integrity.signature`'s shape was already exactly what this needed.

**Negative, stated honestly.**

- **A signature-only event (no `hash`) is not verifiable**, even though the schema permits
  one. A producer relying solely on `integrity.signature` gets no verification at all today.
- **`--public-key` accepts exactly one key per invocation**, applied to every signature encountered.
  Verifying events signed by different keys in one run requires separate invocations. This matches the
  absence of any key-resolution mechanism in v0.1 rather than working around it, but it is a real
  limitation for a multi-signer chain.
- **`keyId` remains purely advisory.** Nothing stops a caller from supplying the wrong public key for
  what `keyId` names; a mismatch is reported as `signature-invalid`, indistinguishable from a genuine
  forgery attempt, because v0.1 has no registry to tell the two apart.
- Pointing `--public-key` at a private key file by mistake does not fail loudly: `createPublicKey`
  derives the correct public half from a private key, so verification still succeeds. This is Node's
  behaviour, not a gap introduced here, and the derived key is never wrong — but it means the CLI cannot
  warn a caller who meant to supply a public key and supplied the wrong file instead.

## Alternatives considered

**Add `HMAC-SHA256` to the supported hash-algorithm vocabulary.** The request that motivated this
decision. Rejected: explained in Context. A keyed MAC and a specification whose stated model is
"verifiable by any holder of the event" are incompatible goals; extending the vocabulary would have
made the schema's open-vocabulary acceptance look like an endorsement it cannot honestly make.

**Implement all three recommended signature algorithms (Ed25519, ECDSA-P256-SHA256, RSA-PSS-SHA256) at
once.** Rejected for this change. Ed25519 alone answers the motivating use case, needs no new
dependency, and keeps the change reviewable; the other two remain schema-recommended and can be added
independently without revisiting this design.

**Defer MCP tool parity to a separate change.** Considered and retired. The initial draft of this
decision deferred `verify_integrity`/`verify_chain` MCP support, reasoning that a remote, stateless
server raises a key-material question the CLI does not. On review that reasoning did not hold: a
_public_ key is not confidential by definition, so passing it as a tool argument is no different from
passing the event itself, which every tool already does per call. CONTRIBUTING.md's "keep the change
focused" principle is about bundling unrelated concerns, not about the same capability reaching its two
existing integration surfaces — so this stayed one decision, and the code for both is in Decision §6.

**A key registry or trust store resolved by `keyId`.** Rejected for v0.1. `keyId` "MUST NOT contain key
material" precisely so that a future registry mechanism remains possible without a schema change; the
registry itself — format, trust model, revocation — is a separate decision this project is not yet
ready to make.

## Security considerations

A verifier that supplies its own `--public-key` has, definitionally, decided to trust that key; nothing
in this change establishes trust, it only checks a signature against a key the caller already asserts.
Key distribution, custody and rotation remain entirely out of scope, as integrity.md §8 already states
for signatures generally. `--public-key` reads a local file only: no URL, no key-server lookup and no
network access are introduced by this change, keeping both commands offline exactly as they were.
