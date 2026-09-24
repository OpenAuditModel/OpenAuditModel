# Integrity fixtures — as published in 0.6.0, under specification 0.1

> **Preserved, not generated.** This copy is the 0.1 corpus exactly as 0.6.0 published it, kept so
> that the 1.x tooling is held to verifying archives sealed under 0.1. Nothing regenerates it; the
> generator described below now writes the 1.0 fixtures in `examples/integrity/`. See
> [../../README.md](../../README.md).

**Status: Informative.** These fixtures illustrate and regression-test tamper-evidence verification.
They are not normative; the normative digest procedure is
[specification/integrity.md](../../../../specification/integrity.md) §4.

Every fixture is **generated**, never hand-edited. They carry real digests, so a single edited
character invalidates a hash — and a hand-corrected hash would hide whatever the edit broke. The
generator is [`conformance/tools/generate-integrity-fixtures.ts`](../../../../conformance/tools/generate-integrity-fixtures.ts)
and it uses the same digest code the verifier uses, so a fixture cannot encode a procedure the
implementation does not follow.

```bash
npm run fixtures:integrity     # regenerate and reformat
```

A test compares the on-disk content with what the generator produces, so drift fails the build.
Nothing writes fixtures during a normal test run.

## Verifying them

```bash
auditmodel verify-integrity examples/integrity/valid/single-event-sha256.json
auditmodel verify-chain examples/integrity/valid/three-event-chain
auditmodel verify-integrity examples/integrity/valid/signed-event-ed25519.json \
  --public-key examples/integrity/keys/ed25519-test-public.pem
auditmodel verify-checkpoint examples/integrity/valid/three-event-chain \
  --checkpoint examples/integrity/checkpoints/three-event-chain.checkpoint.json
auditmodel verify-proof examples/integrity/valid/three-event-chain/002.json \
  --proof examples/integrity/proofs/three-event-chain.002.proof.json
```

Every event fixture in this directory, valid and invalid alike, is a **schema-valid** event. The
invalid ones fail verification, not validation — that is the point of separating the two commands.
The documents under [checkpoints/](checkpoints/) and [proofs/](proofs/) are not events; they
validate against the [checkpoint schema](../../../../schemas/checkpoint/v0.1/checkpoint.schema.json) and
the [proof schema](../../../../schemas/proof/v0.1/proof.schema.json).

## Keys

[keys/ed25519-test-public.pem](keys/ed25519-test-public.pem),
[keys/ecdsa-p256-test-public.pem](keys/ecdsa-p256-test-public.pem) and
[keys/rsa-pss-test-public.pem](keys/rsa-pss-test-public.pem) are the public halves of TEST-ONLY key
pairs, one per implemented algorithm, generated solely to make the signed fixtures and their invalid
variants reproducible by the fixture generator, the same way their hashes are. **The private halves
are committed in the generator itself and are not secrets** — anyone can produce a "validly signed"
event under these keys, which is exactly why a real signing key must never be generated this way or
checked into a repository.

Two of the three schemes are not deterministic in Node: ECDSA draws a fresh nonce per signature and
RSA-PSS a fresh salt. The RSA-PSS fixture is signed with a zero-length salt, which is deterministic
and still verifies. ECDSA has no such switch, so `signed-event-ecdsa-p256.json` is the one fixture the
generator does not regenerate byte-for-byte: its check compares every field except the signature
value and then **verifies** the committed value with the test key, which fails on any edit just as
deep equality would.

## Valid fixtures

| Fixture                                                              | Demonstrates                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [single-event-sha256.json](valid/single-event-sha256.json)           | A sealed event with no chain                                               |
| [unicode-and-number-event.json](valid/unicode-and-number-event.json) | RFC 8785 determinism over mixed scripts, escapes, number forms and nesting |
| [signed-event-ed25519.json](valid/signed-event-ed25519.json)         | A sealed event additionally signed; verifiable with `--public-key`         |
| [signed-event-ecdsa-p256.json](valid/signed-event-ecdsa-p256.json)   | The same content signed with ECDSA-P256-SHA256 (IEEE P1363 encoding)       |
| [signed-event-rsa-pss.json](valid/signed-event-rsa-pss.json)         | The same content signed with RSA-PSS-SHA256 (2048-bit key, zero salt)      |
| [three-event-chain/](valid/three-event-chain/)                       | A genesis event and two linked successors, sequences 1 to 3                |
| [chain-in-two-batches/](valid/chain-in-two-batches/)                 | The same three events from a second instance, sealed in two batches        |

`unicode-and-number-event.json` deliberately stores its members out of sorted order, mixes upper and
lower case keys, digit keys, Latin-1 and CJK keys, a non-BMP character, combining marks, control
character escapes, and numbers that exercise the ECMAScript number-to-string forms (`1e+21`, `1e-7`,
`0.000001`). Canonicalization has to normalise all of it before the digest is stable.

