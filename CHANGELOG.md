# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses a
specification version (`1.0`) and a repository version, tracked in `package.json`. The repository
version moves with the tooling; the specification version changes only when the schema or a
normative document changes meaning, and the two are stated separately in every release note.

From 1.0 the specification changes only under the rules of
[ADR 0017](decisions/0017-versioning-and-compatibility.md): a minor version only adds, and anything
else is a new major version. Before 1.0, while the project was **Experimental**, breaking changes
were possible in any release and were labelled as such. A change that alters the meaning of an
existing field or event name has never been acceptable — a new name is introduced instead.

## 1.0.0 - 2026-09-23

Specification **`1.0`**. Repository `1.0.0`.

The specification is stable. The schema at
`https://openauditmodel.org/schemas/audit-event/1.0/schema.json` will not change, the identifiers it
publishes are permanent, and every later 1.x version follows the compatibility rules this release
records. The conformance tooling implements everything the specification defines, with the one
shortfall described under the first _Changed behaviour_ entry below. What 1.0 does not
say is that the model has been proven in production: no deployment is known to run on it yet, and
the README says so beside the version.

### Added — specification 1.0, and the rules every later version follows

[ADR 0017](decisions/0017-versioning-and-compatibility.md) makes the three decisions
`overview.md` §6.2 held back until after 0.1. A version is `MAJOR.MINOR`, and each has its own schema
at its own permanent address, fixing `specVersion` to its own value; a validator selects the schema
by the version an event declares. A minor version may only add an optional field, add a value to an
open vocabulary or an example, or raise a bound or widen a pattern where real data needs it;
everything else is a new major version. And a consumer given a version it does not implement does
not evaluate the event: it never passes it, and `validate` does not fail it either, because it has
not checked it against the rules the event claims.

1.0 is 0.1 with two differences: `specVersion` is `"1.0"`, and `request.parentSpanId` records the
span that caused the one in `request.spanId`, so that events sharing a trace can be arranged into
the calls that produced them rather than only ordered. Everything else is carried over unchanged,
deliberately: the closed vocabularies stay closed, the open ones stay open, and the bounds stay where
they are, because no producer has yet given evidence to change any of them. A test strips those two
differences from the published schemas and requires what remains to be identical.

### Changed behaviour — an event of a version this tool does not implement is not evaluated

Before, an event declaring `"specVersion": "0.2"` failed validation on the schema's `const`, the
same way a misspelled field fails. Now an event declaring any well-formed version the tool does not
implement — a newer minor, another major, one never published — is reported as not evaluated, under
a keyword that is not a schema keyword, with no schema failure beside it. `validate` prints it as
`SKIP`, counts it as `not evaluated`, and exits 3 when that is all it found. An event with no
`specVersion`, or one that is not `MAJOR.MINOR`, still fails.

The other commands never pass such an event, but each still counts it the way it counts a
schema-invalid event: `verify-integrity`, `verify-proof` and `check-profile` fail it,
`lint-privacy` gives no verdict, `verify-chain` leaves it out of every chain, and `check-coverage`
counts it as core-invalid. `verify-integrity` and `verify-chain` now say that the event was not
evaluated rather than that it does not conform. ADR 0017's Consequences list what each command
does; a not-evaluated verdict of their own is left for a later 1.x release.

`MAJOR.MINOR` is defined exactly: two decimal integers without leading zeros, so `"01.0"` and
`"1.00"` fail rather than go unevaluated. A new fixture, `examples/versions/leading-zero-version.json`,
pins it. `validateFile`, the library call, reports a `not-evaluated` status of its own, and applies
the same nesting limit the commands do. The JSON reports gain `schemas`, every implemented version's
schema identifier; `specVersion` and `schemaId` beside it name the current version, and each event
is judged by the schema of the version it declares.

### Changed behaviour — a key a signature proves nothing under is refused

An Ed25519 public key that is a small-order point, an RSA public key whose exponent is even or below
3, and an EC public key at the point at infinity are refused when they are loaded, with exit 2 from
the command line and `unusable-public-key` from the MCP server. An Ed25519 signature whose `R` is a
small-order point is refused when it is checked. Before, the first two were accepted along with a
signature anyone could make, wherever Node's OpenSSL build does not check for them itself: under the
identity point as a key, `R` the identity and `S` zero verify for every message, and under an
exponent of 1 the "signature" is the encoded message. The third
aborted the process under Node 22. A signature a genuine key's holder made is unaffected. `integrity.md` §6.1 now
requires this of every verifier, not only of this one. The desktop viewer already refused the
Ed25519 cases, and recorded the difference as a deliberate divergence; the two now agree.

### Changed — `validate_event` on the MCP server names the versions

The result carries `notEvaluated`, `schemaId` for the schema the event was judged by (the declared
version's; the current one's for an absent or malformed version; `null` when the server does not
implement the declared version), `implementedSpecVersions` and `currentSpecVersion`.
`expectedSpecVersion` is gone. It told every event which version to declare, which is wrong advice
for a 0.1 event, whose version may be inside its digest. A client that read it reads
`currentSpecVersion` instead.

### Changed — the conformance kit records a not-evaluated verdict

Every fixture record's `validate` object carries `notEvaluated`. It is `true` for a fixture that
declares a version the reference does not implement, whose single issue is
`specVersion-not-implemented`, so that an implementation can tell that verdict from a failure. The
kit README has a section on versions.

### Changed — a checkpoint says what it cannot know

`verify-checkpoint` reports `checkpoint-members-unverified`, a new finding, when events declaring a
chain could not be verified, and no longer infers `tail-truncated`, `checkpoint-head-missing` or
`checkpoint-count-mismatch` from them: the head may be one of the events that are present but
unverified, and a deletion is the one thing that finding must not claim without cause.

### Changed — the MCP server takes one message per request

A JSON-RPC batch is refused with 400. The protocol dropped batching in 2025-06-18, and one body under
the size limit could ask for thousands of operations; see Security below.

### Changed — `check-coverage` counts names only of events a rule could judge

An event that fails the core schema, or declares a core version the profile does not cover, no
longer contributes its event name to the coverage report. Its "name" was never established, and was
repeated verbatim.

### Security

A review of the command line tool's input handling and the MCP server's HTTP boundary preceded this
release. [SECURITY.md](SECURITY.md) records it. Each item below is fixed, and each code change is
covered by a test; the deployment and release-workflow changes are not.

- JSON nested deeply enough to exhaust the stack ended a command with an internal error. Every
  command now refuses a document or a line nested more than 200 levels deep, with exit 2, and an
  unexpected internal error exits 2 with its name only.
- A named pipe or a device given as a file was read. Only regular files are read.
- Control characters in a file name or a message reached the terminal as written. They are escaped,
  and a newline, carriage return or tab from input no longer starts a line of its own, so input
  cannot print a forged summary.
- An EC public key at the point at infinity aborted the process under Node 22 when a signature was
  checked under it — for an MCP server run on Node 22, with one unauthenticated request. Node 24,
  which the MCP image uses, was not affected. It is refused before anything reads it.
- A file was checked by name and then opened by name, so it could be replaced in between, and a
  file that grew after its size was taken was read whole. It is opened once, checked as opened, and
  read no further than the size it had.
- A JSON parse error could quote the input it failed on. It names a position only.
- A property name shaped like a credential — a token, or a URL or connection string with a password
  in it — was repeated in schema and privacy findings. It is redacted as `<redacted>` in every path
  and message, and `lint-privacy` now reports it.
- A private key given where a public key belongs was used, including one labelled in lower case,
  which OpenSSL also reads. It is refused; the MCP server also tells the caller to treat the key as
  exposed.
- `verify-checkpoint` reported a chain as agreeing when some events declaring it could not be
  verified. It no longer does.
- A closed output pipe (`| head`) ended a command with a stack trace and exit 1. It exits 2.
- The MCP server judged a request with a `__proto__` member as a different document from the one
  sent. It refuses the request with 400.
- The MCP server held a `subscriptions/listen` stream open with nothing to send. It refuses the
  method.
- The MCP server accepted JSON-RPC batches. One body under the size limit held thousands of
  `resources/read` calls, drew a response of over a hundred megabytes and took the process past a
  gigabyte of memory, and passed a per-request rate limit as one request. Batches are refused.
- The MCP server's request log named the path the caller sent. It names the route that answered:
  `/`, `/health`, `/mcp` or `other`.
- The deployment guide said a client that reached the origin directly got a 403. Host validation
  cannot promise that — a client writes its own `Host` — and the guide now says what keeps direct
  clients out: the tunnel, or a firewall admitting only the proxy. The example deployment's
  `OAM_TRUST_PROXY` is off, since nothing it describes needs it.
- The release job installed the newest npm 11 and restored a dependency cache in the job that holds
  the publishing credential, and published from any ref named like a version. It installs an exact
  npm, restores no cache, and publishes only a tag.

### Fixed — documentation that disagreed with the tooling

- `lint-privacy` exits 3, not 1, when no finding was made and an input was not a schema-valid event.
  `privacy.md` §6.11 and the README said 1; they now say 3, and `validate`'s exit 3 is listed
  beside the others in the README and in `--help`.
- `SECURITY.md` said localhost origins were accepted outside production; every unlisted origin is
  refused. It said logs carry the tool name; nothing logs it. It said CI scans the deployed bundle
  for runtime code generation; the test reads the source. It listed an advisory `npm audit` no
  longer reports. Each now says what is true, and it also records that batches are refused and that
  `OPTIONS /mcp` is answered with 405.
- The deploy guide and the MCP README counted eight tools and thirty-four or thirty-six resources.
  There are ten tools and thirty-seven resources. The MCP README listed `GET /mcp` as a stream, a
  generated validator that no longer exists, and a tool name in its log lines; none is so.
- `event-model.md` required `specVersion` to be `"0.1"`, and the CloudEvents mapping's example named
  the 0.1 schema for a 1.0 event. Both say 1.0.
- The profile READMEs said an event of any other version is not applicable; one of a version the
  tooling does not implement fails the core check first.

### Added — 0.1 events are still read, and a sealed 0.1 archive still verifies

Every command validates an event against the schema of the version it declares, so events written
under 0.1 keep validating and verifying. A sealed 0.1 event cannot be migrated — `specVersion` is
inside its digest — so the integrity fixtures exactly as 0.6.0 published them are kept under
`examples/compatibility/v0.1/`, and a test holds the tooling to them: every digest and signature
verifies, every intact chain stays intact and every damaged one broken, the checkpoint still agrees
and still catches the truncated chain, and the proof still verifies. The same test validates every
other published fixture twice, declaring 0.1 and declaring 1.0, and requires the same answer for
every fixture that does not use `request.parentSpanId`.

The published examples are 1.0 now, because they are what producers copy; the integrity fixtures
were sealed again under 1.0 by their generator.

### Changed — every profile is republished for core version 1.0

A profile applies only to the core versions it lists, so each now lists `["0.1", "1.0"]`. The rules
are unchanged. Because a published profile address never changes, every profile moves by one version
— nine to 0.2, `incident-management` to 0.3 — and the previous versions stay published where they
were. The MCP server serves the new versions and both event schemas: thirty-seven resources.

### Changed — three naming questions carried to 1.0 are decided

- **`key.policy.update`** is published. The secrets-and-key-management profile selected the prefix
  `key.policy.` with no name under it; the operation is real — a key management service's key
  policy, a key vault's access policy — and now has a name and a conforming fixture. The profile
  linter's five warnings about the empty prefix are gone.
