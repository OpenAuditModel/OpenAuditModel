#!/usr/bin/env node
/**
 * Generates the language-neutral conformance kit at `conformance-kit/`.
 *
 * [ADR 0001](../../decisions/0001-specification-first.md) promises that "an
 * implementation in any language can be checked against the same fixtures".
 * The fixtures have always been there; what was missing is what they are
 * supposed to produce. Reading it out of 22 Node test files is not something an
 * implementer in another language can do, so the promise held in principle and
 * not in practice.
 *
 * This tool records, for every published fixture, the verdict each applicable
 * engine returns — as data, in one file, with no test framework around it.
 *
 * **What is recorded, and what deliberately is not.** Rule identifiers, JSON
 * Pointers, statuses, severities and finding kinds are the contract: two
 * implementations that disagree about those disagree about conformance. Human
 * messages are not, and are omitted — an implementation that words an error
 * differently is not wrong, and a kit that compared prose would fail every
 * translation and every improvement to a sentence.
 *
 * **The kit claims nothing about the implementation that passes it.** There is
 * no badge, no "compatible" status and no conferred anything. It says: given
 * these inputs, this is what the reference implementation answers. An
 * implementation that answers the same has demonstrated that and nothing more.
 * The corpus is the cases this project chose to publish, not the world.
 *
 * The manifest names fixture paths rather than embedding fixture content, so
 * there is exactly one copy of every event in the repository and the kit cannot
 * drift from it.
 *
 * Usage:
 *   node dist/conformance/tools/generate-kit.js          write conformance-kit/
 *   node dist/conformance/tools/generate-kit.js --check  compare only
 *
 * `--check` compares parsed content rather than bytes, so formatting stays
 * Prettier's responsibility and content stays this tool's.
 */
import { deepStrictEqual } from "node:assert";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  createCheckpointValidator,
  createProofValidator,
  createValidator,
  resolveSchemaPath,
  SPEC_VERSION,
} from "../src/validate.js";
import { lintEvent } from "../src/privacy/lint-event.js";
import { verifyEventIntegrity } from "../src/integrity/verify-event.js";
import { verifyChains } from "../src/integrity/verify-chain.js";
import { verifyCheckpoint } from "../src/integrity/verify-checkpoint.js";
import { verifyProof } from "../src/integrity/verify-proof.js";
import { availableProfiles, loadProfile } from "../src/profiles/load-profile.js";
import { checkProfile } from "../src/profiles/check-profile.js";
import type { ProfileDefinition } from "../src/profiles/types.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const kitRoot = path.join(repoRoot, "conformance-kit");
const validator = createValidator(schemaPath);
const checkpointValidator = createCheckpointValidator(schemaPath);
const proofValidator = createProofValidator(schemaPath);

/** Published documents that are not events and are recorded by their own families instead. */
const NON_EVENT_DIRECTORIES: readonly string[] = [
  "examples/integrity/checkpoints/",
  "examples/integrity/proofs/",
];

function isEventFixture(relativePath: string): boolean {
  return (
    !relativePath.startsWith("examples/integrity/keys/") &&
    !NON_EVENT_DIRECTORIES.some((directory) => relativePath.startsWith(directory))
  );
}

/** A JSON Pointer and the schema keyword that rejected it. */
interface SchemaIssue {
  readonly path: string;
  readonly keyword: string;
}

interface PrivacyFindingRecord {
  readonly ruleId: string;
  readonly path: string;
  readonly severity: string;
  readonly confidence: string;
}

interface ProfileFindingRecord {
  readonly ruleId: string;
  readonly path: string;
}

interface FixtureRecord {
  /** Path relative to the repository root. */
  readonly fixture: string;
  readonly validate: { readonly valid: boolean; readonly issues: readonly SchemaIssue[] };
  readonly lintPrivacy: {
    readonly status: string;
    readonly findings: readonly PrivacyFindingRecord[];
  };
  readonly verifyIntegrity?: {
    readonly verified: boolean;
    readonly findings: readonly string[];
  };
  readonly checkProfile?: {
    readonly profile: string;
    readonly status: string;
    readonly matchedRules: readonly string[];
    readonly errors: readonly ProfileFindingRecord[];
    readonly warnings: readonly ProfileFindingRecord[];
  };
}