**`chain-in-two-batches` carries `integrity.batchId`**, the one integrity field no command used to
read. `verify-chain` lists the batches as a note and does nothing else with them: a batch is the group
sealed together, not a verification scope, so the chain is intact exactly as `three-event-chain` is.
Because `batchId` is inside the digest, its three events are different events with different hashes,
not the other chain relabelled — relabelling one after sealing is a `hash-mismatch`. See
[ADR 0013](../../../../decisions/0013-batch-id-reported-not-judged.md).

## Invalid fixtures

Each fails verification for one documented reason. The expectations are asserted by
[`integrity-event.test.ts`](../../../../conformance/tests/integrity-event.test.ts) and
[`integrity-chain.test.ts`](../../../../conformance/tests/integrity-chain.test.ts).

| Fixture                                                                              | Defect                                                                    | Finding                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [tampered-event.json](invalid/tampered-event.json)                                   | Content changed after sealing; declared hash untouched                    | `hash-mismatch`                                                     |
| [wrong-declared-hash.json](invalid/wrong-declared-hash.json)                         | Content untouched; declared hash is a digest of another event             | `hash-mismatch`                                                     |
| [unsupported-algorithm.json](invalid/unsupported-algorithm.json)                     | Declares `BLAKE3`, which the v0.1 verifier does not implement             | `unsupported-algorithm`                                             |
| [tampered-signed-event.json](invalid/tampered-signed-event.json)                     | Content changed after signing; hash fails before the signature is reached | `hash-mismatch`                                                     |
| [unsupported-signature-algorithm.json](invalid/unsupported-signature-algorithm.json) | Declares `ECDSA-P384-SHA384`, which this verifier does not implement      | `unsupported-signature-algorithm`                                   |
| [broken-previous-hash/](invalid/broken-previous-hash/)                               | Event 3 re-linked past event 2 and re-sealed                              | `broken-link`                                                       |
| [duplicate-sequence/](invalid/duplicate-sequence/)                                   | Two events declare sequence 2                                             | `duplicate-sequence`                                                |
| [missing-sequence/](invalid/missing-sequence/)                                       | Event 2 declares no sequence                                              | `sequence-missing`                                                  |
| [reordered-chain/](invalid/reordered-chain/)                                         | Events 2 and 3 swap sequence numbers without re-sealing                   | `hash-mismatch`                                                     |
| [truncated-chain/](invalid/truncated-chain/)                                         | Events 1 and 2 of the three; the tail is gone                             | none from `verify-chain`; `tail-truncated` from `verify-checkpoint` |

### Why some of these look similar

**`tampered-event` and `wrong-declared-hash` both report `hash-mismatch`** and are different attacks.
In the first, the event changed and the hash did not. In the second, the event is exactly as sealed
and the hash was replaced. A verifier cannot tell them apart from one event — which is worth knowing,
and is why both are published.

**`broken-previous-hash` is the interesting one.** Every event's own digest is valid; running
`verify-integrity` over all three files reports three successes. Only chain verification finds the
problem, because the defect is not in any event but in the relationship between them. This is the
fixture that shows what chaining adds.

**`unsupported-algorithm.json` was sealed with SHA-256 and then relabelled.** Its hash is a real
digest, under a different algorithm than the one it declares. The verifier refuses on the algorithm
before it compares anything, which is the intended behaviour: the schema accepts the identifier, and
acceptance is not support.

**`reordered-chain` fails on digests rather than links** because `sequence` is part of the digest
input. Swapping two events' positions invalidates both of them without anything else being touched —
which is precisely the reason chain metadata is inside the digest. See
[ADR 0006](../../../../decisions/0006-event-digest-and-chain-verification.md).

**`tampered-signed-event.json` reports `hash-mismatch`, never a signature finding**, even with
`--public-key` supplied. Hash verification runs first; a mismatch there is reported and the signature
is never reached. The signature would in fact also fail — the content changed after both sealing and
signing — but the tool reports the first problem it finds, not every problem that exists.

**`truncated-chain` is not broken.** It is the first two events of `three-event-chain`, exactly as
sealed, and `verify-chain` reports it intact — a chain whose tail was deleted is internally
consistent, which is what [integrity.md](../../../../specification/integrity.md) §8 (item 4) warns about.
Only a checkpoint can show what is missing; see below.

## Checkpoints

A checkpoint records a chain's head so that it can be kept somewhere the store's administrators do
not control. The documents under [checkpoints/](checkpoints/) are generated by the same tool as the
events, from the same hashes, and are compared with an archive by `verify-checkpoint`.

