# 0013 — `batchId` is reported, not judged

## Status

Accepted — 2026-09-19. Applies to specification version 0.1; no schema change. Implemented in tooling
0.5.0.

## Context

`integrity.batchId` has been in the schema since v0.1, described as "the identifier of the batch this
event was sealed with", and [integrity.md](../specification/integrity.md) §2.1 spends a whole section
on what it is _not_: not a job run, not a processing batch, not an import, not any business operation.
It sits inside the digest (§4.1) so that batch membership is an assertion the hash covers, and §7.4
permits chains to be instance-level, partition-level or batch-level. Until this decision no command
read the field. `verify-chain` grouped by `chainId`, ordered by `sequence`, and treated `batchId` as
one more field the digest happened to cover; a producer that populated it got no sign that a verifier
had seen it, and "batch-level chains" had no tooling meaning at all.

The 0.5.0 milestone adds checkpoints and inclusion proofs, both of which name a chain and a head.
That is the last cheap moment to decide what a batch means to a verifier, because a checkpoint that
could name a batch instead of a chain would make the batch a second verification scope, and a scope
is the one thing §2.1 was written to keep it from becoming.

Three options were open: leave the field unread and say so; read it and report it; read it and judge
it.

## Decision

### 1. `verify-chain` lists the batches it sees, as notes

For every chain, the batches its events declare are listed in one note, in order of first appearance
by sequence: the identifier, the number of events, and the sequence span (`sequences 1..2`, or the
individual values when the batch has gaps). Events that declare no `batchId` are counted. The note
closes with the sentence that a batch is the group sealed together, not a verification scope. The
CLI prints notes unless `--quiet`; the MCP server's `verify_chain` returns them in `notes`. Notes are
not part of the conformance kit's recorded surface, so the kit's chain records do not change.

### 2. A batch is not a verification scope

Nothing about batches changes `intact`, an exit code or a finding. No command accepts a batch
identifier as an argument, and the checkpoint and proof documents this milestone introduces name a
`chainId`, never a `batchId`. A producer that wants a batch verified as a unit already has the means:
make the batch the chain, which §7.4 permits and which needs no second concept.

### 3. A batch shared across chains is stated, not failed

When one `batchId` appears in more than one chain of the supplied set, each chain's note says so and
names the others. It is a fact about the set. It would be a defect only under a claim that chains are
batch-level, and v0.1 has no document in which that claim can be made — a sealing batch spanning two
instance chains is unremarkable. If a checkpoint or an archive manifest ever carries such a claim, a
finding can be introduced then, checked against that claim rather than against a guess.

### 4. What a chain's head is

The same change gives `ChainVerificationResult` a `headHash`: the declared `integrity.hash` of the
event at the chain's highest sequence, the value §10 asks producers to publish somewhere they do not
control and the value a checkpoint compares against. It is the declared hash — already checked
against its recalculation by the time it is reported — and it is reported for a broken chain too,
because `intact` sits beside it and says what it is worth. It is omitted when the highest sequence is
declared by more than one event, since there is then no one head to name. The CLI prints it as
`head:`; `verify_chain` returns it per chain.

## Consequences

- No verdict moves. Every existing invocation of `verify-chain` exits as it did; the text output gains
  a `head:` line, and a note appears only for events that declare batches.
- The conformance kit records event counts, verdicts and finding kinds for chains, none of which
  change. The viewer's forked chain engine therefore stays in parity without a change, which is the
  reason this decision is deliberately verdict-free while that fork exists.
- `ChainVerificationResult.headHash` and the per-chain `headHash` of `verify_chain` are additions;
  nothing is removed or renamed.
- A batch identifier appears in the note. It is an identifier, as `chainId` already is in the
  `chain` heading; no event content is printed.
- Relabelling is closed by the digest, not by this tool: `batchId` is inside the digest input, so
  changing it after sealing is a `hash-mismatch`. The published fixture
  [examples/integrity/valid/chain-in-two-batches/](../examples/integrity/valid/chain-in-two-batches/)
  shows the note; the chain tests show the relabelling failure.
- The viewer's half of this decision — whether and how it shows batches — is a viewer 0.5.0 item and
  is not decided here.

## Alternatives considered

**Leave the field unread and record that.** Honest and free, and rejected because it leaves §7.4's
batch-level chains without any tooling meaning and gives a producer who populates the field nothing
back. A field the schema describes and the digest covers deserves at least to be shown.

**Judge it.** Make a batch a verification scope: let a checkpoint name a `batchId`, and have the tool
require every event of the batch to be present. Rejected for three reasons. It invents a second
grouping concept beside `chainId`, which is what §2.1 exists to prevent. The tool cannot know a
batch's intended membership without a manifest of the batch, so "complete" would be asserted from
the very events under suspicion, which is circular. And it moves verdicts in the one engine the
viewer still carries as a fork, for a property nobody has asked to have verified.

**A finding for a batch that spans chains.** Rejected until there is a claim to check it against;
see decision 3.

## Security considerations

- The note never contains event content; identifiers and counts only.
- Because `batchId` is inside the digest, an attacker cannot regroup sealed events into different
  batches without invalidating their hashes; and because batches carry no verdict, decorating a
  chain with plausible batch identifiers gains nothing.
- A reader of the note MUST NOT infer completeness from it. "2 events" means two events _were
  supplied_ under that identifier, not that the batch ever held two. Completeness is what
  checkpoints and proofs are for, and §8 still applies to both.
