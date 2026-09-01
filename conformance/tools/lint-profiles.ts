#!/usr/bin/env node
/**
 * Lints profile definitions for defects the definition schema cannot express.
 *
 * The schema decides whether a profile document is well formed. It cannot
 * decide whether the document says what its author meant, and several of the
 * ways it can fail to are silent: the profile loads, the tests pass, and a
 * requirement quietly stops being a requirement.
 *
 * Three of those are worth stating plainly, because each turns a check into a
 * non-check without anything reporting it:
 *
 * - **A duplicated rule id loses requirements.** `selectRules` deduplicates by
 *   id, so a second rule sharing an id is never evaluated and everything it
 *   required disappears. The event is then reported *conforming*.
 * - **A rule that requires nothing turns silence into approval.** An event is
 *   `not-applicable` only when no rule selects it. One requirement-free rule
 *   makes the event governed, satisfied and conforming — the exact reading the
 *   status vocabulary exists to prevent.
 * - **A condition nothing guarantees never fires.** An absent condition path
 *   means the condition does not hold, so a producer that never writes the flag
 *   escapes the requirement in silence. The rule looks enforced and enforces
 *   nothing.
 *
 * Severity follows consequence, not tidiness. An `error` finding is one that
 * changes a verdict; a `warning` is one a reviewer should see and which changes
 * no verdict today. Redundancy on its own is never an error: the corpus is full
 * of deliberate breadth, and a lint that flagged house style would be turned
 * off rather than heeded.
 *
 * Usage:
 *   node dist/conformance/tools/lint-profiles.js          lint every shipped profile
 *   node dist/conformance/tools/lint-profiles.js --quiet   report errors only
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { availableProfiles, loadProfile } from "../src/profiles/load-profile.js";
import { repositoryRoot } from "../src/profiles/validate-profile-definition.js";
import type { ProfileDefinition, ProfileRule } from "../src/profiles/types.js";

export type LintSeverity = "error" | "warning";

export interface ProfileLintFinding {
  readonly profile: string;
  readonly ruleId: string;
  readonly check: string;
  readonly severity: LintSeverity;
  readonly message: string;
}

/**
 * Pointer prefixes the core schema already makes mandatory. A condition on one
 * of these always has a value to read, so it is never an unguarded gate.
 */
const CORE_MANDATORY = [
  "/specVersion",
  "/id",
  "/time",
  "/event/",
  "/actor/",
  "/resource/",
  "/application/",
];

/** Whether a pointer is one the core schema guarantees is present. */
function coreGuaranteed(pointer: string): boolean {
  // `/event/error` is conditional on outcome, so it is not guaranteed.
  if (pointer.startsWith("/event/error")) {
    return false;
  }
  return CORE_MANDATORY.some((prefix) => pointer === prefix || pointer.startsWith(prefix));
}

/** Every pointer a rule requires, with metadata paths resolved to absolute. */
function requiredPointers(rule: ProfileRule): Set<string> {
  const pointers = new Set<string>(rule.requiredPaths ?? []);
  for (const requirement of rule.requiredMetadata ?? []) {
    pointers.add(`/metadata${requirement.path}`);
  }
  for (const requirement of rule.requiredValues ?? []) {
    pointers.add(requirement.path);
  }
  return pointers;
}

/** Whether a rule states any requirement or recommendation at all. */
function statesSomething(rule: ProfileRule): boolean {
  return (
    (rule.requiredPaths?.length ?? 0) +
      (rule.requiredMetadata?.length ?? 0) +
      (rule.requiredValues?.length ?? 0) +
      (rule.recommendedPaths?.length ?? 0) >
    0
  );
}

/** A JSON Pointer with an empty reference token can only ever resolve to a member named "". */
function hasEmptyToken(pointer: string): boolean {
  return pointer
    .split("/")
    .slice(1)
    .some((token) => token.length === 0);
}

/** Every event name the profile's own fixtures carry, for reachability. */
function fixtureNames(profile: string): Set<string> {
  const names = new Set<string>();
  const root = path.join(repositoryRoot(), "examples", "profiles", profile);
  if (!existsSync(root)) {
    return names;
  }

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".json")) {
        continue;
      }
      try {
        const event = JSON.parse(readFileSync(full, "utf8")) as { event?: { name?: unknown } };
        if (typeof event.event?.name === "string") {
          names.add(event.event.name);
        }
      } catch {
        // A fixture that does not parse is another suite's problem, not this one's.
      }
    }
  };

  walk(root);
  return names;
}