interface ChainRecord {
  /** Directory, relative to the repository root, holding the chain's events. */
  readonly fixtures: string;
  readonly intact: boolean;
  readonly eventCount: number;
  readonly chains: readonly {
    readonly eventCount: number;
    readonly intact: boolean;
    readonly findings: readonly string[];
  }[];
}

interface CheckpointRecord {
  /** The checkpoint document, relative to the repository root. */
  readonly checkpoint: string;
  /** The directories compared with it as one archive, relative to the repository root. */
  readonly archive: readonly string[];
  readonly outcome: string;
  /** Finding kinds on the document itself: its schema and its signature. */
  readonly findings: readonly string[];
  /** One entry per chain the checkpoint names; a chain's own findings are in `chains`. */
  readonly chains: readonly {
    readonly chainId: string;
    readonly status: string;
    readonly findings: readonly string[];
  }[];
}

/**
 * Which archive each published checkpoint is compared with. A checkpoint on
 * its own records nothing; the pairing is the case. The same document appears
 * against several archives on purpose: the checkpoint that agrees with the
 * full chain is the one that catches the truncated copy of it.
 */
const CHECKPOINT_CASES: readonly {
  readonly checkpoint: string;
  readonly archive: readonly string[];
}[] = [
  {
    checkpoint: "examples/integrity/checkpoints/three-event-chain.checkpoint.json",
    archive: ["examples/integrity/valid/three-event-chain"],
  },
  {
    checkpoint: "examples/integrity/checkpoints/three-event-chain.checkpoint.json",
    archive: ["examples/integrity/invalid/truncated-chain"],
  },
  {
    checkpoint: "examples/integrity/checkpoints/three-event-chain.checkpoint.json",
    archive: ["examples/integrity/valid/chain-in-two-batches"],
  },
  {
    checkpoint: "examples/integrity/checkpoints/three-event-chain.stale.checkpoint.json",
    archive: ["examples/integrity/valid/three-event-chain"],
  },
  {
    checkpoint: "examples/integrity/checkpoints/three-event-chain.wrong-head.checkpoint.json",
    archive: ["examples/integrity/valid/three-event-chain"],
  },
  {
    checkpoint: "examples/integrity/checkpoints/three-event-chain.unanchored.checkpoint.json",
    archive: ["examples/integrity/valid/three-event-chain"],
  },
  {
    checkpoint: "examples/integrity/checkpoints/archive.checkpoint.json",
    archive: [
      "examples/integrity/valid/three-event-chain",
      "examples/integrity/valid/chain-in-two-batches",
    ],
  },
  {
    checkpoint: "examples/integrity/checkpoints/archive.checkpoint.json",
    archive: ["examples/integrity/valid/three-event-chain"],
  },
];

interface ProofRecord {
  /** The proof document, relative to the repository root. */
  readonly proof: string;
  /** The event it was verified against, relative to the repository root. */
  readonly event: string;
  readonly outcome: string;
  /** Finding kinds on the proof and its relation to the event. */
  readonly findings: readonly string[];
  /** Finding kinds of the event's own verification, as `verifyIntegrity` records them. */
  readonly eventFindings: readonly string[];
}

/** Which event each published proof is verified against. A proof alone proves nothing; the pairing is the case. */
const PROOF_CASES: readonly { readonly proof: string; readonly event: string }[] = [
  {
    proof: "examples/integrity/proofs/three-event-chain.002.proof.json",
    event: "examples/integrity/valid/three-event-chain/002.json",
  },
  {
    proof: "examples/integrity/proofs/three-event-chain.002.wrong-root.proof.json",
    event: "examples/integrity/valid/three-event-chain/002.json",
  },
  {
    proof: "examples/integrity/proofs/three-event-chain.002.proof.json",
    event: "examples/integrity/valid/three-event-chain/001.json",
  },
  {
    proof: "examples/integrity/proofs/three-event-chain.002.proof.json",
    event: "examples/integrity/invalid/tampered-event.json",
  },
  {
    proof: "examples/integrity/proofs/three-event-chain.002.proof.json",
    event: "examples/valid/minimal-event.json",
  },
];

type Event = Record<string, unknown>;

/** Every `.json` file under a directory, recursively, in a stable order. */
function jsonFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...jsonFiles(full));
    } else if (entry.name.endsWith(".json")) {
      found.push(full);
    }
  }
  return found;
}

