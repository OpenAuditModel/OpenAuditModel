/**
 * Loading of profile definitions.
 *
 * Profiles are loaded **only** from the repository's own `profiles/` directory,
 * by name, from a fixed file name. There is no path argument, no remote
 * registry and no reference resolution: a profile is a set of requirements that
 * decides whether an audit event is conforming, and letting a caller point that
 * at an arbitrary file makes conformance mean whatever the caller wants.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { repositoryRoot, validateProfileDefinition } from "./validate-profile-definition.js";
import { supportsCoreVersion, type ProfileDefinition } from "./types.js";

/** Re-exported so that existing import sites keep working. */
export { supportsCoreVersion };

/** File name a profile definition must use inside its directory. */
export const PROFILE_DEFINITION_FILE = "profile.json";

/**
 * Largest profile definition that will be read. A profile is a small document;
 * anything larger is a mistake or an attempt to exhaust memory.
 */
export const MAX_PROFILE_BYTES = 256 * 1024;

/** Profile names are directory names, restricted to the same token form as the schema. */
const PROFILE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export type ProfileLoadResult =
  | { readonly ok: true; readonly profile: ProfileDefinition; readonly file: string }
  | { readonly ok: false; readonly error: string; readonly issues?: readonly string[] };

/** Absolute path of the directory profiles are loaded from. */
export function profilesDirectory(): string {
  return path.join(repositoryRoot(), "profiles");
}

/** Names of the profiles that ship with the repository and carry a definition. */
export function availableProfiles(): string[] {
  const root = profilesDirectory();
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(root, name, PROFILE_DEFINITION_FILE)))
    .sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * Loads a profile definition by name and validates it.
 *
 * The name is checked against a strict token pattern and joined to the profiles
 * directory, so `../` and absolute paths cannot escape it.
 */
export function loadProfile(name: string): ProfileLoadResult {
  if (!PROFILE_NAME.test(name)) {
    return {
      ok: false,
      error: `"${name}" is not a valid profile name`,
    };
  }

  const file = path.join(profilesDirectory(), name, PROFILE_DEFINITION_FILE);
  if (!existsSync(file)) {
    const available = availableProfiles();
    return {
      ok: false,
      error:
        available.length === 0
          ? `no profile named "${name}" is available`
          : `no profile named "${name}"; available profiles: ${available.join(", ")}`,
    };
  }

  const size = statSync(file).size;
  if (size > MAX_PROFILE_BYTES) {
    return {
      ok: false,
      error: `profile definition is ${size} bytes, above the ${MAX_PROFILE_BYTES} byte limit`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    return { ok: false, error: `cannot parse profile definition: ${(cause as Error).message}` };
  }

  const issues = validateProfileDefinition(parsed);
  if (issues.length > 0) {
    return {
      ok: false,
      error: `profile definition "${name}" is not valid`,
      issues: issues.map((issue) => `${issue.path}  ${issue.message}`),
    };
  }

  const profile = parsed as ProfileDefinition;
  if (profile.name !== name) {
    return {
      ok: false,
      error: `profile definition declares name "${profile.name}" but lives in directory "${name}"`,
    };
  }

  return { ok: true, profile, file };
}
