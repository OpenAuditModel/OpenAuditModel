/**
 * The validator interface, with no dependency on Ajv's runtime.
 *
 * This module exists so that an environment which validates with an
 * ahead-of-time compiled function never pulls Ajv's compiler into its bundle.
 * The MCP server validates with Ajv's standalone output, so importing the
 * compiler there would ship a large module of dead code and put runtime code
 * generation on a path that has no use for it.
 *
 * `ValidateFunction` is imported as a type only, so it is erased at build time.
 */
import type { ValidateFunction } from "ajv";
import { toIssues, type ValidationIssue } from "./format-errors.js";

/**
 * Every specification version this tooling implements, oldest first. Each has
 * its own schema, and an event is validated against the one its `specVersion`
 * names (ADR 0017 §1).
 */
export const SUPPORTED_SPEC_VERSIONS = ["0.1", "1.0"] as const;

export type SupportedSpecVersion = (typeof SUPPORTED_SPEC_VERSIONS)[number];

/** The newest version this tooling implements, and the one producers should emit. */
export const SPEC_VERSION: SupportedSpecVersion = "1.0";

/** Canonical identifier of the audit event schema for one specification version. */
export function schemaIdFor(version: SupportedSpecVersion): string {
  return `https://openauditmodel.org/schemas/audit-event/${version}/schema.json`;
}

/** Canonical identifier of the current OpenAuditModel Audit Event Schema. */
export const SCHEMA_ID = schemaIdFor(SPEC_VERSION);

/** Canonical identifier of the chain checkpoint schema, a tooling document versioned on its own. */
export const CHECKPOINT_SCHEMA_ID = "https://openauditmodel.org/schemas/checkpoint/0.1/schema.json";

/** Canonical identifier of the inclusion proof schema, a tooling document versioned on its own. */
export const PROOF_SCHEMA_ID = "https://openauditmodel.org/schemas/proof/0.1/schema.json";

/**
 * Validates parsed events. The smallest interface the conformance engines need,
 * so that they work with a schema read from disk or compiled in at build time.
 */
export interface EventValidator {
  readonly schemaId: string;
  /** Validates an already parsed event and returns the issues found. */
  validateEvent(event: unknown): ValidationIssue[];
}

/**
 * What an event's `specVersion` declares, as a consumer must read it (ADR 0017 §3).
 *
 * `supported` is a version this tooling implements. `unsupported` is a
 * well-formed version it does not — a newer minor, another major, or one never
 * published — which is not evaluated at all. `malformed` is anything that is
 * not a `MAJOR.MINOR` string, including an absent value: that event is not an
 * event of any version and is judged by the current schema, which says why.
 */
export type DeclaredSpecVersion =
  | { readonly kind: "supported"; readonly version: SupportedSpecVersion }
  | { readonly kind: "unsupported"; readonly version: string }
  | { readonly kind: "malformed" };

const VERSION_FORM = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function declaredSpecVersion(event: unknown): DeclaredSpecVersion {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return { kind: "malformed" };
  }
  const declared = (event as Record<string, unknown>)["specVersion"];
  if (typeof declared !== "string" || !VERSION_FORM.test(declared)) {
    return { kind: "malformed" };
  }
  return (SUPPORTED_SPEC_VERSIONS as readonly string[]).includes(declared)
    ? { kind: "supported", version: declared as SupportedSpecVersion }
    : { kind: "unsupported", version: declared };
}

/**
 * The keyword of the one issue reported for an event whose version this
 * tooling does not implement. It is not a JSON Schema keyword, deliberately:
 * no schema was applied, and nothing about the event was found wrong.
 */
export const NOT_EVALUATED_KEYWORD = "specVersion-not-implemented";

/** True when an event was not evaluated because of its declared version. */
export function wasNotEvaluated(issues: readonly ValidationIssue[]): boolean {
  return issues.length === 1 && issues[0]?.keyword === NOT_EVALUATED_KEYWORD;
}

/**
 * A validator that selects the schema by the version an event declares.
 *
 * `byVersion` must hold a validator for every supported version. A version the
 * tooling does not implement yields a single issue under
 * {@link NOT_EVALUATED_KEYWORD} rather than the schema's `const` failure: the
 * event is newer, or other, than this tool — not wrong. A malformed or absent
 * version is judged by the current schema, whose `const` names the problem.
 */
export function createVersionedValidator(
  byVersion: ReadonlyMap<SupportedSpecVersion, EventValidator>,
): EventValidator {
  const current = byVersion.get(SPEC_VERSION);
  if (current === undefined || byVersion.size !== SUPPORTED_SPEC_VERSIONS.length) {
    throw new Error(
      `a validator is needed for every supported version: ${SUPPORTED_SPEC_VERSIONS.join(", ")}`,
    );
  }
  return {
    schemaId: current.schemaId,
    validateEvent(event) {
      const declared = declaredSpecVersion(event);
      if (declared.kind === "supported") {
        return (byVersion.get(declared.version) as EventValidator).validateEvent(event);
      }
      if (declared.kind === "unsupported") {
        return [
          {
            path: "/specVersion",
            keyword: NOT_EVALUATED_KEYWORD,
            message: `specVersion "${declared.version}" is not a version this tool implements, so the event was not evaluated`,
            detail: `implemented: ${SUPPORTED_SPEC_VERSIONS.join(", ")}`,
          },
        ];
      }
      return current.validateEvent(event);
    },
  };
}

/**
 * Wraps an already compiled Ajv validation function.
 *
 * This is how the MCP server validates: Ajv's standalone code generator emits
 * the same validation logic ahead of time, so the server's verdict is identical
 * to the command line tool's by construction rather than by coincidence — and
 * Ajv's compiler is not reachable from its module graph.
 */
export function createValidatorFromCompiled(
  compiled: ValidateFunction,
  schemaId: string = SCHEMA_ID,
): EventValidator {
  return {
    schemaId,
    validateEvent: (event) => (compiled(event) ? [] : toIssues(compiled.errors)),
  };
}

export type { ValidationIssue };
