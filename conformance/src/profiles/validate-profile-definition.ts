/**
 * Validation of profile definition documents.
 *
 * A profile definition is validated against its own JSON Schema, which is
 * closed at every level: an unrecognised rule property, selector or operator is
 * a rejection, not something ignored. A profile that silently ignored what it
 * did not understand would let a typo turn a requirement into nothing.
 *
 * This schema is not part of the canonical audit event schema and never
 * constrains an audit event.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AnySchemaObject, ValidateFunction } from "ajv";
import { createAjv, resolveSchemaPath } from "../validate.js";
import { toIssues, type ValidationIssue } from "../format-errors.js";

export const PROFILE_DEFINITION_SCHEMA_ID =
  "https://openauditmodel.org/schemas/profile-definition/0.1/schema.json";

export const PROFILE_DEFINITION_SCHEMA_RELATIVE_PATH = path.join(
  "profiles",
  "profile-definition.schema.json",
);

/** Repository root, derived from the location of the canonical schema. */
export function repositoryRoot(): string {
  const schemaPath = resolveSchemaPath();
  return path.dirname(path.dirname(path.dirname(schemaPath)));
}

/** Absolute path of the profile definition schema. */
export function resolveProfileDefinitionSchemaPath(): string {
  const candidate = path.join(repositoryRoot(), PROFILE_DEFINITION_SCHEMA_RELATIVE_PATH);
  if (!existsSync(candidate)) {
    throw new Error(`Unable to locate ${PROFILE_DEFINITION_SCHEMA_RELATIVE_PATH}.`);
  }
  return candidate;
}

/** Reads the profile definition schema document. */
export function loadProfileDefinitionSchema(): AnySchemaObject {
  return JSON.parse(readFileSync(resolveProfileDefinitionSchemaPath(), "utf8")) as AnySchemaObject;
}

let compiled: ValidateFunction | undefined;

function definitionValidator(): ValidateFunction {
  if (compiled === undefined) {
    compiled = createAjv().compile(loadProfileDefinitionSchema());
  }
  return compiled;
}

/** Validates a parsed profile definition. Returns the issues found. */
export function validateProfileDefinition(definition: unknown): ValidationIssue[] {
  const validate = definitionValidator();
  return validate(definition) ? [] : toIssues(validate.errors);
}
