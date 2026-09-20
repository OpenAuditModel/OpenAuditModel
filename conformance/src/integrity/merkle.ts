/**
 * Merkle tree hashing for inclusion proofs, as RFC 6962 §2.1 defines it.
 *
 * A leaf is `H(0x00 ‖ d)` where `d` is the event's `integrity.hash` decoded
 * from hexadecimal; an interior node is `H(0x01 ‖ left ‖ right)`. The prefixes
 * keep a leaf from ever colliding with a node, which is what makes a
 * second-preimage construction against the tree impossible. A tree over `n`
 * leaves splits at `k`, the largest power of two smaller than `n`; an odd
 * node at any level is promoted unchanged, never duplicated. That is RFC
 * 6962's rule, chosen so that no implementer has to reverse-engineer a tree
 * from this repository's code.
 *
 * An audit path lists the sibling hashes from the leaf upward, each with the
 * side the sibling sits on. Given the leaf's index and the tree's size those
 * sides are fully determined, so a verifier can check a path's shape as well
 * as its hashes.
 */
import { digestBytes, digestByteLength, isHexDigest } from "./digest.js";
import type { SupportedHashAlgorithm } from "./types.js";

/** Which side of the current node an audit-path sibling sits on. */
export type PathSide = "left" | "right";

/** One step of an audit path: the sibling hash, as hexadecimal, and its side. */
export interface PathStep {
  readonly side: PathSide;
  readonly hash: string;
}

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

/** The largest power of two strictly smaller than `n`, for `n >= 2`. */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) {
    k *= 2;
  }
  return k;
}

/** Decodes a hexadecimal digest, requiring the algorithm's exact length. */
export function decodeDigest(algorithm: SupportedHashAlgorithm, hex: string): Buffer | undefined {
  if (!isHexDigest(hex) || hex.length !== digestByteLength(algorithm) * 2) {
    return undefined;
  }
  return Buffer.from(hex, "hex");
}

/** `H(0x00 ‖ digest)`: the leaf hash of an event whose `integrity.hash` is `digest`. */
export function leafHash(algorithm: SupportedHashAlgorithm, digest: Uint8Array): Buffer {
  return digestBytes(algorithm, LEAF_PREFIX, digest);
}

/** `H(0x01 ‖ left ‖ right)`: an interior node. */
export function nodeHash(
  algorithm: SupportedHashAlgorithm,
  left: Uint8Array,
  right: Uint8Array,
): Buffer {
  return digestBytes(algorithm, NODE_PREFIX, left, right);
}

/** The Merkle tree hash over leaf hashes already computed with {@link leafHash}. */
function treeHash(algorithm: SupportedHashAlgorithm, leaves: readonly Uint8Array[]): Buffer {
  if (leaves.length === 1) {
    return Buffer.from(leaves[0] as Uint8Array);
  }
  const k = splitPoint(leaves.length);
  return nodeHash(
    algorithm,
    treeHash(algorithm, leaves.slice(0, k)),
    treeHash(algorithm, leaves.slice(k)),
  );
}

/** The root of the tree over event digests, given as hexadecimal `integrity.hash` values. */
export function merkleRoot(algorithm: SupportedHashAlgorithm, digests: readonly string[]): Buffer {
  if (digests.length === 0) {
    throw new Error("a Merkle tree needs at least one leaf");
  }
  return treeHash(
    algorithm,
    digests.map((digest) => leafHash(algorithm, mustDecode(algorithm, digest))),
  );
}

function mustDecode(algorithm: SupportedHashAlgorithm, hex: string): Buffer {
  const decoded = decodeDigest(algorithm, hex);
  if (decoded === undefined) {
    throw new Error(`not a ${algorithm} digest in hexadecimal: ${hex}`);
  }
  return decoded;
}

function pathOver(
  algorithm: SupportedHashAlgorithm,
  leaves: readonly Uint8Array[],
  index: number,
): PathStep[] {
  if (leaves.length === 1) {
    return [];
  }
  const k = splitPoint(leaves.length);
  if (index < k) {
    return [
      ...pathOver(algorithm, leaves.slice(0, k), index),
      { side: "right", hash: treeHash(algorithm, leaves.slice(k)).toString("hex") },
    ];
  }
  return [
    ...pathOver(algorithm, leaves.slice(k), index - k),
    { side: "left", hash: treeHash(algorithm, leaves.slice(0, k)).toString("hex") },
  ];
}

/** The audit path for the leaf at `index`, from the leaf upward. */
export function auditPath(
  algorithm: SupportedHashAlgorithm,
  digests: readonly string[],
  index: number,
): PathStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= digests.length) {
    throw new Error(`leaf index ${index} is outside a tree of ${digests.length} leaves`);
  }
  return pathOver(
    algorithm,
    digests.map((digest) => leafHash(algorithm, mustDecode(algorithm, digest))),
    index,
  );
}

/**
 * The sides an audit path must have for the leaf at `index` in a tree of
 * `leafCount` leaves, from the leaf upward. A path with other sides, or
 * another length, is a path for a different position.
 */
export function expectedSides(index: number, leafCount: number): PathSide[] {
  if (leafCount === 1) {
    return [];
  }
  const k = splitPoint(leafCount);
  if (index < k) {
    return [...expectedSides(index, k), "right"];
  }
  return [...expectedSides(index - k, leafCount - k), "left"];
}

/**
 * Recomputes the root from a leaf digest along an audit path. Returns
 * `undefined` when a sibling hash is not a digest of the algorithm's length.
 */
export function rootFromPath(
  algorithm: SupportedHashAlgorithm,
  leafDigest: Uint8Array,
  path: readonly PathStep[],
): Buffer | undefined {
  let current = leafHash(algorithm, leafDigest);
  for (const step of path) {
    const sibling = decodeDigest(algorithm, step.hash);
    if (sibling === undefined) {
      return undefined;
    }
    current =
      step.side === "left"
        ? nodeHash(algorithm, sibling, current)
        : nodeHash(algorithm, current, sibling);
  }
  return current;
}
