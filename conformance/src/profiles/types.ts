/**
 * Types for declarative profile conformance.
 *
 * A profile adds requirements to the core model for a specific domain. It can
 * only ever add: the rule vocabulary can require a value to be present or equal
 * to a scalar, and can do nothing else. There is no way to express "this core
 * field is optional here", because there is no keyword that removes anything.
 *
 * Profile conformance is not legal or regulatory compliance, and a profile is
 * not a regulatory mapping. See decisions/0008-declarative-profile-conformance.md.
 */

/**
 * Profile definition format versions this build implements.
 *
 * `profileVersion` names the rule vocabulary a profile document is written in,
 * and is not the profile's own `version`, which numbers its rules. A document
 * declaring a format this build does not implement must be refused whole: the
 * rule schema is closed, so an unknown vocabulary means unknown rule
 * properties, and a reader that evaluated the ones it recognised would treat a
 * requirement it cannot see as a requirement that is not there — reporting an
 * event conforming because it failed to understand what was being asked.
 *
 * The profile definition schema pins the same list; a test asserts the two
 * agree, so this cannot drift from what the schema accepts.
 */
export const SUPPORTED_PROFILE_VERSIONS = ["0.1"] as const;

export type SupportedProfileVersion = (typeof SUPPORTED_PROFILE_VERSIONS)[number];

/** Whether this build implements the format version a definition declares. */
export function implementsProfileVersion(profileVersion: unknown): boolean {
  return (
    typeof profileVersion === "string" &&
    (SUPPORTED_PROFILE_VERSIONS as readonly string[]).includes(profileVersion)
  );
}

/** How a rule reports its violations. Unrelated to the privacy linter's severities. */
export type RuleSeverity = "info" | "warning" | "error";

/** A scalar a condition or required value compares against. */
export type Scalar = string | number | boolean | null;

export interface Condition {
  readonly path: string;
  readonly equals: Scalar;
}

export interface RequiredValue {
  readonly path: string;
  readonly equals: Scalar;
}

export type MetadataType = "string" | "number" | "integer" | "boolean" | "object" | "array";

export interface RequiredMetadata {
  /** JSON Pointer relative to `/metadata`. */
  readonly path: string;
  readonly type: MetadataType;
}

export interface ProfileRule {
  readonly id: string;
  readonly description: string;
  readonly rationale?: string;
  readonly severity?: RuleSeverity;
  readonly events?: readonly string[];
  readonly eventPrefixes?: readonly string[];
  readonly when?: Condition;
  readonly requiredPaths?: readonly string[];
  readonly requiredMetadata?: readonly RequiredMetadata[];
  readonly requiredValues?: readonly RequiredValue[];
  readonly recommendedPaths?: readonly string[];
}

export interface ProfileDefinition {
  readonly profileVersion: string;
  readonly name: string;
  readonly version: string;
  readonly status: "experimental" | "stable" | "deprecated";
  readonly coreVersions: readonly string[];
  readonly title: string;
  readonly description: string;
  readonly rules: readonly ProfileRule[];
}

/**
 * Outcome of checking one event.
 *
 * `not-applicable` exists so that the tool never claims a document-sharing event
 * conforms to an identity profile. Silence is not conformance.
 */
export type ProfileStatus = "conforming" | "violations" | "not-applicable" | "core-invalid";

/** A profile requirement that was not met. Never carries an event value. */
export interface ProfileFinding {
  readonly ruleId: string;
  /** JSON Pointer to the location the requirement concerns. */
  readonly path: string;
  readonly message: string;
  readonly severity: RuleSeverity;
}

export interface ProfileCheckResult {
  readonly label: string;
  readonly eventId?: string;
  readonly status: ProfileStatus;
  /** Whether the event validates against the canonical core schema. */
  readonly coreValid: boolean;
  /** Whether the event satisfies every applicable profile requirement. */
  readonly profileValid: boolean;
  readonly profile: { readonly name: string; readonly version: string };
  readonly matchedRules: readonly string[];
  readonly errors: readonly ProfileFinding[];
  readonly warnings: readonly ProfileFinding[];
  /** Rendered core schema issues, present only when core validation failed. */
  readonly coreIssues: readonly string[];
}

export interface ProfileCheckSummary {
  readonly events: number;
  readonly conforming: number;
  readonly violations: number;
  readonly notApplicable: number;
  readonly coreInvalid: number;
  readonly errors: number;
  readonly warnings: number;
}

/**
 * Counts results one at a time, for a command that reads its events as a
 * stream and so must not keep a result per event either.
 */
export interface ProfileTally {
  events: number;
  conforming: number;
  violations: number;
  notApplicable: number;
  coreInvalid: number;
  errors: number;
  warnings: number;
}

export function startProfileTally(): ProfileTally {
  return {
    events: 0,
    conforming: 0,
    violations: 0,
    notApplicable: 0,
    coreInvalid: 0,
    errors: 0,
    warnings: 0,
  };
}

export function addToProfileTally(tally: ProfileTally, result: ProfileCheckResult): void {
  tally.events += 1;
  if (result.status === "conforming") {
    tally.conforming += 1;
  } else if (result.status === "violations") {
    tally.violations += 1;
  } else if (result.status === "not-applicable") {
    tally.notApplicable += 1;
  } else if (result.status === "core-invalid") {
    tally.coreInvalid += 1;
  }
  tally.errors += result.errors.length;
  tally.warnings += result.warnings.length;
}

export function finishProfileTally(tally: ProfileTally): ProfileCheckSummary {
  return { ...tally };
}

/** The same count, over an array already in hand. */
export function summariseProfileResults(
  results: readonly ProfileCheckResult[],
): ProfileCheckSummary {
  const tally = startProfileTally();
  for (const result of results) {
    addToProfileTally(tally, result);
  }
  return finishProfileTally(tally);
}

/**
 * Whether a profile applies to an event declaring a given core specification
 * version. Lives here rather than beside profile loading so that the
 * conformance engine has no filesystem dependency at runtime.
 */
export function supportsCoreVersion(profile: ProfileDefinition, specVersion: unknown): boolean {
  return typeof specVersion === "string" && profile.coreVersions.includes(specVersion);
}
