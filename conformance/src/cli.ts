#!/usr/bin/env node
/**
 * `auditmodel` — the OpenAuditModel conformance command line interface.
 *
 * v0.1 implements three commands:
 *   validate          check events against the canonical schema
 *   verify-integrity  recalculate and compare each event's own digest
 *   verify-chain      verify previous-hash chains across a set of events
 *
 * Exit codes:
 *   0  a verdict was produced and it passed
 *   1  a verdict was produced and it failed
 *   2  the tool could not run: usage error, or a file could not be read or parsed
 *   3  NO VERDICT was produced — nothing was evaluated
 *
 * 3 is the code that matters most, because it is the one that is easy to misread
 * as success. `check-profile` returns it when no rule governs the event, and
 * `lint-privacy` returns it when the input is not an audit event and was
 * therefore never scanned. Neither is an approval of anything.
 *
 * The tooling is offline: it resolves no remote reference, fetches no evidence
 * URL and executes nothing contained in an event.
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createValidator, SPEC_VERSION, type Validator } from "./validate.js";
import { loadEventDocuments, type DocumentLoadResult, type EventDocument } from "./sources.js";
import { formatIssues } from "./format-errors.js";
import { verifyEventIntegrity } from "./integrity/verify-event.js";
import { verifyChains, type ChainEventInput } from "./integrity/verify-chain.js";
import type { Finding, Note, PassedCheck } from "./integrity/types.js";
import { lintEvent } from "./privacy/lint-event.js";
import { summarise } from "./privacy/types.js";
import { availableProfiles, loadProfile } from "./profiles/load-profile.js";
import { checkProfile } from "./profiles/check-profile.js";
import { summariseProfileResults, type ProfileFinding } from "./profiles/types.js";

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_ERROR = 2;
/**
 * No verdict was produced for the input.
 *
 * `check-profile`: nothing checked was governed by the profile.
 * `lint-privacy`: the input could not be evaluated as an audit event, so it was
 * not scanned at all.
 *
 * Distinct from 0 in both cases for the same reason: a pipeline must not be able
 * to read "the tool said nothing" as "the tool was satisfied". Distinct from 1
 * because 1 means a real verdict was produced and it was negative, which is a
 * different thing for an operator to act on.
 */
export const EXIT_NO_VERDICT = 3;

/** Retained name for the `check-profile` reading of {@link EXIT_NO_VERDICT}. */
export const EXIT_NOT_APPLICABLE = EXIT_NO_VERDICT;

/** Commands that are specified as future work and deliberately not implemented in v0.1. */
const PLANNED_COMMANDS = new Set(["check-coverage"]);

const OUTPUT_FORMATS = new Set(["text", "json"]);

const USAGE = `auditmodel — OpenAuditModel conformance tooling (specification ${SPEC_VERSION}, experimental)

Usage:
  auditmodel validate <path...>          Validate events against the canonical schema
  auditmodel verify-integrity <path...>  Recalculate and compare each event's own digest
  auditmodel verify-chain <path...>      Verify previous-hash chains across a set of events
  auditmodel lint-privacy <path...>      Report suspected privacy and secret-exposure risks
  auditmodel check-profile <path...>     Check events against a domain profile
  auditmodel --help                      Show this help
  auditmodel --version                   Show the tool version

A path may be a JSON file holding one event, a JSON file holding an array of
events, a .jsonl or .ndjson file holding one event per line, or a directory of
those files.

Options:
  -q, --quiet                            Only report failures
      --format <text|json>               Output format for lint-privacy and check-profile
      --profile <name>                   Profile to check against (check-profile)

Exit codes:
  0  a verdict was produced and it passed
  1  a verdict was produced and it failed: invalid, unverified, a finding, or a
     profile rule violation
  2  the tool could not run: usage error, or a file could not be read or parsed
  3  no verdict was produced, so nothing was approved:
       check-profile  no checked event is governed by the profile
       lint-privacy   the input is not an audit event and was NOT scanned

Verification is tamper-evident, not tamper-proof: it detects modification of the
events supplied to it. It cannot prove that events were never deleted, and it
makes no claim of immutability, legal weight or non-repudiation.

Privacy linting is deterministic local static analysis. It reports suspicions,
never proof: a finding does not confirm a credential, personal data or a breach,
and a clean result does not mean an event is safe or compliant. Findings never
contain the value that produced them.

A profile only ever adds requirements to the core model. Profile conformance is
not regulatory or legal compliance, and an event the profile does not govern is
reported as not-applicable rather than as conforming.

Planned commands (not implemented in v0.1):
  check-coverage
`;