- **`secret.reveal` and `configuration.secret.access`** both stay, and the conventions now say what
  separates them: where the secret is held. A value in the application's own configuration is read
  as `configuration.secret.access`; a secret held by a secret store that is a system of its own is
  read as `secret.reveal`.
- **`request.parentSpanId`** is adopted, as above.

### Changed — the documents say 1.0

Every specification and convention document is labelled `1.0 · Stable`; the profiles remain labelled
experimental, because none has production adoption evidence. `overview.md` §6 states the versioning
rules normatively. `CONTRIBUTING.md`'s compatibility table now matches ADR 0017, including that adding
a value to a closed enum needs a major version, which it previously called compatible for producers.
The site's status line says the same in all five languages. The hosted MCP service is described as
what it is — public, unauthenticated, without an availability guarantee — rather than as a v0.1
alpha.

### Added — a support policy

`SECURITY.md` now says which releases receive fixes: the newest one, with no backports, because
every 1.x release reads every event the one before it did. The 0.x line is closed.

## 0.6.0 - 2026-09-22

Specification `0.1`, unchanged. Repository `0.6.0`.

The theme of this release is the size of an archive. Until now the tool read every file whole and
refused one above 8 MB, which meant it refused the thing it is for: an audit archive is an
append-only file that grows for as long as the system it records is running. JSON Lines is now read
a line at a time, and the commands that judge one event at a time release each event as they go.
Nothing normative changes and no verdict moves, except the two this section names.

### Added — an archive is read a line at a time, so its size is no longer the limit

Until now every command read every input file whole before checking anything, and a file above 8 MB
was refused unread. An audit archive is an append-only file that grows for as long as the system it
records is running, so the tool was refusing the thing it is for: a year of a moderately busy
service could not be offered to it at all.

JSON Lines is now read in 64 KiB chunks and split into lines as they arrive, one event held at a
time. `validate`, `verify-integrity`, `lint-privacy` and `check-profile` judge each event and
release it, keeping nothing but counters in text output. `verify-chain` cannot judge one event at a
time — a link is a relation between two events, and the second may be in another file — so it keeps
each event's links, ordering and digest verdict and releases the event: the memory it needs is
proportional to how many events an archive holds rather than to what they weigh. The tests hold
`validate` to 40 000 events and `verify-chain` to a 30 000-event chain under a 64 MB heap.

The 8 MB limit is not gone. For a streaming command it now applies to one line rather than to a
JSON Lines file, and it is enforced both on a completed line and on a line still growing, so a file
with no newline in it at all is refused after one line's worth rather than read entire. Everywhere
else it still applies to the file: to a single JSON document, whose shape is unknown until its
closing brace and which therefore cannot be parsed in pieces, and to a JSON Lines file given to
`verify-checkpoint`, `verify-proof` or `check-coverage` — the three commands that hold every event
at once and would otherwise be killed part-way through an archive instead of refusing it. See
[ADR 0016](decisions/0016-events-are-read-as-a-stream.md).

### Changed behaviour — a malformed line no longer costs the events that came before it

A single line that is not JSON discarded every event in its file. A thousand-line export with one
truncated line reported nothing: not "999 checked, one line lost" but "0 events found". That made
the tool least informative exactly when an archive is most in question.

Reading a file now stops at the first line that is not JSON and reports it with its line number,
and the events read before it are checked and counted. The exit code does not move — a file that
could not be read is still a `2` — so nothing that branches on the exit code changes. What changes
is that the summary now says what was verified as well as what was lost. In text output an
unreadable file is also reported where it occurred, between the events before it and the events
after it, rather than collected above the run; `--format json` reports it in `unreadable` as before.

### Changed behaviour — `verify-checkpoint` makes no comparison on an archive it could not read in full

A checkpoint comparison reports what is missing from an archive, and an event that was not read is
missing in exactly the way a deleted one is. With the events before a malformed line now surviving,
comparing such a file reported a JSON syntax error as `tail-truncated` — the one finding in this
tool that means somebody removed events.

`verify-checkpoint` now reports the unreadable file, states that no comparison was made, and exits
2 without comparing. The exit code is what it was for this input; what changes is that a partly
read archive no longer produces a comparison, an `outcome` of `disagrees` or a tamper-evidence
finding. A verifier that cannot see the whole archive has not verified it.

### Added — a corpus of inputs built to break the tool rather than to fail a check

An audit tool is pointed at whatever an archive happens to contain, which includes whatever an
attacker managed to write into it. A new test file holds every command to producing one of the four
documented exit codes, and never a stack trace, on: nesting deeper than a parser's stack, an array
of twenty thousand events, bytes that are not UTF-8, a multi-byte character truncated at the end of
a file, duplicate keys, a `__proto__` key, lone surrogates and control characters, numbers outside
what JSON can carry, empty and scalar files, chains that cycle, an event whose `previousHash` is its
own hash, and five hundred events claiming the same sequence. Three thousand seeded mutations of a
valid event are run through every engine — a thousand mutations of its text, of which the ones that
still parse reach the engines and the test asserts how many did; a thousand of its shape, which
always parse; and a thousand of its shape read back from disk. A failure prints the seed and the
input that produced it.

This found a real hole while it was being written: the per-line limit was checked only against a
line still growing, so a line that ended inside the same chunk that carried it past the limit was
read whole. It is now checked against completed lines too.

### Added — `profiles/REQUIREMENTS.md`, the profiles read from the producer's side

The profiles are the contract and they are ten documents holding 127 rules between them. A producer
deciding what to emit has one question — "I record this operation; what does the model want from
it?" — and could answer it only by opening ten files and reading a rule vocabulary first. That is
the same gap the conformance kit closed for implementers in another language: the information
existed and was not reachable.

`profiles/REQUIREMENTS.md` is that contract from the other side. Every event name any profile
selects, with the rules that govern it; every rule with what it requires, what it recommends, and
the condition it fires under; and the pointers the ten profiles ask for most, because a producer
whose event type cannot express the top of that list cannot satisfy most profiles whatever its event
names are. It closes by saying what a profile rule cannot check — that a present field holds the
right value — so that nothing here reads as more assurance than it is.

It is generated from the profile documents by `conformance/tools/generate-requirements.ts` and
checked by `npm run verify`, for the reason every other generated artifact here is: a hand-written
table of a hundred pointers is stale one profile revision later, and a stale requirement is worse
than an absent one because a producer would build to it.

### Fixed — the MCP server checks which rule vocabulary a bundled profile is written in

`profileVersion` names the rule vocabulary a profile document uses, and the rule schema is closed:
an unknown vocabulary means unknown rule properties. The CLI has always refused a document it
cannot read, and the viewer refuses one and says which. The MCP server had no such gate at all — it
parsed each bundled profile straight into a definition and enforced it. With every shipped profile
at format `0.1` that was harmless, and it would have stopped being harmless the first time a
profile moved: the engine would have evaluated the rule properties it recognised and passed over
the ones it did not, so a rule whose only requirement used a new property would have demanded
nothing and the event would have been reported conforming. A requirement a reader cannot see is not
a requirement that is absent.

The server now refuses to start when a bundled profile declares a format version it does not
implement, naming the profile and both versions. Refusing to start is right for this input: the
profiles are compiled into the image from an allowlist, so a mismatch is a build mistake rather
than something a caller sent. Behind that, the generator validates every profile against the
profile definition schema before it is bundled, which the server itself cannot do — it validates
with ahead-of-time compiled code and has no schema compiler. A malformed or unreadable profile now
fails the build instead of reaching the image.

`SUPPORTED_PROFILE_VERSIONS` and `implementsProfileVersion` are new exports, and a test asserts the
list against what the profile definition schema accepts, so the constant cannot drift from the
schema the CLI validates with.

### Fixed — the supported-versions table names the release that is actually current

`SECURITY.md` still listed `0.4.x` as the current release after 0.5.0 and 0.5.1 shipped, so the
document a reader consults to learn whether their version still receives fixes told them the wrong
thing about both. A standing release rule already said that table moves with the version; nothing
checked it, while the README's version row beside it had been checked since 0.3.0. A test now
asserts that the table names exactly this release's minor as current and lists every earlier minor
as superseded, and it fails against the table as it stood.

## 0.5.1 - 2026-09-20

Specification `0.1`, unchanged. Repository `0.5.1`.

### Fixed — the MCP server enforces every profile it publishes

`check_profile` and `check_coverage` accepted nine profiles, not ten.
`incident-management` was revised to profile version 0.2 in 0.4.0, and the pattern that discovers
enforceable profiles from the bundled resource manifest was pinned to the literal `0.1`, so the
profile went on being served as a resource while dropping out of the set the two tools accept. A
caller asking the live endpoint to check an incident event was told no such profile existed, while
the README said all ten were enforceable and the CLI, which loads profiles from disk by name and
never reads a version, checked all ten. The pattern now matches the whole version form the profile
definition schema allows.

A revision was always expected to move a profile's version — ADR 0008 says so and the archive tool
enforces it — so the version was the one part of that URI that could not be a literal. Two
assertions close the gap the old test left: the profiles the server serves are exactly the profiles
it can enforce, and that set is exactly what the repository publishes. Both fail against the old
pattern. The server now also refuses to start when a resource URI's version disagrees with the
version inside the profile document, because enforcing rules under the wrong version number is
worse than not starting.

## 0.5.0 - 2026-09-20

Specification `0.1`, unchanged. Repository `0.5.0`.

The theme of this release is the truncation gap. Since 0.1, integrity.md §8 has said that chain
verification cannot see a deleted tail and that the remedy is a chain head recorded beyond the
store's reach; this release gives that record a format and a verifier (`verify-checkpoint`), adds a
per-event membership proof against a published tree root (`verify-proof`), reports each chain's
head, and verifies the two signature algorithms the schema had recommended without implementing.
Nothing normative changes, no existing verdict moves except the one the first entry names, and every
new verdict ends by saying what it does not prove.

### Changed behaviour — ECDSA-P256-SHA256 and RSA-PSS-SHA256 signatures verify

`--public-key` and `publicKeyPem` accept a key for any of the three algorithms the schema's own
description recommends; until now only Ed25519 was implemented and the other two were refused as
`unsupported-signature-algorithm`. An event signed with either of them and checked with a matching
key now verifies, and one signed with either and checked without a key is now reported as declared
but not checked — with the verdict resting on the hash — where it previously failed. That is a
verdict moving from `1` to `0` for such events, which is why this is a "changed behaviour" entry
rather than an addition.

The key's type, curve and size must match the declared algorithm — `ed25519`, `ec` on P-256, or RSA
with at least 2048 bits — and a mismatch is reported as `signature-invalid` naming both, not as a
signature that "does not match". ECDSA signatures are expected in IEEE P1363 form (64 bytes);
RSA-PSS is verified with the salt length recovered from the signature, and a modulus that is not a
multiple of eight bits is accepted at its rounded-up signature length. ADR 0012 carries the
amendment.

The fixture that demonstrates an unimplemented algorithm declared `ECDSA-P256-SHA256`, which no
longer is one; it now declares `ECDSA-P384-SHA384`, keeps its name, and keeps failing. Two signed
fixtures and two test-only public keys are added. Because neither new scheme signs
deterministically in Node, the RSA-PSS fixture is signed with a zero-length salt and the ECDSA
fixture is the first the generator checks by verifying the committed signature instead of
regenerating it — every other field is still compared exactly.

`SIGNATURE_BYTE_LENGTHS` is replaced by `SIGNATURE_ALGORITHMS`, which records what each algorithm
requires of a key and a value. Breaking for a deep importer of that constant; none is known.

### Added — `verify-chain` reports the chain head and the sealing batches it sees