/** Lints one profile definition. Returns findings in check order, then rule order. */
export function lintProfile(profile: ProfileDefinition): ProfileLintFinding[] {
  const findings: ProfileLintFinding[] = [];
  const add = (ruleId: string, check: string, severity: LintSeverity, message: string): void => {
    findings.push({ profile: profile.name, ruleId, check, severity, message });
  };

  // 001 — a duplicated id makes selectRules drop the later rule and everything
  // it required. The event is then reported conforming rather than in violation.
  const seen = new Set<string>();
  for (const rule of profile.rules) {
    if (seen.has(rule.id)) {
      add(
        rule.id,
        "PROFILE-LINT-001",
        "error",
        "rule id is declared more than once; rule selection deduplicates by id, so this rule is never evaluated and its requirements are silently lost",
      );
    }
    seen.add(rule.id);
  }

  for (const rule of profile.rules) {
    // 002 — governed and unconditionally satisfied is worse than ungoverned.
    if (!statesSomething(rule)) {
      add(
        rule.id,
        "PROFILE-LINT-002",
        "error",
        "the rule selects events but states no requirement or recommendation, so every event it selects is reported conforming rather than not-applicable",
      );
    }

    // 003 — pointers the schema accepts and nothing can ever resolve.
    for (const pointer of [...(rule.requiredPaths ?? []), ...(rule.recommendedPaths ?? [])]) {
      if (hasEmptyToken(pointer)) {
        add(
          rule.id,
          "PROFILE-LINT-003",
          "error",
          `"${pointer}" contains an empty reference token, so it resolves to a member named "" and can never be present`,
        );
      }
    }
    for (const requirement of rule.requiredMetadata ?? []) {
      if (hasEmptyToken(requirement.path)) {
        add(
          rule.id,
          "PROFILE-LINT-003",
          "error",
          `metadata path "${requirement.path}" contains an empty reference token and can never be present`,
        );
      }
      if (requirement.path === "/metadata" || requirement.path.startsWith("/metadata/")) {
        add(
          rule.id,
          "PROFILE-LINT-003",
          "error",
          `metadata path "${requirement.path}" is resolved under /metadata, so it addresses /metadata${requirement.path} and can never be present`,
        );
      }
    }

    // 004 — requirements that contradict each other fail on every event the
    // rule applies to, which reads as a producer defect rather than an
    // authoring one.
    const required = new Set(rule.requiredPaths ?? []);
    const valuesByPath = new Map<string, unknown[]>();
    for (const requirement of rule.requiredValues ?? []) {
      valuesByPath.set(requirement.path, [
        ...(valuesByPath.get(requirement.path) ?? []),
        requirement.equals,
      ]);
    }
    for (const [pointer, values] of valuesByPath) {
      const distinct = new Set(values.map((value) => JSON.stringify(value)));
      if (distinct.size > 1) {
        add(
          rule.id,
          "PROFILE-LINT-004",
          "error",
          `"${pointer}" is required to equal ${[...distinct].join(" and ")}, which no event can satisfy`,
        );
      }
      if (required.has(pointer) && values.some((value) => value === null || value === "")) {
        add(
          rule.id,
          "PROFILE-LINT-004",
          "error",
          `"${pointer}" is required to be present and also required to equal an empty value, which no event can satisfy`,
        );
      }
    }
    for (const requirement of rule.requiredMetadata ?? []) {
      const pointer = `/metadata${requirement.path}`;
      for (const value of valuesByPath.get(pointer) ?? []) {
        const actual =
          value === null
            ? "null"
            : Array.isArray(value)
              ? "array"
              : Number.isInteger(value)
                ? "integer"
                : typeof value;
        const compatible =
          actual === requirement.type ||
          (requirement.type === "number" && actual === "integer") ||
          (requirement.type === "integer" && actual === "integer");
        if (!compatible) {
          add(
            rule.id,
            "PROFILE-LINT-004",
            "error",
            `"${pointer}" is required to be of type "${requirement.type}" and also required to equal a ${actual}, which no event can satisfy`,
          );
        }
      }
    }

    // 007 — redundancy, reported because a selector list is a published
    // contract and a reader should not have to work out that one entry is dead.
    const prefixes = rule.eventPrefixes ?? [];
    for (const name of rule.events ?? []) {
      const covering = prefixes.find((prefix) => name.startsWith(prefix));
      if (covering !== undefined) {
        add(
          rule.id,
          "PROFILE-LINT-007",
          "warning",
          `"${name}" is already selected by the prefix "${covering}" on this rule`,
        );
      }
    }
    for (const prefix of prefixes) {
      const covering = prefixes.find((other) => other !== prefix && prefix.startsWith(other));
      if (covering !== undefined) {
        add(
          rule.id,
          "PROFILE-LINT-007",
          "warning",
          `the prefix "${prefix}" is already covered by "${covering}" on this rule`,
        );
      }
    }
  }

  // 005 — a condition on a flag nothing in the profile requires. The producer
  // omits the flag, the condition never holds, and the requirement behind it
  // never runs. Conditions on core-mandatory paths always have a value to read
  // and are excluded.
  const guaranteed = new Set<string>();
  for (const rule of profile.rules) {
    if (rule.when === undefined) {
      for (const pointer of requiredPointers(rule)) {
        guaranteed.add(pointer);
      }
    }
  }
  for (const rule of profile.rules) {
    const condition = rule.when;
    if (condition === undefined || coreGuaranteed(condition.path)) {
      continue;
    }
    if (!guaranteed.has(condition.path)) {
      add(
        rule.id,
        "PROFILE-LINT-005",
        "warning",
        `the rule applies only when "${condition.path}" holds a specific value, and no unconditional rule in this profile requires that path — a producer that never writes it escapes the requirement silently`,
      );
    }
  }

  // 006 — a prefix nothing in the profile's own world falls under. Scored
  // against the profile's own exact selectors and its own fixtures, so the
  // check needs no notion of "every name that exists".
  const universe = new Set<string>(fixtureNames(profile.name));
  for (const rule of profile.rules) {
    for (const name of rule.events ?? []) {
      universe.add(name);
    }
  }
  const reported = new Set<string>();
  for (const rule of profile.rules) {
    for (const prefix of rule.eventPrefixes ?? []) {
      if ([...universe].some((name) => name.startsWith(prefix))) {
        continue;
      }
      const key = `${rule.id} ${prefix}`;
      if (reported.has(key)) {
        continue;
      }
      reported.add(key);
      add(
        rule.id,
        "PROFILE-LINT-006",
        "warning",
        `the prefix "${prefix}" selects nothing: no event name in this profile and no fixture of it falls under the prefix`,
      );
    }
  }

  return findings.sort(
    (left, right) =>
      left.check.localeCompare(right.check, "en") || left.ruleId.localeCompare(right.ruleId, "en"),
  );
}

