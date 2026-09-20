#!/usr/bin/env node
/**
 * Generates `profiles/REQUIREMENTS.md`, the producer-facing view of what the
 * ten profiles ask for.
 *
 * The profiles are the contract, and they are ten JSON documents holding 127
 * rules between them. A producer deciding what to emit has to answer one
 * question — "I record this operation; what does the model want from it?" —
 * and today answers it by opening ten files. That is the same failure the
 * conformance kit was built to fix for implementers: the information existed
 * and was not reachable.
 *
 * This document is therefore **generated**, never hand-edited. A hand-written
 * table of 119 pointers would be stale one profile revision later, and a stale
 * requirement is worse than an absent one: a producer would build to it.
 *
 * Usage:
 *   node dist/conformance/tools/generate-requirements.js          write
 *   node dist/conformance/tools/generate-requirements.js --check  compare only
 *
 * `--check` compares text, because this output is prose rather than data and
 * Prettier owns its formatting; the check runs after `npm run format`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { resolveSchemaPath } from "../src/validate.js";
import { availableProfiles, loadProfile } from "../src/profiles/load-profile.js";
import { DEFAULT_RULE_SEVERITY } from "../src/profiles/evaluate-rule.js";
import type { ProfileDefinition, ProfileRule } from "../src/profiles/types.js";

const repoRoot = path.dirname(path.dirname(path.dirname(resolveSchemaPath())));
const OUTPUT = path.join(repoRoot, "profiles", "REQUIREMENTS.md");

/** Everything one rule asks for, as pointers a producer can look for in its own output. */
interface Demand {
  readonly required: readonly string[];
  readonly recommended: readonly string[];
}

function demandsOf(rule: ProfileRule): Demand {
  const required = [
    ...(rule.requiredPaths ?? []),
    ...(rule.requiredMetadata ?? []).map((entry) => `/metadata${entry.path} (${entry.type})`),
    ...(rule.requiredValues ?? []).map(
      (entry) => `${entry.path} = ${JSON.stringify(entry.equals)}`,
    ),
  ];
  return { required, recommended: [...(rule.recommendedPaths ?? [])] };
}

/** The selector of a rule, as the profile states it. */
function selectorOf(rule: ProfileRule): readonly string[] {
  return [...(rule.events ?? []), ...(rule.eventPrefixes ?? []).map((prefix) => `${prefix}*`)];
}

function conditionOf(rule: ProfileRule): string | undefined {
  return rule.when === undefined
    ? undefined
    : `only when ${rule.when.path} = ${JSON.stringify(rule.when.equals)}`;
}

/** Escapes a cell so a pointer or a value cannot break the table. */
function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function code(values: readonly string[]): string {
  return values.length === 0 ? "—" : values.map((value) => `\`${cell(value)}\``).join(", ");
}

interface Governed {
  readonly profile: string;
  readonly ruleId: string;
  readonly severity: string;
  readonly viaPrefix?: string;
}

