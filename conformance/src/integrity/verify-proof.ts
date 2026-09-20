/**
 * Verification of an inclusion proof: that one event is a leaf of the Merkle
 * tree a published root describes.
 *
 * A checkpoint says where a chain ends; a proof says that one event belongs
 * to a tree, without the rest of the tree being supplied. The event's
 * `integrity.hash` is the leaf, nothing is added to the event, and the root
 * carries the same anchoring rule a checkpoint does. What a passing proof
 * shows is membership of the tree the root describes; the root's provenance
 * is the anchor's, and the tool says so after every verdict.
 */
import type { KeyObject } from "node:crypto";
import type { EventValidator } from "../validate-core.js";
import { digestsEqual, isSupportedHashAlgorithm } from "./digest.js";
import { decodeDigest, expectedSides, rootFromPath, type PathStep } from "./merkle.js";
import { checkDeclaredDocumentSignature } from "./signature.js";
import { verifyEventIntegrity } from "./verify-event.js";
import {
  SUPPORTED_HASH_ALGORITHMS,
  type EventFindingKind,
  type Finding,
  type Note,
  type PassedCheck,
  type ProofReport,
} from "./types.js";

export interface VerifyProofOptions {
  /** Key to verify the root's `signature` and the event's `integrity.signature` against. */
  readonly publicKey?: KeyObject | undefined;
}

/** The validators a proof needs: one for the event, one for the proof document. */
export interface ProofValidators {
  readonly events: EventValidator;
  readonly proof: EventValidator;
}

/** The label findings on the document itself carry. */
export const PROOF_LABEL = "proof";

/**
 * Event failures after which there is no hash to prove anything about. Every
 * other event failure is a verdict on the event, and the proof fails with it.
 */
