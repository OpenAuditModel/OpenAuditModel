/**
 * Loading of audit event documents from the file system.
 *
 * Every command reads events through this module so that the parse behaviour
 * and the error wording are the same everywhere. The size limit is the one
 * thing that is not: JSON Lines is streamed and limited per line, which is
 * what lets an archive be larger than the memory checking it — but a caller
 * that must hold every event at once asks for the whole-file limit back. See
 * decision 0016. Nothing here resolves remote references or follows anything
 * contained in an event.
 */
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { MAX_JSON_DEPTH } from "./integrity/canonicalize.js";

/**
 * Largest single JSON document the tooling will read whole.
 *
 * A JSON file is parsed in one piece — there is no partial parse of a document
 * whose shape is unknown until the closing brace — so its size is capped. JSON
 * Lines is different: it is read a line at a time and the cap below applies to
 * each line rather than to the file, which is what lets a multi-gigabyte
 * export be checked on a laptop.
 */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/**
 * Largest single event in a JSON Lines file.
 *
 * One line is one event, and an audit event above this size is a mistake or an
 * attempt to exhaust memory. Before streaming, the whole-file cap enforced this
 * implicitly; now it is enforced where it belongs, so that one absurd line
 * cannot do what a large file no longer can.
 */
export const MAX_LINE_BYTES = MAX_DOCUMENT_BYTES;

/** How a caller wants a file read. */
export interface ReadOptions {
  /**
   * Refuse a JSON Lines file above {@link MAX_DOCUMENT_BYTES} rather than
   * streaming it. For a caller that holds every event at once and would
   * otherwise be killed part-way through by the memory it asked for.
   */
  readonly wholeFileLimit?: boolean;
}

/** Read size for JSON Lines. Large enough to be few syscalls, small enough to be bounded. */
const CHUNK_BYTES = 64 * 1024;

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

/** A file opened for reading, with the size it had when it was opened. */
interface OpenedFile {
  readonly ok: true;
  readonly descriptor: number;
  readonly size: number;
}

/**
 * Opens a regular file for reading, or says why it will not.
 *
 * Anything that is not a regular file is refused. A FIFO or a device — or a
 * link to one, named like an event file inside an archive — reports no size and
 * then either never ends or blocks forever: a FIFO named `b.json` hung
 * `validate`, and one fed 12 MB was read whole where a regular file of that size
 * is refused. The file is opened once and every check is made on what was
 * opened, so nothing can be swapped in between a check and the read. It is
 * opened non-blocking, so that opening a FIFO returns at once instead of
 * waiting for a writer; a regular file reads the same either way. A link to a
 * regular file is followed, as a path on the command line is followed.
 */
function openRegularFile(file: string): OpenedFile | JsonReadFailure {
  let descriptor: number;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (cause) {
    return { ok: false, error: `cannot read file: ${(cause as Error).message}` };
  }
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      closeSync(descriptor);
      return { ok: false, error: "not a regular file, so it is not read" };
    }
    return { ok: true, descriptor, size: stats.size };
  } catch (cause) {
    closeSync(descriptor);
    return { ok: false, error: `cannot read file: ${(cause as Error).message}` };
  }
}

function tooLargeMessage(size: number): string {
  return `file is ${size} bytes, above the ${MAX_DOCUMENT_BYTES} byte limit`;
}

/**
 * The parser's position, and nothing of the text.
 *
 * `JSON.parse` quotes the text around the error — the whole input when it is
 * short — so its message can carry a secret from the file it failed on: a
 * short credentials file linked into an archive under an event file's name
 * was echoed in full. Only the position is kept.
 */
function describeJsonError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";
  const position = /at position (\d+)(?: \(line (\d+) column (\d+)\))?/.exec(message);
  if (position !== null) {
    return position[2] !== undefined
      ? `invalid JSON at line ${position[2]}, column ${position[3]}`
      : `invalid JSON at position ${position[1]}`;
  }
  return /Unexpected end of JSON input/.test(message)
    ? "the JSON ends before it is complete"
    : "not valid JSON";
}

