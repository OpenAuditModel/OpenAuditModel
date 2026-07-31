/**
 * Loading of audit event documents from the file system.
 *
 * Every command reads events through this module so that the size limit, the
 * parse behaviour and the error wording are identical everywhere. Nothing here
 * resolves remote references or follows anything contained in an event.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Largest document the tooling will read. An audit event is a small structured
 * record; a file above this size is a mistake or an attempt to exhaust memory,
 * and is refused rather than parsed.
 */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** File extensions treated as JSON Lines rather than a single JSON document. */
const JSON_LINES_EXTENSIONS = [".jsonl", ".ndjson"];

/** File extensions collected when a directory is given. */
const EVENT_EXTENSIONS = [".json", ...JSON_LINES_EXTENSIONS];

/** One event, together with where it came from. */
export interface EventDocument {
  /** Path of the file the event was read from. */
  readonly file: string;
  /** Position of the event within that file. `undefined` for a single-event file. */
  readonly index?: number;
  /** Display label, `file` or `file#index`, used in reports. */
  readonly label: string;
  /** The parsed event. Not yet validated. */
  readonly event: unknown;
}

/** A file that could not be read or parsed. */
export interface DocumentLoadFailure {
  readonly file: string;
  readonly error: string;
}

export interface DocumentLoadResult {
  readonly documents: readonly EventDocument[];
  readonly failures: readonly DocumentLoadFailure[];
}

/** Successful read of a single JSON document. */
export interface JsonReadSuccess {
  readonly ok: true;
  readonly value: unknown;
}

export interface JsonReadFailure {
  readonly ok: false;
  readonly error: string;
}

export type JsonReadResult = JsonReadSuccess | JsonReadFailure;

function isJsonLines(file: string): boolean {
  const extension = path.extname(file).toLowerCase();
  return JSON_LINES_EXTENSIONS.includes(extension);
}

function readTextFile(file: string): JsonReadResult {
  let size: number;
  try {
    size = statSync(file).size;
  } catch (cause) {
    return { ok: false, error: `cannot read file: ${(cause as Error).message}` };
  }

  if (size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: `file is ${size} bytes, above the ${MAX_DOCUMENT_BYTES} byte limit`,
    };
  }

  try {
    return { ok: true, value: readFileSync(file, "utf8") };
  } catch (cause) {
    return { ok: false, error: `cannot read file: ${(cause as Error).message}` };
  }
}

/**
 * Reads and parses one JSON file. The returned failure text never contains file
 * content, only the parser's positional message.
 */
export function readJsonFile(file: string): JsonReadResult {
  const text = readTextFile(file);
  if (!text.ok) {
    return text;
  }

  try {
    return { ok: true, value: JSON.parse(text.value as string) };
  } catch (cause) {
    return { ok: false, error: `cannot parse JSON: ${(cause as Error).message}` };
  }
}

/**
 * Expands input paths into the list of files to read. Directories are expanded
 * one level deep and sorted, so that reports are stable across platforms.
 */
export function expandInputPaths(inputs: readonly string[]): string[] {
  const files: string[] = [];

  for (const input of inputs) {
    const stats = statSync(input);
    if (stats.isDirectory()) {
      const entries = readdirSync(input)
        .filter((entry) => EVENT_EXTENSIONS.includes(path.extname(entry).toLowerCase()))
        .sort((left, right) => left.localeCompare(right, "en"));
      for (const entry of entries) {
        files.push(path.join(input, entry));
      }
    } else {
      files.push(input);
    }
  }

  return files;
}

function documentsFromJsonLines(file: string, text: string): DocumentLoadResult {
  const documents: EventDocument[] = [];
  const lines = text.split(/\r?\n/);

  for (const [lineIndex, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    try {
      documents.push({
        file,
        index: lineIndex + 1,
        label: `${file}#${lineIndex + 1}`,
        event: JSON.parse(trimmed),
      });
    } catch (cause) {
      return {
        documents: [],
        failures: [
          {
            file,
            error: `cannot parse JSON on line ${lineIndex + 1}: ${(cause as Error).message}`,
          },
        ],
      };
    }
  }

  return { documents, failures: [] };
}

/**
 * Reads every event contained in one file. A file may hold a single event
 * object, an array of events, or one event per line for `.jsonl` and `.ndjson`.
 */
export function readEventDocuments(file: string): DocumentLoadResult {
  if (isJsonLines(file)) {
    const text = readTextFile(file);
    if (!text.ok) {
      return { documents: [], failures: [{ file, error: text.error }] };
    }
    return documentsFromJsonLines(file, text.value as string);
  }

  const parsed = readJsonFile(file);
  if (!parsed.ok) {
    return { documents: [], failures: [{ file, error: parsed.error }] };
  }

  if (Array.isArray(parsed.value)) {
    return {
      documents: parsed.value.map((event, index) => ({
        file,
        index,
        label: `${file}#${index}`,
        event,
      })),
      failures: [],
    };
  }

  return { documents: [{ file, label: file, event: parsed.value }], failures: [] };
}

/** Expands input paths and reads every event they contain. */
export function loadEventDocuments(inputs: readonly string[]): DocumentLoadResult {
  const documents: EventDocument[] = [];
  const failures: DocumentLoadFailure[] = [];

  for (const file of expandInputPaths(inputs)) {
    const result = readEventDocuments(file);
    documents.push(...result.documents);
    failures.push(...result.failures);
  }

  return { documents, failures };
}
