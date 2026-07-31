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

export const SPEC_VERSION = "0.1";

/** Canonical identifier of the OpenAuditModel Audit Event Schema. */
export const SCHEMA_ID = "https://openauditmodel.org/schemas/audit-event/0.1/schema.json";

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