function readTextFile(file: string): JsonReadResult {
  const opened = openRegularFile(file);
  if (!opened.ok) {
    return opened;
  }
  const { descriptor, size } = opened;
  try {
    if (size > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: tooLargeMessage(size) };
    }
    // At most one byte past the size the file had when it was opened is read:
    // a file that grew in the meantime is refused, not held whole.
    const buffer = Buffer.allocUnsafe(size + 1);
    let total = 0;
    while (total < buffer.length) {
      const read = readSync(descriptor, buffer, total, buffer.length - total, null);
      if (read === 0) {
        break;
      }
      total += read;
    }
    if (total > size) {
      return { ok: false, error: "file changed while it was read, so it is not read" };
    }
    return { ok: true, value: buffer.toString("utf8", 0, total) };
  } catch (cause) {
    return { ok: false, error: `cannot read file: ${(cause as Error).message}` };
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Reads and parses one JSON file. The returned failure text never contains file
 * content, only the parser's position.
 */
export function readJsonFile(file: string): JsonReadResult {
  const text = readTextFile(file);
  if (!text.ok) {
    return text;
  }

  try {
    return { ok: true, value: JSON.parse(text.value as string) };
  } catch (cause) {
    return { ok: false, error: `cannot parse JSON: ${describeJsonError(cause)}` };
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

/**
 * Reads a file a line at a time, holding one chunk and one partial line.
 *
 * Synchronous on purpose: the whole command line is synchronous, and making it
 * asynchronous to gain a line reader would change every command, every exit
 * path and every test for a property none of them needs. `StringDecoder`
 * carries a multi-byte character across a chunk boundary, which a plain
 * `toString` on each chunk would corrupt silently — a truncated UTF-8 sequence
 * is exactly the kind of input this release is about surviving.
 *
 * Throws {@link LineTooLongError} rather than growing without bound.
 */
function* readLines(
  descriptor: number,
  maxTotalBytes?: number,
): Generator<{ readonly text: string; readonly number: number }> {
  const decoder = new StringDecoder("utf8");
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
  let pending = "";
  let number = 0;
  let total = 0;

  try {
    for (;;) {
      const read = readSync(descriptor, chunk, 0, chunk.length, null);
      if (read === 0) {
        break;
      }
      total += read;
      if (maxTotalBytes !== undefined && total > maxTotalBytes) {
        throw new FileGrewError(maxTotalBytes);
      }
      pending += decoder.write(chunk.subarray(0, read));

      let start = 0;
      for (;;) {
        const newline = pending.indexOf("\n", start);
        if (newline === -1) {
          break;
        }
        const text = pending.slice(start, newline);
        number += 1;
        // A complete line is measured too, not only a growing one: a line that
        // ends inside the chunk that carried it past the limit would otherwise
        // be read whole, which is the one case the limit exists to prevent.
        if (tooLong(text)) {
          throw new LineTooLongError(number);
        }
        yield { text, number };
        start = newline + 1;
      }
      pending = start === 0 ? pending : pending.slice(start);

      // And a line that has not ended yet, so that a file with no newline in it
      // at all is refused after one line's worth rather than read entire.
      if (tooLong(pending)) {
        throw new LineTooLongError(number + 1);
      }
    }

    pending += decoder.end();
    if (pending !== "") {
      const text = pending;
      number += 1;
      if (tooLong(text)) {
        throw new LineTooLongError(number);
      }
      yield { text, number };
    }
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Whether a line is over the limit.
 *
 * Counting the bytes of every line would walk each one a second time. A
 * JavaScript string holds at most three UTF-8 bytes per unit, so a line short
 * enough in units cannot be long enough in bytes, and the count is only taken
 * when it could change the answer.
 */
function tooLong(line: string): boolean {
  return line.length * 3 > MAX_LINE_BYTES && Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES;
}

/** A file held whole that grew past its limit after its size was taken. */
class FileGrewError extends Error {
  constructor(limit: number) {
    super(`file grew above the ${limit} byte limit while it was read`);
    this.name = "FileGrewError";
  }
}

/** A line longer than {@link MAX_LINE_BYTES}, reported by line number alone. */
class LineTooLongError extends Error {
  constructor(readonly line: number) {
    super(`line ${line} is longer than the ${MAX_LINE_BYTES} byte limit for one event`);
    this.name = "LineTooLongError";
  }
}

/**
 * Whether a parsed value nests deeper than {@link MAX_JSON_DEPTH}.
 *
 * `JSON.parse` imposes no depth limit, and the validator recurses: a value a
 * few thousand levels deep overflows the stack inside it. So depth is checked
 * where a document is read, with a walk that stops one level past the limit and
 * therefore cannot overflow itself. The limit is the one canonicalization and
 * the MCP server already apply; no audit event is anywhere near it.
 */
export function nestedTooDeep(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => nestedTooDeep(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) =>
      nestedTooDeep(item, depth + 1),
    );
  }
  return false;
}

const TOO_DEEP = `nested more than ${MAX_JSON_DEPTH} levels deep, deeper than any audit event`;

/** One item from a stream: an event, or a file that could not be read past a point. */
export type LoadedItem =
  | { readonly kind: "event"; readonly document: EventDocument }
  | { readonly kind: "failure"; readonly failure: DocumentLoadFailure };

/**
 * Streams every event in one file.
 *
 * JSON Lines is read a line at a time, so a file larger than memory is checked
 * event by event. A single JSON document is read whole, because it cannot be
 * parsed in pieces, and stays under {@link MAX_DOCUMENT_BYTES}.
 *
 * `wholeFileLimit` refuses a JSON Lines file above {@link MAX_DOCUMENT_BYTES}
 * before reading any of it, for a caller that will hold every event at once.
 * Streaming removed the reason for that limit; it did not remove the reason
 * for it where the events are not released, and a caller that cannot say no
 * early has only moved where it runs out of memory.
 *
 * **A malformed line stops that file and is reported.** The events before it
 * have already been yielded and already count, which is the one behaviour this
 * differs from the whole-file reader it replaced: that one discarded a
 * thousand good events because the thousand-and-first line was truncated.
 * Reporting what was read and where reading stopped says more than reporting
 * nothing, and the exit code is unchanged — a file that could not be read is
 * still a `2`.
 */
export function* streamFile(file: string, options: ReadOptions = {}): Generator<LoadedItem> {
  if (isJsonLines(file)) {
    const opened = openRegularFile(file);
    if (!opened.ok) {
      yield { kind: "failure", failure: { file, error: opened.error } };
      return;
    }
    if (options.wholeFileLimit === true && opened.size > MAX_DOCUMENT_BYTES) {
      closeSync(opened.descriptor);
      yield { kind: "failure", failure: { file, error: tooLargeMessage(opened.size) } };
      return;
    }

    try {
      const limit = options.wholeFileLimit === true ? MAX_DOCUMENT_BYTES : undefined;
      for (const line of readLines(opened.descriptor, limit)) {
        // Trimming is what makes a CRLF file read like any other, and what
        // lets a blank line be blank; the reader yields a line as the file
        // holds it and leaves that judgement here.
        const trimmed = line.text.trim();
        if (trimmed === "") {
          continue;
        }
        let event: unknown;
        try {
          event = JSON.parse(trimmed);
        } catch (cause) {
          yield {
            kind: "failure",
            failure: {
              file,
              error: `cannot parse JSON on line ${line.number}: ${describeJsonError(cause)}`,
            },
          };
          return;
        }
        if (nestedTooDeep(event)) {
          yield { kind: "failure", failure: { file, error: `line ${line.number} is ${TOO_DEEP}` } };
          return;
        }
        yield {
          kind: "event",
          document: { file, index: line.number, label: `${file}#${line.number}`, event },
        };
      }
    } catch (cause) {
      // A line over the limit says so for itself; anything else here is the
      // file refusing to be read at all, and wears the same prefix as every
      // other unreadable file so that one search finds them all.
      const error =
        cause instanceof LineTooLongError || cause instanceof FileGrewError
          ? cause.message
          : `cannot read file: ${(cause as Error).message}`;
      yield { kind: "failure", failure: { file, error } };
    }
    return;
  }

  const parsed = readJsonFile(file);
  if (!parsed.ok) {
    yield { kind: "failure", failure: { file, error: parsed.error } };
    return;
  }

  if (
    Array.isArray(parsed.value)
      ? parsed.value.some((event) => nestedTooDeep(event))
      : nestedTooDeep(parsed.value)
  ) {
    yield { kind: "failure", failure: { file, error: `the document is ${TOO_DEEP}` } };
    return;
  }

  if (Array.isArray(parsed.value)) {
    for (const [index, event] of parsed.value.entries()) {
      yield { kind: "event", document: { file, index, label: `${file}#${index}`, event } };
    }
    return;
  }

  yield { kind: "event", document: { file, label: file, event: parsed.value } };
}

/**
 * Streams every event in every input path, in the order the paths expand.
 *
 * This is what a command reads when it can judge one event at a time.
 * `verify-chain` and the commands built on it cannot: a chain is a property of
 * a whole set, and they collect through {@link loadEventDocuments}.
 */
export function* streamEventDocuments(
  inputs: readonly string[],
  options: ReadOptions = {},
): Generator<LoadedItem> {
  for (const file of expandInputPaths(inputs)) {
    yield* streamFile(file, options);
  }
}

function collect(items: Iterable<LoadedItem>): DocumentLoadResult {
  const documents: EventDocument[] = [];
  const failures: DocumentLoadFailure[] = [];
  for (const item of items) {
    if (item.kind === "event") {
      documents.push(item.document);
    } else {
      failures.push(item.failure);
    }
  }
  return { documents, failures };
}

/**
 * Reads every event contained in one file. A file may hold a single event
 * object, an array of events, or one event per line for `.jsonl` and `.ndjson`.
 */
export function readEventDocuments(file: string, options: ReadOptions = {}): DocumentLoadResult {
  return collect(streamFile(file, options));
}

/**
 * Reads every event in every input path into memory at once.
 *
 * For the commands that need the whole set — chain verification and everything
 * built on it — and for callers that are handed a small corpus. A command that
 * can judge one event at a time should read {@link streamEventDocuments}
 * instead, which holds one event rather than all of them.
 */
export function loadEventDocuments(inputs: readonly string[]): DocumentLoadResult {
  // Every event is kept, so every file is limited — JSON Lines included.
  return collect(streamEventDocuments(inputs, { wholeFileLimit: true }));
}
