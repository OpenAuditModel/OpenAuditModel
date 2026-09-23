/**
 * Reading events as a stream.
 *
 * A JSON Lines archive is read a line at a time, so the memory a run needs is
 * bounded by the largest single event rather than by the size of the archive.
 * These tests hold the reader to that: the chunk boundary must be invisible,
 * a line that is too long must be refused by line number, and a malformed
 * line must not cost the events that were read before it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_LINE_BYTES, readEventDocuments, streamEventDocuments } from "../src/sources.js";
import { readFileSync, statSync } from "node:fs";
import { sealEvent } from "../src/integrity/digest.js";
import { resolveSchemaPath } from "../src/validate.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const scratch = mkdtempSync(path.join(tmpdir(), "openauditmodel-stream-"));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeScratch(name: string, contents: string): string {
  const file = path.join(scratch, name);
  writeFileSync(file, contents, "utf8");
  return file;
}

function auditmodel(...args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** A schema-valid event, distinguishable by its resource id. */
function event(index: number): Record<string, unknown> {
  return {
    specVersion: "0.1",
    id: `018f1b5c-6d2a-7c3e-9a1b-${String(index).padStart(12, "0")}`,
    time: "2026-03-14T09:24:31.412Z",
    event: { name: "data.record.update", category: "data-modification", outcome: "success" },
    actor: { type: "user", id: "user-123" },
    resource: { type: "record", id: `resource-${index}` },
    application: { name: "application-service", environment: "production" },
  };
}

function lines(count: number, from = 0): string {
  return `${Array.from({ length: count }, (_, index) => JSON.stringify(event(from + index))).join("\n")}\n`;
}

describe("the line reader", () => {
  test("reads a file whose lines cross many chunk boundaries", () => {
    // The reader works in 64 KiB chunks; ~2000 events is several of them, and
    // no event boundary lines up with a chunk boundary.
    const file = writeScratch("many.jsonl", lines(2000));
    const result = readEventDocuments(file);

    assert.equal(result.failures.length, 0);
    assert.equal(result.documents.length, 2000);
    assert.equal(result.documents[0]?.index, 1, "line numbers start at 1");
    assert.equal(result.documents[1999]?.index, 2000);
    assert.equal(
      (result.documents[1999]?.event as { resource: { id: string } }).resource.id,
      "resource-1999",
    );
  });

  test("reads one event larger than a chunk", () => {
    const big = event(1);
    big.resource = { type: "record", id: "x".repeat(200_000) };
    const file = writeScratch(
      "big-line.jsonl",
      `${JSON.stringify(big)}\n${JSON.stringify(event(2))}\n`,
    );
    const result = readEventDocuments(file);

    assert.equal(result.failures.length, 0);
    assert.equal(result.documents.length, 2);
    assert.equal(
      (result.documents[0]?.event as { resource: { id: string } }).resource.id.length,
      200_000,
    );
  });

  test("keeps multi-byte characters whole across a chunk boundary", () => {
    // A run of characters that each take three bytes in UTF-8 is certain to be
    // cut mid-character by a 64 KiB read. Decoding each chunk on its own would
    // corrupt the text; the reader must carry the partial character over.
    const wide = event(1);
    wide.resource = { type: "record", id: "ışık".repeat(30_000) };
    const file = writeScratch("wide.jsonl", `${JSON.stringify(wide)}\n`);
    const result = readEventDocuments(file);

    assert.equal(result.failures.length, 0);
    assert.equal(
      (result.documents[0]?.event as { resource: { id: string } }).resource.id,
      "ışık".repeat(30_000),
    );
  });

  test("ignores blank lines and a trailing newline", () => {
    const file = writeScratch(
      "blank.jsonl",
      `\n${JSON.stringify(event(1))}\n\n   \n${JSON.stringify(event(2))}\n\n`,
    );
    const result = readEventDocuments(file);

    assert.equal(result.failures.length, 0);
    assert.equal(result.documents.length, 2);
    // The line number is the line in the file, not the event's position: a
    // reported line has to be the line an editor will open.
    assert.equal(result.documents[0]?.index, 2);
    assert.equal(result.documents[1]?.index, 5);
  });

  test("reads a file with no trailing newline", () => {
    const file = writeScratch("no-newline.jsonl", JSON.stringify(event(1)));
    const result = readEventDocuments(file);

    assert.equal(result.failures.length, 0);
    assert.equal(result.documents.length, 1);
  });

  test("reads CRLF line endings", () => {
    const file = writeScratch(
      "crlf.jsonl",
      `${JSON.stringify(event(1))}\r\n${JSON.stringify(event(2))}\r\n`,
    );
    const result = readEventDocuments(file);

    assert.equal(result.failures.length, 0);
    assert.equal(result.documents.length, 2);
  });

  test("refuses a line longer than the limit, by line number", () => {
    const huge = `{"padding":"${"x".repeat(MAX_LINE_BYTES)}"}`;
    const file = writeScratch("huge-line.jsonl", `${JSON.stringify(event(1))}\n${huge}\n`);
    const result = readEventDocuments(file);

    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0]?.error ?? "", /line 2 is longer than the \d+ byte limit/);
    // The event before the refused line was already read, and still counts.
    assert.equal(result.documents.length, 1);
  });

  test("refuses a file that never reaches a newline, without reading it", () => {
    // Not one long event but one long non-event. The file is eight times the
    // limit and the heap is smaller than the file, so a reader that waited for
    // a newline before deciding would be killed rather than answer: the check
    // that refuses a line still growing is what is under test, and asserting
    // the message alone would not reach it — the end-of-file check produces
    // the same words.
    const file = path.join(scratch, "no-newline-ever.jsonl");
    const chunk = "x".repeat(8 * 1024 * 1024);
    writeFileSync(file, chunk, "utf8");
    for (let index = 0; index < 7; index += 1) {
      appendFileSync(file, chunk, "utf8");
    }

    const result = spawnSync(
      process.execPath,
      ["--max-old-space-size=48", cliPath, "validate", "--quiet", file],
      { cwd: repoRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /line 1 is longer than/);
    assert.doesNotMatch(result.stderr, /heap out of memory/);
  });

  test("stops at a malformed line and reports where", () => {
    const file = writeScratch(
      "broken.jsonl",
      `${lines(3)}{"specVersion": broken\n${JSON.stringify(event(9))}\n`,
    );
    const result = readEventDocuments(file);

    assert.equal(result.documents.length, 3, "the events before the bad line are kept");
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0]?.error ?? "", /cannot parse JSON on line 4/);
  });

  test("carries on with the next file after one cannot be read", () => {
    const bad = writeScratch("first-bad.jsonl", "{not json\n");
    const good = writeScratch("then-good.jsonl", lines(2));
    const items = [...streamEventDocuments([bad, good])];

    assert.deepEqual(
      items.map((item) => item.kind),
      ["failure", "event", "event"],
    );
  });
});

