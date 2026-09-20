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
  CHECKPOINT_SCHEMA_ID,
  createAjv,
  createValidatorFromSchema,
  createValidatorFromSchemas,
  PROOF_SCHEMA_ID,
  SCHEMA_ID,
  SPEC_VERSION,
  validateSchemaDocument,
  type EventValidator,
} from "./validate-core.js";

export {
  CHECKPOINT_SCHEMA_ID,
  createAjv,
  PROOF_SCHEMA_ID,
  SCHEMA_ID,
  SPEC_VERSION,
  validateSchemaDocument,
};
export type { EventValidator };

export const SCHEMA_RELATIVE_PATH = path.join(
  "schemas",
  `v${SPEC_VERSION}`,
  "audit-event.schema.json",
);

/** The checkpoint schema, versioned on its own; 0.1 is its first version. */
export const CHECKPOINT_SCHEMA_RELATIVE_PATH = path.join(
  "schemas",
  "checkpoint",
  "v0.1",
  "checkpoint.schema.json",
);

/** The inclusion proof schema, versioned on its own; 0.1 is its first version. */
export const PROOF_SCHEMA_RELATIVE_PATH = path.join(
  "schemas",
  "proof",
  "v0.1",
  "proof.schema.json",
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

/** A validator for a document other than an event, with the schema it was read from. */
export interface DocumentValidator extends EventValidator {
  readonly schemaPath: string;
}

/**
 * Locates a tooling document's schema from the event schema's location: they
 * ship together, under the same `schemas/` directory, in the repository and in
 * the installed package alike.
 */
function resolveDocumentSchemaPath(relativePath: string, schemaPath?: string): string {
  const eventSchemaPath = schemaPath ?? resolveSchemaPath();
  const root = path.dirname(path.dirname(path.dirname(eventSchemaPath)));
  const candidate = path.join(root, relativePath);
  if (!existsSync(candidate)) {
    throw new Error(`Unable to locate ${relativePath} beside ${eventSchemaPath}.`);
  }
  return candidate;
}

export function resolveCheckpointSchemaPath(schemaPath?: string): string {
  return resolveDocumentSchemaPath(CHECKPOINT_SCHEMA_RELATIVE_PATH, schemaPath);
}

export function resolveProofSchemaPath(schemaPath?: string): string {
  return resolveDocumentSchemaPath(PROOF_SCHEMA_RELATIVE_PATH, schemaPath);
}

function readSchema(file: string): AnySchemaObject {
  return JSON.parse(readFileSync(file, "utf8")) as AnySchemaObject;
}

/**
 * Compiles the checkpoint schema. It refers to the audit event schema's
 * `$defs` for digests, identifiers, timestamps and signatures, so the event
 * schema is registered alongside it and a digest means one thing in both.
 */
export function createCheckpointValidator(schemaPath?: string): DocumentValidator {
  const eventSchemaPath = schemaPath ?? resolveSchemaPath();
  const checkpointSchemaPath = resolveCheckpointSchemaPath(eventSchemaPath);
  const core = createValidatorFromSchemas(readSchema(checkpointSchemaPath), [
    loadSchema(eventSchemaPath),
  ]);
  return { ...core, schemaPath: checkpointSchemaPath };
}

/**
 * Compiles the inclusion proof schema. It borrows from the event schema as the
 * checkpoint does, and its root's `anchor` is the checkpoint schema's, so one
 * anchoring rule holds across both documents.
 */
export function createProofValidator(schemaPath?: string): DocumentValidator {
  const eventSchemaPath = schemaPath ?? resolveSchemaPath();
  const proofSchemaPath = resolveProofSchemaPath(eventSchemaPath);
  const core = createValidatorFromSchemas(readSchema(proofSchemaPath), [
    loadSchema(eventSchemaPath),
    readSchema(resolveCheckpointSchemaPath(eventSchemaPath)),
  ]);
  return { ...core, schemaPath: proofSchemaPath };
}

/** Re-exported so that consumers of the validator keep a single import site. */
export { expandInputPaths };

export type { ValidationIssue };
