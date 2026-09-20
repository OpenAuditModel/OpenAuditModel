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
  CHECKPOINT_SCHEMA_ID,
  createValidatorFromCompiled,
  PROOF_SCHEMA_ID,
  SCHEMA_ID,
  SPEC_VERSION,
  type EventValidator,
} from "../../conformance/src/validator-interface.js";
import type { ProfileDefinition } from "../../conformance/src/profiles/types.js";
import validateAuditEvent from "./schema-validator.generated.js";
import validateCheckpoint from "./checkpoint-validator.generated.js";
import validateProof from "./proof-validator.generated.js";
import { BUNDLED_RESOURCES } from "./resource-manifest.generated.js";

export { CHECKPOINT_SCHEMA_ID, PROOF_SCHEMA_ID, SCHEMA_ID, SPEC_VERSION };

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

/**
 * The checkpoint validator, compiled the same way. The checkpoint schema refers
 * into the event schema's `$defs`; the generator registers the event schema
 * before compiling, so the references are resolved at build time and nothing
 * is fetched at run time.
 */
export const checkpointValidator: EventValidator = createValidatorFromCompiled(
  validateCheckpoint as unknown as ValidateFunction,
  CHECKPOINT_SCHEMA_ID,
);

/** The inclusion proof validator, compiled the same way, with both schemas it refers to registered. */
export const proofValidator: EventValidator = createValidatorFromCompiled(
  validateProof as unknown as ValidateFunction,
  PROOF_SCHEMA_ID,
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
/**
 * A profile resource URI: the profile's name and the version it declares.
 *
 * The version part matches the whole `version` form the profile definition
 * schema allows, not one literal. It used to be pinned to `0.1`, and when
 * `incident-management` was revised to `0.2` the profile went on being served
 * as a resource while quietly dropping out of the enforceable set — the server
 * published rules it would no longer check anything against. A profile
 * revision is expected (ADR 0008); a revision that removes a tool's ability to
 * enforce it is not.
 */
const PROFILE_URI = /^openauditmodel:\/\/profiles\/([a-z][a-z0-9-]*)\/([0-9]+(?:\.[0-9]+){0,2})$/;

function bundledProfiles(): ReadonlyMap<string, ProfileDefinition> {
  const found = new Map<string, ProfileDefinition>();
  for (const resource of BUNDLED_RESOURCES) {
    const match = PROFILE_URI.exec(resource.uri);
    const name = match?.[1];
    if (name === undefined) {
      continue;
    }
    const profile = JSON.parse(resource.text) as ProfileDefinition;
    // The URI carries the version by hand; the document carries it as data.
    // A disagreement means the allowlist was edited and the profile was not,
    // or the reverse, and enforcing rules under the wrong version number is
    // worse than refusing to start.
    if (profile.version !== match?.[2]) {
      throw new Error(
        `${resource.uri} advertises version ${match?.[2] ?? "(none)"}, but the profile declares ${profile.version}`,
      );
    }
    found.set(name, profile);
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