Each chain's result now carries `headHash`, the declared `integrity.hash` of its highest-sequence
event: the value integrity.md §10 asks producers to publish somewhere they do not control, and the
value a checkpoint will be compared against. The CLI prints it as `head:`; `verify_chain` returns it
per chain. It is reported for a broken chain too, with `intact` beside it saying what it is worth,
and omitted when the highest sequence is declared by more than one event.

`integrity.batchId`, which no command read until now, is listed per chain as a note: identifier,
event count and sequence span, with a batch that also appears in another chain of the set stated as
such. Batches are reported, not judged — no verdict, exit code or finding depends on them — and
ADR 0013 records why the alternatives were refused. `examples/integrity/valid/chain-in-two-batches/`
is added to show the note; the conformance kit gains its chain record, and nothing recorded for an
existing fixture changes.

### Added — `verify-checkpoint`, and the checkpoint document it compares an archive with

Chain verification proves that the events it is given are consistent with each other; it cannot see
a deleted tail, because a truncated chain is a shorter chain that verifies perfectly. integrity.md §8
has said so since 0.1 and named the remedy: a chain head recorded somewhere the store's
administrators do not control. That record now has a format and a verifier.

The **checkpoint** is a tooling document with its own schema at
`https://openauditmodel.org/schemas/checkpoint/0.1/schema.json`, versioned independently of the
specification, which does not change. It records a chain's head — sequence and hash — when it was
taken, optionally the event count and a signature, and an **anchor** naming where it was placed
beyond the store's reach; the anchor is required and may not be blank, so a checkpoint kept beside
the events is not a checkpoint. A multi-chain form records one head per chain for a whole archive,
which is what an archive manifest is, so there is one document rather than two. Digest, identifier,
timestamp and signature definitions are the event schema's own, by reference.

`verify-checkpoint <path...> --checkpoint <file> [--public-key] [--format json]` verifies the archive
exactly as `verify-chain` does and then compares every chain the checkpoint names: the event at the
recorded sequence must carry the recorded hash, and the count is compared when stated. A chain that
ends before the head is `tail-truncated`; a head the archive skips is `checkpoint-head-missing`; a
different hash is `checkpoint-head-mismatch`; a checkpoint under another algorithm is
`checkpoint-algorithm-mismatch`. Events after the head are a note, never a failure — a checkpoint
from yesterday does not fail today's archive. Exit `0` when the archive agrees, `1` when it does not
or the archive itself is broken, `2` when the document is not a checkpoint, and `3` when the archive
holds none of the chains the checkpoint names, so nothing was compared. Every report ends with the
line that says what was not proven: the archive is consistent with the supplied checkpoint; whether
the checkpoint is genuine and its anchor real is for whoever holds the anchor. The anchor is never
dereferenced. `--public-key` verifies the checkpoint's own signature too, over the document with
`/signature` removed. A checkpoint that lies under the same directory as the events is noted.

The MCP server gains `verify_checkpoint`, with the same outcomes as data, and serves the checkpoint
schema as a resource. The site publishes the schema at its `$id`.
`examples/integrity/checkpoints/` holds five generated documents and
`examples/integrity/invalid/truncated-chain/` the deleted tail, which passes `verify-chain` and fails
`verify-checkpoint` — the two records the conformance kit's new `checkpoints` family keeps side by
side with the `chains` record that calls the same directory intact. `createValidatorFromSchemas`,
`createCheckpointValidator`, `verifyCheckpoint`, `verifyDocumentSignature` and
`documentSignatureInput` are new exports; nothing is removed. ADR 0014 records the decisions.
`deploy/smoke-test.mjs`'s pinned catalogue counts follow every such addition, and a test keeps them
equal to what the server registers, so an addition cannot fail the container job the way this one
first did. One key per run: `--public-key` and `publicKeyPem` verify the checkpoint's signature and
every event's with the same key, so a checkpoint signed by a different party than the events is
verified in two runs, one per key. A separate document key is planned, not shipped.

### Added — `verify-proof`, and the Merkle inclusion proof it checks

A checkpoint covers a chain; an inclusion proof covers one event. It is a sidecar document under its
own schema at `https://openauditmodel.org/schemas/proof/0.1/schema.json`, versioned independently
of the specification: the event's `integrity.hash` as the leaf with its index, the sibling hashes up
to a Merkle root, and the root with its leaf count, the checkpoint schema's anchor, and optionally a
signature over the root object. Nothing is added to the event.

The hashing is defined, not assumed. Leaves and nodes are domain-separated as RFC 6962 §2.1 does
it — `H(0x00 ‖ digest)` and `H(0x01 ‖ left ‖ right)` — a tree splits at the largest power of two
below its size, and an odd node is promoted unchanged. The schema's description says so, because a
tree that hashes concatenations with no prefix admits second-preimage constructions and an
implementer in another language should build to the document, not to this repository's code.

`verify-proof <event-file> --proof <file> [--public-key] [--format json]` checks the proof's own
consistency first — algorithm, digest lengths, the path's shape against the leaf's index and the
tree's size, the root it recomputes to — then verifies the event exactly as `verify-integrity` does
and requires its hash to be the leaf. Exit `0` when the proof verifies, `1` when it does not or the
event fails its own verification, `2` when the document is not a proof, and `3` when the event's
hash cannot be established, so there is nothing to prove. Every report ends with what a verified
proof shows, and no more: membership of the tree the root describes; the root's provenance is the
anchor's.

The MCP server gains `verify_proof` and serves the proof schema: ten tools, thirty-six resources,
and the deploy smoke test follows. The site publishes the schema at its `$id`. Two proofs are
generated under `examples/integrity/proofs/`, and the conformance kit's new `proofs` family records
six cases, including the same proof against the wrong event, against an event with no hash and
against one under an algorithm the verifier does not implement.
`merkleRoot`, `auditPath`, `expectedSides`, `rootFromPath`, `verifyProof`, `createProofValidator` and
`checkDeclaredDocumentSignature` are new exports; `CheckpointSignatureResult` is now an alias of
`DocumentSignatureResult`. ADR 0015 records the decisions.

## 0.4.2 - 2026-09-18

Specification `0.1`, unchanged. Repository `0.4.2`.

### Changed — the published package carries the fixture corpus and the conformance kit

[ADR 0001](decisions/0001-specification-first.md) promises that "an implementation in any language
can be checked against the same fixtures", and 0.4.0 turned the expected verdicts into data. Both
were true only for someone holding a git checkout: `files` stopped at the schema, the profiles, the
conventions and the specification, so the corpus that proves an implementation and the manifest that
says what it should produce were the two things a consumer could not install.

`examples/` and `conformance-kit/` now ship, and the `exports` map declares both, so a consumer
resolves them through the package rather than by guessing at a path inside `node_modules`. The
tarball goes from 156 files to 493: the 335 files under `examples/` — 320 of them the fixtures the
manifest names — plus the manifest and the kit's README. Pinning one version pins both halves, which
is what the manifest needs: it names fixture paths rather than embedding fixture content, so a
manifest and a corpus from different releases would describe each other wrongly.

**This reverses a decision 0.4.0 stated and enforced**, and the reason it gave was not wrong. Eleven
privacy fixtures hold synthetic credential-shaped values, and they now land in every consumer's
`node_modules`, where a secret scanner will find them. They are inert, each one says what it is, and
they are what the privacy linter has to be checked against — a conformance kit nobody can install is
not a conformance kit. The trade is stated here rather than discovered by whoever runs the scanner.

[scripts/verify-package.mjs](scripts/verify-package.mjs) changes sides with it: `examples/` moves out
of the forbidden list, `conformance-kit/manifest.json` joins the required list, and a new check fails
the build when any file under `examples/` is missing from the tarball. The corpus ships whole or not
at all, because a manifest naming files the tarball does not carry is worse than shipping neither.

## 0.4.1 - 2026-09-18

Specification `0.1`, unchanged. Repository `0.4.1`.

### Fixed — every dependency finding with a fix available, in three layers

The container scan gate — the one that fails only on findings that have a fix available — went red
without a line of this repository changing:

| Package        | Installed | Fixed in        | Findings                                                                                                                                  |
| -------------- | --------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `libpcre2-8-0` | 10.42-1   | 10.42-1+deb12u1 | CVE-2026-86145, CVE-2026-89157, CVE-2026-89161 — out-of-bounds writes in the regex engine                                                 |
| `fast-uri`     | 3.1.5     | 3.1.8           | CVE-2026-75899, CVE-2026-75931, CVE-2026-75975, CVE-2026-76172 — server-side request forgery, and host confusion via skipped IDN handling |

`fast-uri` is reached through `ajv`, and is the first Node-level finding against this image that sat
in `/app/node_modules` rather than in the package-manager trees the runtime stage deletes.

Debian published the pcre2 fix before the base image was rebuilt around it, so a fresher tag was not
a remedy: an image built the same day still carried the vulnerable package. The runtime stage now
upgrades every package that has a fix — the same predicate the gate uses — which keeps this a
property of the image rather than a list of package names maintained by hand. The apt lists are
removed in the same layer, so nothing new is shipped and the runtime still carries no package
manager a running server could reach.

**A consumer installing from npm was never exposed to the `fast-uri` finding**: the package carries
no lockfile, and `ajv`'s own dependency range resolves a fixed version today. What was exposed is
this repository's own builds and the published image.

**A third finding the gate could not have reported**: `hono` 4.13.1, reached through
`@modelcontextprotocol/node` and `@hono/node-server`, carries three moderate advisories fixed in
4.13.5 — an incomplete fix for a `toSSG()` path traversal (GHSA-gqvv-2mrq-wpjv), memory exhaustion
through unbounded dot-notation nesting in `parseBody()` (GHSA-g6gw-c38x-mqfc), and a query parser
that reads parameters after the URL fragment, which produces cache-key and proxy interpretation
differentials (GHSA-crvj-82cr-hjcx). Now 4.13.8.

None of the three is on a path this server uses — it generates no static site, and it reaches HTTP
through `toNodeHandler` rather than through `parseBody()` or hono's query parser — but the server is
public and unauthenticated, which is not where a dependency is left a release behind on the argument
that its vulnerable paths look unreachable.

It was invisible by configuration rather than by accident: the image scan is set to
`CRITICAL,HIGH`, and these are moderate, while nothing else in this repository looked at the
dependency tree at all. The threshold, not an absence of findings, is why the report was quiet —
which is the reason the CI job below exists. `npm audit` now reports zero vulnerabilities at every
severity.

### Fixed — the README described the MCP server's resources as covering one profile

`README.md` said the thirty-four read-only resources cover "the specification, both schemas, the
semantic conventions and the IAM profile". Nine of the ten bundled profiles went unmentioned, and
"the specification" is seven of its fifteen documents. The sentence was also split mid-phrase across
a line break, which is how a claim about a generated manifest survives three releases without being
read as a whole. [mcp/README.md](mcp/README.md) has carried the correct breakdown throughout; the
root page, which is also the page npm renders, did not.

A test now reads that paragraph and checks it against the generated resource manifest and the
registered tool and prompt names, so the claim moves with the surface it describes. It reads a count
written as a word or as digits, because the README writes both.

### Added — CI runs weekly, and reads the dependency tree

Two gaps, and every finding above sat in one of them.

**Nothing re-ran between releases.** CI ran on push, on pull request and on demand, so the seventeen
days after 0.4.0 passed with no run at all, while the image accumulated findings the scan gate would
have failed on any of those days. CI now also runs on Mondays, which turns that into a failing check.
GitHub disables a schedule after sixty days without activity, so it supplements pushing rather than
replacing it.