describe("what a command does with a partly unreadable archive", () => {
  test("validate reports the events it read and still exits 2", () => {
    const file = writeScratch("validate-partial.jsonl", `${lines(3)}{"specVersion": broken\n`);
    const result = auditmodel("validate", file);

    // The exit code is unchanged: a file that could not be read is a 2, and
    // silence about the rest would say less, not more.
    assert.equal(result.status, 2);
    assert.match(result.stdout, /3 events checked: 3 valid, 0 invalid, 1 unreadable/);
    assert.match(result.stdout, /cannot parse JSON on line 4/);
  });

  test("the unreadable file is reported where it occurred", () => {
    const first = writeScratch("order-first.jsonl", lines(1, 100));
    const broken = writeScratch("order-broken.jsonl", "{not json\n");
    const last = writeScratch("order-last.jsonl", lines(1, 200));
    const result = auditmodel("validate", first, broken, last);

    const before = result.stdout.indexOf("order-first.jsonl#1");
    const error = result.stdout.indexOf("order-broken.jsonl");
    const after = result.stdout.indexOf("order-last.jsonl#1");
    assert.ok(before >= 0 && error > before && after > error, result.stdout);
  });

  test("lint-privacy still names the unreadable file in its JSON report", () => {
    const file = writeScratch("lint-partial.jsonl", `${lines(2)}{oops\n`);
    const result = auditmodel("lint-privacy", "--format", "json", file);

    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout) as {
      summary: { events: number };
      unreadable: readonly { file: string; error: string }[];
      results: readonly unknown[];
    };
    assert.equal(report.summary.events, 2);
    assert.equal(report.results.length, 2);
    assert.equal(report.unreadable.length, 1);
    assert.match(report.unreadable[0]?.error ?? "", /line 3/);
  });

  test("check-profile prints its profile line above the first result", () => {
    const file = writeScratch("profile-partial.jsonl", lines(2));
    const result = auditmodel("check-profile", "--profile", "document-management", file);

    const profileLine = result.stdout.indexOf("profile: document-management");
    const firstResult = result.stdout.indexOf("profile-partial.jsonl#1");
    assert.ok(profileLine >= 0 && firstResult > profileLine, result.stdout);
  });
});

