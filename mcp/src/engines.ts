/**
 * The single place where the server binds to the conformance engines.
 *
 * The engines are not reimplemented here and are not copied. The server is an
 * adapter: it supplies a validator built from a precompiled schema, and a
 * profile parsed from the bundled manifest, and then calls the same functions
 * the command line tool calls. Any divergence between the two would be a bug in
 * this file, not in an engine, which is what the parity tests check.
 */
import type { ValidateFunction } from "ajv";
import {
  createValidatorFromCompiled,
  SCHEMA_ID,
  SPEC_VERSION,
  type EventValidator,
} from "../../conformance/src/validator-interface.js";
import type { ProfileDefinition } from "../../conformance/src/profiles/types.js";
import validateAuditEvent from "./schema-validator.generated.js";
import { BUNDLED_RESOURCES } from "./resource-manifest.generated.js";

export { SCHEMA_ID, SPEC_VERSION };

/**
 * The canonical validator, built from Ajv's own ahead-of-time compiled code.
 *
 * servers forbid runtime code generation, so `ajv.compile()` cannot run here.
 * The generated module is Ajv's output for the canonical schema, which is why
 * this validator agrees with the command line one exactly rather than
 * approximately.
 */
export const validator: EventValidator = createValidatorFromCompiled(
  validateAuditEvent as unknown as ValidateFunction,
  SCHEMA_ID,
);

export const IAM_PROFILE_NAME = "identity-and-access-management";
export const DOCUMENT_PROFILE_NAME = "document-management";

/**
 * The profiles this server can enforce, parsed from the same manifest entries
 * the profile resources serve.
 *
 * Discovered from the manifest rather than listed here, so the rules the server
 * enforces and the rules it publishes cannot drift apart, and so that adding a
 * profile is a change to the resource allowlist alone. A placeholder profile has
 * no `profile.json` and is therefore absent by construction. A caller cannot
 * supply a profile document: conformance would then mean whatever the caller
 * wanted it to mean.
 */
const PROFILE_URI = /^openauditmodel:\/\/profiles\/([a-z][a-z0-9-]*)\/0\.1$/;

function bundledProfiles(): ReadonlyMap<string, ProfileDefinition> {
  const found = new Map<string, ProfileDefinition>();
  for (const resource of BUNDLED_RESOURCES) {
    const match = PROFILE_URI.exec(resource.uri);
    if (match?.[1] === undefined) {
      continue;
    }
    found.set(match[1], JSON.parse(resource.text) as ProfileDefinition);
  }
  if (!found.has(IAM_PROFILE_NAME)) {
    throw new Error("the identity profile is missing from the generated resource manifest");
  }
  return found;
}

const PROFILES = bundledProfiles();

/** The bundled identity profile. */
export const iamProfile: ProfileDefinition = PROFILES.get(
  IAM_PROFILE_NAME,
) as unknown as ProfileDefinition;

/** Profiles this server can enforce. Placeholder profiles are deliberately absent. */
export const ENFORCEABLE_PROFILES: readonly string[] = [...PROFILES.keys()].sort((left, right) =>
  left.localeCompare(right, "en"),
);

export function profileByName(name: string): ProfileDefinition | undefined {
  return PROFILES.get(name);
}
