/**
 * Signature verification.
 *
 * Verifies `integrity.signature.value` against the same canonicalized digest
 * input used for `integrity.hash` (specification/integrity.md §4), using a
 * public key supplied out of band. v0.1 defines no key registry or trust
 * store: `integrity.signature.keyId` identifies a key for a human or an
 * external system to resolve, and is never dereferenced by this verifier.
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { canonicalBytes } from "./canonicalize.js";
import { buildDigestInput } from "./digest.js";
import {
  SIGNATURE_BYTE_LENGTHS,
  SUPPORTED_SIGNATURE_ALGORITHMS,
  type SupportedSignatureAlgorithm,
} from "./types.js";

/**
 * Signature value encoding this verifier accepts: standard base64, padded.
 * The schema's `digest` type also permits hexadecimal and base64url, because
 * `signature.value` is often echoed from whatever system produced it — but a
 * value this verifier claims to check must be decoded unambiguously, so it
 * narrows to the one encoding it expects rather than guessing among three.
 */
const BASE64_SIGNATURE = /^[A-Za-z0-9+/]+=*$/;

/** True when this verifier implements the declared signature algorithm. */
export function isSupportedSignatureAlgorithm(
  algorithm: string,
): algorithm is SupportedSignatureAlgorithm {
  return (SUPPORTED_SIGNATURE_ALGORITHMS as readonly string[]).includes(algorithm);
}

/**
 * Parses a public key from PEM text (SPKI, the format Node's own
 * `KeyObject.export({ type: "spki", format: "pem" })` produces).
 *
 * Node's `createPublicKey` also accepts a private key and derives its public
 * half — pointing `--public-key` at a private key file by mistake therefore
 * still verifies correctly rather than failing loudly, since the derived key
 * is the genuine public counterpart. That is Node's behaviour to rely on, not
 * a gap to work around: there is no reliable way to tell "this PEM was a
 * public key" from "this PEM was a private key whose public half was just
 * derived" after the fact, and the derived key is never wrong.
 */
export function loadPublicKey(pemText: string): KeyObject {
  try {
    return createPublicKey(pemText);
  } catch (cause) {
    throw new Error(`not a readable public key: ${(cause as Error).message}`, { cause });
  }
}

export type SignatureCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind:
        "unsupported-signature-algorithm" | "malformed-signature" | "signature-invalid";
      readonly message: string;
    };

/**
 * Verifies `integrity.signature` against `event`, canonicalized the same way
 * `integrity.hash` is: `/integrity/hash` and `/integrity/signature` excluded,
 * everything else — including `sequence`, `previousHash` and `chainId` —
 * included. A chain's links are therefore covered by the signature too, not
 * only by the hash.
 */
export function verifyEventSignature(
  event: unknown,
  algorithm: string,
  value: string,
  publicKey: KeyObject,
): SignatureCheckResult {
  if (!isSupportedSignatureAlgorithm(algorithm)) {
    return {
      ok: false,
      kind: "unsupported-signature-algorithm",
      message: `signature algorithm "${algorithm}" is not implemented by this verifier`,
    };
  }

  if (publicKey.asymmetricKeyType !== "ed25519") {
    return {
      ok: false,
      kind: "signature-invalid",
      message: `the supplied public key is ${publicKey.asymmetricKeyType ?? "of an unrecognised type"}, not ed25519`,
    };
  }

  if (!BASE64_SIGNATURE.test(value)) {
    return {
      ok: false,
      kind: "malformed-signature",
      message: "declared signature value is not base64, the encoding this verifier expects",
    };
  }

  const signatureBytes = Buffer.from(value, "base64");
  const expectedLength = SIGNATURE_BYTE_LENGTHS[algorithm];
  if (signatureBytes.length !== expectedLength) {
    return {
      ok: false,
      kind: "malformed-signature",
      message: `declared signature is ${signatureBytes.length} bytes, but ${algorithm} produces ${expectedLength}`,
    };
  }

  const data = canonicalBytes(buildDigestInput(event));

  let valid: boolean;
  try {
    // The algorithm argument must be null for Ed25519/Ed448: the digest
    // algorithm is fixed by the signature scheme itself, not selectable per
    // call, and Node rejects a non-null value here.
    valid = cryptoVerify(null, data, publicKey, signatureBytes);
  } catch {
    // A degenerate or non-canonical encoded point can make the underlying
    // primitive fail rather than cleanly return false. The message is fixed,
    // never the library's own, for the same reason loadPublicKey's caller
    // does not forward its parse error: an MCP caller receives this Finding
    // directly, and nothing an external decoder writes should reach them.
    return {
      ok: false,
      kind: "signature-invalid",
      message: "signature could not be verified: the supplied key or signature is malformed",
    };
  }

  return valid
    ? { ok: true }
    : { ok: false, kind: "signature-invalid", message: "signature does not match" };
}

export { SUPPORTED_SIGNATURE_ALGORITHMS, type SupportedSignatureAlgorithm };