function relative(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

/** The profile a fixture belongs to, from its path, or `undefined`. */
function owningProfile(file: string): string | undefined {
  const segments = relative(file).split("/");
  if (segments[0] !== "examples" || segments[1] !== "profiles") {
    return undefined;
  }
  const name = segments[2];
  return name !== undefined && availableProfiles().includes(name) ? name : undefined;
}

function recordFixture(
  file: string,
  profiles: ReadonlyMap<string, ProfileDefinition>,
): FixtureRecord {
  const event = JSON.parse(readFileSync(file, "utf8")) as Event;
  const label = relative(file);

  const issues = validator.validateEvent(event);
  const privacy = lintEvent(event, label, validator);

  const record: FixtureRecord = {
    fixture: label,
    validate: {
      valid: issues.length === 0,
      issues: issues.map((issue) => ({ path: issue.path, keyword: issue.keyword })),
    },
    lintPrivacy: {
      status: privacy.status,
      findings: privacy.findings.map((finding) => ({
        ruleId: finding.ruleId,
        path: finding.path,
        severity: finding.severity,
        confidence: finding.confidence,
      })),
    },
  };

  // Integrity is recorded only where the fixture declares it, because
  // `verify-integrity` reports "no integrity object" for everything else and
  // that is a property of the command, not of the fixture.
  const withIntegrity =
    typeof event["integrity"] === "object" && event["integrity"] !== null
      ? {
          verifyIntegrity: (() => {
            const result = verifyEventIntegrity(event, label, validator);
            return {
              verified: result.verified,
              findings: result.findings.map((finding) => finding.kind),
            };
          })(),
        }
      : {};

  const profileName = owningProfile(file);
  const definition = profileName === undefined ? undefined : profiles.get(profileName);
  const withProfile =
    definition === undefined || profileName === undefined
      ? {}
      : {
          checkProfile: (() => {
            const result = checkProfile(event, label, definition, validator);
            return {
              profile: profileName,
              status: result.status,
              matchedRules: result.matchedRules,
              errors: result.errors.map((finding) => ({
                ruleId: finding.ruleId,
                path: finding.path,
              })),
              warnings: result.warnings.map((finding) => ({
                ruleId: finding.ruleId,
                path: finding.path,
              })),
            };
          })(),
        };

  return { ...record, ...withIntegrity, ...withProfile };
}

/** Directories holding a chain, which are verified as a set rather than per event. */
function chainDirectories(): string[] {
  const roots = [
    path.join(repoRoot, "examples", "integrity", "valid"),
    path.join(repoRoot, "examples", "integrity", "invalid"),
  ];
  const found: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    )) {
      if (entry.isDirectory()) {
        found.push(path.join(root, entry.name));
      }
    }
  }
  return found;
}

function recordChain(directory: string): ChainRecord {
  const events = jsonFiles(directory).map((file) => ({
    label: relative(file),
    event: JSON.parse(readFileSync(file, "utf8")) as Event,
  }));
  const report = verifyChains(events, validator);

  return {
    fixtures: relative(directory),
    intact: report.intact,
    eventCount: report.eventCount,
    chains: report.chains.map((chain) => ({
      eventCount: chain.eventCount,
      intact: chain.intact,
      findings: chain.findings.map((finding) => finding.kind),
    })),
  };
}

function recordCheckpoint(testCase: (typeof CHECKPOINT_CASES)[number]): CheckpointRecord {
  const events = testCase.archive.flatMap((directory) =>
    jsonFiles(path.join(repoRoot, directory)).map((file) => ({
      label: relative(file),
      event: JSON.parse(readFileSync(file, "utf8")) as Event,
    })),
  );
  const checkpoint = JSON.parse(
    readFileSync(path.join(repoRoot, testCase.checkpoint), "utf8"),
  ) as unknown;
  const report = verifyCheckpoint(events, checkpoint, {
    events: validator,
    checkpoint: checkpointValidator,
  });

  return {
    checkpoint: testCase.checkpoint,
    archive: testCase.archive,
    outcome: report.outcome,
    findings: report.findings.map((finding) => finding.kind),
    chains: report.chains.map((entry) => ({
      chainId: entry.claim.chainId,
      status: entry.status,
      findings: entry.findings.map((finding) => finding.kind),
    })),
  };
}