/** Lints every profile that ships with the repository. */
export function lintAllProfiles(): ProfileLintFinding[] {
  const findings: ProfileLintFinding[] = [];
  for (const name of availableProfiles()) {
    const loaded = loadProfile(name);
    if (!loaded.ok) {
      findings.push({
        profile: name,
        ruleId: "-",
        check: "PROFILE-LINT-000",
        severity: "error",
        message: `the profile did not load: ${loaded.error}`,
      });
      continue;
    }
    findings.push(...lintProfile(loaded.profile));
  }
  return findings;
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { quiet: { type: "boolean", short: "q", default: false } },
  });

  const findings = lintAllProfiles();
  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const shown = values.quiet === true ? errors : findings;

  let current = "";
  for (const finding of shown) {
    if (finding.profile !== current) {
      current = finding.profile;
      process.stdout.write(`\n${current}\n`);
    }
    const stream = finding.severity === "error" ? process.stderr : process.stdout;
    stream.write(
      `  ${finding.severity.toUpperCase().padEnd(8)}${finding.check}  ${finding.ruleId}\n    ${finding.message}\n`,
    );
  }

  const profiles = availableProfiles().length;
  process.stdout.write(
    `\n${profiles} profiles linted: ${errors.length} ${errors.length === 1 ? "error" : "errors"}, ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}\n`,
  );

  // A warning is a finding a reviewer should see, not a reason to stop a build.
  // Making them fail would make the lint something a contributor silences.
  return errors.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && process.argv[1].includes("lint-profiles")) {
  process.exitCode = main();
}
