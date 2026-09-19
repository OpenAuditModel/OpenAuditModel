/**
 * Shared types and constants for tamper-evidence verification.
 *
 * The tooling detects specific integrity failures. It does not prevent deletion
 * or modification, and it makes no claim that an event is immutable,
 * tamper-proof, legally binding or non-repudiable.
 */

/** Canonicalization identifier the v0.1 verifier implements: RFC 8785 JCS. */
export const CANONICALIZATION_RFC8785 = "RFC8785";

/** Canonicalization identifiers this verifier can execute. Matching is case-sensitive. */
export const SUPPORTED_CANONICALIZATIONS = [CANONICALIZATION_RFC8785] as const;

/**
 * Hash algorithms this verifier can execute, as normative identifiers.
 *
 * The schema keeps `integrity.hashAlgorithm` an open vocabulary so that new
 * algorithms can be adopted without a specification change. An identifier the
 * schema accepts is therefore not necessarily one this verifier implements: an
 * event declaring an algorithm outside this list is reported as
 * `unsupported-algorithm` rather than silently treated as verified.
 */
export const SUPPORTED_HASH_ALGORITHMS = ["SHA-256", "SHA-384", "SHA-512"] as const;

export type SupportedHashAlgorithm = (typeof SUPPORTED_HASH_ALGORITHMS)[number];

/** Digest length in bytes for each supported algorithm. */
export const DIGEST_BYTE_LENGTHS: Readonly<Record<SupportedHashAlgorithm, number>> = {
  "SHA-256": 32,
  "SHA-384": 48,
  "SHA-512": 64,
};

/**
 * Signature algorithms this verifier can execute, as normative identifiers.
 *
 * `integrity.signature.algorithm` is an open vocabulary for the same reason
 * `hashAlgorithm` is: schema acceptance is not verifier support. The three the
 * schema's own description recommends are implemented; anything else is
 * reported `unsupported-signature-algorithm`, never silently treated as
 * verified. All three come from Node's `crypto` module and add no dependency.
 */
export const SUPPORTED_SIGNATURE_ALGORITHMS = [
  "Ed25519",
  "ECDSA-P256-SHA256",
  "RSA-PSS-SHA256",
] as const;

export type SupportedSignatureAlgorithm = (typeof SUPPORTED_SIGNATURE_ALGORITHMS)[number];

/**
 * What each algorithm requires of a key and of a signature value. The verifier
 * checks these before the primitive runs, so that a key of the wrong type or a
 * value of the wrong length is reported as what it is rather than as
 * "signature does not match".
 */
export interface SignatureAlgorithmSpec {
  /** Node `asymmetricKeyType` values a matching public key may report. */
  readonly keyTypes: readonly string[];
  /** Required named curve, for elliptic-curve keys. */
  readonly namedCurve?: string;
  /** Smallest modulus this verifier accepts, for RSA keys. */
  readonly minimumModulusBits?: number;
  /** Signature length in bytes when the scheme fixes it; RSA's is the modulus length. */
  readonly signatureBytes?: number;
}

export const SIGNATURE_ALGORITHMS: Readonly<
  Record<SupportedSignatureAlgorithm, SignatureAlgorithmSpec>
> = {
  Ed25519: { keyTypes: ["ed25519"], signatureBytes: 64 },
  // IEEE P1363 encoding (r ‖ s), so the length is fixed and checkable. DER
  // would make the same signature 70 to 72 bytes and the check meaningless.
  "ECDSA-P256-SHA256": { keyTypes: ["ec"], namedCurve: "prime256v1", signatureBytes: 64 },
  "RSA-PSS-SHA256": { keyTypes: ["rsa", "rsa-pss"], minimumModulusBits: 2048 },
};

/**
 * JSON Pointers removed from an event before its digest is calculated.
 *
 * Everything else, including `sequence`, `integrity.previousHash`,
 * `integrity.chainId`, `integrity.batchId`, `integrity.hashAlgorithm` and
 * `integrity.canonicalization`, is part of the digest input.
 */
export const DIGEST_EXCLUDED_POINTERS = ["/integrity/hash", "/integrity/signature"] as const;

/** Why a single event failed verification. */
export type EventFindingKind =
  | "schema-invalid"
  | "integrity-missing"
  | "hash-missing"
  | "hash-algorithm-missing"
  | "canonicalization-missing"
  | "unsupported-canonicalization"
  | "unsupported-algorithm"
  | "malformed-hash"
  | "digest-length-mismatch"
  | "hash-mismatch"
  | "canonicalization-failed"
  | "unsupported-signature-algorithm"
  | "malformed-signature"
  | "signature-invalid";

/** Why a chain failed verification. */
export type ChainFindingKind =
  | "chain-id-missing"
  | "sequence-missing"
  | "duplicate-sequence"
  | "previous-hash-missing"
  | "broken-link"
  | "algorithm-mismatch";

export type FindingKind = EventFindingKind | ChainFindingKind;

/** A single reason verification did not succeed. */
export interface Finding {
  readonly kind: FindingKind;
  /** One line, safe to print. Never contains event content. */
  readonly message: string;
  /** Ordered detail lines, such as the declared and calculated digests. */
  readonly detail?: readonly string[];
  /** Where the problem was found, when it applies to one event. */
  readonly label?: string;
}

/** An informational observation that does not by itself fail verification. */
export interface Note {
  readonly message: string;
  readonly detail?: readonly string[];
}

/** A check that passed, reported so that a successful run says what it proved. */
export interface PassedCheck {
  readonly message: string;
}

/** Outcome of verifying one event's own digest. */
export interface EventVerificationResult {
  readonly label: string;
  readonly verified: boolean;
  readonly checks: readonly PassedCheck[];
  readonly findings: readonly Finding[];
  readonly canonicalization?: string;
  readonly hashAlgorithm?: string;
  readonly declaredHash?: string;
  readonly calculatedHash?: string;
}

/** Outcome of verifying one chain. */
export interface ChainVerificationResult {
  readonly chainId: string;
  readonly eventCount: number;
  readonly firstSequence?: number;
  readonly lastSequence?: number;
  readonly intact: boolean;
  readonly checks: readonly PassedCheck[];
  readonly findings: readonly Finding[];
  readonly notes: readonly Note[];
}

/** Outcome of verifying every chain in a supplied set of events. */
export interface ChainReport {
  readonly chains: readonly ChainVerificationResult[];
  /** Events that could not be assigned to a chain at all. */
  readonly unassigned: readonly Finding[];
  readonly eventCount: number;
  readonly intact: boolean;
}