| Document                                                                                                 | Against                       | Outcome                                     |
| -------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| [three-event-chain.checkpoint.json](checkpoints/three-event-chain.checkpoint.json)                       | `valid/three-event-chain/`    | agrees; signed with the Ed25519 test key    |
| the same document                                                                                        | `invalid/truncated-chain/`    | exit 1, `tail-truncated`                    |
| the same document                                                                                        | `valid/chain-in-two-batches/` | exit 3: the archive holds no such chain     |
| [three-event-chain.stale.checkpoint.json](checkpoints/three-event-chain.stale.checkpoint.json)           | `valid/three-event-chain/`    | agrees, with one event noted as not covered |
| [three-event-chain.wrong-head.checkpoint.json](checkpoints/three-event-chain.wrong-head.checkpoint.json) | `valid/three-event-chain/`    | exit 1, `checkpoint-head-mismatch`          |
| [three-event-chain.unanchored.checkpoint.json](checkpoints/three-event-chain.unanchored.checkpoint.json) | anything                      | exit 2: not a checkpoint, nothing judged    |
| [archive.checkpoint.json](checkpoints/archive.checkpoint.json)                                           | both `valid/` chains together | agrees; the multi-chain form                |

The pair worth running is the second one, because the two commands disagree on purpose:

```bash
auditmodel verify-chain examples/integrity/invalid/truncated-chain          # exit 0
auditmodel verify-checkpoint examples/integrity/invalid/truncated-chain \
  --checkpoint examples/integrity/checkpoints/three-event-chain.checkpoint.json   # exit 1
```

**The anchoring rule is a schema constraint.** `anchor.type` and `anchor.reference` are required and
may not be blank, which is why `three-event-chain.unanchored.checkpoint.json` exits `2` rather than
`1`: a checkpoint that names no place beyond the store's reach is not a checkpoint, and nothing about
the archive is judged against it. The verifier never dereferences an anchor.

**What a passing run establishes** is printed after every verdict: the archive is consistent with the
checkpoint it was handed. Whether the checkpoint is genuine and its anchor real is for whoever holds
the anchor. A checkpoint kept beside the events it describes is noted as such, because whoever can
rewrite the store can rewrite it too.

## Inclusion proofs

An inclusion proof shows that one event is a leaf of a Merkle tree whose root has been published,
without the rest of the tree. The event's `integrity.hash` is the leaf; nothing is added to the event.
The documents under [proofs/](proofs/) are generated from the three chain events' digests.

**The tree is hashed as RFC 6962 §2.1 defines it**, and the schema's description says the same, so
an implementer in another language builds the same tree from the document rather than from this
repository's code:

- a leaf is `H(0x00 ‖ d)`, where `d` is the event's `integrity.hash` decoded from hexadecimal;
- an interior node is `H(0x01 ‖ left ‖ right)` over the raw node hashes;
- a tree over `n` leaves splits at `k`, the largest power of two smaller than `n`; an odd node at any
  level is promoted unchanged, never duplicated;
- the path lists sibling hashes from the leaf upward, each with the side the sibling sits on, and its
  shape is fully determined by the leaf's index and the tree's size — `verify-proof` checks the shape
  before it hashes anything.

The prefixes are what keep a leaf from colliding with a node; a tree hashed without them admits a
second-preimage construction, and "we used SHA-256" is not a specification of a tree.

| Document                                                                                          | Against                             | Outcome                                 |
| ------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------- |
| [three-event-chain.002.proof.json](proofs/three-event-chain.002.proof.json)                       | `valid/three-event-chain/002.json`  | verified; root signed with the test key |
| the same document                                                                                 | `valid/three-event-chain/001.json`  | exit 1, `proof-leaf-mismatch`           |
| the same document                                                                                 | `invalid/tampered-event.json`       | exit 1: the event fails its own digest  |
| the same document                                                                                 | `examples/valid/minimal-event.json` | exit 3: no hash, so nothing to prove    |
| [three-event-chain.002.wrong-root.proof.json](proofs/three-event-chain.002.wrong-root.proof.json) | `valid/three-event-chain/002.json`  | exit 1, `proof-root-mismatch`           |

The root carries the checkpoint's anchoring rule and may carry a signature over the `root` object
with `/signature` removed, so one signed root serves every proof cut from its tree. A passing proof
shows membership of the tree the root describes; the root's provenance is the anchor's, and the
command says so after every verdict.

## What these fixtures cannot show

Nothing here demonstrates a checkpoint whose anchor was itself forged or withdrawn, because that is
not something an offline tool can see. The tool compares an archive with the checkpoint in front of
it; the anchor's provenance is the holder's. That limitation is real, is not an implementation
defect, and is stated in [integrity.md](../../../../specification/integrity.md) §8, item 11.
