/**
 * Property names that look like credentials, kept out of every report.
 *
 * A finding carries a JSON Pointer, and a pointer is built from property
 * names — so a token used as a key (`metadata.sessions["ghp_…"]`) came back
 * verbatim in the path of any finding beneath it, and in a schema error that
 * quoted an unknown property. The project promises that a finding never
 * carries the value that produced it; a key is where that promise leaked.
 * The same tests that decide whether a string value is credential-shaped
 * decide it for a key, and a key that fails them is reported as
 * {@link REDACTED_SEGMENT} wherever it would have been printed.
 */
import { isHighEntropyTokenCandidate } from "./entropy.js";
import { analyzeConnectionString, analyzeUrl } from "./url-analysis.js";
import {
  containsPrivateKeyMaterial,
  isJwtStructured,
  matchesAuthorizationHeader,
  matchKnownTokenFormat,
} from "./token-patterns.js";

/** What a credential-shaped property name is replaced with. */
export const REDACTED_SEGMENT = "<redacted>";

/** True when a string has the shape of a credential by the linter's own rules. */
export function isCredentialShaped(text: string): boolean {
  return (
    matchKnownTokenFormat(text) !== undefined ||
    isJwtStructured(text) ||
    containsPrivateKeyMaterial(text) ||
    matchesAuthorizationHeader(text) ||
    isHighEntropyTokenCandidate(text) ||
    analyzeUrl(text)?.hasUserinfo === true ||
    analyzeConnectionString(text) === "credentialed"
  );
}

/** A property name as it may be printed. */
export function redactKey(key: string): string {
  return isCredentialShaped(key) ? REDACTED_SEGMENT : key;
}

/** A JSON Pointer with every credential-shaped segment replaced. */
export function redactPointer(pointer: string): string {
  if (pointer === "" || pointer === "/") {
    return pointer;
  }
  return pointer
    .split("/")
    .map((segment, index) => {
      if (index === 0) return segment;
      const decoded = segment.replaceAll("~1", "/").replaceAll("~0", "~");
      return isCredentialShaped(decoded) ? REDACTED_SEGMENT : segment;
    })
    .join("/");
}
