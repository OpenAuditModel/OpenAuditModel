/**
 * Command line behaviour of `lint-privacy`, including the documented exit codes
 * and the guarantee that no synthetic secret reaches the terminal.
 *
 * The CLI runs as a child process so that what is asserted is what a user or a
 * CI job actually sees.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveSchemaPath } from "../src/validate.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const findingsDir = path.join(repoRoot, "examples", "privacy", "findings");

const scratch = mkdtempSync(path.join(tmpdir(), "openauditmodel-privacy-"));
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

const CLEAN = "examples/privacy/clean/minimal-clean-event.json";
const PASSWORD = "examples/privacy/findings/password-field.json";

describe("exit codes", () => {
  test("a clean event exits 0", () => {
    const result = auditmodel("lint-privacy", CLEAN);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /0 privacy findings/);
  });

  test("an event with findings exits 1", () => {
    const result = auditmodel("lint-privacy", PASSWORD);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /OAM-PRIV-001/);
  });

  test("a missing file exits 2", () => {
    assert.equal(auditmodel("lint-privacy", "examples/privacy/no-such-file.json").status, 2);
  });

  test("invalid JSON exits 2", () => {
    const file = writeScratch("malformed.json", '{"specVersion": "0.1",');
    const result = auditmodel("lint-privacy", file);
    assert.equal(result.status, 2);
    assert.match(result.output, /cannot parse JSON/);
  });

  test("no path exits 2", () => {
    const result = auditmodel("lint-privacy");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires at least one file or directory/);
  });

  test("an unknown output format exits 2", () => {
    const result = auditmodel("lint-privacy", CLEAN, "--format", "yaml");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown output format/);
  });
});

describe("schema-invalid input", () => {
  test("a schema-invalid event exits non-zero and is not linted", () => {
    const result = auditmodel("lint-privacy", "examples/invalid/missing-actor.json");

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /not an OpenAuditModel event: NOT scanned/);
    assert.match(result.stdout, /actor/);
    assert.match(result.stdout, /1 schema-invalid/);
  });

  test("a schema-invalid event with a secret is not deep linted", () => {
    const event = JSON.parse(readFileSync(path.join(repoRoot, PASSWORD), "utf8")) as Record<
      string,
      unknown
    >;
    delete event["actor"];
    const file = writeScratch("schema-invalid-secret.json", JSON.stringify(event));

    const result = auditmodel("lint-privacy", file);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /schema-invalid/);
    assert.doesNotMatch(result.stdout, /OAM-PRIV-001/);
  });
});

describe("the exit-code contract distinguishes a failed scan from an unperformed one", () => {
  /**
   * A privacy scan that could not run must never look like a scan that found
   * nothing. `lint-privacy` reads only the locations the specification defines
   * on an audit event, so an input that is not one is not scanned at all — and
   * reporting that as exit 0 would hand a CI job a green tick over unexamined
   * data. Exit 3 means "no verdict", the same thing it means for
   * `check-profile`, and it is deliberately distinct from 1, which means a
   * verdict was produced and it was negative.
   */
  const SECRET = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";

  test("a schema-invalid input exits 3, not 0 and not 1", () => {
    const file = writeScratch(
      "not-an-event.json",
      JSON.stringify({ foo: { bar: SECRET }, note: "AKIAIOSFODNN7EXAMPLE" }),
    );

    const result = auditmodel("lint-privacy", file);

    assert.equal(result.status, 3);
    assert.match(result.stdout, /NOT scanned/);
    assert.match(result.stdout, /Privacy evaluation was not completed/);
    // The summary must not be able to read as a pass: nothing was scanned.
    assert.match(result.stdout, /0 clean/);
    assert.match(result.stdout, /1 schema-invalid/);
  });

  test("a schema-invalid input never echoes the value it did not scan", () => {
    const file = writeScratch("not-an-event-echo.json", JSON.stringify({ foo: { bar: SECRET } }));

    const result = auditmodel("lint-privacy", file);

    assert.doesNotMatch(result.output, /sk_live_/);
    assert.doesNotMatch(result.output, /AKIAIOSFODNN7EXAMPLE/);
  });

  test("a batch of only schema-invalid inputs exits 3", () => {
    const directory = path.join(scratch, "all-invalid");
    mkdirSync(directory, { recursive: true });
    for (const name of ["a.json", "b.json"]) {
      writeFileSync(path.join(directory, name), JSON.stringify({ foo: SECRET }), "utf8");
    }

    const result = auditmodel("lint-privacy", directory);

    assert.equal(result.status, 3);
    assert.match(result.stdout, /2 schema-invalid/);
  });

  test("a real finding outranks an unscanned input in a mixed batch", () => {
    const directory = path.join(scratch, "mixed");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "clean.json"),
      readFileSync(path.join(repoRoot, CLEAN), "utf8"),
      "utf8",
    );
    writeFileSync(
      path.join(directory, "finding.json"),
      readFileSync(path.join(repoRoot, PASSWORD), "utf8"),
      "utf8",
    );
    writeFileSync(path.join(directory, "invalid.json"), JSON.stringify({ foo: SECRET }), "utf8");

    const result = auditmodel("lint-privacy", directory);

    // 1, not 3: a finding is the actionable signal and must not be buried by a
    // sibling that could not be evaluated. The unscanned input is still reported.
    assert.equal(result.status, 1);
    assert.match(result.stdout, /1 schema-invalid/);
    assert.match(result.stdout, /Privacy evaluation was not completed/);
  });

  test("an operational failure is still 2, not 3", () => {
    assert.equal(auditmodel("lint-privacy", "no-such-file.json").status, 2);
  });

  test("a clean valid event is the only input that exits 0", () => {
    assert.equal(auditmodel("lint-privacy", CLEAN).status, 0);
  });
});

