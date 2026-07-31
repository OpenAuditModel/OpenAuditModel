/**
 * Schema validation with no filesystem dependency.
 *
 * This module is the boundary that lets the conformance engines run unchanged
 * in environments that do not read the schema from disk — the MCP server in
 * particular, where the schema is compiled in at build time.
 *
 * Everything here operates on a schema **object**. Locating and reading schema
 * files lives in `validate.ts`, which imports this module.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchemaObject, ErrorObject, ValidateFunction } from "ajv";
import formatsModule from "ajv-formats";
import { toIssues, type ValidationIssue } from "./format-errors.js";
import {
  createValidatorFromCompiled,
  SCHEMA_ID,
  SPEC_VERSION,
  type EventValidator,
} from "./validator-interface.js";

// Re-exported so that existing import sites keep working. Code that only needs
// a precompiled validator should import ./validator-interface.js directly, which
// keeps Ajv out of its bundle entirely.
export { createValidatorFromCompiled, SCHEMA_ID, SPEC_VERSION };
export type { EventValidator };

/** `ajv-formats` is published as CommonJS; this is its ESM-interop entry point. */
const addFormats = formatsModule.default;

/** Creates an Ajv instance configured the way OpenAuditModel conformance requires. */
export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    // Reject schema authoring mistakes rather than silently ignoring them.
    strict: true,
    // Union types are used deliberately by the free-form JSON value definition.
    allowUnionTypes: true,
    // `strictRequired` is an Ajv-specific authoring lint that rejects the
    // standard `if`/`then` + `required` idiom, which OpenAuditModel relies on
    // for its conditional rules. The idiom is valid Draft 2020-12 and portable
    // across validators, so this single check is disabled.
    strictRequired: false,
    // Report every problem in one pass so that a report is actionable.
    allErrors: true,
  });
  addFormats(ajv);
  return ajv;
}

/** Validates a schema document itself against the Draft 2020-12 meta-schema. */
export function validateSchemaDocument(schema: AnySchemaObject): ValidationIssue[] {
  const ajv = createAjv();
  const valid = ajv.validateSchema(schema);
  return valid ? [] : toIssues(ajv.errors as ErrorObject[] | null);
}

/**
 * Compiles a schema object into a reusable validator.
 *
 * Used directly where the schema is already in memory. Environments that forbid
 * dynamic code generation cannot call this — Ajv compiles with `new Function` —
 * and supply a precompiled validation function instead; see
 * {@link createValidatorFromCompiled}.
 */
export function createValidatorFromSchema(schema: AnySchemaObject): EventValidator {
  const ajv = createAjv();
  const compiled: ValidateFunction = ajv.compile(schema);
  const schemaId = typeof schema["$id"] === "string" ? schema["$id"] : SCHEMA_ID;

  return {
    schemaId,
    validateEvent: (event) => (compiled(event) ? [] : toIssues(compiled.errors)),
  };
}

export type { ValidationIssue };
