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
import { expandInputPaths, nestedTooDeep, readJsonFile } from "./sources.js";
import { MAX_JSON_DEPTH } from "./integrity/canonicalize.js";
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
import {
  createVersionedValidator,
  SUPPORTED_SPEC_VERSIONS,
  wasNotEvaluated,
  type SupportedSpecVersion,
} from "./validator-interface.js";

export {
  CHECKPOINT_SCHEMA_ID,
  createAjv,
  PROOF_SCHEMA_ID,
  SCHEMA_ID,
  SPEC_VERSION,
  SUPPORTED_SPEC_VERSIONS,
  validateSchemaDocument,
};
export type { EventValidator, SupportedSpecVersion };

/** Where one version's audit event schema lives, relative to the repository or package root. */
export function schemaRelativePathFor(version: SupportedSpecVersion): string {
  return path.join("schemas", `v${version}`, "audit-event.schema.json");
}

/** The current version's schema, which is what locating the schemas starts from. */
export const SCHEMA_RELATIVE_PATH = schemaRelativePathFor(SPEC_VERSION);

/**
 * One version's schema, found beside the current one: every version ships in
 * the same `schemas/` directory, in the repository and in the installed package.
 */
export function resolveSchemaPathFor(
  version: SupportedSpecVersion,
  currentSchemaPath?: string,
): string {
  const current = currentSchemaPath ?? resolveSchemaPath();
  const root = path.dirname(path.dirname(path.dirname(current)));
  const candidate = path.join(root, schemaRelativePathFor(version));
  if (!existsSync(candidate)) {
    throw new Error(`Unable to locate ${schemaRelativePathFor(version)} beside ${current}.`);
  }
  return candidate;
}

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

/**
 * Outcome of validating a single file. `not-evaluated` is an event declaring a
 * specification version this tool does not implement (ADR 0017 §3): it was
 * neither passed nor failed.
 */
export type FileStatus = "valid" | "invalid" | "not-evaluated" | "unreadable";

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

/**
 * Compiles the schema of every supported version and returns a validator that
 * applies the one each event declares (ADR 0017). `schemaPath` is the current
 * version's schema; the others are found beside it.
 */
export function createValidator(schemaPath?: string): Validator {
  const resolvedPath = schemaPath ?? resolveSchemaPath();
  // The given file is the current version's schema and is used as given; the
  // other versions are found beside it. Loading the current version from its
  // conventional path instead would validate against a file the caller did
  // not name while reporting the one it did.
  const byVersion = new Map<SupportedSpecVersion, EventValidator>(
    SUPPORTED_SPEC_VERSIONS.map((version) => [
      version,
      createValidatorFromSchema(
        loadSchema(
          version === SPEC_VERSION ? resolvedPath : resolveSchemaPathFor(version, resolvedPath),
        ),
      ),
    ]),
  );
  const core = createVersionedValidator(byVersion);
  const { schemaId } = core;
  const validateEvent = (event: unknown): ValidationIssue[] => core.validateEvent(event);

  const validateFile = (file: string): FileValidationResult => {
    const parsed = readJsonFile(file);
    if (!parsed.ok) {
      return { file, status: "unreadable", issues: [], error: parsed.error };
    }
    // The limit every command applies: validation recurses, and a document
    // nested deeply enough would end the process rather than fail.
    if (nestedTooDeep(parsed.value)) {
      return {
        file,
        status: "unreadable",
        issues: [],
        error: `the document is nested more than ${MAX_JSON_DEPTH} levels deep, deeper than any audit event`,
      };
    }

    const issues = validateEvent(parsed.value);
    const status =
      issues.length === 0 ? "valid" : wasNotEvaluated(issues) ? "not-evaluated" : "invalid";
    return { file, status, issues };
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
  // The checkpoint format refers to the 0.1 event schema's `$defs`, the
  // version it was written against; that schema stays published (ADR 0017 §6).
  const core = createValidatorFromSchemas(readSchema(checkpointSchemaPath), [
    loadSchema(resolveSchemaPathFor("0.1", eventSchemaPath)),
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
    loadSchema(resolveSchemaPathFor("0.1", eventSchemaPath)),
    readSchema(resolveCheckpointSchemaPath(eventSchemaPath)),
  ]);
  return { ...core, schemaPath: proofSchemaPath };
}

/** Re-exported so that consumers of the validator keep a single import site. */
export { expandInputPaths };

export type { ValidationIssue };