describe("input forms", () => {
  test("a directory is linted", () => {
    const result = auditmodel("lint-privacy", "examples/privacy/clean");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /5 events checked: 5 clean/);
  });

  test("a JSON array in one file is linted", () => {
    const events = ["minimal-clean-event.json", "structured-metadata.json"].map((name) =>
      JSON.parse(readFileSync(path.join(repoRoot, "examples", "privacy", "clean", name), "utf8")),
    );
    const file = writeScratch("array.json", JSON.stringify(events));

    const result = auditmodel("lint-privacy", file);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /2 events checked: 2 clean/);
  });

  test("JSON Lines input is linted", () => {
    const lines = ["minimal-clean-event.json", "sanitized-change.json"]
      .map((name) =>
        readFileSync(path.join(repoRoot, "examples", "privacy", "clean", name), "utf8"),
      )
      .map((raw) => JSON.stringify(JSON.parse(raw)))
      .join("\n");
    const file = writeScratch("events.jsonl", `${lines}\n`);

    const result = auditmodel("lint-privacy", file);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /2 events checked: 2 clean/);
  });

  test("multiple paths are linted together", () => {
    const result = auditmodel("lint-privacy", CLEAN, PASSWORD);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /2 events checked: 1 clean, 1 with findings/);
  });
});

describe("quiet mode", () => {
  test("clean events are suppressed but the summary remains", () => {
    const result = auditmodel("lint-privacy", CLEAN, "--quiet");
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /^ok {4}/m);
    assert.match(result.stdout, /0 privacy findings/);
  });

  test("findings and the non-zero exit survive quiet mode", () => {
    const result = auditmodel("lint-privacy", CLEAN, PASSWORD, "--quiet");
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /ok {4}examples\/privacy\/clean/);
    assert.match(result.stdout, /OAM-PRIV-001/);
  });
});