**Nothing read the dependency tree.** A new `advisories` job runs `npm audit --audit-level=moderate`
against the lock file, which is what the image scan's `CRITICAL,HIGH` threshold cannot report. It is
deliberately a CI job rather than a step in `npm run verify`: verify is offline and deterministic by
design, and an advisory database is neither — a developer on a plane must still be able to run every
gate. The weekly schedule re-runs it whether or not anyone pushed, so an advisory published against
a dependency already in the lock file surfaces without a commit.

## 0.4.0 - 2026-09-01

Specification `0.1`, unchanged. Repository `0.4.0`.

### Added — `check-coverage`, and the question `check-profile` cannot answer

`check-profile` reports whether each event conforms. It cannot report whether the profile reached the
events at all, and the two are indistinguishable in a line that counts failures: an export with no
violations and an export the profile never governed both read as quiet.

`auditmodel check-coverage <path...> --profile <name>` reports what a profile reached across a set —
which rules were selected, which were applied, and every event name the profile does not govern. Text
and `--format json`. An eighth MCP tool, `check_coverage`, ships with it, so the agent surface still
matches the command line.

**It counts events, not obligations.** "6 of 15 rules selected" describes an event set. It is not a
percentage of conformance, a maturity score or a grade, there is no threshold, and a low number is
the normal state of a narrow export. A threshold would be policy; this is a measurement.

Two of its lines are the reason it exists:

- **Ungoverned event names** are what tell a producer that its vocabulary and the profile's have not
  met. Nothing else surfaces this: every one of those events is individually `not-applicable` and
  individually unremarkable.
- **Selected but never applied** names a rule whose condition never held. Such a rule is selected on
  every matching event, contributes no requirement to any of them, and fails nothing — it looked
  enforced and enforced nothing. Counting it as coverage would be the same mistake as reading
  `not-applicable` as conformance.

**It never exits `1`.** Coverage makes no pass or fail claim: `0` when the profile governed at least
one event, `3` when it governed none, `2` when the tool could not run. A test asserts that an input
which fails `check-profile` with `1` is still a successful coverage report.

`check-coverage` was the one command the README listed as planned and unimplemented; that line is
gone, and `PLANNED_COMMANDS` is now empty.

### Added — five semantic conventions for vocabularies the profiles already enforced

Ten profiles enforce ten vocabularies; seven convention documents published eight of them. Five
domains had rules with real requirements behind names no document described, which left a producer
with the profile as its only source and no statement of what the names mean.

| Document                                                                    | Names published |
| --------------------------------------------------------------------------- | --------------- |
| [message-brokers.md](semantic-conventions/message-brokers.md)               | 32              |
| [secrets-and-keys.md](semantic-conventions/secrets-and-keys.md)             | 18              |
| [financial-transactions.md](semantic-conventions/financial-transactions.md) | 18              |
| [backup-and-recovery.md](semantic-conventions/backup-and-recovery.md)       | 13              |
| [customer-and-account.md](semantic-conventions/customer-and-account.md)     | 14              |

**No vocabulary was invented.** Every one of the 95 names published is one its profile already
selects or one that falls under a prefix the profile selects, checked mechanically rather than by
reading. A convention describes what exists; extending a vocabulary is a profile change with a
version bump behind it.

Each document carries the passage its domain most needs: broker message payloads, key and secret
material, primary account numbers and counterparty data, backed-up content, and customer personal
data are each named as things an event must never carry. Each also resolves the
actor/resource/subject question for its domain, because `subject` misused as a generic target is what
[actor-model.md](specification/actor-model.md) §5.2 calls the single most common modelling mistake.

Two conflicts are recorded rather than resolved, because a convention may not decide either on its
own:

- **`secret.reveal` and `configuration.secret.access` name what is arguably one operation.** The
  older document publishes one, the secrets profile enforces the other, and `event-model.md` §7.2
  makes name stability a MUST — so neither can be withdrawn by a convention. The overlap is stated,
  interim guidance is given, and reconciling them is left to a specification change.
- **The `key.policy.` prefix has no name behind it.** `secret.policy.update` and
  `backup.policy.update` exist; the key equivalent was never written. The gap is named as an open
  item rather than filled with an invented name — which is also the finding `npm run profiles:lint`
  reports, reached from the other direction.

The five documents are published through the MCP server alongside the other seven, taking its
read-only resource count from 29 to 34.

### Added — a language-neutral conformance kit, with no badge

ADR 0001 has promised since v0.1 that "an implementation in any language can be checked against the
same fixtures". The fixtures were always published; what they are supposed to _produce_ lived in
twenty-two Node test files, which is not a contract an implementer in another language can read.

[conformance-kit/manifest.json](conformance-kit/manifest.json) is that contract as data: for all 320
published fixtures and 5 chains it records the verdict each engine returns — `validate` for every
fixture, `lintPrivacy` for every fixture, `verifyIntegrity` where the fixture declares integrity
material, and `checkProfile` for the fixtures under a profile.

**Human-readable messages are deliberately absent.** Rule identifiers, JSON Pointers, statuses,
severities, confidences and finding kinds are the contract; wording is not. An implementation that
words an error differently is not wrong, and a kit that compared prose would fail every translation
and every improvement to a sentence. A test asserts that no message, recommendation or detail string
appears anywhere in the manifest.

**The kit confers nothing** — no badge, no "compatible" status, no listing, no certification.
`overview.md` §3.4 says conformance MUST NOT be presented as a compliance statement, and a status this
project handed out would be read as exactly that by people with no way to see it withdrawn. The
manifest carries its own limits in a `claims` array, and a test asserts that neither the manifest nor
the kit's README ever says "certified", "compliant" or "approved".

The manifest **names** fixture paths rather than embedding fixture content, so there remains exactly
one copy of every event in the repository. It is generated from the same engines the CLI uses;
`npm run kit:check` is part of `npm run verify` and is asserted from the test suite, so a change that
moves a verdict updates this file in the same commit or fails the build.

It is not published to npm, and that is deliberate: the package does not carry `examples/` because
eleven privacy fixtures hold synthetic credential-shaped values, and a manifest without the fixtures
it names would be useless. The kit is a repository artifact, taken from a checkout or a release
archive pinned to a tag.

### Added — a profile lint, and the first checks that run over all ten profiles

`npm run profiles:lint` reads every shipped profile and reports defects the definition schema cannot
express. Seven checks, and the severity of each follows its consequence rather than its tidiness: an
`error` changes a verdict, a `warning` is something a reviewer should see that changes no verdict
today. Warnings do not fail the build — a lint that flagged house style would be silenced rather than
heeded.

Three of the checks exist because the failure they catch is silent:

- **A duplicated rule id loses requirements.** Rule selection deduplicates by id, so a second rule
  sharing one is never evaluated and everything it required disappears — and the event is then
  reported _conforming_. The schema permits it: `rules` carries no uniqueness constraint.
- **A rule that requires nothing turns silence into approval.** An event is `not-applicable` only
  while no rule selects it. One requirement-free rule makes it governed, satisfied and conforming,
  which is the exact reading the status vocabulary exists to prevent.
- **A condition nothing guarantees never fires.** An absent condition path means the condition does
  not hold, so a producer that never writes the flag escapes the requirement in silence. The rule
  looks enforced and enforces nothing.

The lint also rejects pointers the schema accepts and nothing can resolve — an empty reference token
(`/metadata/`), and a `requiredMetadata` path beginning with `/metadata`, which is concatenated into
`/metadata/metadata/…` — and contradictory requirements that fail on every event a rule applies to.

**On the shipped corpus: 0 errors, 17 warnings.** Twelve are conditions no unconditional rule in
their own profile guarantees, one per profile in seven profiles and three in
`customer-and-account-management`; five are the `key.policy.` prefix in `secrets-and-key-management`,
which selects nothing — no event name in that profile and no fixture of it falls under it. Both
findings are recorded in the test as a pinned list rather than a count, so fixing one is a visible
change rather than a silently shrinking number.

`INC-CLOSE-001` appears in that list, and it is the same rule `check-coverage` reports as selected
but never applied against a real fixture. The two checks reach it from opposite ends — one from the
profile document at review time, one from a producer's events at run time.

The suite that asserts this is also the first test in the repository to iterate every profile. Nine
of the ten profile test files assert unique rule ids, a rationale per rule and `coreVersions` by hand;
`identity-and-access-management` has no profile-definition block at all, and a new profile inherited
none of them. Those assertions now run for all ten.

### Added — `lint-privacy` breaks its findings down by category

Severity already said how bad one finding would be if the suspicion is correct. It never said what
kind of mistake produced it, and that is what an instrumentation fix is organised around: fifty
findings in one category are an afternoon's work, fifty spread across nine are a different problem.

`by category: credential-field-name 2, credential-shaped-value 2, minimization 2, url 2, …` now
follows the severity line, and `byCategory` is in the JSON report. The `category` field already
existed on every rule; only the rollup is new. A finding whose rule declares no category is counted
under `uncategorised` rather than dropped, so the category counts always sum to the finding count —
a test asserts that against the published fixture corpus. `--quiet` drops the line with the rest of
the detail.

### Changed behaviour — `incident-management` governs both segment forms of a case operation (profile 0.1 → 0.2)

**Breaking for producers**, in the sense ADR 0008 gives that phrase: events that were reported
`not-applicable` may now be reported as violations. Nothing about the core model changes, and no rule
was added, removed or altered — only the names the existing rules select.

Every `<domain>.case.<action>` selector is now accompanied by its two-segment twin: `incident.create`
beside `incident.case.create`, `incident.resolve` beside `incident.case.resolve`, and the same for
`close`, `cancel`, `reopen` and the two `problem.case.*` operations. Ten distinct two-segment
selectors, thirty selector entries, fifteen rules unchanged.

The profile presumed a system that models an incident as a separate _case_ record. A system that
manages the incident directly emits `incident.create`, and only "at least two segments" is normative —
so half the domain was being told nothing at all. `not-applicable` is not conformance, and the
previous behaviour was the worse kind of silence: it read as an absence of findings.

**Measured, so that the consequence is stated rather than discovered.** Run against a real 204-event
export from a production incident-management application, `check-profile` moves from
`204 not applicable, exit 3` to `0 conforming, 15 with violations, 189 not applicable, exit 1` —
45 violations and 84 recommendations, on `/authorization`, `/metadata/incident/status`,
`/metadata/incident/priority` and `/metadata/incident/resolutionType`. Not one event becomes
conforming. That is the profile finally saying something about a real system, and what it says is
that the system does not record the decisions the domain expects.

Only the imperative spellings are added. A producer that emitted `incident.created` before switching
to `incident.create` keeps its historical rows ungoverned: past-tense names are what
`semantic-conventions/event-naming.md` recommends against, and one product's superseded spelling does
not belong in a vendor-neutral profile.

The twins are exact names, never prefixes, so `incident.note.create`, `incident.timeline.append`,
`incident.view` and `problem.view` stay ungoverned. A test asserts that each two-segment form selects
_exactly_ the same rules as the three-segment form it twins, and another names the reads that must
stay outside. `/profiles/incident-management/0.1/profile.json` remains served alongside the new
`/0.2/`.

### Fixed — revising a profile no longer withdraws the previous version's URL

The site published only each profile's current version, and wiped `site/` on every build, so the
first bump of any profile would have stopped serving the address that version had been published at.
`deploy/Caddyfile` serves everything under `/profiles/` with a year-long `immutable` cache lifetime,
so that address had been declared permanent to every cache that holds it.