function recordProof(testCase: (typeof PROOF_CASES)[number]): ProofRecord {
  const event = JSON.parse(readFileSync(path.join(repoRoot, testCase.event), "utf8")) as unknown;
  const proof = JSON.parse(readFileSync(path.join(repoRoot, testCase.proof), "utf8")) as unknown;
  const report = verifyProof(event, testCase.event, proof, {
    events: validator,
    proof: proofValidator,
  });
  return {
    proof: testCase.proof,
    event: testCase.event,
    outcome: report.outcome,
    findings: report.findings.map((finding) => finding.kind),
    eventFindings: report.event?.findings.map((finding) => finding.kind) ?? [],
  };
}

export { CHECKPOINT_CASES, NON_EVENT_DIRECTORIES, PROOF_CASES };

export interface ConformanceKit {
  readonly specVersion: string;
  readonly schemaId: string;
  readonly claims: readonly string[];
  readonly profiles: readonly { readonly name: string; readonly version: string }[];
  readonly fixtures: readonly FixtureRecord[];
  readonly chains: readonly ChainRecord[];
  readonly checkpoints: readonly CheckpointRecord[];
  readonly proofs: readonly ProofRecord[];
}

/** Builds the kit from the published fixtures and the engines. */
export function buildKit(): ConformanceKit {
  const profiles = new Map<string, ProfileDefinition>();
  for (const name of availableProfiles()) {
    const loaded = loadProfile(name);
    if (loaded.ok) {
      profiles.set(name, loaded.profile);
    }
  }

  // Keys are not JSON; checkpoints and proofs are not events and have
  // families of their own below.
  const files = jsonFiles(path.join(repoRoot, "examples")).filter((file) =>
    isEventFixture(relative(file)),
  );

  return {
    specVersion: SPEC_VERSION,
    schemaId: validator.schemaId,
    claims: [
      "Each record states what the reference implementation answers for one published fixture.",
      "An implementation that answers the same has demonstrated that, and nothing else.",
      "This kit confers no status, no badge and no compatibility claim.",
      "Human-readable messages are deliberately absent: they are not part of the contract.",
      "The corpus is the cases this project chose to publish, not every case that exists.",
    ],
    profiles: [...profiles.values()].map((profile) => ({
      name: profile.name,
      version: profile.version,
    })),
    fixtures: files.map((file) => recordFixture(file, profiles)),
    chains: chainDirectories().map((directory) => recordChain(directory)),
    checkpoints: CHECKPOINT_CASES.map((testCase) => recordCheckpoint(testCase)),
    proofs: PROOF_CASES.map((testCase) => recordProof(testCase)),
  };
}

const MANIFEST = path.join(kitRoot, "manifest.json");

/** Compares the generated kit with what is on disk. Returns the drifted paths. */
export function checkKit(): string[] {
  if (!existsSync(MANIFEST)) {
    return ["conformance-kit/manifest.json (missing)"];
  }
  try {
    deepStrictEqual(
      JSON.parse(readFileSync(MANIFEST, "utf8")),
      JSON.parse(JSON.stringify(buildKit())),
    );
    return [];
  } catch {
    return ["conformance-kit/manifest.json"];
  }
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { check: { type: "boolean", default: false } },
  });

  if (values.check === true) {
    const drifted = checkKit();
    if (drifted.length === 0) {
      const kit = buildKit();
      process.stdout.write(
        `conformance kit is current (${kit.fixtures.length} fixtures, ${kit.chains.length} chains, ${kit.checkpoints.length} checkpoint cases, ${kit.proofs.length} proof cases)\n`,
      );
      return 0;
    }
    process.stderr.write("the conformance kit is stale:\n");
    for (const entry of drifted) {
      process.stderr.write(`  ${entry}\n`);
    }
    process.stderr.write('\nRun "npm run kit:build" to regenerate it.\n');
    return 1;
  }

  const kit = buildKit();
  mkdirSync(kitRoot, { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(kit, null, 2)}\n`, "utf8");
  process.stdout.write(
    `wrote conformance-kit/manifest.json (${kit.fixtures.length} fixtures, ${kit.chains.length} chains, ${kit.checkpoints.length} checkpoint cases, ${kit.proofs.length} proof cases)\n`,
  );
  return 0;
}

if (process.argv[1] !== undefined && process.argv[1].includes("generate-kit")) {
  process.exitCode = main();
}