describe("json output", () => {
  test("the report is machine readable and carries the summary", () => {
    const result = auditmodel("lint-privacy", "examples/privacy/findings", "--format", "json");
    assert.equal(result.status, 1);

    const report = JSON.parse(result.stdout) as {
      tool: string;
      summary: { events: number; findings: number };
      results: Array<{ file: string; status: string; findings: Array<Record<string, unknown>> }>;
    };

    assert.equal(report.tool, "auditmodel lint-privacy");
    assert.equal(report.summary.events, 11);
    assert.ok(report.summary.findings >= 11);
    assert.equal(report.results.length, 11);
  });

  test("every JSON finding carries the documented fields and nothing value-bearing", () => {
    const result = auditmodel("lint-privacy", "examples/privacy/findings", "--format", "json");
    const report = JSON.parse(result.stdout) as {
      results: Array<{ findings: Array<Record<string, unknown>> }>;
    };

    for (const entry of report.results) {
      for (const finding of entry.findings) {
        for (const field of ["ruleId", "severity", "confidence", "path", "message"]) {
          assert.ok(field in finding, `missing ${field}`);
        }
        for (const forbidden of [
          "actualValue",
          "matchedValue",
          "valuePreview",
          "prefix",
          "suffix",
        ]) {
          assert.equal(forbidden in finding, false, forbidden);
        }
      }
    }
  });

  test("a clean run produces a valid JSON report and exits 0", () => {
    const result = auditmodel("lint-privacy", "examples/privacy/clean", "--format", "json");
    assert.equal(result.status, 0);

    const report = JSON.parse(result.stdout) as { summary: { findings: number; clean: number } };
    assert.equal(report.summary.findings, 0);
    assert.equal(report.summary.clean, 5);
  });
});

describe("output safety", () => {
  /** Distinctive substrings taken from the published finding fixtures. */
  const markers = [
    "synthetic-fixture-value-not-a-real-password",
    "synthetic-fixture-value-not-a-real-token",
    "SYNTHETICFIXTUREVALUE",
    "eyJhbGciOiJIUzI1NiI",
    "BEGIN PRIVATE KEY",
    "synthetic-password",
    "synthetic_password",
    "Zq7Z9dK2mR4xT6vB",
    "customerId",
  ];

  test("human output contains no value from any finding fixture", () => {
    const result = auditmodel("lint-privacy", "examples/privacy/findings");
    assert.equal(result.status, 1);

    for (const marker of markers) {
      assert.ok(!result.output.includes(marker), `human output leaked ${marker}`);
    }
  });

  test("JSON output contains no value from any finding fixture", () => {
    const result = auditmodel("lint-privacy", "examples/privacy/findings", "--format", "json");

    for (const marker of markers) {
      assert.ok(!result.output.includes(marker), `JSON output leaked ${marker}`);
    }
  });

  test("every finding fixture value is actually present on disk", () => {
    // Guards the test above: a marker that no longer exists proves nothing.
    const corpus = readdirSync(findingsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readFileSync(path.join(findingsDir, entry), "utf8"))
      .join("\n");

    for (const marker of markers) {
      assert.ok(corpus.includes(marker), `${marker} is no longer in any fixture`);
    }
  });

  test("a parse error does not dump file content", () => {
    const file = writeScratch("secret-malformed.json", '{"metadata":{"password":"CANARYVALUE"');
    const result = auditmodel("lint-privacy", file);

    assert.equal(result.status, 2);
    assert.doesNotMatch(result.output, /CANARYVALUE/);
  });
});

describe("help", () => {
  test("lint-privacy is documented and no longer listed as planned", () => {
    const result = auditmodel("--help");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /auditmodel lint-privacy <path\.\.\.>/);
    assert.match(result.stdout, /--format <text\|json>/);

    const planned = result.stdout.split("Planned commands")[1] ?? "";
    assert.doesNotMatch(planned, /lint-privacy/);
    assert.match(planned, /check-coverage/);
  });

  test("help states that findings are suspicions, not proof", () => {
    const result = auditmodel("--help");
    // The help text is wrapped, so line breaks may fall inside these phrases.
    assert.match(result.stdout, /reports suspicions,\s+never proof/i);
    assert.match(result.stdout, /clean result does not mean an event is\s+safe or compliant/i);
    assert.doesNotMatch(
      result.stdout,
      /(?:proves|confirms) (?:a )?(?:breach|credential|violation)/i,
    );
  });
});

describe("existing commands are unchanged", () => {
  test("validate still exits 0 for the published valid examples", () => {
    assert.equal(auditmodel("validate", "examples/valid").status, 0);
  });

  test("the privacy fixtures are schema-valid events", () => {
    assert.equal(auditmodel("validate", "examples/privacy/clean").status, 0);
    assert.equal(auditmodel("validate", "examples/privacy/findings").status, 0);
  });

  test("verify-integrity still verifies a sealed event", () => {
    assert.equal(
      auditmodel("verify-integrity", "examples/integrity/valid/single-event-sha256.json").status,
      0,
    );
  });
});
