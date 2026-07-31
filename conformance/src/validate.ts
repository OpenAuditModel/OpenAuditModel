/**
 * Validation of audit events against the canonical OpenAuditModel schema, read
 * from this repository.
 *
 * The filesystem-free half lives in `validate-core.ts`, which this module
 * re-exports so that existing import sites keep working. Environments without a
 * filesystem import that module directly.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnySchemaObject } from "ajv";
import type { ValidationIssue } from "./format-errors.js";
import { expandInputPaths, readJsonFile } from "./sources.js";
import {
  createAjv,
  createValidatorFromSchema,
  SCHEMA_ID,
  SPEC_VERSION,
  validateSchemaDocument,
  type EventValidator,
} from "./validate-core.js";

export { createAjv, SCHEMA_ID, SPEC_VERSION, validateSchemaDocument };
export type { EventValidator };

export const SCHEMA_RELATIVE_PATH = path.join(
  "schemas",
  `v${SPEC_VERSION}`,
  "audit-event.schema.json",
);

/** Outcome of validating a single file. */
export type FileStatus = "valid" | "invalid" | "unreadable";

export interface FileValidationResult {
  readonly file: string;
  readonly status: FileStatus;
  readonly issues: readonly ValidationIssue[];
  /** Set when the file could not be read or parsed as JSON. */
  readonly error?: string;
}

export interface Validator extends EventValidator {
  readonly schemaPath: string;
  /** Reads, parses and validates a single JSON file. */
  validateFile(file: string): FileValidationResult;
}

/**
 * Walks upwards from a starting directory until the canonical schema is found.
 * This keeps the CLI working when run from `dist/`, from the repository root,
 * or from an installed package directory.
 */
export function resolveSchemaPath(startDir?: string): string {
  const from = startDir ?? path.dirname(fileURLToPath(import.meta.url));
  let dir = path.resolve(from);

  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(dir, SCHEMA_RELATIVE_PATH);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error(
    `Unable to locate ${SCHEMA_RELATIVE_PATH}. Searched upwards from ${path.resolve(from)}.`,
  );
}

/** Reads the canonical schema document from disk. */
export function loadSchema(schemaPath?: string): AnySchemaObject {
  const resolved = schemaPath ?? resolveSchemaPath();
  const raw = readFileSync(resolved, "utf8");
  return JSON.parse(raw) as AnySchemaObject;
}

/** Compiles the canonical schema and returns a reusable validator. */
export function createValidator(schemaPath?: string): Validator {
  const resolvedPath = schemaPath ?? resolveSchemaPath();
  const schema = loadSchema(resolvedPath);
  const core = createValidatorFromSchema(schema);
  const { schemaId } = core;
  const validateEvent = (event: unknown): ValidationIssue[] => core.validateEvent(event);

  const validateFile = (file: string): FileValidationResult => {
    const parsed = readJsonFile(file);
    if (!parsed.ok) {
      return { file, status: "unreadable", issues: [], error: parsed.error };
    }

    const issues = validateEvent(parsed.value);
    return { file, status: issues.length === 0 ? "valid" : "invalid", issues };
  };

  return { schemaId, schemaPath: resolvedPath, validateEvent, validateFile };
}

/** Re-exported so that consumers of the validator keep a single import site. */
export { expandInputPaths };

export type { ValidationIssue };