function toolVersion(schemaPath: string): string {
  // <root>/schemas/v0.1/audit-event.schema.json -> <root>/package.json
  const root = path.dirname(path.dirname(path.dirname(schemaPath)));
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      version?: string;
    };
    return manifest.version ?? SPEC_VERSION;
  } catch {
    return SPEC_VERSION;
  }
}

function displayPath(file: string): string {
  return path.relative(process.cwd(), path.resolve(file)).split(path.sep).join("/") || file;
}

/** Report label for one event: its file, plus its position when the file holds several. */
function displayLabel(document: EventDocument): string {
  const base = displayPath(document.file);
  return document.index === undefined ? base : `${base}#${document.index}`;
}

function write(text: string): void {
  process.stdout.write(text);
}

function writeFindings(findings: readonly Finding[], indent: string): void {
  for (const finding of findings) {
    const where = finding.label === undefined ? "" : `${finding.label}: `;
    write(`${indent}${where}${finding.message}  [${finding.kind}]\n`);
    for (const line of finding.detail ?? []) {
      write(`${indent}  ${line}\n`);
    }
  }
}

function writeProfileFindings(findings: readonly ProfileFinding[], indent: string): void {
  for (const finding of findings) {
    write(
      `${indent}${finding.severity.toUpperCase()}  ${finding.ruleId}  ${finding.path}\n${indent}  ${finding.message}\n`,
    );
  }
}

function writeChecks(checks: readonly PassedCheck[], indent: string): void {
  for (const check of checks) {
    write(`${indent}${check.message}\n`);
  }
}

function writeNotes(notes: readonly Note[], indent: string): void {
  for (const note of notes) {
    write(`${indent}note: ${note.message}\n`);
    for (const line of note.detail ?? []) {
      write(`${indent}  ${line}\n`);
    }
  }
}

interface LoadedInput {
  readonly documents: readonly EventDocument[];
  readonly failures: DocumentLoadResult["failures"];
  readonly validator: Validator;
}

/**
 * Expands the given paths, reads every event they contain and compiles the
 * schema. Returns an exit code when the command cannot proceed at all.
 */
function loadInput(
  inputs: readonly string[],
  command: string,
  quiet: boolean,
): LoadedInput | number {
  if (inputs.length === 0) {
    process.stderr.write(`auditmodel: ${command} requires at least one file or directory\n\n`);
    process.stderr.write(USAGE);
    return EXIT_ERROR;
  }

  let loaded: DocumentLoadResult;
  try {
    loaded = loadEventDocuments(inputs);
  } catch (cause) {
    process.stderr.write(`auditmodel: ${(cause as Error).message}\n`);
    return EXIT_ERROR;
  }

  if (loaded.documents.length === 0 && loaded.failures.length === 0) {
    process.stderr.write("auditmodel: no events found in the given paths\n");
    return EXIT_ERROR;
  }

  let validator: Validator;
  try {
    validator = createValidator();
  } catch (cause) {
    process.stderr.write(`auditmodel: ${(cause as Error).message}\n`);
    return EXIT_ERROR;
  }

  if (!quiet) {
    write(`schema: ${validator.schemaId} (${displayPath(validator.schemaPath)})\n\n`);
  }

  return { documents: loaded.documents, failures: loaded.failures, validator };
}

function reportLoadFailures(failures: DocumentLoadResult["failures"]): void {
  for (const failure of failures) {
    write(`ERROR ${displayPath(failure.file)}\n    ${failure.error}\n`);
  }
}

function runValidate(inputs: readonly string[], quiet: boolean): number {
  const loaded = loadInput(inputs, "validate", quiet);
  if (typeof loaded === "number") {
    return loaded;
  }

  reportLoadFailures(loaded.failures);

  let valid = 0;
  let invalid = 0;

  for (const document of loaded.documents) {
    const label = displayLabel(document);
    const issues = loaded.validator.validateEvent(document.event);

    if (issues.length === 0) {
      valid += 1;
      if (!quiet) {
        write(`ok    ${label}\n`);
      }
    } else {
      invalid += 1;
      write(`FAIL  ${label}\n${formatIssues(issues)}\n`);
    }
  }

  const total = loaded.documents.length;
  const noun = total === 1 ? "event" : "events";
  write(
    `\n${total} ${noun} checked: ${valid} valid, ${invalid} invalid, ${loaded.failures.length} unreadable\n`,
  );

  if (loaded.failures.length > 0) {
    return EXIT_ERROR;
  }
  return invalid > 0 ? EXIT_INVALID : EXIT_OK;
}

