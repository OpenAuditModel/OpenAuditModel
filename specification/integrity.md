# Integrity

**Specification version: 0.1 · Status: Experimental · This document: Normative**

## 1. Tamper-evident, not immutable

This specification uses the term **tamper-evident** and only that term.

An audit event model can make alteration **detectable**. It cannot make anything immutable. Nothing an
SDK does to a JSON object prevents that object from being deleted, overwritten or never written at
all. The words `immutable`, `tamper-proof`, `legally binding` and `non-repudiable` MUST NOT be used to
describe event-level or SDK-level guarantees in this project, in its documentation, or in tooling
built on it.

Storage immutability is a property of a storage system — write-once media, append-only ledgers,
retention locks — and is outside this specification.

## 2. The integrity object

`integrity` is OPTIONAL. Integrity information is not required of a conforming event, and an event
without it is fully conforming. When the object is present it MUST contain at least one property.

| Field              | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `canonicalization` | Canonicalization applied before hashing. REQUIRED when `hash` is present.      |
| `hashAlgorithm`    | Algorithm used for `hash` and `previousHash`. REQUIRED when either is present. |
| `hash`             | Digest of the canonicalized event.                                             |
| `previousHash`     | Digest of the preceding event in the same chain.                               |
| `chainId`          | Identifier of the chain this event belongs to.                                 |
| `batchId`          | Identifier of the sealing or verification batch. See §2.1.                     |
| `signature`        | Digital signature over the canonicalized event.                                |

`signature` is an object requiring `algorithm` and `value`, and optionally `keyId`. `keyId` MUST NOT
contain key material. v0.1 tooling verifies Ed25519 signatures when a public key is supplied out of
band; signing and key management are not part of v0.1. See §6.1 and §9.

### 2.1 What `batchId` is not

`batchId` identifies an **integrity sealing or verification batch**: the group of events whose
digests were computed, or whose chain was verified, together. Its boundaries are set by the sealing
process.

It does NOT identify a job run, a processing batch, an import batch or any business operation, and a
consumer MUST NOT read it as one. Two events in the same sealing batch need not be related in any
other way, and events from one job run may be sealed across several batches.

`request.correlationId` is the field for job runs, processing batches and logical operations. See
[event-model.md §10.1](event-model.md) and
[semantic-conventions/correlation-and-tracing.md](../semantic-conventions/correlation-and-tracing.md).

Likewise `chainId` identifies a tamper-evidence chain, not a business grouping.

## 3. Canonicalization

A digest over JSON is meaningless unless the bytes are reproducible. Property order, whitespace,
number formatting and Unicode escaping all vary between serializers, so two implementations
serializing the same event will otherwise disagree on its digest.

- A producer that populates `hash`, `previousHash` or `signature` MUST canonicalize the event first,
  and MUST declare which canonicalization it used.
- **RFC 8785, the JSON Canonicalization Scheme, is the canonicalization of v0.1**, declared as the
  identifier `RFC8785`. Identifiers are matched **case-sensitively**: `rfc8785` and `JCS-RFC8785` are
  not `RFC8785`.
- `canonicalization` is an open vocabulary in the schema so that a future scheme can be adopted
  without a specification change. A producer MAY declare another identifier; conforming v0.1 tooling
  will report it as unverifiable rather than guess.

RFC 8785 was chosen because it is a published standard with independent implementations, it produces
plain UTF-8 JSON rather than a bespoke encoding, and its number and string rules are already the
behaviour of every JSON serializer built on ECMAScript semantics. See
[ADR 0006](../decisions/0006-event-digest-and-chain-verification.md).

## 4. The digest procedure

This procedure is **normative**. An implementation that deviates from it in any step produces a
different digest and is not interoperable.

Given an event and the algorithm named by `integrity.hashAlgorithm`:

1. The input MUST be a conforming OpenAuditModel event. A verifier MUST validate it against the
   canonical schema before calculating a digest.
2. The event MUST be deep-cloned. The digest procedure MUST NOT modify the input event.
3. Exactly the following JSON Pointers MUST be removed from the clone, when present:

   ```text
   /integrity/hash
   /integrity/signature
   ```

   No other member is removed. **No empty container is pruned**: an `integrity` object left with no
   members MUST be serialized as `{}`. This rule is arbitrary, and it is fixed precisely because it
   is arbitrary — a producer that pruned the empty object and a verifier that did not would compute
   different digests for the same event.

