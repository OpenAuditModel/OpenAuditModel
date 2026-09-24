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
import {
  constants,
  createPrivateKey,
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
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
 * A private key is refused by name. Node's `createPublicKey` would accept one
 * and derive its public half, and the verdict would be right — but a private
 * key where a public one belongs is a mistake worth saying out loud, and on
 * the MCP server it means the private key was just sent over the network to a
 * public service. The refusal is decided before the text is read as a public
 * key, and the key's text is never repeated.
 *
 * A key that parses but that no signature can be checked against is refused
 * too, with {@link UnusablePublicKeyError}; see {@link unusableKeyReason}.
 */
export function loadPublicKey(pemText: string): KeyObject {
  if (isPrivateKeyText(pemText)) {
    throw new Error(
      "this is a private key; supply the public key that belongs to it (openssl pkey -in private.pem -pubout)",
    );
  }
  let key: KeyObject;
  try {
    key = createPublicKey(pemText);
  } catch (cause) {
    throw new Error(`not a readable public key: ${(cause as Error).message}`, { cause });
  }
  const reason = unusableKeyReason(key);
  if (reason !== undefined) {
    throw new UnusablePublicKeyError(reason);
  }
  return key;
}

/**
 * True when PEM text holds a private key. The label is matched without regard
 * to case, because OpenSSL reads `-----BEGIN rsa PRIVATE KEY-----` as a
 * private key too; anything else OpenSSL would read as one is caught by trying.
 * An encrypted key cannot be read without its passphrase, and its label says
 * what it is.
 */
export function isPrivateKeyText(pemText: string): boolean {
  if (/-----BEGIN [^-\r\n]*PRIVATE KEY-----/i.test(pemText)) {
    return true;
  }
  try {
    createPrivateKey(pemText);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why a parsed public key cannot be used, or `undefined` when it can.
 *
 * - An EC key that is the point at infinity parses, and reading its details
 *   aborts the process: Node asserts inside `asymmetricKeyDetails`. Exporting
 *   it fails cleanly, so the export is the probe, and it runs before anything
 *   reads the details.
 * - An Ed25519 key that is a small-order point verifies a forged signature for
 *   any message.
 * - An RSA key whose public exponent is below 3 or even is not an RSA key a
 *   signature proves anything under: with an exponent of 1, a "signature" is
 *   the encoded message itself.
 */
export function unusableKeyReason(key: KeyObject): string | undefined {
  const type = key.asymmetricKeyType;
  if (type === "ec") {
    try {
      key.export({ type: "spki", format: "der" });
    } catch {
      return "this EC public key is not a point a signature can be checked against, so it is not used";
    }
  }
  if (isSmallOrderEd25519Key(key)) {
    return SMALL_ORDER_KEY_MESSAGE;
  }
  if (type === "rsa" || type === "rsa-pss") {
    const exponent = key.asymmetricKeyDetails?.publicExponent;
    if (exponent === undefined || exponent < 3n || exponent % 2n === 0n) {
      return "this RSA public key's exponent is below 3 or even, under which a signature can be made without the private key, so it is not used";
    }
  }
  return undefined;
}

/**
 * A key that parses but that no signature can be checked against. The message
 * is written here, never by a decoder, so a caller may repeat it.
 */
export class UnusablePublicKeyError extends Error {}

const SMALL_ORDER_KEY_MESSAGE =
  "this Ed25519 public key is a small-order point: nobody holds a private key for it, and a signature that verifies under it can be made for any message, so it is not used";

/**
 * The encodings of the eight points of order 1, 2, 4 and 8 on edwards25519,
 * with the sign bit cleared: seven values, two of them the non-canonical
 * y = p and y = p + 1. It is the list libsodium refuses, derived again for
 * this file by multiplying random points by the prime subgroup order.
 *
 * Some OpenSSL builds Node carries check neither the key nor a signature's R
 * against it, and others do; this verifier does not depend on which. Under
 * the identity point as a key, R = identity and S = 0 verify for every message;
 * under a genuine key, a small-order R is a nonce no honest signer produces.
 * Both are refused, as a strict verifier such as ed25519-dalek's
 * `verify_strict` refuses them.
 */
const SMALL_ORDER_POINTS = [
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
].map((hex) => Buffer.from(hex, "hex"));

/** True when a 32-byte encoded point is one of the small-order points, either sign. */
export function isSmallOrderEd25519Point(encoded: Uint8Array): boolean {
  if (encoded.length !== 32) {
    return false;
  }
  const cleared = Buffer.from(encoded);
  cleared[31] = (cleared[31] as number) & 0x7f;
  return SMALL_ORDER_POINTS.some((point) => point.equals(cleared));
}

/** True when `key` is an Ed25519 public key whose point has small order. */
export function isSmallOrderEd25519Key(key: KeyObject): boolean {
  if (key.asymmetricKeyType !== "ed25519") {
    return false;
  }
  const { x } = key.export({ format: "jwk" });
  return typeof x === "string" && isSmallOrderEd25519Point(Buffer.from(x, "base64url"));
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
  // A key that did not come through loadPublicKey is held to the same rules,
  // and before its details are read: for one of them, reading them aborts.
  const unusable = unusableKeyReason(publicKey);
  if (unusable !== undefined) {
    return { ok: false, kind: "signature-invalid", message: unusable };
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
  const expectedLength = spec.signatureBytes ?? Math.ceil((modulusBits as number) / 8);
  if (signatureBytes.length !== expectedLength) {
    return {
      ok: false,
      kind: "malformed-signature",
      message: `declared signature is ${signatureBytes.length} bytes, but ${algorithm} produces ${expectedLength}`,
    };
  }

  if (algorithm === "Ed25519" && isSmallOrderEd25519Point(signatureBytes.subarray(0, 32))) {
    return {
      ok: false,
      kind: "signature-invalid",
      message:
        "the signature's R is a small-order point, a nonce no honest signer produces, so the signature is not accepted",
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
