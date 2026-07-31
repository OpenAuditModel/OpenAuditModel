/**
 * Recognizers for credential-shaped values.
 *
 * Every pattern is anchored, uses bounded quantifiers and contains no nested
 * quantifier or back-reference, so none can backtrack catastrophically. No
 * pattern uses look-behind, which keeps them portable across engines.
 *
 * A match identifies a value **shaped like** a credential. Nothing here checks
 * whether a credential is real, current or usable, and no matched value is ever
 * returned to a caller: the functions answer yes or no, so that a value cannot
 * leak into a report by accident.
 *
 * The prefixes below are published by the systems that issue them. Recognising
 * them is a property of this linter, not of the OpenAuditModel data model: the
 * specification and the canonical schema remain vendor-neutral, and no rule here
 * introduces a field, vocabulary or concept into the model.
 */
import { RULES } from "./rules.js";

/**
 * `Scheme <credential>`, as an HTTP authorization header value.
 *
 * The credential must be at least 16 characters of credential alphabet and the
 * whole string must be exactly two whitespace-separated parts, so that ordinary
 * prose beginning with one of these words is not matched.
 */
const AUTHORIZATION_HEADER =
  /^(?:Bearer|Basic|Digest|ApiKey|Token)\s+[A-Za-z0-9._~+/=-]{16,4096}$/i;

/** PEM markers that introduce private key material. Public material is excluded. */
const PRIVATE_KEY_MARKERS: readonly string[] = [
  "BEGIN PRIVATE KEY",
  "BEGIN RSA PRIVATE KEY",
  "BEGIN DSA PRIVATE KEY",
  "BEGIN EC PRIVATE KEY",
  "BEGIN OPENSSH PRIVATE KEY",
  "BEGIN PGP PRIVATE KEY BLOCK",
  "BEGIN ENCRYPTED PRIVATE KEY",
];

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]{4,8192}$/;

/** Published credential prefixes, each with the rule that reports it. */
const PREFIXED_TOKEN_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly ruleId: string;
}> = [
  // Access key identifiers: a 4-character prefix and 16 upper-case characters.
  { pattern: /^(?:AKIA|ASIA)[A-Z0-9]{16}$/, ruleId: RULES.AWS_ACCESS_KEY_ID.id },
  // Personal, OAuth, user, server and refresh tokens, and fine-grained tokens.
  { pattern: /^gh[pousr]_[A-Za-z0-9]{36,255}$/, ruleId: RULES.GITHUB_TOKEN.id },
  { pattern: /^github_pat_[A-Za-z0-9_]{22,255}$/, ruleId: RULES.GITHUB_TOKEN.id },
  { pattern: /^glpat-[A-Za-z0-9_-]{20,255}$/, ruleId: RULES.GITLAB_TOKEN.id },
  { pattern: /^xox[abprs]-[A-Za-z0-9-]{10,255}$/, ruleId: RULES.SLACK_TOKEN.id },
  { pattern: /^(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}$/, ruleId: RULES.PAYMENT_SECRET_KEY.id },
  { pattern: /^AIza[A-Za-z0-9_-]{35}$/, ruleId: RULES.CLOUD_API_KEY.id },
];

/** True when a value is shaped like an authorization header credential. */
export function matchesAuthorizationHeader(value: string): boolean {
  return AUTHORIZATION_HEADER.test(value.trim());
}

/**
 * True when a value contains a private key marker. Matching is a plain substring
 * search, so there is no pattern to backtrack, and public certificates and
 * public keys never match because their markers do not contain `PRIVATE KEY`.
 */
export function containsPrivateKeyMaterial(value: string): boolean {
  return PRIVATE_KEY_MARKERS.some((marker) => value.includes(marker));
}

/**
 * True when a value is structured as a JSON Web Token.
 *
 * Three dot-separated segments alone are not enough: arbitrary data splits that
 * way too. The header and payload must decode from base64url to JSON **objects**
 * and the header must declare an algorithm, which is what JWS requires.
 *
 * The signature is never checked, the decoded values are never returned, and no
 * claim ever reaches a report.
 */
export function isJwtStructured(value: string): boolean {
  const segments = value.split(".");
  if (segments.length !== 3) {
    return false;
  }

  const [header, payload] = segments;
  if (header === undefined || payload === undefined) {
    return false;
  }
  if (!BASE64URL_SEGMENT.test(header) || !BASE64URL_SEGMENT.test(payload)) {
    return false;
  }

  const decodedHeader = decodeJsonObject(header);
  if (decodedHeader === undefined || typeof decodedHeader["alg"] !== "string") {
    return false;
  }

  return decodeJsonObject(payload) !== undefined;
}

/** Decodes a base64url segment to a JSON object, or `undefined`. Never returns content to a report. */
function decodeJsonObject(segment: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = Buffer.from(segment, "base64url").toString("utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Returns the rule identifier for a published credential format, or
 * `undefined`. The matched value is never returned.
 */
export function matchKnownTokenFormat(value: string): string | undefined {
  if (isJwtStructured(value)) {
    return RULES.JWT_TOKEN.id;
  }
  for (const { pattern, ruleId } of PREFIXED_TOKEN_PATTERNS) {
    if (pattern.test(value)) {
      return ruleId;
    }
  }
  return undefined;
}