4. The resulting value MUST be serialized with RFC 8785.
5. The canonical form MUST be encoded as UTF-8.
6. The digest MUST be calculated over those bytes with the declared algorithm.
7. The digest MUST be encoded as described in §5.
8. The result MUST be compared with `integrity.hash` as **bytes**, not as text. A malformed encoding
   MUST be rejected; it MUST NOT be reinterpreted, coerced or truncated to make a comparison possible.

### 4.1 What is in the digest

| Field                        | In the digest | Why                                                                      |
| ---------------------------- | ------------- | ------------------------------------------------------------------------ |
| Every field not listed below | **Included**  | The digest attests to the event                                          |
| `sequence`                   | **Included**  | Position in a chain is an integrity claim; reordering must be detectable |
| `integrity.previousHash`     | **Included**  | The link is an assertion; re-linking must invalidate the event           |
| `integrity.chainId`          | **Included**  | Chain membership is an assertion; moving an event must be detectable     |
| `integrity.batchId`          | **Included**  | Batch membership is an assertion                                         |
| `integrity.hashAlgorithm`    | **Included**  | Prevents silently downgrading the declared algorithm                     |
| `integrity.canonicalization` | **Included**  | Prevents silently changing the declared canonicalization                 |
| `integrity.hash`             | **Excluded**  | Self-referential: it cannot be an input to its own calculation           |
| `integrity.signature`        | **Excluded**  | Belongs to a later verification layer, over the same digest input        |

The inclusions matter as much as the exclusions. If chain metadata were excluded, an attacker could
rewrite `previousHash`, `chainId` and `sequence` freely while every event's hash still verified — the
chain would become decoration. Because they are included, altering any of them invalidates the event
that carries them.

### 4.2 Consequence for collectors

Every field except the two excluded pointers is part of the digest, including `observedTime`. A
collector that adds `observedTime` to an event that already carries `integrity.hash` therefore
invalidates it. This is not a special case: a component that is not the producer MUST NOT modify a
sealed event at all, as required by [delivery.md](delivery.md) §7. Enrichment of a sealed event MUST
be carried alongside it, not inside it.

## 5. Digest encoding

`integrity.hash` and `integrity.previousHash` MUST be encoded as **lower-case hexadecimal** with an
even number of digits. The canonical schema enforces this.

A single encoding is mandated because a digest that might be hexadecimal, base64 or base64url cannot
be compared without guessing which: a 64-character hexadecimal digest is also a well-formed base64
character sequence, so no verifier can distinguish them reliably. Hexadecimal was chosen over
base64url because it is fixed-length per algorithm, has no padding or alphabet variants, and can be
compared by eye in a report. Its 33% size cost on a 32-byte digest is not material.

`integrity.signature.value`, `change.beforeHash`, `change.afterHash` and `evidence[].hash` are **not**
restricted to hexadecimal. Those values are frequently echoed from the system that produced them, and
OpenAuditModel tooling does not recalculate them.

## 6. Hash algorithms

`hashAlgorithm` is an open vocabulary, matched case-sensitively, so that a new algorithm can be
adopted without a specification change.

Conforming v0.1 tooling MUST implement:

```text
SHA-256   SHA-384   SHA-512
```

Producers SHOULD use one of those three. A producer MAY declare another identifier — `BLAKE3`, for
example — and a verifier that does not implement it MUST report the event as unverifiable rather than
as verified. **Acceptance by the schema is not a claim of verifier support**, and tooling MUST NOT
present it as one.

A verifier MUST reject a declared hash whose length disagrees with the declared algorithm.

### 6.1 Signature algorithms

`integrity.signature.algorithm` is likewise an open vocabulary, matched case-sensitively.

Conforming v0.1 tooling MUST implement:

```text
Ed25519
```

`ECDSA-P256-SHA256` and `RSA-PSS-SHA256` are recommended identifiers a producer MAY use; a verifier
that does not implement them MUST report the signature as unverifiable rather than as verified, for
the same reason an unimplemented hash algorithm is reported and not silently accepted.

