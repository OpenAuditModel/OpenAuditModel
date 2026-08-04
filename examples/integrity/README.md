# Integrity fixtures

**Status: Informative.** These fixtures illustrate and regression-test tamper-evidence verification.
They are not normative; the normative digest procedure is
[specification/integrity.md](../../specification/integrity.md) §4.

Every fixture is **generated**, never hand-edited. They carry real digests, so a single edited
character invalidates a hash — and a hand-corrected hash would hide whatever the edit broke. The
generator is [`conformance/tools/generate-integrity-fixtures.ts`](../../conformance/tools/generate-integrity-fixtures.ts)
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
```

Every fixture in this directory, valid and invalid alike, is a **schema-valid** event. The invalid
ones fail verification, not validation — that is the point of separating the two commands.

## Keys

[keys/ed25519-test-public.pem](keys/ed25519-test-public.pem) is the public half of a TEST-ONLY Ed25519
key pair generated solely to make `signed-event-ed25519.json` and its invalid variants reproducible by
the fixture generator, the same way their hashes are. **The private half is committed in the generator
itself and is not a secret** — anyone can produce a "validly signed" event under this key, which is
exactly why a real signing key must never be generated this way or checked into a repository.

## Valid fixtures

| Fixture                                                              | Demonstrates                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [single-event-sha256.json](valid/single-event-sha256.json)           | A sealed event with no chain                                               |
| [unicode-and-number-event.json](valid/unicode-and-number-event.json) | RFC 8785 determinism over mixed scripts, escapes, number forms and nesting |
| [signed-event-ed25519.json](valid/signed-event-ed25519.json)         | A sealed event additionally signed; verifiable with `--public-key`         |
| [three-event-chain/](valid/three-event-chain/)                       | A genesis event and two linked successors, sequences 1 to 3                |

`unicode-and-number-event.json` deliberately stores its members out of sorted order, mixes upper and
lower case keys, digit keys, Latin-1 and CJK keys, a non-BMP character, combining marks, control
character escapes, and numbers that exercise the ECMAScript number-to-string forms (`1e+21`, `1e-7`,
`0.000001`). Canonicalization has to normalise all of it before the digest is stable.

## Invalid fixtures

Each fails verification for one documented reason. The expectations are asserted by
[`integrity-event.test.ts`](../../conformance/tests/integrity-event.test.ts) and
[`integrity-chain.test.ts`](../../conformance/tests/integrity-chain.test.ts).

| Fixture                                                                              | Defect                                                                    | Finding                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------- |
| [tampered-event.json](invalid/tampered-event.json)                                   | Content changed after sealing; declared hash untouched                    | `hash-mismatch`                   |
| [wrong-declared-hash.json](invalid/wrong-declared-hash.json)                         | Content untouched; declared hash is a digest of another event             | `hash-mismatch`                   |
| [unsupported-algorithm.json](invalid/unsupported-algorithm.json)                     | Declares `BLAKE3`, which the v0.1 verifier does not implement             | `unsupported-algorithm`           |
| [tampered-signed-event.json](invalid/tampered-signed-event.json)                     | Content changed after signing; hash fails before the signature is reached | `hash-mismatch`                   |
| [unsupported-signature-algorithm.json](invalid/unsupported-signature-algorithm.json) | Declares `ECDSA-P256-SHA256`, not yet implemented                         | `unsupported-signature-algorithm` |
| [broken-previous-hash/](invalid/broken-previous-hash/)                               | Event 3 re-linked past event 2 and re-sealed                              | `broken-link`                     |
| [duplicate-sequence/](invalid/duplicate-sequence/)                                   | Two events declare sequence 2                                             | `duplicate-sequence`              |
| [missing-sequence/](invalid/missing-sequence/)                                       | Event 2 declares no sequence                                              | `sequence-missing`                |
| [reordered-chain/](invalid/reordered-chain/)                                         | Events 2 and 3 swap sequence numbers without re-sealing                   | `hash-mismatch`                   |

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
[ADR 0006](../../decisions/0006-event-digest-and-chain-verification.md).

**`tampered-signed-event.json` reports `hash-mismatch`, never a signature finding**, even with
`--public-key` supplied. Hash verification runs first; a mismatch there is reported and the signature
is never reached. The signature would in fact also fail — the content changed after both sealing and
signing — but the tool reports the first problem it finds, not every problem that exists.

## What these fixtures cannot show

No fixture demonstrates tail truncation, because a truncated chain is internally consistent and there
is nothing to detect. That limitation is real, is not an implementation defect, and is stated in
[integrity.md](../../specification/integrity.md) §8.
