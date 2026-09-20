/**
 * Verification of an archive against a chain checkpoint.
 *
 * `verifyChains` proves that a supplied set of events is internally
 * consistent. It cannot see what is not there: a chain whose most recent
 * events were deleted is a shorter chain that verifies perfectly
 * (specification/integrity.md §8, item 4). A checkpoint is the reference that
 * closes that gap — the chain's head, recorded and kept somewhere the store's
 * administrators do not control. This module compares an archive with such a
 * checkpoint and reports whether the archive still reaches the recorded head.
 *
 * What it establishes is that the archive is consistent with the checkpoint it
 * was handed. Whether the checkpoint is genuine and its anchor real is for
 * whoever holds the anchor; the tool is offline and dereferences nothing.
 */
import type { KeyObject } from "node:crypto";
import type { EventValidator } from "../validate-core.js";
import { digestsEqual, isHexDigest } from "./digest.js";
import { checkDeclaredDocumentSignature } from "./signature.js";
import { verifyChains, type ChainEventInput } from "./verify-chain.js";
import { readIntegrity } from "./verify-event.js";
import type {
  ChainVerificationResult,
  CheckpointChainResult,
  CheckpointClaim,
  CheckpointReport,
  Finding,
  Note,
  PassedCheck,
} from "./types.js";

export interface VerifyCheckpointOptions {
  /**
   * Key to verify the checkpoint's `signature` and every event's
   * `integrity.signature` against. Without it a declared signature in an
   * implemented algorithm is reported as declared but not checked; one in an
   * unimplemented algorithm fails either way, as for events.
   */
  readonly publicKey?: KeyObject | undefined;
}

/** The validators a comparison needs: one for events, one for the checkpoint document. */
export interface CheckpointValidators {
  readonly events: EventValidator;
  readonly checkpoint: EventValidator;
}

/** The label findings on the document itself carry. */
export const CHECKPOINT_LABEL = "checkpoint";

