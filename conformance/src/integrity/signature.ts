/**
 * Signature verification.
 *
 * Verifies `integrity.signature.value` against the same canonicalized digest
 * input used for `integrity.hash` (specification/integrity.md §4), using a
 * public key supplied out of band, for the three algorithms the schema's own
 * description recommends: Ed25519, ECDSA-P256-SHA256 and RSA-PSS-SHA256. The
 * key's type, curve and size must match the declared algorithm and are checked
 * before the primitive runs. No key registry or trust store exists:
 * `integrity.signature.keyId` identifies a key for a human or an external
 * system to resolve, and is never dereferenced by this verifier.
 */
import { constants, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { canonicalBytes } from "./canonicalize.js";
import { buildDigestInput } from "./digest.js";
import {
  SIGNATURE_ALGORITHMS,
  SUPPORTED_SIGNATURE_ALGORITHMS,
  type DocumentSignatureResult,
  type Finding,
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
  return verifySignature(canonicalBytes(buildDigestInput(event)), algorithm, value, publicKey);
}

/**
 * The input a document-level signature covers: a deep clone of the document
 * with `/signature` removed and nothing else touched. A checkpoint is signed
 * this way — the same procedure as an event, with the pointer at the root.
 */
export function documentSignatureInput(document: unknown): unknown {
  const clone = structuredClone(document);
  if (clone !== null && typeof clone === "object" && !Array.isArray(clone)) {
    delete (clone as Record<string, unknown>)["signature"];
  }
  return clone;
}

/** Verifies a document-level `signature`, such as a checkpoint's, under the event rules. */
export function verifyDocumentSignature(
  document: unknown,
  algorithm: string,
  value: string,
  publicKey: KeyObject,
): SignatureCheckResult {
  return verifySignature(
    canonicalBytes(documentSignatureInput(document)),
    algorithm,
    value,
    publicKey,
  );
}

/**
 * Checks a document's declared `signature`, when it has one, the three ways a
 * declared signature is always reported: failed for an algorithm this
 * verifier does not implement whether or not a key is supplied; declared but
 * not checked without a key; verified with one. Returns `undefined` only when
 * no signature is declared. `label` names the document in the finding.
 */
export function checkDeclaredDocumentSignature(
  document: unknown,
  publicKey: KeyObject | undefined,
  label: string,
): { readonly result: DocumentSignatureResult; readonly finding?: Finding } | undefined {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return undefined;
  }
  const declared = (document as Record<string, unknown>)["signature"];
  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) {
    return undefined;
  }
  const algorithm = (declared as Record<string, unknown>)["algorithm"];
  const value = (declared as Record<string, unknown>)["value"];
  if (typeof algorithm !== "string" || typeof value !== "string") {
    return undefined;
  }

  if (!isSupportedSignatureAlgorithm(algorithm)) {
    const message = `signature algorithm "${algorithm}" is not implemented by this verifier`;
    return {
      result: { algorithm, status: "invalid", message },
      finding: { kind: "unsupported-signature-algorithm", label, message },
    };
  }
  if (publicKey === undefined) {
    return {
      result: {
        algorithm,
        status: "not-checked",
        message: `signature declared (${algorithm}), not checked: no public key was supplied`,
      },
    };
  }
  const outcome = verifyDocumentSignature(document, algorithm, value, publicKey);
  if (outcome.ok) {
    return { result: { algorithm, status: "valid", message: `signature valid (${algorithm})` } };
  }
  return {
    result: { algorithm, status: "invalid", message: outcome.message },
    finding: { kind: outcome.kind, label, message: outcome.message },
  };
}

function verifySignature(
  data: Uint8Array,
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

  const spec = SIGNATURE_ALGORITHMS[algorithm];
  const keyType = publicKey.asymmetricKeyType ?? "of an unrecognised type";
  if (!spec.keyTypes.includes(keyType)) {
    return {
      ok: false,
      kind: "signature-invalid",
      message: `the supplied public key is ${keyType}, but ${algorithm} needs ${spec.keyTypes.join(" or ")}`,
    };
  }
  const details = publicKey.asymmetricKeyDetails ?? {};
  if (spec.namedCurve !== undefined && details.namedCurve !== spec.namedCurve) {
    return {
      ok: false,
      kind: "signature-invalid",
      message: `the supplied public key is on curve ${details.namedCurve ?? "unknown"}, but ${algorithm} needs ${spec.namedCurve}`,
    };
  }
  const modulusBits = details.modulusLength;
  if (
    spec.minimumModulusBits !== undefined &&
    (modulusBits === undefined || modulusBits < spec.minimumModulusBits)
  ) {
    return {
      ok: false,
      kind: "signature-invalid",
      message: `the supplied public key has a ${modulusBits ?? "unknown"}-bit modulus, but ${algorithm} needs at least ${spec.minimumModulusBits}`,
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
  // Two schemes fix their length; an RSA signature is exactly one modulus long.
  const expectedLength = spec.signatureBytes ?? (modulusBits as number) / 8;
  if (signatureBytes.length !== expectedLength) {
    return {
      ok: false,
      kind: "malformed-signature",
      message: `declared signature is ${signatureBytes.length} bytes, but ${algorithm} produces ${expectedLength}`,
    };
  }

  let valid: boolean;
  try {
    valid = verifyWithPrimitive(algorithm, data, publicKey, signatureBytes);
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

/**
 * The one place each scheme's primitive is named. Ed25519 fixes its own digest
 * and Node rejects a non-null algorithm argument for it. ECDSA is verified
 * over SHA-256 with the fixed-length IEEE P1363 encoding this verifier
 * requires. RSA-PSS is verified over SHA-256 with the salt length recovered
 * from the signature itself (`RSA_PSS_SALTLEN_AUTO`): a signer's salt choice
 * is the signer's.
 */
function verifyWithPrimitive(
  algorithm: SupportedSignatureAlgorithm,
  data: Uint8Array,
  publicKey: KeyObject,
  signature: Uint8Array,
): boolean {
  switch (algorithm) {
    case "Ed25519":
      return cryptoVerify(null, data, publicKey, signature);
    case "ECDSA-P256-SHA256":
      return cryptoVerify("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
    case "RSA-PSS-SHA256":
      return cryptoVerify(
        "sha256",
        data,
        {
          key: publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_AUTO,
        },
        signature,
      );
  }
}

export { SUPPORTED_SIGNATURE_ALGORITHMS, type SupportedSignatureAlgorithm };