A signature is calculated and verified over the same digest input as `hash` — the canonicalized event
with `/integrity/hash` and `/integrity/signature` removed (§4) — so it covers `sequence`,
`previousHash` and `chainId` exactly as the hash does; a signed chain is exactly as tamper-evident as a
hashed one. `integrity.signature.value` MUST be base64-encoded for a v0.1 verifier to check it. The
schema's `digest` type also permits hexadecimal and base64url, because the field is often echoed
verbatim from whatever system produced it, but a v0.1 verifier implements one encoding, not three, and
reports a value in another encoding as unverifiable.

`integrity.signature.keyId` is never dereferenced. v0.1 defines no key registry, trust store or
certificate parsing: a verifying party obtains the public key out of band, by whatever means it
already trusts, and supplies it directly.

## 7. Chains

`previousHash` links an event to its predecessor, so that removing or altering a member of the
sequence breaks the chain and becomes detectable.

### 7.1 Chain rules

For an event to participate in chain verification:

1. It MUST declare `integrity.chainId`. Chain membership is explicit; it is never inferred.
2. It MUST declare `integrity.hash`.
3. It MUST declare `sequence`. Ordering is by `sequence`; there is no other deterministic order.
4. Every event in one chain MUST declare the **same** `hashAlgorithm` and the **same**
   `canonicalization`. A `previousHash` produced under a different algorithm can never equal the
   predecessor's `hash`.
5. Two events in one chain MUST NOT declare the same `sequence`.
6. Sequence numbers MAY be non-contiguous. The core model permits gaps, and a genuinely removed event
   breaks a link rather than only leaving a gap.

### 7.2 The first event

**The first event in a chain MUST omit `previousHash`.**

No genesis constant is defined. A magic value would have to be agreed, encoded, and then distinguished
from a real digest by every verifier; omission is unambiguous and needs no agreement.

A verifier given a set whose lowest-sequence event _does_ declare `previousHash` MUST report that the
supplied set is a **segment** of a chain rather than a chain from its beginning. That is not a
failure — verifying a window is legitimate — but it MUST be visible in the report, because a segment
that verifies says nothing about the events before it.

### 7.3 Linking

For every event after the first, `integrity.previousHash` MUST equal the **declared**
`integrity.hash` of the preceding event in sequence order.

Comparison is against the predecessor's declared hash rather than a recalculation. This is not weaker:
every event's declared hash is independently verified against its own recalculated digest, so the two
formulations are equivalent whenever verification passes. It is more useful when verification fails,
because a modified event and a broken link are then reported as separate, individually locatable
problems instead of one smearing into the other.

### 7.4 Chain scope

Chains MAY be **instance-level**, **partition-level** or **batch-level**. A single global hash chain
is **NOT** required, and for most distributed systems is not achievable without a serialization
bottleneck the audit model has no business imposing. A set of events containing several chains is
verified as several independent chains.

## 8. What verification does not prove

This section is normative in the sense that documentation and tooling MUST NOT claim otherwise.

1. **An event hash does not prevent deletion.** A verifier can detect that an event is missing from a
   chain; nothing stops it being removed.
2. **An event hash does not provide storage immutability.** It detects change; it does not prevent it.
3. **Chain verification proves consistency of the supplied set only.** It cannot prove that the whole
   historical chain was supplied.
4. **Tail truncation may be undetectable.** An attacker who removes the most recent events leaves a
   shorter chain that is internally perfectly consistent. Detecting this requires an external
   checkpoint — a chain head published somewhere the attacker does not control — which is out of
   scope for v0.1.
5. **Head truncation is reported, not prevented.** A segment that does not begin at a genesis event is
   flagged, but a verifier cannot know what preceded it.
6. **Hash chaining does not replace WORM storage.** A party that can rewrite the store can also
   recompute the chain, unless the chain is anchored somewhere they do not control.
7. **Hash chaining does not guarantee completeness across distributed producers.** Each producer
   attests to its own sequence. Events a producer never emitted, or a producer that never started,
   leave no gap to detect.
8. **Distributed ordering is outside the core model.** `sequence` orders events within one chain, not
   across producers.
9. **A digital signature does not automatically create legal evidentiary status.** Whether a signature
   is admissible or probative is a legal question depending on jurisdiction, process, key custody and
   the circumstances of the dispute. This specification makes no claim about it.
