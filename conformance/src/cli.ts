#!/usr/bin/env node
/**
 * `auditmodel` — the OpenAuditModel conformance command line interface.
 *
 * v0.1 implements eight commands:
 *   validate           check events against the canonical schema
 *   verify-integrity   recalculate and compare each event's own digest
 *   verify-chain       verify previous-hash chains across a set of events
 *   verify-checkpoint  compare an archive with a chain checkpoint
 *   verify-proof       verify one event's inclusion proof against a tree root
 *   lint-privacy       report suspected privacy and secret-exposure risks
 *   check-profile      check events against a domain profile
 *   check-coverage     report how much of a profile a set of events reaches
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
import type { KeyObject } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createCheckpointValidator,
  createProofValidator,
  createValidator,
  SPEC_VERSION,
  type DocumentValidator,
  type Validator,
} from "./validate.js";
import {
  loadEventDocuments,
  readJsonFile,
  type DocumentLoadResult,
  type EventDocument,
} from "./sources.js";
import { formatIssues } from "./format-errors.js";
import { verifyEventIntegrity } from "./integrity/verify-event.js";
import { verifyChains, type ChainEventInput } from "./integrity/verify-chain.js";
import { verifyCheckpoint } from "./integrity/verify-checkpoint.js";
import { verifyProof } from "./integrity/verify-proof.js";
import { loadPublicKey } from "./integrity/signature.js";
import type {
  ChainVerificationResult,
  CheckpointReport,
  EventVerificationResult,
  Finding,
  Note,
  PassedCheck,
  ProofReport,
} from "./integrity/types.js";
import { lintEvent } from "./privacy/lint-event.js";
import { summarise } from "./privacy/types.js";
import { availableProfiles, loadProfile } from "./profiles/load-profile.js";
import { checkProfile } from "./profiles/check-profile.js";
import { summariseProfileResults, type ProfileFinding } from "./profiles/types.js";
import { summariseCoverage } from "./profiles/coverage.js";

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
const PLANNED_COMMANDS = new Set<string>([]);

const OUTPUT_FORMATS = new Set(["text", "json"]);

/** Every implemented command, for diagnosing flags before dispatch. */
const IMPLEMENTED_COMMANDS = new Set([
  "validate",
  "verify-integrity",
  "verify-chain",
  "verify-checkpoint",
  "verify-proof",
  "lint-privacy",
  "check-profile",
  "check-coverage",
]);

/** The commands --format applies to; every other implemented command refuses the flag. */
const FORMAT_COMMANDS = new Set([
  "verify-checkpoint",
  "verify-proof",
  "lint-privacy",
  "check-profile",
  "check-coverage",
]);

/** The commands --public-key applies to. */
const PUBLIC_KEY_COMMANDS = new Set([
  "verify-integrity",
  "verify-chain",
  "verify-checkpoint",
  "verify-proof",
]);

/** The fixed line that follows every verify-proof verdict. */
const PROOF_NOT_PROVEN =
  "a verified proof shows only that the event is a member of the tree the root describes; the root's provenance is the anchor's";

/** The fixed line that follows every verify-checkpoint verdict, so that a pass is never read as more than it is. */
const CHECKPOINT_NOT_PROVEN =
  "an agreeing verdict establishes only that the archive is consistent with the supplied checkpoint; whether the checkpoint is genuine and its anchor real is for whoever holds the anchor";

