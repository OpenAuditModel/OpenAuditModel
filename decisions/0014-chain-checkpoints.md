# 0014 — Chain checkpoints

## Status

Accepted — 2026-09-20. Applies to specification version 0.1; no schema change to the audit event.
Implemented in tooling 0.5.0 as a separately versioned document, `checkpointVersion` 0.1.

## Context

[integrity.md](../specification/integrity.md) §8 has said since v0.1 that chain verification proves
consistency of the supplied set only, and that tail truncation may be undetectable: an attacker who
removes the most recent events leaves a shorter chain that is internally perfectly consistent. The
same section names the remedy — a chain head recorded somewhere the attacker does not control — and
§10 asks producers to publish chain heads periodically. Until this decision nothing said what such a
record looks like, and nothing could compare an archive with one. The fixture corpus could not even
show the problem: `examples/integrity/README.md` said, correctly, that no fixture demonstrated tail
truncation because there was nothing to detect it with.

ADR 0006 put chain metadata inside the digest so that re-linking and re-ordering are detectable. ADR
0012 added signatures over the same input. Both close doors an attacker who edits events would use.
Neither closes the door an attacker who deletes events uses, and that is the door a checkpoint
closes — the only one, in this design, that needs something kept outside the store.

## Decision

### 1. A tooling document with its own version, not a specification change

The checkpoint is a JSON document under its own schema,
`https://openauditmodel.org/schemas/checkpoint/0.1/schema.json`, versioned by `checkpointVersion`
independently of the specification — the same arrangement `profile-definition` has had since ADR 0008. The audit event schema does not change, no normative document changes meaning, and the
specification stays 0.1. §8 gains an informative pointer to the tooling; the normative statement that
truncation may be undetectable stands, because it is true of chain verification and the checkpoint
is what a verifier brings to it from outside.

The document borrows the event schema's `$defs` — `hexDigest`, `identifier`, `timestamp`,
`algorithmIdentifier`, `signature` — by reference rather than restating them, so a digest means one
thing across both documents. The verifier registers both schemas and resolves the references at
compile time; nothing is fetched.

### 2. The anchoring rule is a schema constraint, and the anchor is never dereferenced

`anchor` is required, and its `type` and `reference` are required and may not be blank. A
checkpoint that names no place beyond the store's reach is schema-invalid: not a weak checkpoint but
not a checkpoint, and `verify-checkpoint` exits `2` for it and judges nothing about the archive.
This is §8 item 11 — verification is only as good as its reference — as the one constraint a tool can
check. `type` is an open vocabulary with recommended values (`publication`, `transparency-log`,
`timestamp-authority`, `ledger`, `manual`); `reference` is whatever the anchor is in that form.

The verifier never dereferences an anchor. It is offline, as §9 says of all the tooling, and it could
not in any case establish that a URL, a log entry or a countersigned ticket is what it claims to be.
It reports the anchor and moves on.

### 3. What `verify-checkpoint` establishes, and the exit codes that say so

The command verifies the archive exactly as `verify-chain` does, then compares every chain the
checkpoint names with what the archive holds under that identifier: the event at the recorded
sequence must carry the recorded hash, and the event count is compared when the checkpoint states
one. The findings name the ways an archive can differ: `tail-truncated` when the chain ends before
the head, `checkpoint-head-missing` when the archive skips the head's sequence but continues past it,
`checkpoint-head-mismatch` when the event is there with another hash, `checkpoint-count-mismatch`,
`checkpoint-algorithm-mismatch` when the two documents do not share an algorithm and
canonicalization, and `checkpoint-chain-missing` when the archive has no such chain. Events after
the head are a note, never a failure: a checkpoint from yesterday does not fail today's archive.

Exit codes follow the contract the CLI has always had. `0`: the archive agrees. `1`: it does not, or
the archive itself is broken — a broken archive never agrees with anything, whatever its head says.
`2`: the tool could not run, including a document that is not a checkpoint. `3`: no verdict — the
archive holds none of the chains the checkpoint names, so nothing was compared. `3` exists so that
pointing the tool at the wrong archive cannot read as a pass.

Every report, passing or failing, ends with the same line: an agreeing verdict establishes only
that the archive is consistent with the supplied checkpoint; whether the checkpoint is genuine and
its anchor real is for whoever holds the anchor. Without that line a tool that trusts whatever checkpoint it is handed
would satisfy the "detects truncation" requirement while being the silence-as-approval failure this
project exists to refuse. When the checkpoint file lies under a directory the events were read from,
the report notes it; the tool cannot know a store's boundaries, but it can see the two paths
coincide.

