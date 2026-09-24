/**
 * The 0.1 → 1.0 compatibility corpus (ADR 0017).
 *
 * Two promises are held here. First, that an archive written and sealed under
 * 0.1 goes on verifying under the 1.x tooling: its events were sealed with
 * `"specVersion": "0.1"` inside the digest and can never be migrated, so the
 * only way they stay useful is for the tooling to keep reading them. The sealed
 * corpus under examples/compatibility/v0.1 is the integrity material exactly as
 * 0.6.0 published it, and every verdict on it is pinned.
 *
 * Second, that 1.0 is 0.1 with a new version number and one optional field
 * (§5). Every published fixture is validated twice, declaring 0.1 and
 * declaring 1.0, and the two answers must be the same — except for a fixture
 * that uses `request.parentSpanId`, which 0.1 does not know.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import { createValidator, resolveSchemaPath } from "../src/validate.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const validator = createValidator(schemaPath);

const CORPUS = "examples/compatibility/v0.1/integrity";

function auditmodel(...args: string[]): { status: number; stdout: string } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "" };
}

function jsonFiles(directory: string): string[] {
  const absolute = path.join(repoRoot, directory);
  return readdirSync(absolute).flatMap((entry) => {
    const relative = path.join(directory, entry);
    if (statSync(path.join(repoRoot, relative)).isDirectory()) {
      return jsonFiles(relative);
    }
    return entry.endsWith(".json") ? [relative] : [];
  });
}

describe("an archive sealed under 0.1", () => {
  test("every event in it still declares 0.1", () => {
    // If a regeneration ever rewrote this corpus, it would stop being evidence
    // of anything: a sealed 0.1 archive is precisely what cannot be rewritten.
    const events = jsonFiles(`${CORPUS}/valid`).concat(jsonFiles(`${CORPUS}/invalid`));
    assert.ok(events.length >= 20, `the corpus lost events: ${events.length}`);
    for (const file of events) {
      const event = JSON.parse(readFileSync(path.join(repoRoot, file), "utf8")) as Record<
        string,
        unknown
      >;
      assert.equal(event["specVersion"], "0.1", file);
    }
  });

  test("its event digests and signatures still verify", () => {
    const result = auditmodel(
      "verify-integrity",
      "--public-key",
      `${CORPUS}/keys/ed25519-test-public.pem`,
      `${CORPUS}/valid/single-event-sha256.json`,
      `${CORPUS}/valid/unicode-and-number-event.json`,
      `${CORPUS}/valid/signed-event-ed25519.json`,
      `${CORPUS}/valid/three-event-chain`,
      `${CORPUS}/valid/chain-in-two-batches`,
    );
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /signature valid \(Ed25519\)/);

    // Each signed event against its own key, so that a signature altered in
    // this corpus fails here rather than passing as "declared, not checked".
    for (const [file, key, algorithm] of [
      ["signed-event-ecdsa-p256.json", "ecdsa-p256-test-public.pem", "ECDSA-P256-SHA256"],
      ["signed-event-rsa-pss.json", "rsa-pss-test-public.pem", "RSA-PSS-SHA256"],
    ] as const) {
      const signed = auditmodel(
        "verify-integrity",
        "--public-key",
        `${CORPUS}/keys/${key}`,
        `${CORPUS}/valid/${file}`,
      );
      assert.equal(signed.status, 0, signed.stdout);
      assert.match(signed.stdout, new RegExp(`signature valid \\(${algorithm}\\)`));
    }
    const tampered = auditmodel(
      "verify-integrity",
      "--public-key",
      `${CORPUS}/keys/ed25519-test-public.pem`,
      `${CORPUS}/invalid/tampered-signed-event.json`,
    );
    assert.equal(tampered.status, 1);
  });

  test("its chains are still intact, and its damaged chains still broken", () => {
    assert.equal(auditmodel("verify-chain", `${CORPUS}/valid/three-event-chain`).status, 0);
    assert.equal(auditmodel("verify-chain", `${CORPUS}/valid/chain-in-two-batches`).status, 0);
    for (const damaged of [
      "broken-previous-hash",
      "reordered-chain",
      "duplicate-sequence",
      "missing-sequence",
    ]) {
      assert.equal(auditmodel("verify-chain", `${CORPUS}/invalid/${damaged}`).status, 1, damaged);
    }
  });

  test("its checkpoint still agrees with it, and still catches its truncation", () => {
    const checkpoint = `${CORPUS}/checkpoints/three-event-chain.checkpoint.json`;
    assert.equal(
      auditmodel(
        "verify-checkpoint",
        "--checkpoint",
        checkpoint,
        "--public-key",
        `${CORPUS}/keys/ed25519-test-public.pem`,
        `${CORPUS}/valid/three-event-chain`,
      ).status,
      0,
    );
    const truncated = auditmodel(
      "verify-checkpoint",
      "--checkpoint",
      checkpoint,
      `${CORPUS}/invalid/truncated-chain`,
    );
    assert.equal(truncated.status, 1);
    assert.match(truncated.stdout, /tail-truncated/);

    const verify = (name: string, ...archive: string[]): number =>
      auditmodel("verify-checkpoint", "--checkpoint", `${CORPUS}/checkpoints/${name}`, ...archive)
        .status;
    assert.equal(
      verify("three-event-chain.stale.checkpoint.json", `${CORPUS}/valid/three-event-chain`),
      0,
    );
    assert.equal(
      verify("three-event-chain.wrong-head.checkpoint.json", `${CORPUS}/valid/three-event-chain`),
      1,
    );
    assert.equal(
      verify("three-event-chain.unanchored.checkpoint.json", `${CORPUS}/valid/three-event-chain`),
      2,
    );
    assert.equal(
      verify(
        "archive.checkpoint.json",
        `${CORPUS}/valid/three-event-chain`,
        `${CORPUS}/valid/chain-in-two-batches`,
      ),
      0,
    );
  });

  test("its inclusion proof still verifies", () => {
    const result = auditmodel(
      "verify-proof",
      "--proof",
      `${CORPUS}/proofs/three-event-chain.002.proof.json`,
      "--public-key",
      `${CORPUS}/keys/ed25519-test-public.pem`,
      `${CORPUS}/valid/three-event-chain/002.json`,
    );
    assert.equal(result.status, 0, result.stdout);

    const wrongRoot = auditmodel(
      "verify-proof",
      "--proof",
      `${CORPUS}/proofs/three-event-chain.002.wrong-root.proof.json`,
      `${CORPUS}/valid/three-event-chain/002.json`,
    );
    assert.equal(wrongRoot.status, 1);
  });
});

describe("1.0 relative to 0.1", () => {
  // Every published fixture outside the sealed corpus, whatever it was written
  // to show: valid events, invalid ones, privacy cases and profile cases.
  const fixtures = [
    "examples/valid",
    "examples/invalid",
    "examples/privacy",
    "examples/profiles",
    "examples/integrity/valid",
    "examples/integrity/invalid",
  ].flatMap((directory) => jsonFiles(directory));

  test("the corpus is the published fixtures, all of them", () => {
    assert.ok(fixtures.length > 250, `fixtures: ${fixtures.length}`);
  });

  test("every fixture is judged the same declaring 0.1 as declaring 1.0", () => {
    const differing: string[] = [];
    let compared = 0;
    for (const file of fixtures) {
      const document = JSON.parse(readFileSync(path.join(repoRoot, file), "utf8")) as unknown;
      const events = Array.isArray(document) ? document : [document];
      for (const event of events) {
        if (event === null || typeof event !== "object" || Array.isArray(event)) {
          continue;
        }
        const record = event as Record<string, unknown>;
        const request = record["request"] as Record<string, unknown> | undefined;
        if (request !== undefined && "parentSpanId" in request) {
          continue; // the one difference §5 names
        }
        const as = (version: string): string[] =>
          validator
            .validateEvent({ ...record, specVersion: version })
            .map((issue) => `${issue.path} ${issue.keyword}`)
            .sort();
        compared += 1;
        const under01 = as("0.1");
        const under10 = as("1.0");
        if (JSON.stringify(under01) !== JSON.stringify(under10)) {
          differing.push(
            `${file}: 0.1 ${JSON.stringify(under01)} / 1.0 ${JSON.stringify(under10)}`,
          );
        }
      }
    }
    assert.ok(compared > 250, `compared: ${compared}`);
    assert.deepEqual(differing, []);
  });
});

describe("the version-selection fixtures", () => {
  // examples/versions/README.md states the expected answer for each; the kit
  // records it for implementations in other languages. Held here so the table
  // and the tool cannot disagree.
  const expected: Readonly<Record<string, string>> = {
    "valid-under-0.1.json": "valid",
    "parent-span-under-1.0.json": "valid",
    "parent-span-under-0.1.json": "/request/parentSpanId additionalProperties",
    "newer-minor.json": "/specVersion specVersion-not-implemented",
    "other-major.json": "/specVersion specVersion-not-implemented",
    "never-published.json": "/specVersion specVersion-not-implemented",
    "malformed-version.json": "/specVersion const",
    "leading-zero-version.json": "/specVersion const",
  };

  test("every fixture gets the answer its README gives", () => {
    const files = jsonFiles("examples/versions").map((file) => path.basename(file));
    assert.deepEqual(files.sort(), Object.keys(expected).sort());
    for (const [name, answer] of Object.entries(expected)) {
      const event = JSON.parse(
        readFileSync(path.join(repoRoot, "examples/versions", name), "utf8"),
      ) as unknown;
      const issues = validator
        .validateEvent(event)
        .map((issue) => `${issue.path} ${issue.keyword}`);
      assert.deepEqual(issues, answer === "valid" ? [] : [answer], name);
    }
  });

  test("validate exits 1 for the set: three fail, three are not evaluated", () => {
    const result = auditmodel("validate", "examples/versions");
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /8 events checked: 2 valid, 3 invalid, 3 not evaluated, 0 unreadable/,
    );
  });

  test("validateFile, the library call, gives the same three answers", () => {
    const status = (name: string) =>
      validator.validateFile(path.join(repoRoot, "examples/versions", name)).status;
    assert.equal(status("valid-under-0.1.json"), "valid");
    assert.equal(status("newer-minor.json"), "not-evaluated");
    assert.equal(status("malformed-version.json"), "invalid");
  });
});