function runVerifyIntegrity(inputs: readonly string[], quiet: boolean): number {
  const loaded = loadInput(inputs, "verify-integrity", quiet);
  if (typeof loaded === "number") {
    return loaded;
  }

  reportLoadFailures(loaded.failures);

  let verified = 0;
  let failed = 0;

  for (const document of loaded.documents) {
    const label = displayLabel(document);
    const result = verifyEventIntegrity(document.event, label, loaded.validator);

    if (result.verified) {
      verified += 1;
      if (!quiet) {
        write(`ok    ${label}\n`);
        writeChecks(result.checks, "        ");
      }
    } else {
      failed += 1;
      write(`FAIL  ${label}\n`);
      if (!quiet) {
        writeChecks(result.checks, "        ");
      }
      // The file name is already on the FAIL line, so the per-finding label
      // would only repeat it.
      writeFindings(
        result.findings.map((finding) => ({
          kind: finding.kind,
          message: finding.message,
          ...(finding.detail === undefined ? {} : { detail: finding.detail }),
        })),
        "        ",
      );
    }
  }

  const total = loaded.documents.length;
  const noun = total === 1 ? "event" : "events";
  write(`\n${total} ${noun} checked: ${verified} verified, ${failed} failed\n`);

  if (loaded.failures.length > 0) {
    return EXIT_ERROR;
  }
  return failed > 0 ? EXIT_INVALID : EXIT_OK;
}

function runVerifyChain(inputs: readonly string[], quiet: boolean): number {
  const loaded = loadInput(inputs, "verify-chain", quiet);
  if (typeof loaded === "number") {
    return loaded;
  }

  reportLoadFailures(loaded.failures);

  const events: ChainEventInput[] = loaded.documents.map((document) => ({
    label: displayLabel(document),
    event: document.event,
  }));

  const report = verifyChains(events, loaded.validator);

  if (report.unassigned.length > 0) {
    write("events that could not be assigned to a chain\n");
    writeFindings(report.unassigned, "  ");
    write("\n");
  }

  for (const chain of report.chains) {
    const range =
      chain.firstSequence === undefined || chain.lastSequence === undefined
        ? "none"
        : `${chain.firstSequence}..${chain.lastSequence}`;

    write(`chain ${chain.chainId}\n`);
    write(`  events:    ${chain.eventCount}\n`);
    write(`  sequences: ${range}\n`);

    if (!quiet) {
      writeChecks(
        chain.checks.map((check) => ({ message: `ok    ${check.message}` })),
        "  ",
      );
    }
    if (chain.findings.length > 0) {
      write("  FAIL\n");
      writeFindings(chain.findings, "    ");
    }
    if (!quiet) {
      writeNotes(chain.notes, "  ");
    }
    write("\n");
  }

  const intact = report.chains.filter((chain) => chain.intact).length;
  const broken = report.chains.length - intact;
  const chainNoun = report.chains.length === 1 ? "chain" : "chains";
  write(
    `${report.chains.length} ${chainNoun} checked: ${intact} intact, ${broken} broken (${report.eventCount} events)\n`,
  );

  if (loaded.failures.length > 0) {
    return EXIT_ERROR;
  }
  if (report.chains.length === 0 && report.unassigned.length === 0) {
    process.stderr.write("auditmodel: no chains found in the given paths\n");
    return EXIT_INVALID;
  }
  return report.intact ? EXIT_OK : EXIT_INVALID;
}