### 4. The archive manifest is the checkpoint's multi-chain form

An archive manifest — one head per chain, plus what the archive holds — is a set of checkpoints
taken together. It is therefore a second form of the same document, `chains: [{ chainId, head,
eventCount }]` in place of `chainId`/`head`, with optional `description`, `applications` and
`timeRange` that are descriptive and never evaluated. One schema, one command, one anchoring rule. A
second schema for the same idea would be the two-`manifest.json` problem again. In the multi-chain
form, a named chain that is absent while others are present is a finding, because the archive is
evidently the one described and part of it is gone; when none is present the outcome is `3`, as for
the single-chain form.

### 5. A checkpoint's signature is verified under the event rules

`signature` has the event's shape and covers the canonical form of the document with `/signature`
removed — the same procedure as an event, with the pointer at the document root. `--public-key`
verifies it alongside the events' signatures, with the same three outcomes: valid, declared but not
checked without a key, and failed for an algorithm this verifier does not implement whether or not
a key is supplied. A signature that fails against the supplied key is the verdict: a checkpoint that
is not what its signer signed cannot vouch for anything. A producer-signed checkpoint binds the
producer's claim, not the store; the honest line above says so by saying nothing more.

### 6. The deleted-tail fixture lives under `invalid/` and passes `verify-chain`

`examples/integrity/invalid/truncated-chain/` is the first two events of `three-event-chain`,
untouched. `verify-chain` reports it intact and the conformance kit records it as intact; against the
checkpoint taken at sequence 3 it is `tail-truncated`, and the kit's new `checkpoints` family records
that too. The two records about one directory disagree on purpose. It sits under `invalid/` because
it is invalid in the sense that matters — the archive is not what it was — and the discipline that
every directory under `invalid/` fails `verify-chain` is relaxed for exactly this one, with the CI
loop that enforces it naming the exception. The fixture was generated and watched to pass
`verify-chain` before the command that catches it existed.

## Consequences

- No existing verdict moves. `verify-integrity` and `verify-chain` are unchanged; the checkpoint is a
  third command and a third document.
- `verify-checkpoint` is the first command with a document input beside the events (`--checkpoint`)
  and the first verification command with `--format json`, because an archive check is what a
  scheduled job runs. `--checkpoint` is refused by every other command, as `--format` is by the
  commands it does not apply to.
- The npm package ships a second schema file under `schemas/`; the site publishes it at its `$id`;
  the MCP server gains `verify_checkpoint` and serves the schema as a resource. The kit gains a
  `checkpoints` family whose records name a document and the archive directories it was compared
  with.
- The viewer is not touched. A "covered up to sequence N by an anchored checkpoint" indicator is the
  natural viewer item once it reads checkpoints; that is a later stop.
- The specification still says truncation may be undetectable, and it is right: it is undetectable
  by chain verification. What changed is that the reference §8 asks for now has a format the tooling
  can compare against.

## Alternatives considered

**A normative section in `integrity.md`.** Rejected for 0.5.0: it is a specification change, it
would make the checkpoint format part of conformance for producers who never publish one, and the
format should earn normativity by being used first. It belongs to a later specification version's
ADR if it belongs anywhere.

**A separate archive-manifest schema.** Rejected; see decision 4.

**Dereferencing anchors — fetching the publication URL, querying the log.** Rejected: the tooling is
offline by contract, a network check proves little about custody, and a tool that sometimes checks
anchors would teach readers that a passing run means the anchor was checked.

**A checkpoint scoped by `batchId`.** Rejected in ADR 0013: a batch is not a verification scope.

**Failing the archive for events after the head.** Rejected: it would make every checkpoint stale the
moment the next event was written, and the uncovered tail is exactly what §8 says is exposed until
the next checkpoint. It is a note.

## Security considerations

- The report contains identifiers, sequences and hashes; never event content.
- A checkpoint proves nothing about its own provenance, and the tool says so every time. An attacker
  who controls the store and the place the checkpoint is kept can rewrite both; the anchoring rule
  makes that a documented choice rather than a silent one, and no more.
- Because the signature covers the whole document, an edited count or head cannot keep a signature
  that was valid before the edit.
- `verify-checkpoint` reads two things a caller supplies and executes neither; a checkpoint's
  `reference` is printed, not opened.
