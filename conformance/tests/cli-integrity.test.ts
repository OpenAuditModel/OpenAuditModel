/**
 * Command line behaviour of `verify-integrity` and `verify-chain`, including
 * the documented exit codes.
 *
 * The CLI is run as a child process so that what is asserted is what a user or
 * a CI job actually observes.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveSchemaPath } from "../src/validate.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const scratch = mkdtempSync(path.join(tmpdir(), "openauditmodel-cli-"));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

function auditmodel(...args: string[]): CliResult {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status ?? -1, stdout, stderr, output: `${stdout}${stderr}` };
}

function writeScratch(name: string, contents: string): string {
  const file = path.join(scratch, name);
  writeFileSync(file, contents, "utf8");
  return file;
}

const VALID_EVENT = "examples/integrity/valid/single-event-sha256.json";
const VALID_CHAIN = "examples/integrity/valid/three-event-chain";
const BATCHED_CHAIN = "examples/integrity/valid/chain-in-two-batches";
const TRUNCATED_CHAIN = "examples/integrity/invalid/truncated-chain";
const CHECKPOINTS = "examples/integrity/checkpoints";
const CHECKPOINT = `${CHECKPOINTS}/three-event-chain.checkpoint.json`;
const SIGNED_EVENT = "examples/integrity/valid/signed-event-ed25519.json";
const TEST_PUBLIC_KEY = "examples/integrity/keys/ed25519-test-public.pem";

describe("verify-integrity", () => {
  test("exits 0 and reports each check for a sealed event", () => {
    const result = auditmodel("verify-integrity", VALID_EVENT);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /schema valid/);
    assert.match(result.stdout, /canonicalization: RFC8785/);
    assert.match(result.stdout, /hash algorithm: SHA-256/);
    assert.match(result.stdout, /integrity hash valid/);
    assert.match(result.stdout, /1 event checked: 1 verified, 0 failed/);
  });

  test("exits 1 and shows both digests when an event was modified", () => {
    const result = auditmodel("verify-integrity", "examples/integrity/invalid/tampered-event.json");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /integrity hash mismatch {2}\[hash-mismatch\]/);
    assert.match(result.stdout, /declared: {3}[0-9a-f]{64}/);
    assert.match(result.stdout, /calculated: [0-9a-f]{64}/);
  });

  test("exits 1 when the declared hash belongs to another event", () => {
    const result = auditmodel(
      "verify-integrity",
      "examples/integrity/invalid/wrong-declared-hash.json",
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[hash-mismatch\]/);
  });

  test("exits 1 for an algorithm the verifier does not implement", () => {
    const result = auditmodel(
      "verify-integrity",
      "examples/integrity/invalid/unsupported-algorithm.json",
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[unsupported-algorithm\]/);
    assert.match(result.stdout, /SHA-256, SHA-384, SHA-512/);
  });

  test("exits 1 when the event carries no integrity object", () => {
    const result = auditmodel("verify-integrity", "examples/valid/minimal-event.json");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[integrity-missing\]/);
  });

  test("exits 1 for a schema-invalid event", () => {
    const result = auditmodel("verify-integrity", "examples/invalid/missing-actor.json");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[schema-invalid\]/);
  });

  test("exits 2 when the file does not exist", () => {
    const result = auditmodel("verify-integrity", "examples/integrity/valid/no-such-file.json");
    assert.equal(result.status, 2);
  });

  test("exits 2 when the file is not valid JSON", () => {
    const file = writeScratch("malformed.json", '{"specVersion": "0.1",');
    const result = auditmodel("verify-integrity", file);
    assert.equal(result.status, 2);
    assert.match(result.output, /cannot parse JSON/);
  });

  test("exits 2 when no path is given", () => {
    const result = auditmodel("verify-integrity");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires at least one file or directory/);
  });

  test("a failure report contains no event content", () => {
    const result = auditmodel("verify-integrity", "examples/integrity/invalid/tampered-event.json");
    const tampered = readFileSync(
      path.join(repoRoot, "examples", "integrity", "invalid", "tampered-event.json"),
      "utf8",
    );
    const summary = (JSON.parse(tampered) as { event: { summary: string } }).event.summary;

    assert.equal(result.status, 1);
    assert.ok(summary.length > 20, "the fixture must carry a distinctive summary to look for");
    assert.doesNotMatch(result.output, new RegExp(summary.slice(0, 30)));
    assert.doesNotMatch(result.output, /configuration-audit-retention/);
  });
});

describe("verify-chain", () => {
  test("exits 0 for an intact chain and names what it proved", () => {
    const result = auditmodel("verify-chain", VALID_CHAIN);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /all 3 event digests valid/);
    assert.match(result.stdout, /all 2 previous-hash links valid/);
    assert.match(result.stdout, /chain starts at a genesis event/);
    assert.match(result.stdout, /1 chain checked: 1 intact, 0 broken \(3 events\)/);
  });

  test("reports the chain head as the declared hash of the last event", () => {
    const last = JSON.parse(readFileSync(path.join(repoRoot, VALID_CHAIN, "003.json"), "utf8")) as {
      integrity: { hash: string };
    };
    const result = auditmodel("verify-chain", VALID_CHAIN);
    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`^  head:      ${last.integrity.hash}$`, "m"));
  });

  test("lists sealing batches as a note that does not change the verdict", () => {
    const result = auditmodel("verify-chain", BATCHED_CHAIN);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /note: events declare 2 sealing batches/);
    assert.match(result.stdout, /batch-2026-04-03-08-instance-9e4b: 2 events, sequences 1\.\.2/);
    assert.match(result.stdout, /batch-2026-04-03-09-instance-9e4b: 1 event, sequence 3/);
    assert.match(result.stdout, /reported, not judged/);
    assert.match(result.stdout, /1 chain checked: 1 intact, 0 broken \(3 events\)/);

    const quiet = auditmodel("verify-chain", BATCHED_CHAIN, "--quiet");
    assert.equal(quiet.status, 0);
    assert.doesNotMatch(quiet.stdout, /sealing batch/);
  });

  const brokenChains: ReadonlyArray<readonly [string, RegExp]> = [
    ["broken-previous-hash", /\[broken-link\]/],
    ["duplicate-sequence", /\[duplicate-sequence\]/],
    ["missing-sequence", /\[sequence-missing\]/],
    ["reordered-chain", /\[hash-mismatch\]/],
  ];

  for (const [directory, expected] of brokenChains) {
    test(`exits 1 for ${directory}`, () => {
      const result = auditmodel("verify-chain", `examples/integrity/invalid/${directory}`);
      assert.equal(result.status, 1);
      assert.match(result.stdout, expected);
      assert.match(result.stdout, /0 intact, 1 broken/);
    });
  }

  test("exits 3 when events carry no chain identifier, because no chain was checked", () => {
    const result = auditmodel("verify-chain", VALID_EVENT);
    assert.equal(result.status, 3);
    assert.match(result.stdout, /\[chain-id-missing\]/);
    assert.match(result.stderr, /no chain was verified/);
  });

  test("exits 3 for schema-invalid events too — nothing was assignable, so nothing was checked", () => {
    const result = auditmodel("verify-chain", "examples/invalid/missing-actor.json");
    assert.equal(result.status, 3);
    assert.match(result.stderr, /no chain was verified/);
  });

  test("a load failure keeps exit 2 precedence over the no-verdict exit 3", () => {
    const result = auditmodel("verify-chain", VALID_EVENT, "examples/integrity/no-such-file.json");
    assert.equal(result.status, 2);
  });

  test("exits 2 when the directory does not exist", () => {
    const result = auditmodel("verify-chain", "examples/integrity/no-such-directory");
    assert.equal(result.status, 2);
  });
});

describe("--public-key", () => {
  test("without it, a signed event verifies and the signature is reported as not checked", () => {
    const result = auditmodel("verify-integrity", SIGNED_EVENT);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /integrity hash valid/);
    assert.match(result.stdout, /signature declared \(Ed25519\), not checked/);
  });

  test("without it, an unimplemented signature algorithm still fails verification", () => {
    const result = auditmodel(
      "verify-integrity",
      "examples/integrity/invalid/unsupported-signature-algorithm.json",
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[unsupported-signature-algorithm\]/);
  });

  test("with it, a genuinely signed event reports the signature as verified", () => {
    const result = auditmodel("verify-integrity", SIGNED_EVENT, "--public-key", TEST_PUBLIC_KEY);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /signature valid \(Ed25519\)/);
    assert.match(result.stdout, /1 event checked: 1 verified, 0 failed/);
  });

  test("a tampered signed event still fails on the hash, before the signature is reached", () => {
    const result = auditmodel(
      "verify-integrity",
      "examples/integrity/invalid/tampered-signed-event.json",
      "--public-key",
      TEST_PUBLIC_KEY,
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[hash-mismatch\]/);
    assert.doesNotMatch(result.stdout, /signature/);
  });

  test("a signature algorithm this verifier does not implement is refused", () => {
    const result = auditmodel(
      "verify-integrity",
      "examples/integrity/invalid/unsupported-signature-algorithm.json",
      "--public-key",
      TEST_PUBLIC_KEY,
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[unsupported-signature-algorithm\]/);
  });

  test("verify-chain accepts --public-key and verifies signatures across the chain", () => {
    const result = auditmodel("verify-chain", VALID_CHAIN, "--public-key", TEST_PUBLIC_KEY);
    // The published chain fixtures are hashed but not signed, so supplying a
    // key that finds nothing to check must not change the verdict.
    assert.equal(result.status, 0);
    assert.match(result.stdout, /all 3 event digests valid/);
  });

  test("exits 2 when the key file does not exist", () => {
    const result = auditmodel(
      "verify-integrity",
      SIGNED_EVENT,
      "--public-key",
      "examples/integrity/keys/no-such-key.pem",
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot read --public-key/);
  });

  test("exits 2 when the key file is not a readable key", () => {
    const result = auditmodel("verify-integrity", SIGNED_EVENT, "--public-key", SIGNED_EVENT);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /not a readable public key/);
  });

  test("is ignored by commands that do not use it, even when the path is bad", () => {
    const result = auditmodel(
      "validate",
      "examples/valid/minimal-event.json",
      "--public-key",
      "no-such-key.pem",
    );
    assert.equal(result.status, 0);
  });
});

describe("input forms", () => {
  test("an array of events in one file is verified", () => {
    const events = ["001.json", "002.json", "003.json"].map((name) =>
      JSON.parse(readFileSync(path.join(repoRoot, VALID_CHAIN, name), "utf8")),
    );
    const file = writeScratch("chain-array.json", JSON.stringify(events));

    const result = auditmodel("verify-chain", file);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /1 chain checked: 1 intact/);
  });

  test("JSON Lines input is verified", () => {
    const lines = ["001.json", "002.json", "003.json"]
      .map((name) => readFileSync(path.join(repoRoot, VALID_CHAIN, name), "utf8"))
      .map((raw) => JSON.stringify(JSON.parse(raw)))
      .join("\n");
    const file = writeScratch("chain.jsonl", `${lines}\n`);

    const result = auditmodel("verify-chain", file);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /1 chain checked: 1 intact/);
  });

  test("a malformed JSON Lines file reports the offending line and exits 2", () => {
    const file = writeScratch("broken.jsonl", '{"a":1}\nnot json\n');
    const result = auditmodel("verify-integrity", file);
    assert.equal(result.status, 2);
    assert.match(result.output, /line 2/);
  });

  test("a directory of events is verified", () => {
    const result = auditmodel("verify-integrity", VALID_CHAIN);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /3 events checked: 3 verified, 0 failed/);
  });
});

describe("existing commands are unchanged", () => {
  test("validate still exits 0 for the published valid examples", () => {
    const result = auditmodel("validate", "examples/valid");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /11 events checked: 11 valid, 0 invalid/);
  });

  test("validate still exits 1 for a schema-invalid event", () => {
    const result = auditmodel("validate", "examples/invalid/missing-actor.json");
    assert.equal(result.status, 1);
  });

  test("validate still exits 2 for a missing file", () => {
    assert.equal(auditmodel("validate", "examples/valid/no-such-file.json").status, 2);
  });

  test("the integrity fixtures are schema-valid events", () => {
    assert.equal(auditmodel("validate", "examples/integrity/valid").status, 0);
    assert.equal(auditmodel("validate", "examples/integrity/invalid").status, 0);
  });
});

describe("verify-checkpoint", () => {
  test("exits 0 when the archive reaches the recorded head, and says what it did not prove", () => {
    const result = auditmodel(
      "verify-checkpoint",
      VALID_CHAIN,
      "--checkpoint",
      CHECKPOINT,
      "--public-key",
      TEST_PUBLIC_KEY,
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /checkpoint schema valid/);
    assert.match(result.stdout, /signature valid \(Ed25519\)/);
    assert.match(result.stdout, /anchor: +manual — .*\(not dereferenced\)/);
    assert.match(result.stdout, /event at sequence 3 matches the recorded head/);
    assert.match(result.stdout, /1 chain named by the checkpoint: 1 agrees, 0 disagree, 0 missing/);
    assert.match(
      result.stdout,
      /whether the checkpoint is genuine and its anchor real is for whoever holds the anchor/,
    );
  });

  test("the deleted tail: verify-chain exits 0, verify-checkpoint exits 1 with tail-truncated", () => {
    const asChain = auditmodel("verify-chain", TRUNCATED_CHAIN);
    assert.equal(asChain.status, 0);
    assert.match(asChain.stdout, /1 chain checked: 1 intact, 0 broken/);

    const result = auditmodel("verify-checkpoint", TRUNCATED_CHAIN, "--checkpoint", CHECKPOINT);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[tail-truncated\]/);
    assert.match(
      result.stdout,
      /ends at sequence 2, but the checkpoint records a head at sequence 3/,
    );
    assert.match(result.stdout, /0 agree, 1 disagrees, 0 missing/);
  });

  test("a stale checkpoint exits 0 and the uncovered tail is a note", () => {
    const result = auditmodel(
      "verify-checkpoint",
      VALID_CHAIN,
      "--checkpoint",
      `${CHECKPOINTS}/three-event-chain.stale.checkpoint.json`,
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /note: 1 event after the checkpoint is not covered by it/);
  });

  test("a wrong head exits 1 and shows both hashes", () => {
    const result = auditmodel(
      "verify-checkpoint",
      VALID_CHAIN,
      "--checkpoint",
      `${CHECKPOINTS}/three-event-chain.wrong-head.checkpoint.json`,
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[checkpoint-head-mismatch\]/);
    assert.match(result.stdout, /recorded head hash: [0-9a-f]{64}/);
  });

  test("a document that is not a checkpoint exits 2 and judges nothing", () => {
    const result = auditmodel(
      "verify-checkpoint",
      VALID_CHAIN,
      "--checkpoint",
      `${CHECKPOINTS}/three-event-chain.unanchored.checkpoint.json`,
    );
    assert.equal(result.status, 2);
    assert.match(result.stdout, /\[checkpoint-schema-invalid\]/);
    assert.match(result.stdout, /\/anchor {2}missing required property/);
    assert.match(result.stdout, /nothing about the archive was judged/);
    assert.doesNotMatch(result.stdout, /agrees|disagrees/);
  });

  test("exits 3, never 0, when the archive holds none of the named chains", () => {
    const result = auditmodel("verify-checkpoint", BATCHED_CHAIN, "--checkpoint", CHECKPOINT);
    assert.equal(result.status, 3);
    assert.match(result.stdout, /\[checkpoint-chain-missing\]/);
    assert.match(
      result.stderr,
      /no verdict: the archive holds none of the chains the checkpoint names/,
    );
  });

  test("the multi-chain form verifies every chain it names across several inputs", () => {
    const archive = `${CHECKPOINTS}/archive.checkpoint.json`;
    const both = auditmodel(
      "verify-checkpoint",
      VALID_CHAIN,
      BATCHED_CHAIN,
      "--checkpoint",
      archive,
    );
    assert.equal(both.status, 0);
    assert.match(both.stdout, /2 chains named by the checkpoint: 2 agree, 0 disagree, 0 missing/);

    const one = auditmodel("verify-checkpoint", VALID_CHAIN, "--checkpoint", archive);
    assert.equal(one.status, 1);
    assert.match(one.stdout, /1 agrees, 0 disagree, 1 missing/);
  });

  test("--format json carries the outcome, the findings and the not-proven line", () => {
    const result = auditmodel(
      "verify-checkpoint",
      TRUNCATED_CHAIN,
      "--checkpoint",
      CHECKPOINT,
      "--format",
      "json",
    );
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout) as {
      tool: string;
      outcome: string;
      checkpoint: { schemaId: string; sharesLocationWithEvents: boolean };
      chains: Array<{ status: string; findings: Array<{ kind: string }> }>;
      notProven: string;
    };
    assert.equal(report.tool, "auditmodel verify-checkpoint");
    assert.equal(report.outcome, "disagrees");
    assert.match(report.checkpoint.schemaId, /schemas\/checkpoint\/0\.1/);
    assert.equal(report.checkpoint.sharesLocationWithEvents, false);
    assert.deepEqual(
      report.chains[0]?.findings.map((finding) => finding.kind),
      ["tail-truncated"],
    );
    assert.match(report.notProven, /whoever holds the anchor/);
  });

  test("a checkpoint kept beside the events is noted", () => {
    const events = readFileSync(path.join(repoRoot, VALID_CHAIN, "001.json"), "utf8");
    const checkpointText = readFileSync(
      path.join(repoRoot, CHECKPOINTS, "three-event-chain.stale.checkpoint.json"),
      "utf8",
    );
    // One event and the checkpoint taken at sequence 2 would not agree; only
    // the note is under test here, so a checkpoint at sequence 1 is written.
    const checkpoint = JSON.parse(checkpointText) as {
      head: { sequence: number; hash: string };
      eventCount: number;
    };
    const event = JSON.parse(events) as { integrity: { hash: string } };
    checkpoint.head = { sequence: 1, hash: event.integrity.hash };
    checkpoint.eventCount = 1;
    const eventFile = writeScratch("beside-001.json", events);
    const checkpointFile = writeScratch("beside.checkpoint.json", JSON.stringify(checkpoint));

    const result = auditmodel("verify-checkpoint", eventFile, "--checkpoint", checkpointFile);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /note: the checkpoint and the events come from the same location/);
  });

  test("exits 2 without --checkpoint, or with one that cannot be read", () => {
    const missing = auditmodel("verify-checkpoint", VALID_CHAIN);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /requires --checkpoint <file>/);

    const unreadable = auditmodel(
      "verify-checkpoint",
      VALID_CHAIN,
      "--checkpoint",
      `${CHECKPOINTS}/no-such.checkpoint.json`,
    );
    assert.equal(unreadable.status, 2);
    assert.match(unreadable.stderr, /cannot read --checkpoint/);
  });

  test("--checkpoint is refused by every other command rather than ignored", () => {
    const result = auditmodel("verify-chain", VALID_CHAIN, "--checkpoint", CHECKPOINT);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--checkpoint is not supported by "verify-chain"/);
  });

  test("a report contains no event content", () => {
    const result = auditmodel("verify-checkpoint", VALID_CHAIN, "--checkpoint", CHECKPOINT);
    assert.doesNotMatch(result.output, /Time-bound platform administrator/);
    assert.doesNotMatch(result.output, /just-in-time-access/);
  });
});

describe("help and options", () => {
  test("help documents the three verification commands", () => {
    const result = auditmodel("--help");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /auditmodel verify-integrity <path\.\.\.>/);
    assert.match(result.stdout, /auditmodel verify-chain <path\.\.\.>/);
    assert.match(result.stdout, /auditmodel verify-checkpoint <path\.\.\.>/);
    assert.match(result.stdout, /--checkpoint <file>/);
  });

  const formatUnsupported = ["validate", "verify-integrity", "verify-chain"] as const;
  for (const command of formatUnsupported) {
    test(`--format is refused by ${command} rather than silently ignored`, () => {
      const result = auditmodel(command, VALID_EVENT, "--format", "json");
      assert.equal(result.status, 2);
      assert.match(result.stderr, /--format is not supported by/);
    });
  }

  test("an unknown command with --format gets the unknown-command diagnosis, not the format one", () => {
    const result = auditmodel("no-such-command", "--format", "json");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown command/);
    assert.doesNotMatch(result.stderr, /--format is not supported/);
  });

  test("help documents --public-key and what happens without it", () => {
    const result = auditmodel("--help");
    assert.match(result.stdout, /--public-key <path>/);
    assert.match(result.stdout, /a declared signature is reported but not[\s\S]*checked/);
    assert.match(result.stdout, /fails verification either way/);
  });

  test("help advertises every command it implements, and none it does not", () => {
    // The planned-commands section existed while check-coverage was unbuilt.
    // Nothing is planned now, so the section is gone rather than empty: a
    // heading with nothing under it invites a reader to wonder what is missing.
    const help = auditmodel("--help").stdout;
    assert.doesNotMatch(help, /Planned commands/);
    for (const command of [
      "validate",
      "verify-integrity",
      "verify-chain",
      "verify-checkpoint",
      "lint-privacy",
      "check-profile",
      "check-coverage",
    ]) {
      assert.match(help, new RegExp(`auditmodel ${command} <path\\.\\.\\.>`), command);
    }
  });

  test("help states that verification is tamper-evident, not tamper-proof", () => {
    const result = auditmodel("--help");
    assert.match(result.stdout, /tamper-evident, not tamper-proof/);
    assert.match(result.stdout, /makes no claim of immutability, legal weight or non-repudiation/);
    // Immutability may be disclaimed; it must never be claimed.
    assert.doesNotMatch(result.stdout, /(?:events|records) are immutable/i);
    assert.doesNotMatch(
      result.stdout,
      /(?:guarantees|provides|ensures|proves)\s+(?:immutability|non-repudiation|legal)/i,
    );
  });

  test("quiet suppresses passing output but keeps the summary", () => {
    const result = auditmodel("verify-integrity", VALID_EVENT, "--quiet");
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /integrity hash valid/);
    assert.match(result.stdout, /1 event checked: 1 verified, 0 failed/);
  });

  test("no advertised command reports itself as unimplemented", () => {
    // The inverse of the test this replaces: check-coverage was the last
    // planned command, and running it must now produce a report rather than a
    // refusal. Exit 3 is a real verdict here — the profile governed nothing.
    const result = auditmodel("check-coverage", VALID_EVENT, "--profile", "incident-management");
    assert.notEqual(result.status, 2, result.output);
    assert.doesNotMatch(result.stderr, /not implemented/);
  });
});

describe("--public-key for the algorithms added in 0.5.0", () => {
  test("an ECDSA-P256-SHA256 fixture verifies with its test key", () => {
    const result = auditmodel(
      "verify-integrity",
      "examples/integrity/valid/signed-event-ecdsa-p256.json",
      "--public-key",
      "examples/integrity/keys/ecdsa-p256-test-public.pem",
    );
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /signature valid \(ECDSA-P256-SHA256\)/);
  });

  test("an RSA-PSS-SHA256 fixture verifies with its test key", () => {
    const result = auditmodel(
      "verify-integrity",
      "examples/integrity/valid/signed-event-rsa-pss.json",
      "--public-key",
      "examples/integrity/keys/rsa-pss-test-public.pem",
    );
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /signature valid \(RSA-PSS-SHA256\)/);
  });

  test("the wrong kind of key for the declared algorithm fails the signature, and says which", () => {
    const result = auditmodel(
      "verify-integrity",
      "examples/integrity/valid/signed-event-ecdsa-p256.json",
      "--public-key",
      TEST_PUBLIC_KEY,
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[signature-invalid\]/);
    assert.match(result.stdout, /is ed25519, but ECDSA-P256-SHA256 needs ec/);
  });
});