function runLintPrivacy(inputs: readonly string[], quiet: boolean, format: string): number {
  const loaded = loadInput(inputs, "lint-privacy", quiet || format === "json");
  if (typeof loaded === "number") {
    return loaded;
  }

  const results = loaded.documents.map((document) =>
    lintEvent(document.event, displayLabel(document), loaded.validator),
  );
  const summary = summarise(results);

  if (format === "json") {
    const report = {
      tool: "auditmodel lint-privacy",
      specVersion: SPEC_VERSION,
      schemaId: loaded.validator.schemaId,
      summary,
      unreadable: loaded.failures.map((failure) => ({
        file: displayPath(failure.file),
        error: failure.error,
      })),
      results: results.map((result) => ({
        file: result.label,
        ...(result.eventId === undefined ? {} : { eventId: result.eventId }),
        status: result.status,
        schemaIssues: result.schemaIssues,
        // Findings never carry the value that produced them.
        findings: result.findings.map((entry) => ({
          ruleId: entry.ruleId,
          severity: entry.severity,
          confidence: entry.confidence,
          category: entry.category,
          path: entry.path,
          message: entry.message,
          recommendation: entry.recommendation,
        })),
      })),
    };
    write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    reportLoadFailures(loaded.failures);

    for (const result of results) {
      if (result.status === "clean") {
        if (!quiet) {
          write(`ok    ${result.label}\n`);
        }
        continue;
      }

      if (result.status === "schema-invalid") {
        write(`FAIL  ${result.label}  (not an OpenAuditModel event: NOT scanned)\n`);
        for (const issue of result.schemaIssues) {
          write(`        ${issue}\n`);
        }
        continue;
      }

      const noun = result.findings.length === 1 ? "finding" : "findings";
      write(`FAIL  ${result.label}  (${result.findings.length} ${noun})\n`);
      for (const entry of result.findings) {
        write(
          `        ${entry.severity.toUpperCase()}  ${entry.ruleId}  confidence ${entry.confidence}  ${entry.path}\n`,
        );
        write(`          ${entry.message}\n`);
        if (entry.recommendation !== undefined) {
          write(`          recommendation: ${entry.recommendation}\n`);
        }
      }
    }

    const eventNoun = summary.events === 1 ? "event" : "events";
    write(
      `\n${summary.events} ${eventNoun} checked: ${summary.clean} clean, ${summary.withFindings} with findings, ${summary.schemaInvalid} schema-invalid, ${loaded.failures.length} unreadable\n`,
    );
    const { critical, high, medium, low, info } = summary.bySeverity;
    const findingNoun = summary.findings === 1 ? "finding" : "findings";
    write(
      `${summary.findings} privacy ${findingNoun}: ${critical} critical, ${high} high, ${medium} medium, ${low} low, ${info} info\n`,
    );

    if (summary.schemaInvalid > 0) {
      const noun = summary.schemaInvalid === 1 ? "input" : "inputs";
      write(
        `\nPrivacy evaluation was not completed for ${summary.schemaInvalid} ${noun}: not a valid OpenAuditModel event. Those inputs were NOT scanned, and are not reported as clean.\n`,
      );
    }
  }

  if (loaded.failures.length > 0) {
    return EXIT_ERROR;
  }
  // Findings win over schema-invalid: a real finding is the more actionable
  // signal, and reporting "not evaluated" would bury it. With no findings, a
  // schema-invalid input must never look clean — nothing was scanned.
  if (summary.findings > 0) {
    return EXIT_INVALID;
  }
  return summary.schemaInvalid > 0 ? EXIT_NO_VERDICT : EXIT_OK;
}