const USAGE = `auditmodel — OpenAuditModel conformance tooling (specification ${SPEC_VERSION}, experimental)

Usage:
  auditmodel validate <path...>          Validate events against the canonical schema
  auditmodel verify-integrity <path...>  Recalculate and compare each event's own digest
  auditmodel verify-chain <path...>      Verify previous-hash chains across a set of events
  auditmodel verify-checkpoint <path...> Compare an archive with a chain checkpoint
                                          (--checkpoint <file>)
  auditmodel verify-proof <path>         Verify one event's inclusion proof against a
                                          tree root (--proof <file>)
  auditmodel lint-privacy <path...>      Report suspected privacy and secret-exposure risks
  auditmodel check-profile <path...>     Check events against a domain profile
  auditmodel check-coverage <path...>    Report how much of a profile a set of events reaches
  auditmodel --help                      Show this help
  auditmodel --version                   Show the tool version

A path may be a JSON file holding one event, a JSON file holding an array of
events, a .jsonl or .ndjson file holding one event per line, or a directory of
those files.

Options:
  -q, --quiet                            Only report failures
      --format <text|json>               Output format for verify-checkpoint, verify-proof,
                                          lint-privacy, check-profile and check-coverage
      --profile <name>                   Profile to check against (check-profile,
                                          check-coverage)
      --checkpoint <file>                Checkpoint document to compare the archive with
                                          (verify-checkpoint). Its anchor is never
                                          dereferenced.
      --proof <file>                     Inclusion proof to verify the event against
                                          (verify-proof). Its anchor is never dereferenced.
      --public-key <path>                PEM public key to verify integrity.signature against
                                          (verify-integrity, verify-chain,
                                          verify-checkpoint and verify-proof, where the same
                                          key also verifies the document's own signature):
                                          Ed25519,
                                          ECDSA-P256-SHA256 or RSA-PSS-SHA256; the key must be
                                          of the declared algorithm's type. Without it,
                                          a declared signature is reported but not checked;
                                          an algorithm this verifier does not implement
                                          fails verification either way.

Exit codes:
  0  a verdict was produced and it passed
  1  a verdict was produced and it failed: invalid, unverified, a finding, or a
     profile rule violation
  2  the tool could not run: usage error, or a file could not be read or parsed
  3  no verdict was produced, so nothing was approved:
       check-profile  no checked event is governed by the profile
       lint-privacy   the input is not an audit event and was NOT scanned
       verify-chain   no event could be assigned to a chain, so no chain
                      was checked
       verify-checkpoint
                      the archive holds none of the chains the checkpoint
                      names, so nothing was compared
       verify-proof   the event's hash cannot be established, so there is
                      nothing to prove
       check-coverage no event in the set is governed by the profile, so the
                      profile reached nothing

check-coverage never exits 1. It reports what a profile reached; it makes no
pass or fail claim, and it counts events rather than obligations. "4 of 15 rules
selected" describes this event set, and is not a score, a percentage or a grade.

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

function runVerifyIntegrity(
  inputs: readonly string[],
  quiet: boolean,
  publicKey: KeyObject | undefined,
): number {
  const loaded = loadInput(inputs, "verify-integrity", quiet);
  if (typeof loaded === "number") {
    return loaded;
  }

  reportLoadFailures(loaded.failures);

  let verified = 0;
  let failed = 0;

  for (const document of loaded.documents) {
    const label = displayLabel(document);
    const result = verifyEventIntegrity(document.event, label, loaded.validator, { publicKey });

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

/** The text block for one verified chain, shared by verify-chain and verify-checkpoint. */
function writeChainResult(chain: ChainVerificationResult, quiet: boolean): void {
  const range =
    chain.firstSequence === undefined || chain.lastSequence === undefined
      ? "none"
      : `${chain.firstSequence}..${chain.lastSequence}`;

  write(`chain ${chain.chainId}\n`);
  write(`  events:    ${chain.eventCount}\n`);
  write(`  sequences: ${range}\n`);
  if (chain.headHash !== undefined) {
    write(`  head:      ${chain.headHash}\n`);
  }

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
}

/**
 * True when the checkpoint file and the events share a directory tree: the
 * checkpoint lies in or under a directory the events were read from, or the
 * events lie under the checkpoint's directory — the bundle layout with the
 * checkpoint beside an `events/` folder. The tool cannot know a store's
 * boundaries, but it can see when the two paths coincide, and a checkpoint
 * kept beside the events it describes is the case integrity.md §8 (item 11)
 * warns about. A checkpoint at a filesystem root contains everything and
 * says nothing, so that one case is not flagged.
 */
function checkpointSharesLocation(checkpointFile: string, inputs: readonly string[]): boolean {
  const checkpointDirectory = path.resolve(path.dirname(checkpointFile));
  if (path.parse(checkpointDirectory).root === checkpointDirectory) {
    return false;
  }
  const contains = (parent: string, child: string): boolean =>
    child === parent || child.startsWith(`${parent}${path.sep}`);
  for (const input of inputs) {
    let base: string;
    try {
      base = statSync(input).isDirectory()
        ? path.resolve(input)
        : path.dirname(path.resolve(input));
    } catch {
      continue;
    }
    if (contains(base, checkpointDirectory) || contains(checkpointDirectory, base)) {
      return true;
    }
  }
  return false;
}

function runVerifyCheckpoint(
  inputs: readonly string[],
  quiet: boolean,
  format: string,
  checkpointFile: string | undefined,
  publicKey: KeyObject | undefined,
): number {
  if (checkpointFile === undefined) {
    process.stderr.write("auditmodel: verify-checkpoint requires --checkpoint <file>\n\n");
    process.stderr.write(USAGE);
    return EXIT_ERROR;
  }

  const json = format === "json";
  const loaded = loadInput(inputs, "verify-checkpoint", quiet || json);
  if (typeof loaded === "number") {
    return loaded;
  }

  const parsed = readJsonFile(checkpointFile);
  if (!parsed.ok) {
    process.stderr.write(
      `auditmodel: cannot read --checkpoint "${checkpointFile}": ${parsed.error}\n`,
    );
    return EXIT_ERROR;
  }

  let checkpointValidator: DocumentValidator;
  try {
    checkpointValidator = createCheckpointValidator();
  } catch (cause) {
    process.stderr.write(`auditmodel: ${(cause as Error).message}\n`);
    return EXIT_ERROR;
  }

  const events: ChainEventInput[] = loaded.documents.map((document) => ({
    label: displayLabel(document),
    event: document.event,
  }));
  const report = verifyCheckpoint(
    events,
    parsed.value,
    { events: loaded.validator, checkpoint: checkpointValidator },
    { publicKey },
  );
  const sharedLocation = checkpointSharesLocation(checkpointFile, inputs);

  if (json) {
    writeCheckpointJson(
      report,
      checkpointFile,
      checkpointValidator.schemaId,
      loaded,
      sharedLocation,
    );
  } else {
    writeCheckpointText(report, checkpointFile, quiet, loaded, sharedLocation);
  }

  if (report.outcome === "invalid-checkpoint" || loaded.failures.length > 0) {
    return EXIT_ERROR;
  }
  if (report.outcome === "no-chain") {
    process.stderr.write(
      "auditmodel: no verdict: the archive holds none of the chains the checkpoint names, so nothing was compared\n",
    );
    return EXIT_NO_VERDICT;
  }
  return report.outcome === "agrees" ? EXIT_OK : EXIT_INVALID;
}

const SHARED_LOCATION_NOTE: Note = {
  message: "the checkpoint and the events come from the same location",
  detail: [
    "a checkpoint kept beside the events it describes proves little: whoever can rewrite the store can rewrite it too",
    "see specification/integrity.md §8, item 11",
  ],
};

function writeCheckpointText(
  report: CheckpointReport,
  checkpointFile: string,
  quiet: boolean,
  loaded: LoadedInput,
  sharedLocation: boolean,
): void {
  reportLoadFailures(loaded.failures);

  const version =
    report.checkpointVersion === undefined ? "" : ` (checkpoint ${report.checkpointVersion})`;
  write(`checkpoint ${displayPath(checkpointFile)}${version}\n`);
  if (!quiet) {
    writeChecks(
      report.checks.map((check) => ({ message: `ok    ${check.message}` })),
      "  ",
    );
  }
  if (report.findings.length > 0) {
    write("  FAIL\n");
    writeFindings(report.findings, "    ");
  }
  if (report.anchor !== undefined && !quiet) {
    write(`  anchor:    ${report.anchor.type} — ${report.anchor.reference} (not dereferenced)\n`);
  }
  if (report.description !== undefined && !quiet) {
    write(`  describes: ${report.description}\n`);
  }
  if (sharedLocation && !quiet) {
    writeNotes([SHARED_LOCATION_NOTE], "  ");
  }
  write("\n");

  if (report.outcome === "invalid-checkpoint") {
    write("the document is not a checkpoint, so nothing about the archive was judged\n");
    return;
  }

  const archive = report.archive;
  if (archive !== undefined && archive.unassigned.length > 0) {
    write("events that could not be assigned to a chain\n");
    writeFindings(archive.unassigned, "  ");
    write("\n");
  }

  for (const entry of report.chains) {
    if (entry.chain === undefined) {
      write(`chain ${entry.claim.chainId}\n`);
      write("  not in the archive\n");
    } else {
      writeChainResult(entry.chain, quiet);
    }
    write(`  checkpoint: head at sequence ${entry.claim.headSequence}\n`);
    if (!quiet) {
      writeChecks(
        entry.checks.map((check) => ({ message: `ok    ${check.message}` })),
        "  ",
      );
    }
    if (entry.findings.length > 0) {
      write("  FAIL\n");
      writeFindings(entry.findings, "    ");
    }
    if (!quiet) {
      writeNotes(entry.notes, "  ");
    }
    write(
      `  ${entry.status === "agrees" ? "agrees with" : entry.status === "missing" ? "missing from the archive named by" : "disagrees with"} the checkpoint\n\n`,
    );
  }

  // Chains the archive holds that the checkpoint says nothing about are
  // reported as verify-chain reports them: a broken one keeps the archive
  // from agreeing with anything, and a reader should not have to run a second
  // command to learn that.
  const named = new Set(report.chains.map((entry) => entry.claim.chainId));
  const unnamed = (archive?.chains ?? []).filter((chain) => !named.has(chain.chainId));
  for (const chain of unnamed) {
    writeChainResult(chain, quiet);
    write("  not named by the checkpoint\n\n");
  }

  const agrees = report.chains.filter((entry) => entry.status === "agrees").length;
  const missing = report.chains.filter((entry) => entry.status === "missing").length;
  const disagrees = report.chains.length - agrees - missing;
  const chainNoun = report.chains.length === 1 ? "chain" : "chains";
  write(
    `${report.chains.length} ${chainNoun} named by the checkpoint: ${agrees} ${agrees === 1 ? "agrees" : "agree"}, ${disagrees} ${disagrees === 1 ? "disagrees" : "disagree"}, ${missing} missing (${archive?.eventCount ?? 0} events in the archive)\n`,
  );
  write(`${CHECKPOINT_NOT_PROVEN}\n`);
}

function writeCheckpointJson(
  report: CheckpointReport,
  checkpointFile: string,
  checkpointSchemaId: string,
  loaded: LoadedInput,
  sharedLocation: boolean,
): void {
  const finding = (entry: Finding) => ({
    kind: entry.kind,
    ...(entry.label === undefined ? {} : { label: entry.label }),
    message: entry.message,
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
  });
  const payload = {
    tool: "auditmodel verify-checkpoint",
    specVersion: SPEC_VERSION,
    schemaId: loaded.validator.schemaId,
    checkpoint: {
      file: displayPath(checkpointFile),
      schemaId: checkpointSchemaId,
      ...(report.checkpointVersion === undefined ? {} : { version: report.checkpointVersion }),
      ...(report.anchor === undefined ? {} : { anchor: report.anchor }),
      ...(report.signature === undefined ? {} : { signature: report.signature }),
      ...(report.description === undefined ? {} : { description: report.description }),
      checks: report.checks.map((check) => check.message),
      findings: report.findings.map(finding),
      sharesLocationWithEvents: sharedLocation,
    },
    outcome: report.outcome,
    ...(report.archive === undefined
      ? {}
      : {
          archive: {
            eventCount: report.archive.eventCount,
            chainCount: report.archive.chains.length,
            intact: report.archive.intact,
            unassigned: report.archive.unassigned.map(finding),
          },
        }),
    chains: report.chains.map((entry) => ({
      chainId: entry.claim.chainId,
      status: entry.status,
      claim: {
        headSequence: entry.claim.headSequence,
        headHash: entry.claim.headHash,
        ...(entry.claim.eventCount === undefined ? {} : { eventCount: entry.claim.eventCount }),
      },
      ...(entry.chain === undefined
        ? {}
        : {
            chain: {
              eventCount: entry.chain.eventCount,
              ...(entry.chain.firstSequence === undefined
                ? {}
                : { firstSequence: entry.chain.firstSequence }),
              ...(entry.chain.lastSequence === undefined
                ? {}
                : { lastSequence: entry.chain.lastSequence }),
              ...(entry.chain.headHash === undefined ? {} : { headHash: entry.chain.headHash }),
              intact: entry.chain.intact,
              checks: entry.chain.checks.map((check) => check.message),
              findings: entry.chain.findings.map(finding),
              notes: entry.chain.notes.map((note) => note.message),
            },
          }),
      checks: entry.checks.map((check) => check.message),
      findings: entry.findings.map(finding),
      notes: entry.notes.map((note) => note.message),
    })),
    unreadable: loaded.failures.map((failure) => ({
      file: displayPath(failure.file),
      error: failure.error,
    })),
    notProven: CHECKPOINT_NOT_PROVEN,
  };
  write(`${JSON.stringify(payload, null, 2)}\n`);
}

function runVerifyProof(
  inputs: readonly string[],
  quiet: boolean,
  format: string,
  proofFile: string | undefined,
  publicKey: KeyObject | undefined,
): number {
  if (proofFile === undefined) {
    process.stderr.write("auditmodel: verify-proof requires --proof <file>\n\n");
    process.stderr.write(USAGE);
    return EXIT_ERROR;
  }

  const json = format === "json";
  const loaded = loadInput(inputs, "verify-proof", quiet || json);
  if (typeof loaded === "number") {
    return loaded;
  }
  if (loaded.failures.length > 0) {
    reportLoadFailures(loaded.failures);
    return EXIT_ERROR;
  }
  if (loaded.documents.length !== 1) {
    process.stderr.write(
      `auditmodel: verify-proof takes exactly one event; ${loaded.documents.length} were given\n`,
    );
    return EXIT_ERROR;
  }

  const parsed = readJsonFile(proofFile);
  if (!parsed.ok) {
    process.stderr.write(`auditmodel: cannot read --proof "${proofFile}": ${parsed.error}\n`);
    return EXIT_ERROR;
  }

  let proofValidator: DocumentValidator;
  try {
    proofValidator = createProofValidator();
  } catch (cause) {
    process.stderr.write(`auditmodel: ${(cause as Error).message}\n`);
    return EXIT_ERROR;
  }

  const document = loaded.documents[0] as EventDocument;
  const report = verifyProof(
    document.event,
    displayLabel(document),
    parsed.value,
    { events: loaded.validator, proof: proofValidator },
    { publicKey },
  );

  if (json) {
    writeProofJson(report, proofFile, proofValidator.schemaId, loaded);
  } else {
    writeProofText(report, proofFile, quiet);
  }

  if (report.outcome === "invalid-proof") {
    return EXIT_ERROR;
  }
  if (report.outcome === "no-leaf") {
    process.stderr.write(
      "auditmodel: no verdict: the event's hash cannot be established, so there is nothing to prove\n",
    );
    return EXIT_NO_VERDICT;
  }
  return report.outcome === "verified" ? EXIT_OK : EXIT_INVALID;
}

/** The text block for one event's own verification, as verify-integrity prints it. */
function writeEventResult(result: EventVerificationResult, quiet: boolean): void {
  if (result.verified) {
    if (!quiet) {
      write(`ok    ${result.label}\n`);
      writeChecks(result.checks, "        ");
    }
    return;
  }
  write(`FAIL  ${result.label}\n`);
  if (!quiet) {
    writeChecks(result.checks, "        ");
  }
  writeFindings(result.findings, "        ");
}

function writeProofText(report: ProofReport, proofFile: string, quiet: boolean): void {
  const version = report.proofVersion === undefined ? "" : ` (proof ${report.proofVersion})`;
  write(`proof ${displayPath(proofFile)}${version}\n`);
  if (!quiet) {
    writeChecks(
      report.checks.map((check) => ({ message: `ok    ${check.message}` })),
      "  ",
    );
  }
  if (report.findings.length > 0) {
    write("  FAIL\n");
    writeFindings(report.findings, "    ");
  }
  if (report.root !== undefined && !quiet) {
    const leaves = report.root.leafCount === 1 ? "leaf" : "leaves";
    write(
      `  tree:      ${report.hashAlgorithm}, ${report.root.leafCount} ${leaves}, root ${report.root.hash}\n`,
    );
    write(
      `  anchor:    ${report.root.anchor.type} — ${report.root.anchor.reference} (not dereferenced)\n`,
    );
  }
  write("\n");

  if (report.outcome === "invalid-proof") {
    write("the document is not a proof, so nothing was judged\n");
    return;
  }

  if (report.event !== undefined) {
    writeEventResult(report.event, quiet);
    write("\n");
  }

  switch (report.outcome) {
    case "verified":
      write(
        `proof verified: leaf ${report.leaf?.index} of ${report.root?.leafCount} in the tree the root describes\n`,
      );
      break;
    case "failed":
      write("proof failed\n");
      break;
    case "no-leaf":
      write("no verdict: the event's hash cannot be established, so there is nothing to prove\n");
      break;
    default:
      break;
  }
  write(`${PROOF_NOT_PROVEN}\n`);
}

function writeProofJson(
  report: ProofReport,
  proofFile: string,
  proofSchemaId: string,
  loaded: LoadedInput,
): void {
  const finding = (entry: Finding) => ({
    kind: entry.kind,
    ...(entry.label === undefined ? {} : { label: entry.label }),
    message: entry.message,
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
  });
  const payload = {
    tool: "auditmodel verify-proof",
    specVersion: SPEC_VERSION,
    schemaId: loaded.validator.schemaId,
    proof: {
      file: displayPath(proofFile),
      schemaId: proofSchemaId,
      ...(report.proofVersion === undefined ? {} : { version: report.proofVersion }),
      ...(report.hashAlgorithm === undefined ? {} : { hashAlgorithm: report.hashAlgorithm }),
      ...(report.leaf === undefined ? {} : { leaf: report.leaf }),
      ...(report.root === undefined ? {} : { root: report.root }),
      ...(report.calculatedRoot === undefined ? {} : { calculatedRoot: report.calculatedRoot }),
      ...(report.signature === undefined ? {} : { signature: report.signature }),
      checks: report.checks.map((check) => check.message),
      findings: report.findings.map(finding),
    },
    outcome: report.outcome,
    ...(report.event === undefined
      ? {}
      : {
          event: {
            label: report.event.label,
            verified: report.event.verified,
            checks: report.event.checks.map((check) => check.message),
            findings: report.event.findings.map(finding),
          },
        }),
    notProven: PROOF_NOT_PROVEN,
  };
  write(`${JSON.stringify(payload, null, 2)}\n`);
}

function runVerifyChain(
  inputs: readonly string[],
  quiet: boolean,
  publicKey: KeyObject | undefined,
): number {
  const loaded = loadInput(inputs, "verify-chain", quiet);
  if (typeof loaded === "number") {
    return loaded;
  }

  reportLoadFailures(loaded.failures);

  const events: ChainEventInput[] = loaded.documents.map((document) => ({
    label: displayLabel(document),
    event: document.event,
  }));

  const report = verifyChains(events, loaded.validator, publicKey);

  if (report.unassigned.length > 0) {
    write("events that could not be assigned to a chain\n");
    writeFindings(report.unassigned, "  ");
    write("\n");
  }

  for (const chain of report.chains) {
    writeChainResult(chain, quiet);
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
  if (report.chains.length === 0) {
    // No chain was evaluated, so there is nothing to pass or fail. Reporting
    // this as a failed verdict would make "nothing was checked" indistinguishable
    // from "a chain was checked and is broken". The per-event findings above
    // name why each event could not join a chain — a missing chainId, a missing
    // sequence, or a schema-invalid event.
    process.stderr.write(
      "auditmodel: no chain was verified: no event could be assigned to a chain (the findings above name why)\n",
    );
    return EXIT_NO_VERDICT;
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

    // Severity says how bad one finding would be. Category says what kind of
    // mistake produced it, which is what an instrumentation fix is organised
    // around — and fifty findings in one category is a different afternoon from
    // fifty spread across nine.
    if (!quiet && summary.byCategory.length > 0) {
      write(
        `by category: ${summary.byCategory
          .map((entry) => `${entry.category} ${entry.findings}`)
          .join(", ")}\n`,
      );
    }

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

/** Longest ungoverned-name list printed in text mode before it is summarised. */
const COVERAGE_NAME_LIMIT = 20;

function runCheckCoverage(
  inputs: readonly string[],
  quiet: boolean,
  format: string,
  profileName: string | undefined,
): number {
  if (profileName === undefined || profileName === "") {
    process.stderr.write(
      `auditmodel: check-coverage requires --profile <name>; available profiles: ${availableProfiles().join(", ")}\n`,
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

  const input = loadInput(inputs, "check-coverage", quiet || format === "json");
  if (typeof input === "number") {
    return input;
  }

  const { profile } = loaded;
  const events = input.documents.map((document) => document.event);
  const results = input.documents.map((document) =>
    checkProfile(document.event, displayLabel(document), profile, input.validator),
  );
  const coverage = summariseCoverage(events, results, profile);

  if (format === "json") {
    write(
      `${JSON.stringify(
        {
          tool: "auditmodel check-coverage",
          specVersion: SPEC_VERSION,
          schemaId: input.validator.schemaId,
          coverage,
          unreadable: input.failures.map((failure) => ({
            file: displayPath(failure.file),
            error: failure.error,
          })),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    reportLoadFailures(input.failures);

    write(`profile: ${profile.name} ${profile.version} (${profile.status})\n\n`);

    const summary = coverage.events;
    const noun = summary.events === 1 ? "event" : "events";
    write(
      `${summary.events} ${noun} checked: ${summary.conforming} conforming, ${summary.violations} with violations, ${summary.notApplicable} not applicable, ${summary.coreInvalid} core-invalid, ${input.failures.length} unreadable\n\n`,
    );

    write(
      `rules: ${coverage.rules.total} in the profile, ${coverage.rules.selected} selected, ${coverage.rules.applied} applied\n`,
    );
    if (!quiet) {
      for (const rule of coverage.perRule) {
        if (rule.selected === 0) {
          continue;
        }
        write(
          `  ${rule.ruleId.padEnd(18)}${rule.severity.padEnd(9)}selected ${String(rule.selected).padStart(5)}   applied ${String(rule.applied).padStart(5)}   failed ${String(rule.failed).padStart(5)}\n`,
        );
      }
      if (coverage.rules.neverSelected.length > 0) {
        write(
          `  never selected (${coverage.rules.neverSelected.length}): ${coverage.rules.neverSelected.join(", ")}\n`,
        );
      }
    }

    // The quiet half of the report, and the half worth reading: a rule that was
    // selected and never applied looked enforced and enforced nothing.
    if (coverage.rules.selectedButNeverApplied.length > 0) {
      write(
        `  selected but never applied (${coverage.rules.selectedButNeverApplied.length}): ${coverage.rules.selectedButNeverApplied.join(", ")}\n`,
      );
      write("        a condition on these rules never held, so they contributed no requirement\n");
    }

    write(
      `\nevent names: ${coverage.nameTotals.distinct} distinct, ${coverage.nameTotals.governed} governed, ${coverage.nameTotals.ungoverned} ungoverned\n`,
    );
    if (!quiet) {
      for (const kind of ["governed", "ungoverned"] as const) {
        const entries = coverage.names.filter((entry) => entry.governed === (kind === "governed"));
        if (entries.length === 0) {
          continue;
        }
        write(`  ${kind}\n`);
        for (const entry of entries.slice(0, COVERAGE_NAME_LIMIT)) {
          write(`    ${String(entry.events).padStart(7)}  ${entry.name}\n`);
        }
        if (entries.length > COVERAGE_NAME_LIMIT) {
          write(`    and ${entries.length - COVERAGE_NAME_LIMIT} more\n`);
        }
      }
    }

    if (coverage.nameTotals.governed === 0) {
      write("\nthis profile governs no event in this set, so it checked nothing\n");
    }
  }

  if (input.failures.length > 0) {
    return EXIT_ERROR;
  }
  // Never EXIT_INVALID: coverage reports reach, and makes no pass or fail claim.
  // `check-profile` is the command that judges.
  return coverage.nameTotals.governed === 0 ? EXIT_NO_VERDICT : EXIT_OK;
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
        // No default here: "was --format passed at all" must stay observable,
        // because commands that do not support it refuse it. The textual
        // default is applied where the value is read.
        format: { type: "string" },
        profile: { type: "string" },
        checkpoint: { type: "string" },
        proof: { type: "string" },
        "public-key": { type: "string" },
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

  // --format is honest: a command that would ignore it refuses it instead.
  // Accepting the flag and silently emitting text taught a CI author that
  // their pipeline was consuming JSON when it never was. Unknown and planned
  // commands fall through to their own diagnosis, which is the useful one.
  if (
    typeof values.format === "string" &&
    IMPLEMENTED_COMMANDS.has(command) &&
    !FORMAT_COMMANDS.has(command)
  ) {
    process.stderr.write(
      `auditmodel: --format is not supported by "${command}"; it applies to ${[...FORMAT_COMMANDS].join(" and ")}\n`,
    );
    return EXIT_ERROR;
  }

  // The same honesty for --checkpoint: it means one thing to one command.
  if (
    typeof values.checkpoint === "string" &&
    IMPLEMENTED_COMMANDS.has(command) &&
    command !== "verify-checkpoint"
  ) {
    process.stderr.write(
      `auditmodel: --checkpoint is not supported by "${command}"; it applies to verify-checkpoint\n`,
    );
    return EXIT_ERROR;
  }

  if (
    typeof values.proof === "string" &&
    IMPLEMENTED_COMMANDS.has(command) &&
    command !== "verify-proof"
  ) {
    process.stderr.write(
      `auditmodel: --proof is not supported by "${command}"; it applies to verify-proof\n`,
    );
    return EXIT_ERROR;
  }

  let publicKey: KeyObject | undefined;
  if (typeof values["public-key"] === "string" && PUBLIC_KEY_COMMANDS.has(command)) {
    const keyPath = values["public-key"];
    let pemText: string;
    try {
      pemText = readFileSync(keyPath, "utf8");
    } catch (cause) {
      process.stderr.write(
        `auditmodel: cannot read --public-key "${keyPath}": ${(cause as Error).message}\n`,
      );
      return EXIT_ERROR;
    }
    try {
      publicKey = loadPublicKey(pemText);
    } catch (cause) {
      process.stderr.write(`auditmodel: --public-key "${keyPath}" ${(cause as Error).message}\n`);
      return EXIT_ERROR;
    }
  }

  if (command === "validate") {
    return runValidate(rest, quiet);
  }
  if (command === "verify-integrity") {
    return runVerifyIntegrity(rest, quiet, publicKey);
  }
  if (command === "verify-chain") {
    return runVerifyChain(rest, quiet, publicKey);
  }
  if (command === "verify-checkpoint") {
    return runVerifyCheckpoint(
      rest,
      quiet,
      format,
      typeof values.checkpoint === "string" ? values.checkpoint : undefined,
      publicKey,
    );
  }
  if (command === "verify-proof") {
    return runVerifyProof(
      rest,
      quiet,
      format,
      typeof values.proof === "string" ? values.proof : undefined,
      publicKey,
    );
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
  if (command === "check-coverage") {
    return runCheckCoverage(
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