Every published version is now filed at `profiles/<name>/<version>/profile.json`, and the site
publishes all of them. Revising a profile adds an address instead of replacing one — the
`incident-management` bump in this same release is the first to exercise it, and
`/profiles/incident-management/0.1/profile.json` is still served beside the new `/0.2/`. A build
whose current version has no filed copy fails rather than shipping a landing page that links a 404.

### Added — a profile's rules cannot change without its version changing

ADR 0008 already recorded that adding a rule to a profile is a breaking change for producers and that
profile versions "are expected to move". Nothing enforced it: no test read `profile.version`, and a
rule could be added, removed or retargeted with the version left alone.

The archive above is append-only, so a rules change that leaves `version` untouched makes the working
document disagree with the copy already filed under that version, and `npm run verify` fails. Bumping
the version or reverting the change are the only ways to make it pass; the filed copy cannot be
re-pointed at the new content. `npm run profiles:archive` files a version, `npm run
profiles:check-archive` compares, and the check is also asserted from the test suite.

Two adjacent couplings are now held in place by tests rather than by memory: every filed copy must
declare the version it is filed under, and the MCP server must advertise each profile under the
version that profile declares — its resource URIs carry the version and are written by hand, so a
bump would otherwise have served new rules at the old version's URI.

### Added — the site's landing page is served in five languages

The landing page is generated from one template and one JSON strings file per locale
(`scripts/site-locales/`), and is now also published at `/tr/`, `/de/`, `/fr/` and `/es/` as
**informative translations**: the English page is authoritative, each translated page says so in a
banner in its own language, and the specification, schemas and profiles remain published in English
only. The pages cross-reference each other with `hreflang` links and a language switcher. The
build refuses a locale whose keys do not exactly match English, so a copy change that forgets a
language fails the build instead of shipping a page that silently mixes languages; `site:check`
treats a stale localized page like any other stale file.

### Fixed — the site's rule count is qualified

The landing page said "127 rules" without qualification. It now computes and states the split the
README already carries: 113 enforced as errors, 14 advisory.

## 0.3.0 - 2026-08-13

Specification `0.1`, unchanged. Repository `0.3.0`.

### Changed behaviour — a declared signature is never silently passed over

**Breaking** for pipelines that relied on the old silence. Two cases now speak
(specification/integrity.md §6.1 already required the second):

- `verify-integrity` without `--public-key` now reports an event's declared signature in an
  implemented algorithm as declared but not checked among its checks. The verdict is unchanged —
  the hash was verified, the signature was never claimed to be — but silence no longer reads as a
  check. (`verify-chain` prints chain-level checks, not per-event ones, so this line appears in
  `verify-integrity` output only.)
- An event declaring a signature in an algorithm this verifier does not implement now **fails
  verification with or without a key** (`[unsupported-signature-algorithm]`, exit `1`) — in
  `verify-integrity`, and in `verify-chain`, where it breaks the event's chain. Previously it
  failed only when a key was supplied; without one, the default invocation reported `verified` — a
  signature that can never be checked was passing as if it had been.

### Added — tag-driven release checks

Pushing `vX.Y.Z` now runs every gate a fresh clone can run, plus two guards that encode a lesson
this project paid for once: the workflow refuses a tag whose version does not match `package.json`,
or whose changelog section is not dated — 0.2.0 was tagged and published while its changelog still
said "Unreleased", and that class of mistake is now mechanical to catch. Publishing to npm remains
deliberately manual until 1.0; automated publishing with provenance is planned to move into this
workflow at that milestone.

### Changed behaviour — MCP host validation is on by default

**Breaking** for deployments that expose the server on a public name without setting
`OAM_ALLOWED_HOSTS` — they now answer `403` until the variable lists their names. With
`OAM_ALLOWED_HOSTS` unset, the MCP server used to answer on any host name; the documented
posture existed only in the reference compose file. Unset now means **loopback only** —
`localhost`, `127.0.0.1`, `[::1]` — so a bare `docker run` and a local start keep working with no
configuration, and answering on a public name is something an operator states with
`OAM_ALLOWED_HOSTS` rather than something the default hands out. Deployments that already set the
variable, including the reference compose file, are unaffected. Also fixed while writing the first
tests this check has had: a bracketed IPv6 `Host` such as `[::1]:8880` never had its port stripped,
so it could never match an allowlist entry.

### Changed — the package declares its import surface, and the analysis engines are browser-safe

`package.json` gains an `exports` map. The analysis engines are importable as
`@openauditmodel/cli/conformance/<module>` (for example
`@openauditmodel/cli/conformance/privacy/lint-event.js`), and the schema, profile and specification
documents keep their repository paths. **Breaking for deep-path importers:** the undeclared
`@openauditmodel/cli/dist/…` paths that legacy resolution exposed no longer resolve. The surface is
locked now, while the consumer set is plausibly empty, because adding `exports` later only gets more
breaking.

The three uses of Node's `Buffer` in the analysis engines are replaced with `TextEncoder`/`atob`
equivalents that behave identically in Node. This matters more than it looks: both privacy-engine
uses sat inside `try/catch`, so a browser bundle without `Buffer` did not fail — it silently
downgraded a high-confidence JWT finding to a low-confidence entropy heuristic. A bundler can now
take the engines as they are. `canonicalBytes` returns `Uint8Array` instead of `Buffer`; every Node
crypto API this project feeds it to accepts either.

### Changed behaviour — `--format` is refused where it is not supported

**Breaking** for scripts that passed the flag to a command that ignored it. `--format` applies to
`lint-privacy` and `check-profile`. `validate`, `verify-integrity` and
`verify-chain` used to accept the flag and silently emit text anyway — so
`auditmodel validate ./logs --format json` looked like a JSON pipeline and never was one. Those
commands now refuse the flag with a usage error (exit `2`) naming the commands it applies to.

### Changed behaviour — `verify-chain` exits `3` when no chain was checked

**Breaking** for CI jobs that branch on the exit code. When no event in the input could be assigned
to a chain — a missing `integrity.chainId`, `integrity.hash` or `sequence`, or a schema-invalid
event — `verify-chain` used to exit `1`, reporting "nothing was checked" the same way as "a chain
was checked and is broken". It now exits `3`, the documented no-verdict code, with a message
pointing at the per-event findings that name why. A CI job that treats `1` as failure and `3` as
not-applicable can now tell the two apart. The per-event findings themselves are unchanged.

### Fixed — `npm run verify` covers every gate a fresh clone can run

`verify` omitted four checks that existed and passed: `fixtures:check`, `mcp:check-generated`,
`package:verify` and `package:smoke`. All four are now part of it, so the command CONTRIBUTING
points a contributor at runs what CI runs. `site:check` is deliberately not included: it compares
the built site against the untracked `site/` directory, which a fresh clone does not have; it runs
in CI alongside `site:build` and belongs in the operator's pre-deploy checklist.

## 0.2.1 - 2026-08-12

Specification `0.1`, unchanged. Repository `0.2.1`. Documentation only; no behaviour changes.

### Added — prior art

The README gained a prior-art section, and the description of CADF was corrected in the README and
both CADF mappings documents: DSP0262 is a full event model with schema definitions, taxonomies and
federation interfaces, not only a conceptual reference. Merged after 0.2.0 was tagged; recorded
here.

### Fixed — documentation

- `specification/integrity.md` §2 still said signature verification is not part of v0.1,
  contradicting §6.1 and §9 of the same document after 0.2.0 shipped Ed25519 verification. It now
  states what the tooling does. The MCP resource manifest, which embeds the document, is
  regenerated to match.
- `SECURITY.md` described the public MCP endpoint as not yet deployed. It is deployed and
  answering, as the README already said; the two documents now agree.
- The README's v0.1 inventory counted "127 rules" without qualification. 113 are error-severity;
  14 are advisory warnings, which cannot fail conformance.
- This changelog's preamble claimed the specification and repository versions are aligned. They
  have differed since 0.2.0; the preamble now states the actual policy.
- The supported-versions table in `SECURITY.md` names the current 0.2.x release line. Added after
  the 0.2.0 tag; recorded here.

## 0.2.0 - 2026-08-05

### Added — Ed25519 signature verification

`integrity.signature` has been part of the schema since v0.1, but v0.1's `verify-integrity` and
`verify-chain` never checked it: the field could record a signature, and the tooling would say nothing
about whether it was genuine. Both commands now accept `--public-key <path>`, a PEM-encoded Ed25519
public key; when it is supplied and an event declares a signature, the signature is verified over the
same canonicalized digest input as `integrity.hash`, so a signed chain is exactly as tamper-evident as
a hashed one. Without `--public-key`, a declared signature is neither checked nor mentioned — every
existing invocation of either command behaves exactly as before.

The MCP server's `verify_integrity` and `verify_chain` tools gained the same capability, through an
optional `publicKeyPem` argument (a PEM string, since the server touches no filesystem) rather than a
path. A public key carries no confidentiality concern by definition, so this raises nothing the
server's existing per-call input model does not already handle.

A signature currently requires an accompanying `hash` to be checked: `verify-integrity` still reports
`hash-missing` for a signature-only event, before any signature logic runs. Signature-only events are
possible future work, not a defect in this one.

ECDSA-P256-SHA256 and RSA-PSS-SHA256 remain unimplemented, as recommended-but-optional identifiers the
schema already names; an event declaring either is reported `unsupported-signature-algorithm`, the
same way an unimplemented hash algorithm always has been.

See [ADR 0012](decisions/0012-ed25519-signature-verification.md) for why Ed25519 first, why a CLI flag
rather than a key registry, and why this needed no schema change.

- New fixtures: `examples/integrity/valid/signed-event-ed25519.json`,
  `examples/integrity/invalid/tampered-signed-event.json`,
  `examples/integrity/invalid/unsupported-signature-algorithm.json`, and the TEST-ONLY public key they
  verify against at `examples/integrity/keys/ed25519-test-public.pem`.

## 0.1.1 - 2026-08-04

### Fixed — the published package's own README said it was not published

`0.1.0`'s bundled `README.md` told a reader the CLI was "not yet published to a package registry" —
accurate when that sentence was written, false from the moment `npm publish` succeeded, and
uncorrectable in place: a published npm version's contents cannot be edited after the fact, only
superseded. `README.md` and the mirrored Quick Start section of the generated site now drive the CLI
through `npx @openauditmodel/cli` again, and `conformance/tests/readme-quick-start.test.ts` asserts
it, so the stale wording cannot silently come back. `0.1.0` is left exactly as published,
contradiction included — that is what an immutable version is for.

## 0.1.0 - 2026-08-04

First bootstrap of the OpenAuditModel v0.1 Experimental Specification, followed by the
tamper-evidence verification toolchain.

### Changed — the CLI is installable, and a scan that did not run no longer looks clean

**The package could not be consumed.** It was `private: true`, named `open-audit-model`, and its
`files` allowlist omitted `profiles/` — so even after publishing, `check-profile` would have failed
for every consumer with no profile to load. No test caught it, because every test reads the
repository. The package is now `@openauditmodel/cli`, publishable, with `auditmodel` as the canonical
binary and `openauditmodel` as an alias, and it ships the canonical schema, all ten profile
definitions, the semantic conventions and the specification.

- `scripts/verify-package.mjs` runs from `prepack` and refuses to build a tarball that omits the
  schema or the profiles, or that includes tests, fixtures, the MCP server or the privacy fixtures.
- `scripts/package-smoke-test.mjs` packs, installs into a throwaway directory outside the working
  tree and drives the installed binary. A new CI job runs it. It is the only check that can catch a
  path which resolves in the checkout and nowhere else.