const LEAF_UNAVAILABLE: ReadonlySet<EventFindingKind> = new Set<EventFindingKind>([
  "schema-invalid",
  "integrity-missing",
  "hash-missing",
  "hash-algorithm-missing",
  "canonicalization-missing",
  "unsupported-canonicalization",
  "unsupported-algorithm",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Verifies that `event` is the leaf `proof` describes and that the proof's
 * path recomputes to its root.
 *
 * The proof is validated against its schema first; a document that is not a
 * proof judges nothing. The proof's own consistency — algorithm, digest
 * lengths, the path's shape against the leaf's position, the root it
 * recomputes to — is checked before the event is looked at, because it holds
 * or fails regardless of which event is offered. The event is then verified
 * exactly as `verify-integrity` verifies it, and its hash must be the leaf.
 */
export function verifyProof(
  event: unknown,
  label: string,
  proof: unknown,
  validators: ProofValidators,
  options: VerifyProofOptions = {},
): ProofReport {
  const issues = validators.proof.validateEvent(proof);
  if (issues.length > 0) {
    const shown = issues.slice(0, 5).map((issue) => `${issue.path}  ${issue.message}`);
    return {
      outcome: "invalid-proof",
      checks: [],
      findings: [
        {
          kind: "proof-schema-invalid",
          label: PROOF_LABEL,
          message: "document does not conform to the proof schema",
          detail:
            issues.length > shown.length
              ? [...shown, `and ${issues.length - shown.length} further schema issues`]
              : shown,
        },
      ],
      notes: [],
    };
  }

  const document = proof as Record<string, unknown>;
  const checks: PassedCheck[] = [{ message: "proof schema valid" }];
  const findings: Finding[] = [];
  const notes: Note[] = [];

  const hashAlgorithm = document["hashAlgorithm"] as string;
  const leaf = document["leaf"] as Record<string, unknown>;
  const path = document["path"] as PathStep[];
  const root = document["root"] as Record<string, unknown>;
  const anchor = root["anchor"] as Record<string, unknown>;
  const recordedAt = asString(anchor["recordedAt"]);
  const eventId = asString(leaf["eventId"]);
  const leafIndex = leaf["index"] as number;
  const leafCount = root["leafCount"] as number;

  const base = {
    proofVersion: document["proofVersion"] as string,
    hashAlgorithm,
    leaf: {
      hash: leaf["hash"] as string,
      index: leafIndex,
      ...(eventId === undefined ? {} : { eventId }),
    },
    root: {
      hash: root["hash"] as string,
      leafCount,
      anchor: {
        type: anchor["type"] as string,
        reference: anchor["reference"] as string,
        ...(recordedAt === undefined ? {} : { recordedAt }),
      },
    },
  };

  // The root's signature covers the root object with `/signature` removed: one
  // signed root serves every proof cut from its tree.
  const signature = checkDeclaredDocumentSignature(root, options.publicKey, PROOF_LABEL);
  if (signature !== undefined) {
    if (signature.finding === undefined) {
      checks.push({ message: `root ${signature.result.message}` });
    } else {
      findings.push(signature.finding);
    }
  }

  if (!isSupportedHashAlgorithm(hashAlgorithm)) {
    findings.push({
      kind: "proof-algorithm-unsupported",
      label: PROOF_LABEL,
      message: `hash algorithm "${hashAlgorithm}" is not implemented by this verifier`,
      detail: [`implemented: ${SUPPORTED_HASH_ALGORITHMS.join(", ")}`],
    });
    return {
      outcome: "failed",
      ...base,
      ...(signature === undefined ? {} : { signature: signature.result }),
      checks,
      findings,
      notes,
    };
  }

  const leafDigest = decodeDigest(hashAlgorithm, base.leaf.hash);
  const rootDigest = decodeDigest(hashAlgorithm, base.root.hash);
  const badLengths = [
    ...(leafDigest === undefined ? ["/leaf/hash"] : []),
    ...(rootDigest === undefined ? ["/root/hash"] : []),
    ...path.flatMap((step, index) =>
      decodeDigest(hashAlgorithm, step.hash) === undefined ? [`/path/${index}/hash`] : [],
    ),
  ];
  if (badLengths.length > 0) {
    findings.push({
      kind: "proof-digest-length-mismatch",
      label: PROOF_LABEL,
      message: `${badLengths.length === 1 ? "a digest is" : `${badLengths.length} digests are`} not the length ${hashAlgorithm} produces`,
      detail: badLengths,
    });
  }

  let positionValid = true;
  if (leafIndex >= leafCount) {
    positionValid = false;
    findings.push({
      kind: "proof-position-invalid",
      label: PROOF_LABEL,
      message: `leaf index ${leafIndex} is outside a tree of ${leafCount} ${leafCount === 1 ? "leaf" : "leaves"}`,
    });
  } else {
    const expected = expectedSides(leafIndex, leafCount);
    const actual = path.map((step) => step.side);
    if (
      expected.length !== actual.length ||
      expected.some((side, index) => side !== actual[index])
    ) {
      positionValid = false;
      findings.push({
        kind: "proof-path-inconsistent",
        label: PROOF_LABEL,
        message: `the path is not the shape of leaf ${leafIndex} in a tree of ${leafCount} leaves`,
        detail: [
          `expected ${expected.length} ${expected.length === 1 ? "step" : "steps"}: ${expected.join(", ") || "(none)"}`,
          `found ${actual.length} ${actual.length === 1 ? "step" : "steps"}: ${actual.join(", ") || "(none)"}`,
        ],
      });
    } else {
      checks.push({
        message: `path has the shape of leaf ${leafIndex} in a tree of ${leafCount} ${leafCount === 1 ? "leaf" : "leaves"}`,
      });
    }
  }

  let calculatedRoot: string | undefined;
  if (leafDigest !== undefined && rootDigest !== undefined && badLengths.length === 0) {
    const recomputed = rootFromPath(hashAlgorithm, leafDigest, path);
    if (recomputed !== undefined) {
      calculatedRoot = recomputed.toString("hex");
      if (digestsEqual(calculatedRoot, base.root.hash)) {
        checks.push({ message: "path recomputes to the recorded root" });
      } else {
        findings.push({
          kind: "proof-root-mismatch",
          label: PROOF_LABEL,
          message: "the path does not recompute to the recorded root",
          detail: [`recorded:   ${base.root.hash}`, `calculated: ${calculatedRoot}`],
        });
      }
    }
  }

  // The event, exactly as verify-integrity sees it.
  const eventResult = verifyEventIntegrity(event, label, validators.events, {
    publicKey: options.publicKey,
  });
  let leafUnavailable = false;
  if (eventResult.verified) {
    if (digestsEqual(eventResult.declaredHash as string, base.leaf.hash)) {
      checks.push({ message: "the leaf is this event's integrity hash" });
    } else {
      findings.push({
        kind: "proof-leaf-mismatch",
        message: "the leaf is not this event's integrity hash",
        detail: [`leaf:  ${base.leaf.hash}`, `event: ${eventResult.declaredHash ?? "(none)"}`],
      });
    }
  } else if (
    eventResult.findings.every((finding) => LEAF_UNAVAILABLE.has(finding.kind as EventFindingKind))
  ) {
    leafUnavailable = true;
    findings.push({
      kind: "proof-leaf-unavailable",
      label,
      message: "the event's hash cannot be established, so there is nothing to prove",
      detail: eventResult.findings.map((finding) => `${finding.kind}: ${finding.message}`),
    });
  }

  const eventFailed = !eventResult.verified && !leafUnavailable;
  const proofFailed = findings.some((finding) => finding.kind !== "proof-leaf-unavailable");
  const outcome =
    proofFailed || eventFailed || !positionValid
      ? "failed"
      : leafUnavailable
        ? "no-leaf"
        : "verified";

  return {
    outcome,
    ...base,
    ...(calculatedRoot === undefined ? {} : { calculatedRoot }),
    ...(signature === undefined ? {} : { signature: signature.result }),
    event: eventResult,
    checks,
    findings,
    notes,
  };
}