/** What the comparison reads from each archived event, keyed by chain. */
interface IndexedEvent {
  readonly label: string;
  readonly sequence: number;
  readonly hash?: string;
  readonly hashAlgorithm?: string;
  readonly canonicalization?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asSequence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function count(total: number, singular: string, plural = `${singular}s`): string {
  return `${total} ${total === 1 ? singular : plural}`;
}

/** Reads the claims a schema-valid checkpoint makes, one per chain, in document order. */
function readClaims(checkpoint: Record<string, unknown>): CheckpointClaim[] {
  const entries = Array.isArray(checkpoint["chains"])
    ? (checkpoint["chains"] as Record<string, unknown>[])
    : [checkpoint];
  return entries.map((entry) => {
    const head = entry["head"] as Record<string, unknown>;
    const eventCount = entry["eventCount"];
    return {
      chainId: entry["chainId"] as string,
      headSequence: head["sequence"] as number,
      headHash: head["hash"] as string,
      ...(typeof eventCount === "number" ? { eventCount } : {}),
    };
  });
}

/**
 * Indexes the archive by chain and sequence, from what each event declares.
 * Schema validity is not re-checked here: an event `verifyChains` could not
 * assign to a chain already makes the archive not intact, and the comparison
 * below never reads a value the digest check has not covered.
 */
function indexArchive(inputs: readonly ChainEventInput[]): Map<string, IndexedEvent[]> {
  const index = new Map<string, IndexedEvent[]>();
  for (const input of inputs) {
    const integrity = readIntegrity(input.event);
    const chainId = integrity === undefined ? undefined : asString(integrity.chainId);
    const sequence = asSequence((input.event as Record<string, unknown> | null)?.["sequence"]);
    if (integrity === undefined || chainId === undefined || sequence === undefined) {
      continue;
    }
    const hash = asString(integrity.hash);
    const hashAlgorithm = asString(integrity.hashAlgorithm);
    const canonicalization = asString(integrity.canonicalization);
    const entry: IndexedEvent = {
      label: input.label,
      sequence,
      ...(hash === undefined ? {} : { hash }),
      ...(hashAlgorithm === undefined ? {} : { hashAlgorithm }),
      ...(canonicalization === undefined ? {} : { canonicalization }),
    };
    const bucket = index.get(chainId);
    if (bucket === undefined) {
      index.set(chainId, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  return index;
}

/** Compares one claim with the chain the archive holds under that identifier. */
function compareClaim(
  claim: CheckpointClaim,
  chain: ChainVerificationResult,
  events: readonly IndexedEvent[],
  hashAlgorithm: string,
  canonicalization: string,
): CheckpointChainResult {
  const checks: PassedCheck[] = [];
  const findings: Finding[] = [];
  const notes: Note[] = [];

  const atHead = events.filter((event) => event.sequence === claim.headSequence);
  const head = atHead[0];

  if (head === undefined) {
    if (chain.lastSequence === undefined) {
      findings.push({
        kind: "checkpoint-head-missing",
        message: `no event in the chain declares a sequence, so the head at sequence ${claim.headSequence} cannot be located`,
      });
    } else if (chain.lastSequence < claim.headSequence) {
      findings.push({
        kind: "tail-truncated",
        message: `the chain ends at sequence ${chain.lastSequence}, but the checkpoint records a head at sequence ${claim.headSequence}`,
        detail: [
          `recorded head hash: ${claim.headHash}`,
          `every event after sequence ${chain.lastSequence} that the checkpoint covered is absent from the archive`,
          "a truncated chain is internally consistent; only a checkpoint can show what is missing",
        ],
      });
    } else {
      findings.push({
        kind: "checkpoint-head-missing",
        message: `no event at sequence ${claim.headSequence}, though the chain continues to sequence ${chain.lastSequence}`,
        detail: [
          `recorded head hash: ${claim.headHash}`,
          "the core model permits gaps, but the checkpoint names an event that existed",
        ],
      });
    }
  } else if (head.hashAlgorithm !== hashAlgorithm || head.canonicalization !== canonicalization) {
    findings.push({
      kind: "checkpoint-algorithm-mismatch",
      message:
        "the checkpoint and the event at its head do not declare the same hash algorithm and canonicalization",
      detail: [
        `checkpoint: ${hashAlgorithm}, ${canonicalization}`,
        `event at sequence ${claim.headSequence}: ${head.hashAlgorithm ?? "(none)"}, ${head.canonicalization ?? "(none)"}`,
        "the recorded head hash cannot be compared with a digest produced another way",
      ],
    });
  } else {
    const matches = atHead.some(
      (event) =>
        event.hash !== undefined &&
        isHexDigest(event.hash) &&
        isHexDigest(claim.headHash) &&
        digestsEqual(event.hash, claim.headHash),
    );
    if (matches) {
      checks.push({ message: `event at sequence ${claim.headSequence} matches the recorded head` });
    } else {
      findings.push({
        kind: "checkpoint-head-mismatch",
        message: `the event at sequence ${claim.headSequence} does not match the recorded head`,
        detail: [
          `recorded head hash: ${claim.headHash}`,
          ...atHead.map((event) => `${event.label}: ${event.hash ?? "(no hash declared)"}`),
        ],
      });
    }

    // The count is compared only once the head was located: a truncated chain
    // is already reported as truncated, and a second finding for the count it
    // implies would say the same thing twice.
    if (claim.eventCount !== undefined) {
      const counted = events.filter((event) => event.sequence <= claim.headSequence).length;
      if (counted === claim.eventCount) {
        checks.push({
          message: `${count(counted, "event")} up to the head, as the checkpoint records`,
        });
      } else {
        findings.push({
          kind: "checkpoint-count-mismatch",
          message: `the checkpoint records ${count(claim.eventCount, "event")} up to the head; the archive holds ${counted}`,
        });
      }
    }
  }

  const after = events.filter((event) => event.sequence > claim.headSequence).length;
  if (after > 0) {
    notes.push({
      message: `${count(after, "event")} after the checkpoint ${after === 1 ? "is" : "are"} not covered by it`,
      detail: ["the checkpoint says nothing about them; a newer checkpoint would"],
    });
  }

  const status = chain.intact && findings.length === 0 ? "agrees" : "disagrees";
  return { claim, status, chain, checks, findings, notes };
}

/**
 * Compares an archive with a checkpoint.
 *
 * The checkpoint is validated against its schema first; a document that is
 * not a checkpoint is reported as such and nothing about the archive is
 * judged. The archive is then verified exactly as `verifyChains` verifies it —
 * a broken archive stays broken — and every chain the checkpoint names is
 * compared with what the archive holds under that identifier.
 */
export function verifyCheckpoint(
  inputs: readonly ChainEventInput[],
  checkpoint: unknown,
  validators: CheckpointValidators,
  options: VerifyCheckpointOptions = {},
): CheckpointReport {
  const issues = validators.checkpoint.validateEvent(checkpoint);
  if (issues.length > 0) {
    const shown = issues.slice(0, 5).map((issue) => `${issue.path}  ${issue.message}`);
    return {
      outcome: "invalid-checkpoint",
      checks: [],
      findings: [
        {
          kind: "checkpoint-schema-invalid",
          label: CHECKPOINT_LABEL,
          message: "document does not conform to the checkpoint schema",
          detail:
            issues.length > shown.length
              ? [...shown, `and ${issues.length - shown.length} further schema issues`]
              : shown,
        },
      ],
      chains: [],
    };
  }

  const document = checkpoint as Record<string, unknown>;
  const checks: PassedCheck[] = [{ message: "checkpoint schema valid" }];
  const findings: Finding[] = [];

  const signature = checkDeclaredDocumentSignature(document, options.publicKey, CHECKPOINT_LABEL);
  if (signature !== undefined) {
    if (signature.finding === undefined) {
      checks.push({ message: signature.result.message });
    } else {
      findings.push(signature.finding);
    }
  }

  const anchorRecord = document["anchor"] as Record<string, unknown>;
  const recordedAt = asString(anchorRecord["recordedAt"]);
  const description = asString(document["description"]);

  const archive = verifyChains(inputs, validators.events, options.publicKey);
  const index = indexArchive(inputs);
  const hashAlgorithm = document["hashAlgorithm"] as string;
  const canonicalization = document["canonicalization"] as string;

  const chains: CheckpointChainResult[] = readClaims(document).map((claim) => {
    const chain = archive.chains.find((candidate) => candidate.chainId === claim.chainId);
    if (chain === undefined) {
      return {
        claim,
        status: "missing",
        checks: [],
        findings: [
          {
            kind: "checkpoint-chain-missing",
            message: `the archive holds no chain ${claim.chainId}`,
            detail: [
              `the checkpoint records its head at sequence ${claim.headSequence}`,
              "either this is not the archive the checkpoint describes, or the whole chain is gone",
            ],
          },
        ],
        notes: [],
      };
    }
    return compareClaim(
      claim,
      chain,
      index.get(claim.chainId) ?? [],
      hashAlgorithm,
      canonicalization,
    );
  });

  const present = chains.filter((entry) => entry.status !== "missing");
  const outcome =
    present.length === 0
      ? "no-chain"
      : findings.length === 0 &&
          archive.intact &&
          chains.every((entry) => entry.status === "agrees")
        ? "agrees"
        : "disagrees";

  return {
    outcome,
    checkpointVersion: document["checkpointVersion"] as string,
    anchor: {
      type: anchorRecord["type"] as string,
      reference: anchorRecord["reference"] as string,
      ...(recordedAt === undefined ? {} : { recordedAt }),
    },
    ...(signature === undefined ? {} : { signature: signature.result }),
    ...(description === undefined ? {} : { description }),
    checks,
    findings,
    archive,
    chains,
  };
}