**Exit code 3 now means "no verdict" across the whole CLI**, not just `check-profile`.
`lint-privacy` previously returned 1 for an input it could not evaluate, which was safe but
indistinguishable from a real finding. It now returns 3 and says plainly that the input is not an
OpenAuditModel event and was **not scanned**, so it can never be read as clean. A real finding still
outranks an unevaluated sibling in a mixed batch, because a finding is the actionable signal.

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | A verdict was produced and it passed.                                |
| `1`  | A verdict was produced and it failed.                                |
| `2`  | The tool could not run.                                              |
| `3`  | No verdict was produced. `check-profile`: no rule governs the event. |
|      | `lint-privacy`: the input is not an audit event and was not scanned. |

`EXIT_NOT_APPLICABLE` is retained as an alias of the new `EXIT_NO_VERDICT`, so nothing that imported
it changes.

**The README quick start now works, and is tested.** It previously showed a package name that was
never published, a positional profile argument the CLI rejects, and — once written out — an event
that fails schema validation, because `resource.type` may not contain a dot.
`conformance/tests/readme-quick-start.test.ts` extracts the event and the commands from `README.md`
itself and asserts every documented outcome, including that the event is deliberately
non-conforming to the financial profile and not-applicable to an unrelated one. Documentation that
drifts from behaviour now fails the build.

The quick start also states what `not-applicable` is not: the profile said nothing about the event,
which is not the same as approving it.

### Added — eight enforceable domain profiles

Eight profiles join `identity-and-access-management` and `document-management`, taking v0.1 from two
enforceable profiles to **ten** and from 22 rules to **127**. Every profile uses only the existing
declarative rule language: no engine change, no profile-schema change, no new `when` operator, no
array predicate, no regex or numeric rule.

| Profile                            | Rules | Valid | Invalid | Not applicable |
| ---------------------------------- | ----- | ----- | ------- | -------------- |
| `incident-management`              | 15    | 13    | 14      | 3              |
| `message-broker-management`        | 12    | 12    | 12      | 3              |
| `deployment-and-change-management` | 13    | 12    | 14      | 3              |
| `financial-transaction-management` | 12    | 12    | 12      | 3              |
| `secrets-and-key-management`       | 14    | 12    | 12      | 3              |
| `customer-and-account-management`  | 13    | 12    | 12      | 3              |
| `backup-and-recovery`              | 13    | 15    | 12      | 3              |
| `api-and-integration-management`   | 13    | 13    | 12      | 3              |

Each profile ships `profile.json`, a profile README, a fixture README, valid/invalid/not-applicable
fixtures and a conformance test file. All 100 new invalid fixtures fail with **exactly one** error at
the documented rule and pointer, and every enforceable rule has at least one negative fixture — both
verified across the whole set rather than asserted.

The four former placeholder profiles are now implemented. **There are no placeholder profiles left
in v0.1.**

**Design decisions carried across all eight**

- **High-volume data-plane events stay ungoverned, structurally.** Ordinary message publish and
  consume, routine API requests, webhook deliveries, automated secret retrieval, backup chunk writes,
  pipeline polling, balance views and customer searches match no rule, because no selector uses a
  prefix broad enough to sweep them in. Each profile carries not-applicable fixtures that would start
  conforming if a selector were widened.
- **Approval is never universally required.** It is required only on events that _are_ approvals, and
  otherwise gated on a producer-declared `/metadata/<domain>/approvalRequired` boolean. Continuous
  deployment, automatic key rotation, scheduled settlement and routine backups remain conforming
  without a human approval record. The profiles do not say when an organization must set that flag.
- **Metadata is namespaced per domain** (`/metadata/incident/…`, `/metadata/broker/…`,
  `/metadata/financial/…`), so an event governed by two profiles cannot have two meanings for one key.
- **No trace identifier is required**, because tracing may not exist. `/request/correlationId` is
  recommended for multi-stage workflows.
- **`/request/protocol` is never required**, so operations from HTTP, gRPC, Kafka, AMQP, RESP, SFTP,
  CLI, scheduled jobs and internal automation are equally conforming.
- **Broker ACL administration belongs to the broker profile, not `identity.*`** — it is a
  control-plane operation on a broker, not an identity change.
- **`/integrity/batchId` is not a backup identifier.** The backup profile uses
  `/metadata/backup/backupId`; `batchId` remains exclusively an integrity sealing or verification
  batch.

**Rule-language limitations, recorded rather than worked around**

- Array contents cannot be inspected, so no rule can require that `/evidence` contains an entry of a
  particular type. The incident profile _recommends_ `/evidence` instead of pretending to verify it.
- Numeric ranges cannot be checked. `/metadata/financial/amount` is required to be a number; no rule
  can assert a threshold.
- There is no cross-field comparison, so separation of duties, `resolvedAt > detectedAt` and
  agreement between a status field and `/change/after` are documented guidance, not enforced rules.
- One equality condition per rule, so compound policy is expressed through a single producer-derived
  boolean rather than several overlapping rules that would approximate an AND incorrectly.

**MCP**

All ten profiles are discoverable and checkable through the MCP server; `check_profile` derives its
profile list from the bundled manifest, so no code changed. The resource catalogue goes from
**21 to 29**. `npm run check:profile`, `npm run lint:privacy` and the CI profile job cover all ten.

### Fixed

- The CI profile loop was rewritten with real line continuations. An intermediate edit had left
  backslash-n as two literal characters in the `for PROFILE in …` list, which `bash -e` would have
  word-split into a bogus `n` profile name — aborting the job on its first iteration and silently
  checking **no** profile at all. Caught by adversarial review before it ever ran.
- The root README listed `document-management` as a placeholder after it had been implemented.

### Added — document management profile

- **A second implemented profile**, `document-management`, with 11 declarative rules covering
  document creation, deletion, download, versioning, sharing, access policy, retention and legal
  hold. It uses only the existing rule language — no engine change, no profile-schema change, and no
  rule that inspects array contents.
- **High-volume read events are deliberately ungoverned.** No selector uses a bare `document.`
  prefix, so `document.file.view` matches no rule and is reported as not applicable. Requiring an
  authorization decision and a justification on every document view would be switched off rather than
  met. A test asserts the exclusion, because widening one prefix later would silently govern every
  read in a deployment.
- 22 fixtures: 10 valid, 11 invalid, 1 not-applicable. Every valid fixture is core-conforming and
  privacy-clean; every invalid fixture is core-**valid** and fails **exactly one** rule, which a test
  enforces so that a negative fixture cannot pass for the wrong reason.
- `openauditmodel://profiles/document-management/0.1` is exposed as an MCP resource, taking the
  catalogue from **20 to 21 resources**. `npm run check:profile`, `npm run lint:privacy` and the CI
  profile job now cover both implemented profiles.

Design notes: metadata requirements are namespaced (`/metadata/share/...`) to match the IAM profile
and to keep two profiles from assigning different meanings to the same `/metadata` key. Approval is
recommended and never required, because many document systems legitimately let an owner delete their
own draft. Retention and legal-hold rules record **state and justification only** — they assert
nothing about how long anything must be kept, and conformance with them is not compliance with any
legal duty.

### Added — correlation and tracing guidance

- `semantic-conventions/correlation-and-tracing.md` — how to choose between `/id`,
  `/request/requestId`, `/request/traceId`, `/request/spanId` and `/request/correlationId` across
  HTTP, messaging, background jobs and workflows, including correlation for systems with no tracing
  at all. Informative. Exposed as MCP resource
  `openauditmodel://semantic-conventions/correlation-and-tracing`, taking the catalogue from
  **19 to 20 resources**.
- Four examples covering an HTTP entry point, a consumer that starts a new trace while keeping the
  business correlation, a scheduled job with no request context, and an approval workflow where
  `/request/requestId` and `/approval/requestId` legitimately coexist.
- An **experimental** extension for messaging causation, `org.openauditmodel.correlation.causes`. It
  is an array because a scalar cannot express fan-in, and it stays an extension because there is not
  enough production adoption evidence to freeze its shape in the core schema.

### Changed — normative correlation rules

**No change was made to the core JSON Schema**, the generated Ajv validator, CLI behaviour, privacy
rules, integrity rules, profiles, MCP tools or MCP prompts.

- `specification/event-model.md` §10 gains normative rules: correlation identifiers are observational
  metadata and MUST NOT be used as proof of identity, authorization, authenticity, integrity or
  tenant isolation; audit event generation MUST NOT depend on trace sampling; producers SHOULD take
  trace and span identifiers from the active trace context rather than generating them; `spanId`
  SHOULD be recorded only with `traceId`; raw `traceparent` and `tracestate` SHOULD NOT be stored;
  and sensitive values SHOULD NOT be used as correlation identifiers.
- **Corrected: trace context does not establish causality.** `specification/delivery.md` previously
  said to use trace context "for causality" and to establish ordering from it. A shared `traceId`
  groups events that belong to one execution; it says nothing about which caused which, or in what
  order. Ordering comes from `sequence`.
- **Corrected: the CloudEvents `correlationId` → `subject` mapping.** `subject` describes the event's
  subject within its `source`, so `resource` is the correct source for it where one applies. Carrying
  a correlation identifier there made `subject` unusable for the routing and filtering CloudEvents
  defines it for, and was not reversible for a consumer. `correlationId` is now left unmapped, with a
  documented custom extension attribute as the alternative.
- **Clarified: `/integrity/batchId` is a sealing or verification batch.** It does not identify a job
  run, processing batch, import batch or business operation; `/request/correlationId` is the field
  for those.
- Corrected the section cross-references in `specification/event-model.md` §1.2, which pointed one
  section low from `organization` onward.

### Fixed

- **`OAM_MAX_EVENT_BYTES` and `OAM_MAX_CHAIN_EVENTS` had no effect.** Both were parsed,
  range-checked, cross-validated against the request limit and documented as operator controls,
  while the tools enforced hardcoded constants instead. The configured values are now the values
  enforced, and `verify_chain` reports the configured limit rather than the built-in one. Default
  behaviour is unchanged, because the defaults on both sides were already identical — which is
  also why no existing test caught it. A test now runs a server on a non-default configuration,
  the only way the difference is observable.

### Changed — self-hosted Docker MCP server

- **The MCP server is no longer deployed to Cloudflare Workers.** It is now a stateless Node.js
  Streamable HTTP server distributed as a container image, self-hosted behind a reverse proxy that
  terminates TLS. The Worker was implemented and tested but never deployed, so nothing operational
  was lost. See `decisions/0011-self-hosted-docker-mcp-server.md`; ADR 0009 is marked superseded and
  retained as historical context.
- `workers/mcp/` moved to `mcp/`. The tools, prompts, resources, engines, output-safety rules and
  both generated artifacts are reused unchanged — the same seven tools, three prompts and nineteen
  resources, with the same names, URIs and result shapes. A connected client cannot tell the platform
  changed.
- MCP is now handled by the official packages: `createMcpHandler` from
  `@modelcontextprotocol/server` and `toNodeHandler` from `@modelcontextprotocol/node`, over plain
  `node:http`. No framework, and no vendor SDK between the project and MCP.
- The standalone Ajv validator is kept even though Node permits runtime compilation: it is Ajv’s own
  compiled logic, so the server’s verdict is identical to the CLI’s by construction, and the schema
  stays a build artifact rather than a runtime input.

**Added**

- `mcp/src/config.ts` — startup configuration, parsed and validated once, failing startup with a
  message that names the offending variable and never its value. Wildcard origins are rejected.
- `mcp/src/logging.ts` — structured logs with an allowlisted field set. There is no parameter
  through which a request body, event identifier, actor, resource, digest or finding could be logged.