function build(profiles: readonly ProfileDefinition[]): string {
  const ruleCount = profiles.reduce((total, profile) => total + profile.rules.length, 0);

  // Index by event name. A prefix selector is listed under the prefix itself,
  // because a producer choosing a name needs to know the prefix governs
  // everything beneath it.
  const byName = new Map<string, Governed[]>();
  const pointerUse = new Map<string, number>();

  for (const profile of profiles) {
    for (const rule of profile.rules) {
      const severity = rule.severity ?? DEFAULT_RULE_SEVERITY;
      for (const name of rule.events ?? []) {
        const entries = byName.get(name) ?? [];
        entries.push({ profile: profile.name, ruleId: rule.id, severity });
        byName.set(name, entries);
      }
      for (const prefix of rule.eventPrefixes ?? []) {
        const key = `${prefix}*`;
        const entries = byName.get(key) ?? [];
        entries.push({ profile: profile.name, ruleId: rule.id, severity, viaPrefix: prefix });
        byName.set(key, entries);
      }
      for (const pointer of demandsOf(rule).required) {
        const base = pointer.split(" ")[0] as string;
        pointerUse.set(base, (pointerUse.get(base) ?? 0) + 1);
      }
    }
  }

  const names = [...byName.keys()].sort((left, right) => left.localeCompare(right, "en"));
  const pointers = [...pointerUse.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"),
  );

  const lines: string[] = [];
  const write = (text = "") => lines.push(text);

  write("# What the profiles require");
  write();
  write(
    "**Generated — do not edit.** Produced by [`conformance/tools/generate-requirements.ts`](../conformance/tools/generate-requirements.ts)",
  );
  write(
    "from the ten profile documents, and checked by `npm run verify`. Edit a profile, not this file.",
  );
  write();
  write("**Status: informative.** The normative statements are in the profile documents and in");
  write(
    '[specification/](../specification/). This is those documents read from the other side: not "what does',
  );
  write('this profile say" but "I record this operation — what does the model want from it?"');
  write();
  write(
    "Nothing here is a compliance requirement. See [README.md](README.md) §What profiles are not.",
  );
  write();
  write(`${profiles.length} profiles, ${ruleCount} rules, ${names.length} selectors.`);
  write();
  write("## How to use this");
  write();
  write("1. Find the operation you record in §1. If no row matches, no profile governs it today —");
  write("   which is reported as `not-applicable`, and is not conformance. Check the event naming");
  write(
    "   convention first: a name no profile selects is often a name shaped differently from the",
  );
  write("   convention, not an operation no profile covers.");
  write("2. Read what its rules require in §2, under the profile that governs it.");
  write("3. Check yourself with the tooling rather than by reading:");
  write();
  write("```bash");
  write("npx @openauditmodel/cli validate events.ndjson");
  write("npx @openauditmodel/cli lint-privacy events.ndjson");
  write("npx @openauditmodel/cli check-profile events.ndjson --profile <name>");
  write("npx @openauditmodel/cli check-coverage events.ndjson --profile <name>");
  write("```");
  write();
  write(
    "`check-coverage` answers the question this document answers statically, against your own events.",
  );
  write();
  write("## 1. Every event name a profile selects");
  write();
  write("A name ending in `*` is a prefix: the rules listed govern every name beneath it.");
  write();
  write("| Event name | Profile | Rules |");
  write("| ---------- | ------- | ----- |");
  for (const name of names) {
    const entries = byName.get(name) ?? [];
    const profilesFor = [...new Set(entries.map((entry) => entry.profile))].sort((a, b) =>
      a.localeCompare(b, "en"),
    );
    const ruleIds = entries.map((entry) =>
      entry.severity === "error" ? entry.ruleId : `${entry.ruleId} (${entry.severity})`,
    );
    write(`| \`${cell(name)}\` | ${profilesFor.join(", ")} | ${ruleIds.join(", ")} |`);
  }
  write();
  write("## 2. What each rule requires");
  write();
  for (const profile of profiles) {
    write(`### ${profile.name} ${profile.version}`);
    write();
    write(profile.description);
    write();
    write("| Rule | Applies to | Requires | Recommends |");
    write("| ---- | ---------- | -------- | ---------- |");
    for (const rule of profile.rules) {
      const demand = demandsOf(rule);
      const condition = conditionOf(rule);
      const severity = rule.severity ?? DEFAULT_RULE_SEVERITY;
      const id = severity === "error" ? rule.id : `${rule.id} (${severity})`;
      const applies = [
        code(selectorOf(rule)),
        ...(condition === undefined ? [] : [condition]),
      ].join("<br>");
      write(`| ${id} | ${applies} | ${code(demand.required)} | ${code(demand.recommended)} |`);
    }
    write();
  }
  write("## 3. The fields most often required");
  write();
  write(
    "Across every rule in every profile. A producer whose event type cannot express the top of",
  );
  write(
    "this list cannot satisfy most profiles, whatever its event names are — which is a question",
  );
  write("about the type that produces the events, not about the names it gives them.");
  write();
  write("| Pointer | Rules requiring it |");
  write("| ------- | ------------------ |");
  for (const [pointer, count] of pointers) {
    write(`| \`${cell(pointer)}\` | ${count} |`);
  }
  write();
  write("## 4. What none of this checks");
  write();
  write("A profile requires that a field is present, is of a type, or equals a scalar. It cannot");
  write(
    "check that the value is the right one. `/actor/id` being present does not make it the actor",
  );
  write("who acted, and an approval object does not mean an approval happened. The most important");
  write(
    "requirement in several profiles is semantic and is stated in the profile's prose rather than",
  );
  write(
    "in a rule, because a rule that approximated it would be wrong in a way nobody would notice.",
  );
  write();
  write("See [ADR 0008](../decisions/0008-declarative-profile-conformance.md) for why the rule");
  write("vocabulary is this small, and what was deliberately left out of it.");

  return `${lines.join("\n")}\n`;
}

function generate(): string {
  const profiles = availableProfiles().flatMap((name) => {
    const loaded = loadProfile(name);
    return loaded.ok ? [loaded.profile] : [];
  });
  return build(profiles);
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { check: { type: "boolean", default: false } },
  });
  const generated = generate();

  if (values.check === true) {
    let current;
    try {
      current = readFileSync(OUTPUT, "utf8");
    } catch {
      process.stderr.write("profiles/REQUIREMENTS.md is missing\n");
      return 1;
    }
    if (current !== generated) {
      process.stderr.write(
        'profiles/REQUIREMENTS.md is stale; run "npm run requirements" and "npm run format"\n',
      );
      return 1;
    }
    process.stdout.write("profiles/REQUIREMENTS.md is current\n");
    return 0;
  }

  writeFileSync(OUTPUT, generated, "utf8");
  process.stdout.write(`wrote profiles/REQUIREMENTS.md (${generated.length} bytes)\n`);
  return 0;
}

export { build, generate };

if (process.argv[1]?.endsWith("generate-requirements.js") === true) {
  process.exitCode = main();
}
