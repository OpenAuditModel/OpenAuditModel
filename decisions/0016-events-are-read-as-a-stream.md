# 0016 — Events are read as a stream

## Status

Accepted — 2026-09-22. Applies to specification version 0.1; no schema change. Implemented in tooling
0.6.0.

## Context

Until 0.6.0 every command began the same way: expand the input paths, read every file into memory,
parse every event, and only then check anything. That is the right shape for the corpus the tool was
built against — a few hundred examples, a bundle of fixtures, a test archive — and the wrong shape
for the thing the tool is for. An audit archive is an append-only file that grows for as long as the
system it records is running. A year of a moderately busy service is measured in gigabytes, and the
cap that kept the reader honest, 8 MB per file, was low enough that such an archive could not be
offered to the tool at all: it was refused before anything was checked.

The cap was not wrong. A whole JSON document has to be parsed in one piece, because its shape is
unknown until the closing brace, and an unbounded read of an untrusted file is how a verifier is
turned into a denial of service against the machine running it. But JSON Lines is not one document.
It is one event per line, and a line is the unit both of parsing and of judgement.

Two further things forced a decision rather than a patch. A single malformed line discarded every
event in its file — a thousand-line export with one truncated line reported nothing at all, which is
the opposite of what an operator needs from a partly damaged archive. And chain verification, unlike
every other command, genuinely needs the whole set: a link is a relation between two events, and the
second may be in another file.

## Decision

### 1. JSON Lines is read a line at a time

`.jsonl` and `.ndjson` files are read in 64 KiB chunks and split into lines as the chunks arrive.
One event is held at a time. The whole-file cap no longer applies to them; what applies instead is a
cap of the same 8 MB on a single line, enforced both on a completed line and on a line still growing,
so that a file containing no newline at all is refused after one line's worth rather than read
entire. A partial multi-byte character at a chunk boundary is carried over rather than decoded on
its own, because a truncated UTF-8 sequence is one of the inputs this release exists to survive.

Single JSON documents are unchanged: still read whole, still capped at 8 MB. There is no partial
parse of a document whose shape is unknown until it ends.

### 2. The commands that judge one event at a time consume the stream

`validate`, `verify-integrity`, `lint-privacy` and `check-profile` read one event, judge it, report
it and release it. In text output they keep nothing but counters. With `--format json` they keep one
result per event, because that report names every event and cannot be written any other way — the
events themselves are still released as they are read.

`verify-checkpoint`, `verify-proof` and `check-coverage` hold every event at once and are not
changed. For them the whole-file limit stays: a JSON Lines file above 8 MB is refused unread, with
the message and the exit code it has always had. Removing the limit for a reader that releases what
it reads is the point of this decision; removing it for a caller that does not would replace a
clean refusal with a process killed part-way through, which is not a verdict and not one of the four
exit codes. The limit is therefore a property of how a caller reads, not of the file: `loadEventDocuments`
asks for it and the stream does not.

### 3. A checkpoint comparison is not made on an archive that was not read in full

`verify-checkpoint` exists to report what is missing from an archive, and an event that was not read
is missing in exactly the way a deleted one is. Since decision 3 lets a file yield the events before
its malformed line, comparing that file would report a syntax error as `tail-truncated` — the one
finding in this tool that means somebody removed events.

So it does not compare. When any input file could not be read in full, `verify-checkpoint` reports
the unreadable file, states that no comparison was made, and exits 2 without a comparison. This is
the exit code it produced for the same input before, and the same refusal to guess that the exit-code
contract is built on: a verifier that cannot see the whole archive has not verified it.

### 4. A malformed line stops its file and is reported; the events before it stand

Reading a file stops at the first line that is not JSON, and the file is reported as unreadable with
the line number. The events read before that line have already been judged and are counted in the
summary. The exit code does not move: a file that could not be read is still a `2`. This is a change
in what is reported, not in what is approved.

The old behaviour — discard the file — was defensible as caution, but it made the tool least useful
exactly when an archive is most in question. An operator handed "999 events checked, 1 file
unreadable at line 1000" knows both what was verified and what was lost. "0 events checked" tells
them only the second.

### 5. Chain verification keeps the reduction, not the events

A chain cannot be judged one event at a time, and this decision does not pretend otherwise. What it
does is separate what a chain needs from what an event is. On arrival each event is validated,
its own digest recalculated and compared, and its signature checked when a key was supplied — all
properties of the event alone. What is then kept is its label, its sequence, its `hash`,
`previousHash`, algorithm, canonicalization and `batchId`, and the findings from its digest check.
The event is released.