- `mcp/src/http-server.ts` — routing, origin and host policy, request limits enforced while reading
  the body, and safe errors. `X-Forwarded-Host` is believed only behind a declared trusted proxy.
- Graceful shutdown on SIGTERM and SIGINT with a bounded grace period.
- `Dockerfile` — multi-stage, Debian slim, non-root, read-only-filesystem compatible, OCI labels,
  health check, exec-form entrypoint. `.dockerignore` excludes git metadata, tests and the synthetic
  privacy fixtures. The runtime image carries no package manager and no declarations or source maps:
  every Node-level CVE reported against the image came from npm’s own vendored tree rather than from
  a production dependency, and a production container has no reason to be able to install anything.
- `mcp/tests/logging.test.ts` — holds the log allowlist to the code, including that a property
  smuggled past the type system does not reach a log line.
- `deploy/docker-compose.yml` and `deploy/README.md` — hardened example plus an Nginx reverse-proxy
  configuration, DNS, environment, upgrade and rollback documentation.
- No image registry. The image is built locally with `docker build --tag openauditmodel-mcp:local`
  on whichever Docker daemon runs it, and started with Docker Compose. Nothing is pushed or pulled,
  and there is no registry account, login or credential anywhere in the repository. A release is a
  versioned local tag such as `openauditmodel-mcp:0.1.0-alpha.1`; `latest` is never used.
- `deploy/smoke-test.mjs` — dependency-free verification of a running deployment: `initialize`, the
  three catalogues, a real tool call, and the origin policy. CI runs the same script against a
  freshly built container, so a release gate and an operator’s check cannot drift apart.
- A CI job that builds the image and tests the container itself — health, non-root, read-only
  filesystem, absence of any package manager, absence of source and fixtures, MCP over Streamable
  HTTP, log content, and a clean SIGTERM exit. `npm run mcp:check-generated` and the MCP test suite
  now also run on every pull request rather than only at publish time.

**Removed**

- `workers/mcp/wrangler.jsonc`, `.github/workflows/deploy-mcp.yml`, the Cloudflare Worker entry
  point, and the `agents`, `wrangler` and `@cloudflare/workers-types` dependencies. Only one
  production MCP implementation exists.

### Added — remote MCP server

- `workers/mcp/` — a stateless Cloudflare Worker exposing the conformance engines over MCP
  Streamable HTTP at `/mcp`, built with `createMcpHandler` from `agents@0.20.1`. No Durable
  Objects, no SSE, no session state, no storage binding of any kind.
- Seven deterministic, read-only tools: `validate_event`, `verify_integrity`, `verify_chain`,
  `lint_privacy`, `check_profile`, `generate_event_template`, `get_event_guidance`. Each
  delegates to the existing engine rather than reimplementing it; parity is asserted by test.
- Three prompts: `design_audit_event`, `review_audit_event`, `instrument_operation`. The Worker
  runs no model and never sees a caller’s source repository.
- Nineteen read-only resources under `openauditmodel://`, compiled into the Worker from a build-time
  allowlist. The Worker reads no file and fetches nothing.
- `src/schema-validator.generated.ts` — Ajv standalone output for the canonical schema, because
  Workers forbid `new Function`. Because it is Ajv’s own compiled logic, Worker validation is
  identical to the CLI’s rather than an approximation. CI fails when either generated file is stale.
- Input limits with structured refusals: request body, event size, event count, JSON depth and output
  size. Input is never silently truncated.
- `decisions/0009-remote-cloudflare-mcp-server.md`; remote MCP threat model in `SECURITY.md`;
  `.github/workflows/deploy-mcp.yml`, which never deploys from a pull request.
- 36 Worker tests covering routing, Origin policy, MCP protocol, tool parity against the engines,
  output safety over the synthetic privacy fixtures, and the generated build artifacts.

### Changed — remote MCP server

- `conformance/src/validator-interface.ts` splits the compiled-validator seam away from Ajv, so a
  bundle that only validates carries no code generator. Verified: the Worker bundle contains no
  `new Function` and no `node:fs`.
- The conformance engines accept `EventValidator` rather than the filesystem-flavoured `Validator`.
- Package metadata now declares the official homepage and repository.

### Added — declarative profile conformance

**Profile definition format**

- `profiles/profile-definition.schema.json` — a Draft 2020-12 schema, identified by
  `https://openauditmodel.org/schemas/profile-definition/0.1/schema.json`, that validates **profile documents**. It is not
  part of the canonical audit event schema and never constrains an audit event.
- Six rule capabilities and nothing else: `events` and `eventPrefixes` selectors; `requiredPaths`,
  `requiredMetadata` and `requiredValues` requirements; `recommendedPaths` recommendations; and one
  `when` conditional comparing a single path for equality against a single scalar.
- The vocabulary has **no keyword that could relax a core requirement**. There is no `optionalPaths`,
  no `exemptPaths`, no `overrides`; a test reads the rule schema's property names and fails if any
  relaxation-shaped name appears.
- Profiles are versioned independently of the core and declare the `coreVersions` they apply to.

**Tooling**

- `auditmodel check-profile <path...> --profile <name>` — validates against the core schema, selects
  matching rules, evaluates them and reports per-rule, per-pointer findings. `--format json` produces
  a machine-readable report.
- `conformance/src/profiles/` — `types`, `resolve-pointer`, `validate-profile-definition`,
  `load-profile`, `select-rules`, `evaluate-rule` and `check-profile`, all usable independently of
  the CLI.
- Exit code `3` for `check-profile`: no checked event was governed by the profile. Distinct from `0`
  so that a pipeline cannot read "the profile said nothing" as "the profile was satisfied".

**Identity and access management profile**

- `profiles/identity-and-access-management/profile.json` — eleven rules covering user lifecycle, role
  assignment and revocation, permission grant and revoke, service account lifecycle and credential
  rotation. Expressed **entirely declaratively**, with no TypeScript.
- `IAM-ROLE-002` and `IAM-PERM-002` use the conditional mechanism: when the privileged flag is `true`,
  approval, authentication and `authentication.mfa` equal to `true` are required.
- Normative profile requirements that no tool can check — that the primary resource identifies the
  target, and that actor and target are not represented ambiguously — are documented as such rather
  than approximated by a rule that would be wrong.

**Fixtures**

- `examples/profiles/identity-and-access-management/` — seven conforming events, seven violating
  exactly one rule, and one event the profile does not govern. Every fixture is core-conforming: the
  invalid ones fail the profile, not the schema.

**Tests**

- 133 new tests. Profile definition validation including unknown properties, unsupported selectors,
  invalid pointers, invalid metadata types and invalid conditional operators; rule selection including
  prefix over-matching; JSON Pointer resolution including prototype unreachability; presence semantics
  including `false` and `0`; conditional evaluation including strict equality and absent predicates;
  and the documented CLI exit codes through child processes.
- **Core invariant tests**: a core-invalid event can never be profile-valid, profile rules are not
  evaluated for one, a profile cannot introduce a top-level property, and profile checking never
  mutates the input event.
- **Cross-command tests**: every valid profile fixture passes `validate`, `lint-privacy` and
  `check-profile`; credential and service-account fixtures are additionally checked field by field for
  secret-shaped members.

**Decisions**

- `decisions/0008-declarative-profile-conformance.md`, including security and compatibility
  considerations.

### Changed — declarative profile conformance

- `check-profile` is removed from the CLI's planned-command list.
- **Privacy rule refinement.** `OAM-PRIV-001` now reports a credential-named property holding a
  **scalar**; a container under such a name is treated as a descriptor and its members are inspected
  individually. The identity profile requires `/metadata/credential/type` for rotation events, and the
  previous rule reported every conforming rotation event as a critical finding. The accepted cost is a
  secret stored under a harmless member name inside such a container, documented in
  `specification/privacy.md` §6.9 and ADR 0007.
- No change to the canonical audit event schema was required.

### Added — privacy and secret-exposure linting

**Tooling**

- `auditmodel lint-privacy <path...>` — deterministic, local, read-only static analysis reporting
  suspected violations of `specification/privacy.md` §1 and §2. It sends nothing anywhere, resolves
  no reference, fetches no URL, opens no referenced file, uses no model or remote service, and never
  modifies or redacts an event.
- `--format json` for a machine-readable report.
- `conformance/src/privacy/` — `types`, `rules`, `field-names`, `safe-formats`, `entropy`,
  `token-patterns`, `url-analysis`, `size-analysis`, `traverse` and `lint-event`, all usable
  independently of the CLI.

**Rules** — 17 rules across 10 categories, each with a fixed severity and a confidence reported
separately:

- `OAM-PRIV-001` credential property names, matched exactly after normalization, including the final
  segment of a reverse-domain extension key.
- `OAM-PRIV-002` authorization header values; `OAM-PRIV-003` private key markers.
- `OAM-PRIV-010` structurally valid JSON Web Tokens; `OAM-PRIV-011` to `OAM-PRIV-016` published
  credential prefixes for access key identifiers, source forges, messaging, payments and cloud APIs.
- `OAM-PRIV-030` URLs with embedded user information; `OAM-PRIV-031` evidence references carrying a
  query string or fragment.
- `OAM-PRIV-040` connection strings carrying a password; `OAM-PRIV-041` connection strings without
  one, reported separately at low severity and explicitly not called a credential.
- `OAM-PRIV-050` the entropy heuristic, at low confidence; `OAM-PRIV-060` oversized values;
  `OAM-PRIV-061` raw request, response and message body fields.

**Specification**

- `specification/privacy.md` §6 rewritten: the four kinds of rule, what the linter checks, what it
  cannot check, why a finding is a suspicion and a clean result is not a clearance, why output never
  contains matched values, inspected paths, known-safe exclusions, fixed thresholds, false-positive
  and false-negative risk, why schema validation is not secret scanning, and exit codes.

**Fixtures**

- `examples/privacy/clean/` — five events that must produce no findings, exercising UUIDs, ULIDs,
  trace and span identifiers, digests, timestamps, safe evidence references and a credential rotation
  recorded as changed field names.
- `examples/privacy/findings/` — eleven events, each raising one documented rule. Every value is
  synthetic and non-functional; `examples/privacy/README.md` documents how and why.

**Tests**

- 197 new tests. Property-name matching including the negative cases that make name-based linters
  unusable (`passwordPolicy`, `tokenCount`, `authorizationDecision`, `requestBodyHash`); JWT
  structure including segments that decode to non-objects; published token formats with positive and
  negative cases; URL and connection-string analysis; every entropy exclusion; size thresholds;
  JSON Pointer escaping and traversal depth; and the documented CLI exit codes.
- Output-safety tests assert that no synthetic fixture value appears in either output format, backed
  by a companion test asserting those values are still present in the fixtures, so the assertion
  cannot silently become vacuous.
- A dogfooding test requires every published example outside `examples/privacy` to be clean. It
  caught a real false positive during implementation: path-shaped evidence references were tripping
  the entropy rule.

**Decisions**

- `decisions/0007-deterministic-privacy-linting.md`, including false-positive and false-negative
  strategies and security considerations.

### Changed — privacy and secret-exposure linting

- `lint-privacy` is removed from the CLI's planned-command list.
- No schema change was required: every rule reads values the canonical schema already permits.

### Added — tamper-evidence verification

**Specification**

- `specification/integrity.md` §4 — a **normative digest procedure**. Deep-clone the event, remove
  exactly `/integrity/hash` and `/integrity/signature`, serialize with RFC 8785, encode as UTF-8,
  hash, encode as lower-case hexadecimal, compare as bytes. No empty container is pruned: an
  `integrity` object left with no members serializes as `{}`.
