/**
 * Verification of a single event's own digest.
 *
 * This proves that the event has not been altered since its digest was
 * calculated. It proves nothing about whether the event was ever stored, is
 * still stored, or belongs to a complete chain.
 */
import type { EventValidator } from "../validate-core.js";
import { CanonicalizationError, isSupportedCanonicalization } from "./canonicalize.js";
import {
  calculateDigest,
  digestByteLength,
  digestsEqual,
  isHexDigest,
  isSupportedHashAlgorithm,
} from "./digest.js";
import {
  SUPPORTED_CANONICALIZATIONS,
  SUPPORTED_HASH_ALGORITHMS,
  type EventVerificationResult,
  type Finding,
  type PassedCheck,
} from "./types.js";

export interface VerifyEventOptions {
  /** Validate against the canonical schema first. Defaults to true. */
  readonly validateSchema?: boolean;
}

/** The integrity object of an event, once it is known to be an object. */
interface IntegrityObject {
  readonly canonicalization?: unknown;
  readonly hashAlgorithm?: unknown;
  readonly hash?: unknown;
  readonly previousHash?: unknown;
  readonly chainId?: unknown;
}

function failure(
  label: string,
  finding: Finding,
  checks: readonly PassedCheck[] = [],
): EventVerificationResult {
  return { label, verified: false, checks, findings: [{ ...finding, label }] };
}

/** Reads the integrity object of an event, or `undefined` when there is none. */
export function readIntegrity(event: unknown): IntegrityObject | undefined {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return undefined;
  }
  const integrity = (event as Record<string, unknown>)["integrity"];
  if (integrity === null || typeof integrity !== "object" || Array.isArray(integrity)) {
    return undefined;
  }
  return integrity as IntegrityObject;
}

/**
 * Verifies that an event's declared `integrity.hash` matches a digest
 * recalculated from the event itself.
 */
export function verifyEventIntegrity(
  event: unknown,
  label: string,
  validator: EventValidator,
  options: VerifyEventOptions = {},
): EventVerificationResult {
  const checks: PassedCheck[] = [];

  if (options.validateSchema !== false) {
    const issues = validator.validateEvent(event);
    if (issues.length > 0) {
      const shown = issues.slice(0, 3).map((issue) => `${issue.path}  ${issue.message}`);
      const detail =
        issues.length > shown.length
          ? [...shown, `and ${issues.length - shown.length} further schema issues`]
          : shown;
      return failure(label, {
        kind: "schema-invalid",
        message: "event does not conform to the canonical schema",
        detail,
      });
    }
    checks.push({ message: "schema valid" });
  }

  const integrity = readIntegrity(event);
  if (integrity === undefined) {
    return failure(
      label,
      {
        kind: "integrity-missing",
        message: "event carries no integrity object, so there is nothing to verify",
        detail: ["integrity is optional in the core model; this command requires it"],
      },
      checks,
    );
  }

  const { canonicalization, hashAlgorithm, hash } = integrity;

  if (typeof hash !== "string") {
    return failure(
      label,
      {
        kind: "hash-missing",
        message: "integrity object declares no hash",
      },
      checks,
    );
  }

  if (typeof canonicalization !== "string") {
    return failure(
      label,
      {
        kind: "canonicalization-missing",
        message: "integrity object declares a hash but no canonicalization",
      },
      checks,
    );
  }

  if (!isSupportedCanonicalization(canonicalization)) {
    return failure(
      label,
      {
        kind: "unsupported-canonicalization",
        message: `canonicalization "${canonicalization}" is not implemented by this verifier`,
        detail: [`implemented: ${SUPPORTED_CANONICALIZATIONS.join(", ")}`],
      },
      checks,
    );
  }
  checks.push({ message: `canonicalization: ${canonicalization}` });

  if (typeof hashAlgorithm !== "string") {
    return failure(
      label,
      {
        kind: "hash-algorithm-missing",
        message: "integrity object declares a hash but no hash algorithm",
      },
      checks,
    );
  }

  if (!isSupportedHashAlgorithm(hashAlgorithm)) {
    return failure(
      label,
      {
        kind: "unsupported-algorithm",
        message: `hash algorithm "${hashAlgorithm}" is not implemented by this verifier`,
        detail: [
          `implemented: ${SUPPORTED_HASH_ALGORITHMS.join(", ")}`,
          "the schema keeps this vocabulary open; acceptance by the schema is not support",
        ],
      },
      checks,
    );
  }
  checks.push({ message: `hash algorithm: ${hashAlgorithm}` });

  if (!isHexDigest(hash)) {
    return failure(
      label,
      {
        kind: "malformed-hash",
        message: "declared hash is not lowercase hexadecimal",
        detail: ["digests are encoded as lowercase hexadecimal; see specification/integrity.md §5"],
      },
      checks,
    );
  }

  const expectedLength = digestByteLength(hashAlgorithm) * 2;
  if (hash.length !== expectedLength) {
    return failure(
      label,
      {
        kind: "digest-length-mismatch",
        message: `declared hash is ${hash.length} characters, but ${hashAlgorithm} produces ${expectedLength}`,
      },
      checks,
    );
  }

  let calculated: string;
  try {
    calculated = calculateDigest(event, hashAlgorithm);
  } catch (cause) {
    const message =
      cause instanceof CanonicalizationError
        ? cause.message
        : `digest could not be calculated: ${(cause as Error).message}`;
    return failure(label, { kind: "canonicalization-failed", message }, checks);
  }

  if (!digestsEqual(hash, calculated)) {
    return {
      label,
      verified: false,
      checks,
      findings: [
        {
          kind: "hash-mismatch",
          label,
          message: "integrity hash mismatch",
          detail: [`declared:   ${hash}`, `calculated: ${calculated}`],
        },
      ],
      canonicalization,
      hashAlgorithm,
      declaredHash: hash,
      calculatedHash: calculated,
    };
  }

  checks.push({ message: "integrity hash valid" });

  return {
    label,
    verified: true,
    checks,
    findings: [],
    canonicalization,
    hashAlgorithm,
    declaredHash: hash,
    calculatedHash: calculated,
  };
}
