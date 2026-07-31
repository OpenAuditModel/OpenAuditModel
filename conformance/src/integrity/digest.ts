/**
 * Event digest calculation and comparison.
 *
 * The procedure implemented here is normative and is specified in
 * specification/integrity.md §4. It is deterministic: the same event produces
 * the same digest in any conforming implementation, in any language.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalBytes, canonicalize } from "./canonicalize.js";
import {
  DIGEST_BYTE_LENGTHS,
  DIGEST_EXCLUDED_POINTERS,
  SUPPORTED_HASH_ALGORITHMS,
  type SupportedHashAlgorithm,
} from "./types.js";

/** Lowercase hexadecimal, an even number of digits. The only accepted digest encoding. */
const HEX_DIGEST = /^([0-9a-f]{2})+$/;

/** Node's digest name for each normative OpenAuditModel algorithm identifier. */
const NODE_HASH_NAMES: Readonly<Record<SupportedHashAlgorithm, string>> = {
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
};

/**
 * True when this verifier implements the declared algorithm. Matching is
 * case-sensitive: `sha256` is not `SHA-256`, and reinterpreting it would mean
 * guessing at what a producer meant.
 */
export function isSupportedHashAlgorithm(algorithm: string): algorithm is SupportedHashAlgorithm {
  return (SUPPORTED_HASH_ALGORITHMS as readonly string[]).includes(algorithm);
}

/** Digest length in bytes for a supported algorithm. */
export function digestByteLength(algorithm: SupportedHashAlgorithm): number {
  return DIGEST_BYTE_LENGTHS[algorithm];
}

/** True when a value is a well-formed lowercase hexadecimal digest. */
export function isHexDigest(value: unknown): value is string {
  return typeof value === "string" && HEX_DIGEST.test(value);
}

/**
 * Builds the digest input: a deep clone of the event with the self-referential
 * integrity members removed.
 *
 * Exactly two JSON Pointers are removed, `/integrity/hash` and
 * `/integrity/signature`. No other member is removed and no empty container is
 * pruned, so an `integrity` object left with no members is serialised as `{}`.
 * That rule is arbitrary but it must be fixed, because a producer that pruned
 * it and a verifier that did not would compute different digests.
 *
 * The input event is never mutated.
 */
export function buildDigestInput(event: unknown): unknown {
  const clone = structuredClone(event);

  if (clone !== null && typeof clone === "object" && !Array.isArray(clone)) {
    const record = clone as Record<string, unknown>;
    const integrity = record["integrity"];
    if (integrity !== null && typeof integrity === "object" && !Array.isArray(integrity)) {
      const integrityRecord = integrity as Record<string, unknown>;
      for (const pointer of DIGEST_EXCLUDED_POINTERS) {
        const member = pointer.slice("/integrity/".length);
        delete integrityRecord[member];
      }
    }
  }

  return clone;
}

/** Returns the RFC 8785 canonical form of the digest input, for diagnostics and tests. */
export function canonicalDigestInput(event: unknown): string {
  return canonicalize(buildDigestInput(event));
}

/**
 * Calculates an event's digest and returns it as lowercase hexadecimal.
 *
 * Throws for an algorithm this verifier does not implement; callers that need
 * to report rather than throw should check `isSupportedHashAlgorithm` first.
 */
export function calculateDigest(event: unknown, algorithm: string): string {
  if (!isSupportedHashAlgorithm(algorithm)) {
    throw new Error(
      `unsupported hash algorithm "${algorithm}"; this verifier implements ${SUPPORTED_HASH_ALGORITHMS.join(", ")}`,
    );
  }

  const bytes = canonicalBytes(buildDigestInput(event));
  return createHash(NODE_HASH_NAMES[algorithm]).update(bytes).digest("hex");
}

/**
 * Returns a copy of an event with `integrity.hash` set to its calculated
 * digest.
 *
 * The event must already declare `integrity.canonicalization` and
 * `integrity.hashAlgorithm`, because both are part of the digest input: a
 * producer that let the tooling choose them would be sealing a claim it never
 * made. This is a producer-side convenience for tests, fixtures and future
 * libraries; it performs no signing and touches no key material.
 */
export function sealEvent<T>(event: T): T {
  const integrity = (event as Record<string, unknown> | null)?.["integrity"];
  if (integrity === null || typeof integrity !== "object" || Array.isArray(integrity)) {
    throw new Error("cannot seal an event that declares no integrity object");
  }

  const record = integrity as Record<string, unknown>;
  const canonicalization = record["canonicalization"];
  const algorithm = record["hashAlgorithm"];

  if (typeof canonicalization !== "string") {
    throw new Error("cannot seal an event that declares no integrity.canonicalization");
  }
  if (typeof algorithm !== "string") {
    throw new Error("cannot seal an event that declares no integrity.hashAlgorithm");
  }

  const hash = calculateDigest(event, algorithm);
  return { ...(event as object), integrity: { ...record, hash } } as T;
}

/**
 * Compares two digests as bytes, in constant time for equal-length inputs.
 *
 * A digest is not a secret, so this is defence in depth rather than a
 * requirement; what matters more is that a malformed value is rejected instead
 * of being coerced. `Buffer.from(value, "hex")` truncates silently on invalid
 * input, so both values are checked against the accepted encoding first.
 */
export function digestsEqual(left: string, right: string): boolean {
  if (!isHexDigest(left) || !isHexDigest(right)) {
    return false;
  }

  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  return timingSafeEqual(leftBytes, rightBytes);
}

export { SUPPORTED_HASH_ALGORITHMS, type SupportedHashAlgorithm };
