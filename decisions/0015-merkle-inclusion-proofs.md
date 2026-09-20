# 0015 — Merkle inclusion proofs

## Status

Accepted — 2026-09-20. Applies to specification version 0.1; no schema change to the audit event.
Implemented in tooling 0.5.0 as a separately versioned document, `proofVersion` 0.1.

## Context

A checkpoint (ADR 0014) lets a verifier compare a whole archive with a recorded head. It answers
"is this archive still what it was", and it needs the archive. It does not answer the question an
auditor, a customer or a court asks about one record: "was this event in the trail that was
published, without handing over the trail". That question is what a Merkle inclusion proof answers:
a short path of sibling hashes from one leaf to a root, verifiable by anyone who holds the event and
the root, revealing nothing about the other leaves.

The event model already has the leaf. `integrity.hash` is a digest of the canonical event, produced
by a normative procedure (ADR 0006); a proof needs to add nothing to the event, and this decision
adds nothing. What was missing was a document format for the path and the root, a hashing rule for
the tree, and a verifier.

The hashing rule is the part that is expensive to get wrong. A tree is not specified by naming its
hash function: a scheme that hashes bare concatenations lets an attacker present an interior node as
a leaf, and two implementers who guess differently about odd nodes build different trees from the
same leaves and never agree on a root.

## Decision

### 1. A tooling document with its own version, as the checkpoint is

The proof is a JSON document under `https://openauditmodel.org/schemas/proof/0.1/schema.json`,
versioned by `proofVersion`. The specification stays 0.1; the audit event schema is untouched. The
document borrows digests, identifiers and the signature shape from the event schema and the anchor
from the checkpoint schema, all by reference, so one anchoring rule holds across both documents and
a digest means one thing in all three.

### 2. RFC 6962 hashing, written into the schema

Leaves and interior nodes are domain-separated exactly as RFC 6962 §2.1 does it: a leaf is
`H(0x00 ‖ d)` where `d` is the event's `integrity.hash` decoded from hexadecimal, an interior node is
`H(0x01 ‖ left ‖ right)` over raw node hashes, a tree over `n` leaves splits at `k`, the largest
power of two smaller than `n`, and an odd node at any level is promoted unchanged, never duplicated.
`H` is the proof's `hashAlgorithm`, one the verifier implements, and every digest in the document
must be that algorithm's length. The rule is stated in the schema's description and in
`examples/integrity/README.md`, not left to `merkle.ts`, because an implementer in another language
builds to the document. The prefixes are what make a second-preimage construction against the tree
impossible; the split and promotion rules are what make two implementations agree.

### 3. A proof is a proof of position

`leaf.index` and `root.leafCount` are required. Given both, the shape of an audit path — how many
steps and which side each sibling sits on — is fully determined, and the verifier checks it before
it hashes anything: a path of the wrong shape is `proof-path-inconsistent`, an index outside the tree
is `proof-position-invalid`. A proof therefore says "this event is leaf `m` of `n`", which is what a
reader can cross-check against a checkpoint's event count or against another proof from the same
tree, rather than "this hash appears somewhere in some tree of this root".

### 4. What `verify-proof` establishes, and the exit codes that say so

The proof's own consistency is checked first, because it holds or fails regardless of which event
is offered: algorithm, digest lengths, path shape, and the root the path recomputes to
(`proof-root-mismatch` when it differs). The event is then verified exactly as `verify-integrity`
verifies it, and its `integrity.hash` must be the leaf (`proof-leaf-mismatch`). Exit `0` when the
proof verifies; `1` when it does not, or the event fails its own verification — a tampered event
fails on its digest, and the proof fails with it; `2` when the document is not a proof; `3` when the
event's hash cannot be established, because there is then nothing to prove and no verdict is
possible. A broken proof with an unprovable event is a failed proof, not a missing verdict.

Every report ends with the same line: a verified proof shows only that the event is a member of
the tree the root describes; the root's provenance is the anchor's. A root carries the checkpoint's anchoring rule,
and the verifier never dereferences the anchor.

### 5. The root is signed once, and the signature covers the root

`root.signature` has the event's shape and covers the canonical form of the `root` object with
`/signature` removed, not the whole proof. One signed root therefore serves every proof cut from
its tree, which is how a producer publishes: one signed tree head, many paths. `--public-key`
verifies it under the event rules alongside the event's own signature; a root signature that fails
against the supplied key is the verdict.

## Consequences

- No existing verdict moves. `verify-proof` is a fourth command and a third tooling document.
- The npm package ships a third schema under `schemas/`; the site publishes it at its `$id`; the MCP
  server gains `verify_proof` and serves the schema. The kit gains a `proofs` family whose records
  name a document and the event it was verified against, and record the event's own findings
  separately from the proof's.
- `merkle.ts` is the reference implementation of the tree and is exported, so a producer in Node can
  build trees and cut paths with the same code the verifier uses. Producers in other languages build
  to the schema's description, and the published fixtures — a three-leaf tree, its root, and the
  path of leaf 1 — are the vectors to check against.
- A proof and a checkpoint are independent documents. Nothing yet ties a proof's root to a
  checkpoint's head; a producer who publishes both under one anchor has tied them, and a later stop
  can compare them.
- The viewer is not touched.
- One key per run, as for checkpoints (ADR 0014): `--public-key` verifies the root's signature and
  the event's with the same key.

## Alternatives considered

**Define our own tree.** Rejected: it is what everybody regrets. RFC 6962's rules are published,
analysed and implemented in several languages; a tree that differed from them in the odd-node case
or the prefixes would be a second thing for implementers to get wrong, for no gain.

**Duplicate the odd node instead of promoting it.** Rejected: it is the other common choice, it is
weaker — duplication lets two different leaf sequences share a root — and RFC 6962 does not do it.

**Hash the hexadecimal string rather than the decoded digest.** Rejected: the leaf is a digest, and
hashing its text encoding would make the tree depend on a representation choice the event model
already fixed as lower-case hexadecimal. The rule is stated explicitly so nobody has to guess.

**Make `leaf.index` and `root.leafCount` optional.** Rejected; see decision 3. Every Merkle library
knows both, and without them a proof cannot be placed.

**Sign the whole proof rather than the root.** Rejected: a producer would then sign once per proof,
and a reader could not tell that two proofs come from the same tree head. Signing the root is what
transparency logs do.

## Security considerations

- The report contains digests, an index and a count; never event content.
- A proof shows membership of a tree; it does not show the tree is complete, was published when the
  anchor says, or contains only genuine events. Those are the anchor's and the checkpoint's concerns,
  and the report's closing line says so.
- The domain-separation prefixes are load-bearing. An implementation that omits them produces a
  tree in which an interior node can be presented as a leaf; the verifier's fixtures will not agree
  with such an implementation, which is the point of publishing them.
- The verifier reads two documents a caller supplies and executes neither; the anchor's `reference`
  is printed, not opened.