10. **Key management is outside the core specification.** Key generation, storage, rotation,
    revocation, distribution and custody are all out of scope. `keyId` identifies a key; it says
    nothing about how that key is protected.
11. **Verification is only as good as its reference.** A verifier that obtains both the events and the
    expected digests from the same untrusted store has verified nothing.

## 9. Verifying with the conformance tooling

Two commands are implemented in v0.1. Both are offline: they resolve no remote reference, fetch no
evidence URL and execute nothing contained in an event.

```bash
auditmodel verify-integrity examples/integrity/valid/single-event-sha256.json
auditmodel verify-chain examples/integrity/valid/three-event-chain
```

`verify-integrity` validates the event against the canonical schema, confirms the declared
canonicalization and algorithm are implemented, recalculates the digest and compares it with
`integrity.hash`.

`verify-chain` additionally groups events by `chainId`, orders them by `sequence`, and checks every
link. It detects broken links, modified events, reordering, duplicate sequences, missing sequences,
mixed algorithms and unsupported algorithms.

Both commands accept `--public-key <path>`, a PEM-encoded Ed25519 public key. When it is supplied and
an event declares `integrity.signature`, the signature is verified against the same digest input as
the hash; without it, a declared signature is neither checked nor reported on, which keeps every
example above byte-for-byte the same whether or not an event happens to carry one:

```bash
auditmodel verify-integrity examples/integrity/valid/signed-event-ed25519.json \
  --public-key examples/integrity/keys/ed25519-test-public.pem
```

Exit codes are `0` verified, `1` a verification failed, `2` a usage, read or parse error.

**Implemented in v0.1:** Ed25519 signature verification, given a public key supplied out of band —
there is no key registry to resolve `keyId` against.

**Not implemented in v0.1**, and not to be inferred from the presence of the fields that would support
them: signing, ECDSA-P256-SHA256 and RSA-PSS-SHA256 signature verification, key generation, key
storage, key management integrations, certificate parsing, trust stores, transparency logs, timestamp
authorities, WORM storage and remote verification services.

## 10. Practical guidance

- Integrity metadata is OPTIONAL. An application without it is fully conforming. It SHOULD NOT be
  added because it sounds reassuring; it is worth adding when there is a verifier that will actually
  check it.
- Producers SHOULD start with per-instance chains. They require no coordination and detect the most
  common failure mode: selective deletion from a single store.
- Producers SHOULD periodically publish chain heads to a system under different administrative
  control. That is the difference between a chain that detects tampering by an outsider and one that
  detects tampering by anyone.
- Verifiers SHOULD treat a broken chain as a signal to investigate, not as proof of misconduct.
  Crashes, replays and misconfigured batching break chains routinely.
- A producer MUST NOT re-seal an event to repair a failed verification. The correct response to a
  mismatch is investigation.

## 11. Examples

An event in an instance-level chain:

```json
{
  "sequence": 2,
  "integrity": {
    "canonicalization": "RFC8785",
    "hashAlgorithm": "SHA-256",
    "hash": "f7fbea247bdde9c24f07d81cb6ba82b60372f293b2d618066b065bac880dcbf1",
    "previousHash": "3e9462f941036e9b676694cf80fcf17bb438ddff9fb4fb6f67220eca3399ba1b",
    "chainId": "chain-platform-control-service-instance-7c1a"
  }
}
```

A signed event with no hash and no chain. This one is illustrative only, not verifiable: v0.1's
`verify-integrity` requires a hash before it checks anything at all, so a signature with no
accompanying `hash` is reported `hash-missing` even though the tooling implements Ed25519 signature
verification. A signature MUST currently accompany a hash to be checked; see
[examples/integrity/valid/signed-event-ed25519.json](../examples/integrity/valid/signed-event-ed25519.json)
for the combination `verify-integrity --public-key` actually verifies.

```json
{
  "integrity": {
    "canonicalization": "RFC8785",
    "signature": {
      "algorithm": "Ed25519",
      "value": "3045022100c0ffee1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      "keyId": "key-2026-03"
    }
  }
}
```

Complete, verifiable fixtures are published under
[examples/integrity/](../examples/integrity/).
