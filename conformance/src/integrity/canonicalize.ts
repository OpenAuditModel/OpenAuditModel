/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * Canonicalization is delegated to the `canonicalize` package (Apache-2.0, no
 * dependencies), which implements the scheme by sorting object keys with the
 * ECMAScript default string comparison — UTF-16 code unit order, as RFC 8785
 * §3.2.3 requires — and serialising primitives with `JSON.stringify`, whose
 * number and string handling is the behaviour RFC 8785 §3.2.2.2 and §3.2.2.3
 * are defined against.
 *
 * The guard in this module exists because that package is permissive with
 * values JSON cannot represent: it maps `undefined` inside an array to `null`,
 * drops `undefined` object members, and calls `toJSON` on anything that has it.
 * Silently reinterpreting an input would produce a digest over something other
 * than what the caller passed, so those inputs are rejected instead.
 */
import canonicalizeValue from "canonicalize";
import { CANONICALIZATION_RFC8785, SUPPORTED_CANONICALIZATIONS } from "./types.js";

/**
 * Deepest structure accepted for canonicalization. Canonicalization is
 * recursive, so an arbitrarily deep document would exhaust the stack; audit
 * events are shallow and this bound is far above any realistic event.
 */
export const MAX_JSON_DEPTH = 200;

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

function describePointer(pointer: string): string {
  return pointer === "" ? "the document root" : pointer;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Rejects anything that is not a value `JSON.parse` could have produced.
 *
 * The pointer in the error identifies *where* the problem is, never what the
 * value was, so that a malformed event cannot leak its content through an error
 * message.
 */
export function assertJsonValue(value: unknown, pointer = "", depth = 0): void {
  if (depth > MAX_JSON_DEPTH) {
    throw new CanonicalizationError(
      `structure is nested more than ${MAX_JSON_DEPTH} levels deep at ${describePointer(pointer)}`,
    );
  }

  if (value === null) {
    return;
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(
          `number at ${describePointer(pointer)} is not finite and cannot be canonicalized`,
        );
      }
      return;
    case "object":
      break;
    default:
      throw new CanonicalizationError(
        `value at ${describePointer(pointer)} has type "${typeof value}", which JSON cannot represent`,
      );
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertJsonValue(item, `${pointer}/${index}`, depth + 1);
    }
    return;
  }

  if (!isPlainObject(value as object)) {
    throw new CanonicalizationError(
      `value at ${describePointer(pointer)} is not a plain JSON object`,
    );
  }

  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    if (member === undefined) {
      throw new CanonicalizationError(
        `member "${key}" at ${describePointer(pointer)} is undefined, which JSON cannot represent`,
      );
    }
    assertJsonValue(
      member,
      `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      depth + 1,
    );
  }
}

/** Returns the RFC 8785 canonical form of a JSON value. */
export function canonicalize(value: unknown): string {
  assertJsonValue(value);

  const canonical = canonicalizeValue(value);
  if (typeof canonical !== "string") {
    throw new CanonicalizationError("value could not be canonicalized");
  }

  return canonical;
}

const encoder = new TextEncoder();

/**
 * Returns the UTF-8 encoding of the RFC 8785 canonical form. `Uint8Array`
 * rather than Node's `Buffer`, so the module runs identically in a browser
 * bundle; every Node crypto API this project feeds it to accepts either.
 */
export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

/** True when this verifier implements the declared canonicalization. */
export function isSupportedCanonicalization(identifier: string): boolean {
  return (SUPPORTED_CANONICALIZATIONS as readonly string[]).includes(identifier);
}

export { CANONICALIZATION_RFC8785 };