- §4.1 — the normative inclusion set. `sequence`, `integrity.previousHash`, `integrity.chainId`,
  `integrity.batchId`, `integrity.hashAlgorithm` and `integrity.canonicalization` are **inside** the
  digest, so chain metadata cannot be rewritten without invalidating the event that carries it.
- §4.2 — the consequence for collectors: `observedTime` is inside the digest, so adding it to a
  sealed event invalidates it.
- §5 — lower-case hexadecimal as the single digest encoding, and why one encoding is mandatory.
- §6 — `SHA-256`, `SHA-384` and `SHA-512` as the algorithms conforming v0.1 tooling implements, with
  case-sensitive matching and the rule that schema acceptance is not verifier support.
- §7 — chain rules: `chainId`, `hash` and `sequence` required for chain membership, one algorithm and
  canonicalization per chain, unique sequences, gaps permitted, and the first-event rule (the genesis
  event omits `previousHash`; no genesis constant is defined).
- §7.3 — links compare against the predecessor's declared hash, with every declared hash
  independently verified.
- §8 — eleven statements of what verification does **not** prove, including tail truncation.

**Tooling**

- `auditmodel verify-integrity <path...>` — validates against the schema, confirms the declared
  canonicalization and algorithm are implemented, recalculates the digest and compares it.
- `auditmodel verify-chain <path...>` — groups events by `chainId`, orders by `sequence`, verifies
  every event digest and every link. Detects broken links, modified events, reordering, duplicate
  sequences, missing sequences, mixed algorithms, unsupported algorithms and unassignable events.
- `conformance/src/integrity/` — `canonicalize`, `digest`, `verify-event`, `verify-chain` and
  `types`, all usable independently of the CLI.
- `conformance/src/sources.ts` — shared event loading with an 8 MiB document limit, used by every
  command so that read, parse and size behaviour is identical everywhere.
- `sealEvent`, exported so that producers, fixtures and tests calculate digests with the same code
  the verifier uses. It performs no signing and touches no key material.
- `conformance/tools/generate-integrity-fixtures.ts` — generates every integrity fixture, with a
  `--check` mode that fails the build on drift. Nothing writes fixtures during a normal test run.

**Fixtures**

- `examples/integrity/valid/` — a sealed single event, a three-event chain, and an event exercising
  RFC 8785 determinism over mixed scripts, escapes, number forms and nesting.
- `examples/integrity/invalid/` — tampered event, wrong declared hash, unsupported algorithm, broken
  previous hash, duplicate sequence, missing sequence and reordered chain. Every fixture is a
  schema-valid event that fails verification rather than validation.
- `examples/integrity/README.md` documenting each fixture and its expected finding.

**Tests**

- 137 new tests: RFC 8785 conformance vectors written for this project (ordering by UTF-16 code unit,
  non-BMP characters, combining sequences, escapes, ECMAScript number forms, array order, UTF-8
  encoding, input guards, depth bound); digest exclusion and inclusion for every field; SHA-256,
  SHA-384 and SHA-512 round trips; digest comparison including malformed encodings; every chain
  failure mode; every published fixture; and the CLI's documented exit codes through a child process.
- A test asserts that failure output never contains event content.
- A test asserts that every published example carrying an `integrity.hash` verifies.

**Decisions**

- `decisions/0006-event-digest-and-chain-verification.md`.

### Changed — tamper-evidence verification

- **Breaking.** `integrity.hash` and `integrity.previousHash` are narrowed from the shared `digest`
  definition to a new `hexDigest` definition: lower-case hexadecimal, even length. An event that
  encoded either in base64 or upper-case hexadecimal was valid and is no longer valid. A digest that
  might be hexadecimal or base64 cannot be compared without guessing, and no published example or
  fixture was affected. See ADR 0006.
- **Breaking.** `integrity.canonicalization` is now required whenever `integrity.hash` is present,
  through `dependentRequired`. An event that declared a hash without a canonicalization was valid and
  is no longer valid, because such an event can never be verified by anyone. No published example or
  fixture was affected. See ADR 0006.
- **Non-breaking.** `auditmodel validate` now accepts a JSON array of events, and `.jsonl` and
  `.ndjson` files, in addition to a single-event JSON file or a directory. Its summary line counts
  events rather than files.
- **Non-breaking.** All commands refuse a document larger than 8 MiB, and reject a JSON structure
  nested more than 200 levels deep, rather than attempting to parse or canonicalize it.
- `verify-integrity` and `verify-chain` are removed from the CLI's planned-command list.

### Fixed

- `examples/valid/privileged-configuration-change.json` carried an invented `integrity.hash` that no
  verifier could reproduce. It is now correctly sealed and verifies, and a test keeps it that way.

### Security — tamper-evidence verification

- Digests are compared as bytes with `timingSafeEqual`, after both values are checked against the
  accepted encoding. Validating the encoding first is what prevents `Buffer.from(value, "hex")`
  truncating a malformed value into a comparison.
- Malformed encodings, unimplemented algorithms and unimplemented canonicalizations are reported.
  Nothing is guessed, coerced, padded or truncated to make a comparison succeed.
- `hashAlgorithm` and `canonicalization` are inside the digest, so relabelling a sealed event with a
  weaker algorithm invalidates it rather than changing how it is checked.
- Failure output contains file paths, JSON Pointers, digests and finding kinds — never event content
  — so verifying an event that mistakenly contains a secret does not copy it into a CI log.
- Verification resolves no remote reference, fetches no evidence URL and evaluates nothing contained
  in an event. All tests remain offline.

### Dependencies

- Added `canonicalize@^3.0.0` — RFC 8785 JSON Canonicalization Scheme. Apache-2.0, the same licence
  as this project; no transitive dependencies; pure ESM with type declarations; authored by the
  author of RFC 8785. Reviewed in ADR 0006.
- Upgraded `eslint` and `@eslint/js` to v10 to clear a transitive advisory in `brace-expansion`.
  `npm audit` reports no vulnerabilities.

### Added — initial bootstrap

**Specification**

- `specification/overview.md` — scope, conformance, document status labels, versioning and
  compatibility, relationship to other standards.
- `specification/terminology.md` — RFC 2119 and RFC 8174 normative keywords, and the project
  vocabulary.
- `specification/design-principles.md` — the twelve principles every proposed change is evaluated
  against.
- `specification/event-model.md` — top-level structure, identity, time, sequence, event descriptor,
  outcomes, severity, errors, naming rules, application, organization, request correlation, reason,
  control categories and tags.
- `specification/actor-model.md` — principals, the actor / subject / resource distinction, principal
  types and identifier guidance.
- `specification/resource-model.md` — resources, open-ended resource types, classification and
  related resources.
- `specification/authentication.md` — authentication context, and why absence differs from anonymous
  authentication.
- `specification/authorization.md` — authorization decisions, and why the model records decisions
  rather than evaluating policy.
- `specification/approval-and-delegation.md` — approval status, delegation types, and the subject
  requirement for delegated authority.
- `specification/change-model.md` — change types, and the four safe ways to describe a change.
- `specification/evidence-model.md` — evidence as references, never embedded payloads.
- `specification/privacy.md` — values that must never be recorded, the allowlist capture model, data
  minimization, and the limits of schema validation.
- `specification/integrity.md` — tamper-evidence, canonicalization, hash chaining, and seven
  guarantees integrity metadata does **not** provide.
- `specification/delivery.md` — transport independence, idempotency, ordering, gaps, and what
  pipeline components must not modify.
- `specification/extension-model.md` — `metadata` versus `extensions`, reverse-domain namespaces and
  promotion.

**Schema**

- `schemas/v0.1/audit-event.schema.json` — canonical JSON Schema Draft 2020-12, identified by
  `https://openauditmodel.org/schemas/audit-event/0.1/schema.json`.
- Seven required top-level fields: `specVersion`, `id`, `time`, `event`, `actor`, `resource`,
  `application`.
- Nineteen optional top-level fields covering observation time, sequence, subject, delegation,
  related resources, organization, authentication, authorization, approval, request correlation,
  change, reason, evidence, integrity, privacy, control categories, tags, metadata and extensions.
- `specVersion` pinned to `"0.1"` with `const`.
- All core objects reject unknown properties.
- Optional objects must carry at least one property when present.
- Conditional rule: `event.outcome` of `failure` requires `event.error`.
- Conditional rule: `delegation.type` of `impersonation`, `on-behalf-of` or `delegated` requires
  `subject`.
- Dependent rule: `integrity.hash` and `integrity.previousHash` require `integrity.hashAlgorithm`.
- Reverse-domain namespace enforcement for `extensions` keys, minimum three segments.
- W3C Trace Context compatible `traceId` and `spanId`, rejecting all-zero values.
- `request.route` rejects query strings and fragments.
- Recursive free-form JSON value definition for `metadata`, `extensions` and `attributes`.

**Semantic conventions**

- `semantic-conventions/` — README, event naming rules with recommended categories and activity
  types, plus conventions for authentication, identity and access, data access, configuration and
  change, workflow and approval, and privileged operations.

**Profiles**

- `profiles/` — README explaining what a profile may and may not do, and informative placeholders for
  document management, incident management, message broker management, identity and access
  management, and deployment and change management. No profile is implemented in v0.1.

**Mappings**

- `mappings/` — informative mappings and comparisons for CloudEvents, OpenTelemetry, ECS, OCSF and
  CADF, each stating what does not map.

**Examples**

- Seven valid conformance fixtures: minimal event, user role assignment, document external share,
  incident case close, privileged configuration change, message broker consumer offset reset, and
  service account data export.
- Seven invalid conformance fixtures, each failing for exactly one documented reason: missing actor,
  missing resource, invalid event name, failure without error, delegation without subject, invalid
  extension namespace and unknown core property.
- `examples/README.md` and `examples/invalid/README.md` documenting every fixture and its expected
  outcome.

**Conformance tooling**

- `auditmodel` CLI with the `validate` command, accepting files and directories.
- Exit codes: `0` valid, `1` schema validation failure, `2` usage, read or parse error.
- Validation errors reported with JSON Pointer paths, the failing keyword and contextual detail.
- Offline validation: no remote reference is resolved and no network access is required.
- 143 conformance tests covering meta-schema validation, every published fixture, conditional rules,
  extension namespaces, strict core objects, trace identifier formats, empty and required values,
  vocabulary tokens, regular expression portability, and the absence of product, country and
  regulation specific concepts in the core schema.

**Architecture decisions**

- `decisions/0001-specification-first.md`
- `decisions/0002-json-schema-2020-12.md`
- `decisions/0003-backend-and-transport-independence.md`
- `decisions/0004-reverse-domain-extension-namespaces.md`
- `decisions/0005-core-and-profile-separation.md`

**Project**

- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` and this changelog.
- Apache License 2.0 for all content, including specification text.
- GitHub issue templates for bug reports, specification changes and profile proposals.
- Continuous integration running formatting, linting, schema validation, the test suite, valid and
  invalid example validation, a build and a CLI smoke test on active Node.js LTS releases.

### Changed — initial bootstrap

- Nothing. This is the first version.

### Deprecated

- Nothing.

### Removed

- Nothing.

### Security — initial bootstrap

- Schema patterns avoid look-around and back-references, keeping behaviour identical across ECMA-262,
  RE2 and PCRE engines and avoiding catastrophic backtracking classes. Enforced by a test.
- String lengths and array sizes are bounded so that a validator is not asked to process an unbounded
  document as conforming.
- `privacy.md` states the values that must never be recorded, and states plainly that schema
  validation cannot detect them.
- `integrity.md` states what tamper-evidence does not provide, so that integrity metadata is not
  mistaken for storage immutability or evidentiary status.