function runCheckProfile(
  inputs: readonly string[],
  quiet: boolean,
  format: string,
  profileName: string | undefined,
): number {
  if (profileName === undefined || profileName === "") {
    process.stderr.write(
      `auditmodel: check-profile requires --profile <name>; available profiles: ${availableProfiles().join(", ")}\n`,
    );
    return EXIT_ERROR;
  }

  const loaded = loadProfile(profileName);
  if (!loaded.ok) {
    process.stderr.write(`auditmodel: ${loaded.error}\n`);
    for (const issue of loaded.issues ?? []) {
      process.stderr.write(`    ${issue}\n`);
    }
    return EXIT_ERROR;
  }

  const input = loadInput(inputs, "check-profile", quiet || format === "json");
  if (typeof input === "number") {
    return input;
  }

  const { profile } = loaded;
  const results = input.documents.map((document) =>
    checkProfile(document.event, displayLabel(document), profile, input.validator),
  );
  const summary = summariseProfileResults(results);

  if (format === "json") {
    write(
      `${JSON.stringify(
        {
          tool: "auditmodel check-profile",
          specVersion: SPEC_VERSION,
          schemaId: input.validator.schemaId,
          profile: { name: profile.name, version: profile.version, status: profile.status },
          summary,
          unreadable: input.failures.map((failure) => ({
            file: displayPath(failure.file),
            error: failure.error,
          })),
          results,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    reportLoadFailures(input.failures);

    if (!quiet) {
      write(`profile: ${profile.name} ${profile.version} (${profile.status})\n\n`);
    }

    for (const result of results) {
      if (result.status === "conforming") {
        if (!quiet) {
          write(`ok    ${result.label}  (${result.matchedRules.join(", ")})\n`);
          writeProfileFindings(result.warnings, "        ");
        }
        continue;
      }

      if (result.status === "not-applicable") {
        if (!quiet) {
          write(`n/a   ${result.label}  (no rule in this profile governs this event)\n`);
        }
        continue;
      }

      if (result.status === "core-invalid") {
        write(`FAIL  ${result.label}  (core-invalid: profile rules not evaluated)\n`);
        for (const issue of result.coreIssues) {
          write(`        ${issue}\n`);
        }
        continue;
      }

      const noun = result.errors.length === 1 ? "violation" : "violations";
      write(`FAIL  ${result.label}  (${result.errors.length} ${noun})\n`);
      if (!quiet && result.matchedRules.length > 0) {
        write(`        matched rules: ${result.matchedRules.join(", ")}\n`);
      }
      writeProfileFindings(result.errors, "        ");
      if (!quiet) {
        writeProfileFindings(result.warnings, "        ");
      }
    }

    const noun = summary.events === 1 ? "event" : "events";
    write(
      `\n${summary.events} ${noun} checked: ${summary.conforming} conforming, ${summary.violations} with violations, ${summary.notApplicable} not applicable, ${summary.coreInvalid} core-invalid, ${input.failures.length} unreadable\n`,
    );
    write(`${summary.errors} profile violations, ${summary.warnings} recommendations\n`);
  }

  if (input.failures.length > 0) {
    return EXIT_ERROR;
  }
  if (summary.errors > 0 || summary.coreInvalid > 0) {
    return EXIT_INVALID;
  }
  // Only when nothing at all was governed; a mix of conforming and
  // not-applicable events is a pass.
  return summary.conforming === 0 && summary.notApplicable > 0 ? EXIT_NOT_APPLICABLE : EXIT_OK;
}

export function run(argv: readonly string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", default: false },
        quiet: { type: "boolean", short: "q", default: false },
        format: { type: "string", default: "text" },
        profile: { type: "string" },
      },
    });
  } catch (cause) {
    process.stderr.write(`auditmodel: ${(cause as Error).message}\n\n`);
    process.stderr.write(USAGE);
    return EXIT_ERROR;
  }

  const { values, positionals } = parsed;

  if (values.version === true) {
    const validator = createValidator();
    write(
      `auditmodel ${toolVersion(validator.schemaPath)} (specification ${SPEC_VERSION}, experimental)\n`,
    );
    return EXIT_OK;
  }

  const command = positionals[0];

  if (values.help === true || command === undefined || command === "help") {
    write(USAGE);
    return command === undefined && values.help !== true ? EXIT_ERROR : EXIT_OK;
  }

  const rest = positionals.slice(1);
  const quiet = values.quiet === true;
  const format = typeof values.format === "string" ? values.format : "text";

  if (!OUTPUT_FORMATS.has(format)) {
    process.stderr.write(
      `auditmodel: unknown output format "${format}"; expected ${[...OUTPUT_FORMATS].join(" or ")}\n`,
    );
    return EXIT_ERROR;
  }

  if (command === "validate") {
    return runValidate(rest, quiet);
  }
  if (command === "verify-integrity") {
    return runVerifyIntegrity(rest, quiet);
  }
  if (command === "verify-chain") {
    return runVerifyChain(rest, quiet);
  }
  if (command === "lint-privacy") {
    return runLintPrivacy(rest, quiet, format);
  }
  if (command === "check-profile") {
    return runCheckProfile(
      rest,
      quiet,
      format,
      typeof values.profile === "string" ? values.profile : undefined,
    );
  }

  if (PLANNED_COMMANDS.has(command)) {
    process.stderr.write(
      `auditmodel: "${command}" is planned for a future specification version and is not implemented in v${SPEC_VERSION}\n`,
    );
    return EXIT_ERROR;
  }

  process.stderr.write(`auditmodel: unknown command "${command}"\n\n`);
  process.stderr.write(USAGE);
  return EXIT_ERROR;
}

/**
 * True when this module is the process entry point. Real paths are compared so
 * that execution through a `node_modules/.bin` shim is still recognised.
 */
function isDirectInvocation(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
}

if (isDirectInvocation()) {
  process.exitCode = run(process.argv.slice(2));
}
