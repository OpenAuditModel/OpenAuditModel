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

  test("exits 1 when events carry no chain identifier", () => {
    const result = auditmodel("verify-chain", VALID_EVENT);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[chain-id-missing\]/);
  });

  test("exits 2 when the directory does not exist", () => {
    const result = auditmodel("verify-chain", "examples/integrity/no-such-directory");
    assert.equal(result.status, 2);
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

describe("help and options", () => {
  test("help documents both verification commands", () => {
    const result = auditmodel("--help");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /auditmodel verify-integrity <path\.\.\.>/);
    assert.match(result.stdout, /auditmodel verify-chain <path\.\.\.>/);
  });

  test("help no longer lists the implemented commands as planned", () => {
    const planned = auditmodel("--help").stdout.split("Planned commands")[1] ?? "";
    assert.doesNotMatch(planned, /verify-integrity/);
    assert.doesNotMatch(planned, /verify-chain/);
    assert.match(planned, /check-coverage/);
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

  test("a still-planned command reports that it is not implemented", () => {
    const result = auditmodel("check-coverage", VALID_EVENT);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /not implemented/);
  });
});