The memory a chain run needs is therefore proportional to the number of events in the archive and
not to their size: roughly a few hundred bytes each, whatever the events weigh. `verifyChains` now
accepts anything iterable, and the three-call form behind it — `startChainIntake`, `addChainEvent`,
`finishChains` — is what the CLI drives from the reader.

### 6. A sorted-input contract was not adopted

Verification in constant memory is possible if the archive is required to arrive grouped by
`chainId` and ascending by `sequence`: only the predecessor's hash need be held. Rejected for this
release. It makes a verdict conditional on a property of the input file that the producer of the
archive never promised and the operator often cannot arrange, and a verifier that refuses an
unsorted archive has refused the archive, not verified it. The constant-memory path can be added
later as an explicit mode for a producer who can make that promise; the decision here is that it is
not the default and not a precondition.

## Consequences

- An archive larger than memory can be checked. The tests hold `validate` to 40 000 events and
  `verify-chain` to a 30 000-event chain under a 64 MB heap; both would have failed before. The same
  tests hold `check-coverage` and `verify-checkpoint` to refusing, rather than dying on, the archive
  `validate` reads.
- The 8 MB limit now means "one event" for JSON Lines read by a streaming command, and "one file"
  everywhere else: for a JSON document, and for a JSON Lines file given to one of the three commands
  that hold every event.
- A partly damaged JSON Lines file reports the events it held. Any tooling that read "0 events
  checked" as "the file was rejected" will now see a count and an unreadable file; the exit code it
  branches on is the same.
- In text output, an unreadable file is reported where it occurred — after the events before it and
  before the events after it — rather than collected above the run. In `--format json` it is in
  `unreadable`, as before.
- `verifyChains` takes an `Iterable`, which every array already is; no caller changes. The intake
  functions are additions.
- `verify-checkpoint`, `verify-proof` and `check-coverage` still read their events into memory, and
  keep the whole-file limit that makes that safe. A checkpoint comparison walks the archive twice,
  once to verify the chains and once to index them by sequence; coverage counts rules against the
  whole set; a proof concerns a single event. Folding them onto the intake is a later change, and
  until then the limit is what stands between them and an archive they cannot hold.
- `verify-checkpoint` now refuses to compare where it previously compared what it had. A partly read
  archive produced `tail-truncated` and an `outcome` of `disagrees` in `--format json`; it now
  produces no comparison at all. The exit code is 2 in both cases.
- Findings still accumulate, and so do chain results: a report naming sixty thousand distinct chains
  holds sixty thousand results. That is inherent to reporting them. What streaming removes is the
  cost of the events, not the cost of what is said about them.

## Alternatives considered

**Raise the cap.** Free, and buys one order of magnitude before the same wall. It also leaves the
tool refusing archives for a reason that has nothing to do with their contents.

**Read asynchronously.** Node's idiomatic line reader is async, and adopting it would make every
command, every exit path and every test asynchronous for a property none of them needs. The reader
uses `openSync`/`readSync` and a generator: the same bounded memory, none of the contagion.

**Keep discarding a file with a malformed line.** Rejected under decision 3. The argument for it is
that a damaged file's other lines are also suspect; the answer is that the tool says exactly what it
verified and exactly where it stopped, and that an operator deciding what to trust is better served
by that than by silence.

**Make the events' own digests a separate streaming pass from chain intake.** Rejected as
unnecessary: the digest check is already a property of a single event, and doing it at intake needs
one pass rather than two.

## Security considerations

- The per-line cap replaces the per-file cap for JSON Lines, so an untrusted archive still cannot
  make the tool allocate without bound. The growing-line check fires within one chunk of the limit,
  so the worst case is the limit plus 64 KiB.
- Malformed UTF-8, truncated sequences, nesting deeper than any parser's stack, duplicate keys,
  `__proto__`, lone surrogates and numbers outside what JSON can carry are all held, by test, to
  producing one of the four documented exit codes and never a stack trace. A crash tells an operator
  nothing about the archive, and an archive is exactly where an attacker's bytes end up.
- Reading a file is lazy, so a path that does not exist raises on the first read rather than before
  it. The operator sees the same `cannot read file:` prefix and the same exit code; for JSON Lines
  the system call named in the message may differ, because the file is opened rather than stated.
- Nothing here changes what is approved. Every exit code is as it was, and every event that is now
  reported from a partly damaged file is reported with the verdict it would have had in a file that
  was whole. One finding kind moves, and it moves towards saying less: the `tail-truncated` a partly
  read archive used to produce under `verify-checkpoint` is now no comparison at all (decision 3).
