/**
 * `check-coverage`: what a profile reached, and what it did not.
 *
 * The command exists because `check-profile` cannot answer the question a
 * producer most needs answered first. An export that returns no violations has
 * told you nothing if every event was `not-applicable`, and the two are
 * indistinguishable in a line that counts only failures.
 *
 * Two contracts are asserted here more carefully than the rest, because both
 * are easy to lose in a later edit: coverage **never exits 1**, and a rule that
 * was selected and never applied is reported as such rather than counted as
 * coverage.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";
import { fileURLToPath } from "node:url";
import { createValidator, resolveSchemaPath } from "../src/validate.js";
import { checkProfile } from "../src/profiles/check-profile.js";
import { summariseCoverage } from "../src/profiles/coverage.js";
import type { ProfileDefinition } from "../src/profiles/types.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const validator = createValidator(schemaPath);

const scratch = mkdtempSync(path.join(tmpdir(), "openauditmodel-coverage-"));
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

function writeScratch(name: string, events: readonly unknown[]): string {
  const file = path.join(scratch, name);
  writeFileSync(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  return file;
}

/** A profile whose rules are shaped to exercise selection, conditions and severity. */
const PROFILE: ProfileDefinition = {
  profileVersion: "0.1",
  name: "coverage-fixture",
  version: "0.1",
  status: "experimental",
  coreVersions: ["0.1"],
  title: "Coverage fixture",
  description: "A profile that exists only for the coverage tests.",
  rules: [
    {
      id: "COV-001",
      description: "Every governed operation records an authorization decision.",
      events: ["thing.create", "thing.delete"],
      requiredPaths: ["/authorization"],
    },
    {
      id: "COV-002",
      description: "A deletion that the producer marks irreversible records a reason.",
      events: ["thing.delete"],
      when: { path: "/metadata/irreversible", equals: true },
      requiredPaths: ["/reason"],
    },
    {
      id: "COV-003",
      description: "A rule no event in these tests ever names.",
      events: ["other.thing.archive"],
      requiredPaths: ["/reason"],
    },
  ],
} as ProfileDefinition;

function event(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: "0.1",
    id: "018f1b70-2c18-7f3a-b46d-5e8a1c9d0b12",
    time: "2026-03-14T11:47:52.108Z",
    event: { name, category: "data-modification", outcome: "success" },
    actor: { type: "user", id: "user-1" },
    resource: { type: "thing", id: "thing-1" },
    application: { name: "coverage-app", environment: "production" },
    ...extra,
  };
}

function coverageOf(events: readonly unknown[]) {
  const results = events.map((value, index) =>
    checkProfile(value, `event-${index}`, PROFILE, validator),
  );
  return summariseCoverage(events, results, PROFILE);
}

describe("coverage counts what a profile reached", () => {
  test("a governed name is counted against every rule that selects it", () => {
    const coverage = coverageOf([event("thing.create"), event("thing.create")]);
    const rule = coverage.perRule.find((entry) => entry.ruleId === "COV-001");
    assert.equal(rule?.selected, 2);
    assert.equal(rule?.applied, 2);
    assert.equal(rule?.failed, 2, "neither event carries /authorization");
  });

  test("selected is not applied: a condition that never holds contributes nothing", () => {
    const coverage = coverageOf([
      event("thing.delete", { authorization: { decision: "allow" } }),
      event("thing.delete", { authorization: { decision: "allow" } }),
    ]);
    const conditional = coverage.perRule.find((entry) => entry.ruleId === "COV-002");
    assert.equal(conditional?.selected, 2, "the name selects the rule");
    assert.equal(conditional?.applied, 0, "the condition never held");
    assert.equal(conditional?.failed, 0, "and so nothing failed");
    assert.deepEqual(coverage.rules.selectedButNeverApplied, ["COV-002"]);
  });

  test("a condition that does hold is counted as applied", () => {
    const coverage = coverageOf([
      event("thing.delete", {
        authorization: { decision: "allow" },
        metadata: { irreversible: true },
      }),
    ]);
    const conditional = coverage.perRule.find((entry) => entry.ruleId === "COV-002");
    assert.equal(conditional?.applied, 1);
    assert.equal(conditional?.failed, 1, "/reason is absent");
    assert.deepEqual(coverage.rules.selectedButNeverApplied, []);
  });

  test("a rule no event names is reported as never selected", () => {
    const coverage = coverageOf([event("thing.create")]);
    assert.deepEqual(coverage.rules.neverSelected, ["COV-002", "COV-003"]);
    assert.equal(coverage.rules.total, 3);
    assert.equal(coverage.rules.selected, 1);
  });

  test("event names are split into governed and ungoverned", () => {
    const coverage = coverageOf([
      event("thing.create"),
      event("thing.read"),
      event("thing.read"),
      event("thing.read"),
    ]);
    assert.deepEqual(coverage.nameTotals, { distinct: 2, governed: 1, ungoverned: 1 });
    // Most frequent first, so the largest ungoverned family is the first thing read.
    assert.deepEqual(
      coverage.names.map((entry) => [entry.name, entry.events, entry.governed]),
      [
        ["thing.read", 3, false],
        ["thing.create", 1, true],
      ],
    );
  });

  test("a core-invalid event is counted but never credited as governed", () => {
    const broken = event("thing.create");
    delete broken["actor"];
    const coverage = coverageOf([broken]);
    assert.equal(coverage.events.coreInvalid, 1);
    assert.equal(coverage.nameTotals.governed, 0, "no rule was evaluated against it");
    assert.equal(coverage.perRule.find((entry) => entry.ruleId === "COV-001")?.selected, 0);
  });

  test("an empty set reaches nothing rather than reaching everything", () => {
    const coverage = coverageOf([]);
    assert.equal(coverage.rules.selected, 0);
    assert.deepEqual(coverage.nameTotals, { distinct: 0, governed: 0, ungoverned: 0 });
  });
});