describe("the commands that cannot release an event", () => {
  // `verify-checkpoint`, `verify-proof` and `check-coverage` still hold every
  // event at once. Streaming removed the reason for a whole-file limit where
  // events are released; it did not remove it here, and a command that cannot
  // say no early would be killed part-way through instead of answering.
  const tooLarge = (): string => {
    const file = path.join(scratch, "too-large.jsonl");
    const chunk = lines(4000);
    writeFileSync(file, chunk, "utf8");
    while (statSync(file).size <= MAX_LINE_BYTES) {
      appendFileSync(file, chunk, "utf8");
    }
    return file;
  };

  test("check-coverage refuses an archive it would have to hold whole", () => {
    const result = auditmodel(
      "check-coverage",
      "--profile",
      "document-management",
      "--quiet",
      tooLarge(),
    );

    assert.equal(result.status, 2);
    assert.match(result.stdout, /above the \d+ byte limit/);
    assert.doesNotMatch(result.stderr, /heap out of memory/);
  });

  test("verify-checkpoint refuses the same archive", () => {
    const result = auditmodel(
      "verify-checkpoint",
      "--checkpoint",
      "examples/integrity/checkpoints/three-event-chain.checkpoint.json",
      "--quiet",
      tooLarge(),
    );

    assert.equal(result.status, 2);
    assert.match(result.stdout, /above the \d+ byte limit/);
  });

  test("validate reads the archive the others refused", () => {
    const result = auditmodel("validate", "--quiet", tooLarge());

    assert.equal(result.status, 0);
    assert.match(result.stdout, /events checked: \d+ valid, 0 invalid/);
  });

  test("verify-checkpoint makes no comparison when a line could not be read", () => {
    // Every event that was not read is missing in exactly the way a deleted
    // one is, and `tail-truncated` is the finding that means somebody removed
    // events. It must not be what a syntax error produces.
    const chain = readFileSync("examples/integrity/valid/three-event-chain/001.json", "utf8");
    const second = readFileSync("examples/integrity/valid/three-event-chain/002.json", "utf8");
    const file = writeScratch(
      "partial-chain.jsonl",
      `${JSON.stringify(JSON.parse(chain))}\n${JSON.stringify(JSON.parse(second))}\n{broken\n`,
    );

    const result = auditmodel(
      "verify-checkpoint",
      "--checkpoint",
      "examples/integrity/checkpoints/three-event-chain.checkpoint.json",
      file,
    );

    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /tail-truncated/);
    assert.match(result.stderr, /no comparison was made/);
  });
});

describe("what a run holds in memory", () => {
  test("validate checks an archive far larger than its heap", () => {
    // 40 000 events is roughly 10 MB on disk and several times that once
    // parsed. Under a 64 MB heap a run that kept every event would run out;
    // a run that keeps one event at a time does not.
    const file = path.join(scratch, "large.jsonl");
    writeFileSync(file, lines(40_000), "utf8");

    const result = spawnSync(
      process.execPath,
      ["--max-old-space-size=64", cliPath, "validate", "--quiet", file],
      { cwd: repoRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /40000 events checked: 40000 valid/);
  });

  test("verify-chain verifies a chain far longer than its heap would hold", () => {
    // A chain has to be judged as a whole, so its events cannot be forgotten
    // as they are read — but what has to be remembered is each event's links
    // and the verdict on its own digest, not the event. Under the same 64 MB
    // heap, a run that kept the events would not finish this.
    const count = 30_000;
    const file = path.join(scratch, "long-chain.jsonl");
    const events: string[] = [];
    let previousHash: string | undefined;

    for (let index = 0; index < count; index += 1) {
      const sealed = sealEvent({
        ...event(index),
        sequence: index + 1,
        integrity: {
          canonicalization: "RFC8785",
          hashAlgorithm: "SHA-256",
          hash: "",
          ...(previousHash === undefined ? {} : { previousHash }),
          chainId: "chain-long",
        },
      }) as { integrity: { hash: string } };
      previousHash = sealed.integrity.hash;
      events.push(JSON.stringify(sealed));
    }
    writeFileSync(file, `${events.join("\n")}\n`, "utf8");

    const result = spawnSync(
      process.execPath,
      ["--max-old-space-size=64", cliPath, "verify-chain", "--quiet", file],
      { cwd: repoRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(
      result.stdout,
      new RegExp(`1 chain checked: 1 intact, 0 broken \\(${count} events\\)`),
    );
  });
});