describe("the check-coverage command", () => {
  test("reports coverage and exits 0 when the profile reached something", () => {
    const file = writeScratch("governed.jsonl", [event("incident.create")]);
    const result = auditmodel("check-coverage", file, "--profile", "incident-management");
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /1 governed/);
  });

  test("exits 3, never 0, when no event is governed", () => {
    const file = writeScratch("ungoverned.jsonl", [event("thing.read")]);
    const result = auditmodel("check-coverage", file, "--profile", "incident-management");
    assert.equal(result.status, 3, result.output);
    assert.match(result.stdout, /governs no event in this set, so it checked nothing/);
  });

  test("never exits 1, even when every governed event violates the profile", () => {
    // The contract that separates this command from check-profile: coverage
    // reports reach and makes no pass or fail claim.
    const file = writeScratch("violating.jsonl", [event("incident.create")]);
    const coverage = auditmodel("check-coverage", file, "--profile", "incident-management");
    const profile = auditmodel("check-profile", file, "--profile", "incident-management");
    assert.equal(profile.status, 1, "the same input fails check-profile");
    assert.equal(coverage.status, 0, "and is still a successful coverage report");
  });

  test("requires --profile and says which profiles exist", () => {
    const file = writeScratch("any.jsonl", [event("thing.create")]);
    const result = auditmodel("check-coverage", file);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires --profile/);
    assert.match(result.stderr, /incident-management/);
  });

  test("an unknown profile is a usage error, not an empty report", () => {
    const file = writeScratch("any2.jsonl", [event("thing.create")]);
    const result = auditmodel("check-coverage", file, "--profile", "no-such-profile");
    assert.equal(result.status, 2);
  });

  test("--format json carries the whole report", () => {
    const file = writeScratch("json.jsonl", [event("incident.create"), event("thing.read")]);
    const result = auditmodel(
      "check-coverage",
      file,
      "--profile",
      "incident-management",
      "--format",
      "json",
    );
    assert.equal(result.status, 0, result.output);
    const report = JSON.parse(result.stdout) as {
      tool: string;
      coverage: {
        rules: { total: number; selected: number };
        nameTotals: { distinct: number; governed: number; ungoverned: number };
        names: readonly { name: string }[];
      };
    };
    assert.equal(report.tool, "auditmodel check-coverage");
    assert.equal(report.coverage.nameTotals.distinct, 2);
    assert.equal(report.coverage.nameTotals.governed, 1);
    assert.equal(report.coverage.nameTotals.ungoverned, 1);
    assert.ok(report.coverage.rules.total > 0);
  });

  test("it is no longer advertised as a planned command", () => {
    const help = auditmodel("--help");
    assert.match(help.stdout, /auditmodel check-coverage <path\.\.\.>/);
    assert.doesNotMatch(help.stdout, /Planned commands/);
  });
});
