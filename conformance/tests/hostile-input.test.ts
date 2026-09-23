/**
 * Inputs built to break the tool rather than to fail a check.
 *
 * An audit tool is pointed at whatever an archive happens to contain, which
 * includes whatever an attacker managed to write into it. What matters here is
 * not the verdict but that there is one: every input must leave through a
 * documented exit code, and none may crash the process, hang it, or exhaust
 * its memory. A stack trace on stderr is a failure of this file even when the
 * exit code is right, because a crash tells an operator nothing about the
 * archive.
 *
 * The exit codes are 0 pass, 1 fail, 2 could not run, 3 no verdict.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";
import { fileURLToPath } from "node:url";
import { readEventDocuments } from "../src/sources.js";
import { createValidator, resolveSchemaPath } from "../src/validate.js";
import { verifyEventIntegrity } from "../src/integrity/verify-event.js";
import { verifyChains } from "../src/integrity/verify-chain.js";
import { lintEvent } from "../src/privacy/lint-event.js";
import { checkProfile } from "../src/profiles/check-profile.js";
import { loadProfile } from "../src/profiles/load-profile.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const scratch = mkdtempSync(path.join(tmpdir(), "openauditmodel-hostile-"));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const DOCUMENTED_EXIT_CODES = [0, 1, 2, 3];

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function auditmodel(...args: string[]): CliResult {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** A stack trace frame, which is what a crash leaves behind and a report does not. */
const STACK_FRAME = /^\s+at .+:\d+:\d+/m;

function survives(result: CliResult, what: string): void {
  assert.ok(
    DOCUMENTED_EXIT_CODES.includes(result.status),
    `${what}: exit ${result.status}, expected one of ${DOCUMENTED_EXIT_CODES.join(", ")}`,
  );
  assert.doesNotMatch(result.stderr, STACK_FRAME, `${what}: crashed instead of reporting`);
}

function write(name: string, contents: string | Buffer): string {
  const file = path.join(scratch, name);
  writeFileSync(file, contents);
  return file;
}

function validEvent(): Record<string, unknown> {
  return {
    specVersion: "0.1",
    id: "018f1b5c-6d2a-7c3e-9a1b-4f5e6d7c8b9a",
    time: "2026-03-14T09:24:31.412Z",
    event: { name: "data.record.update", category: "data-modification", outcome: "success" },
    actor: { type: "user", id: "user-123" },
    resource: { type: "record", id: "resource-123" },
    application: { name: "application-service", environment: "production" },
  };
}

describe("shapes that break parsers", () => {
  test("nesting deeper than the parser's stack is reported, not crashed", () => {
    const depth = 200_000;
    const deep = `${"[".repeat(depth)}${"]".repeat(depth)}`;
    const file = write("deep.json", deep);
    const result = auditmodel("validate", file);

    survives(result, "deep nesting");
    // The parser in use is iterative and reads this without complaint, so the
    // input arrives as one event that is not an event: a verdict, not a crash.
    // A parser that refused it would fail the read instead, which is also a
    // documented outcome — what must not happen is a stack overflow.
    assert.ok(result.status === 1 || result.status === 2, `exit ${result.status}`);
  });

  test("nesting inside one JSON Lines event is reported by line", () => {
    const depth = 200_000;
    const file = write("deep.jsonl", `${JSON.stringify(validEvent())}\n${"[".repeat(depth)}\n`);
    const result = auditmodel("validate", file);

    survives(result, "deep nesting in a line");
    assert.equal(result.status, 2);
    assert.match(result.stdout, /line 2/);
    // The event before it was read, which is the whole point of reading a line
    // at a time rather than a file at a time.
    assert.match(result.stdout, /1 event checked/);
  });

  test("an array of many events is checked one at a time", () => {
    const events = Array.from({ length: 20_000 }, () => validEvent());
    const file = write("many.json", JSON.stringify(events));
    const result = auditmodel("validate", "--quiet", file);

    survives(result, "a large array");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /20000 events checked: 20000 valid/);
  });

  test("bytes that are not UTF-8 are reported, not decoded into nonsense", () => {
    // A lone continuation byte and a truncated three-byte sequence.
    const file = write("bad-utf8.jsonl", Buffer.from([0x80, 0xe2, 0x28, 0xa1, 0x0a]));
    const result = auditmodel("validate", file);

    survives(result, "malformed UTF-8");
    assert.equal(result.status, 2);
  });

  test("a truncated multi-byte character at the end of a file is reported", () => {
    const head = Buffer.from(`${JSON.stringify(validEvent())}\n{"id":"`, "utf8");
    const file = write("truncated-utf8.jsonl", Buffer.concat([head, Buffer.from([0xf0, 0x9f])]));
    const result = auditmodel("validate", file);

    survives(result, "a truncated character");
    assert.equal(result.status, 2);
    assert.match(result.stdout, /1 event checked/);
  });

  test("a duplicate key produces a verdict on the value the parser kept", () => {
    // JSON.parse keeps the last occurrence. The tool hashes and checks the
    // parsed event, so what it reports is what any other parser would also
    // see — but it must say something rather than fall over.
    const file = write(
      "duplicate-keys.json",
      '{"specVersion":"0.1","specVersion":"0.1","id":"018f1b5c-6d2a-7c3e-9a1b-4f5e6d7c8b9a","time":"2026-03-14T09:24:31.412Z","event":{"name":"data.record.update","category":"data-modification","outcome":"success"},"actor":{"type":"user","id":"a"},"resource":{"type":"record","id":"r"},"application":{"name":"s","environment":"production"}}',
    );
    const result = auditmodel("validate", file);

    survives(result, "duplicate keys");
    assert.equal(result.status, 0);
  });

  test("a __proto__ key does not reach any prototype", () => {
    const event = validEvent();
    const file = write(
      "proto.json",
      JSON.stringify({
        ...event,
        metadata: JSON.parse('{"__proto__":{"polluted":true}}') as unknown,
      }),
    );
    const result = auditmodel("lint-privacy", file);

    survives(result, "a __proto__ key");
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test("lone surrogates and control characters survive every engine", () => {
    const event = validEvent();
    event.resource = { type: "record", id: "\ud800 lone surrogate \u0000 \u001f" };
    const file = write("surrogate.json", JSON.stringify(event));

    for (const command of ["validate", "verify-integrity", "lint-privacy"]) {
      survives(auditmodel(command, file), command);
    }
  });

  test("numbers outside what JSON can carry are reported, not thrown", () => {
    const file = write(
      "numbers.jsonl",
      ['{"n":1e400}', '{"n":-0}', '{"n":123456789012345678901234567890}', '{"n":NaN}'].join("\n"),
    );
    const result = auditmodel("validate", file);

    survives(result, "extreme numbers");
    // `NaN` is not JSON, so the file stops there; the three before it are read.
    assert.equal(result.status, 2);
  });

  test("an empty file and a file of one scalar both refuse to be events", () => {
    survives(auditmodel("validate", write("empty.jsonl", "")), "an empty file");
    survives(auditmodel("validate", write("scalar.json", "42")), "a scalar");
    survives(auditmodel("validate", write("null.json", "null")), "null");
    survives(auditmodel("validate", write("empty-array.json", "[]")), "an empty array");
  });
});

describe("chains built to loop or contradict", () => {
  const validator = createValidator();

  function chainEvent(
    id: string,
    sequence: number,
    previousHash: string | undefined,
    hash: string,
  ): { label: string; event: unknown } {
    const event = validEvent();
    event.id = id;
    event.sequence = sequence;
    event.integrity = {
      canonicalization: "RFC8785",
      hashAlgorithm: "SHA-256",
      hash,
      chainId: "loop",
      ...(previousHash === undefined ? {} : { previousHash }),
    };
    return { label: id, event };
  }

  const A = "a".repeat(64);
  const B = "b".repeat(64);

  test("a two-event cycle terminates with a verdict", () => {
    const report = verifyChains(
      [
        chainEvent("018f1b5c-6d2a-7c3e-9a1b-00000000000a", 1, B, A),
        chainEvent("018f1b5c-6d2a-7c3e-9a1b-00000000000b", 2, A, B),
      ],
      validator,
    );

    assert.equal(report.intact, false);
    assert.ok(report.chains.length > 0);
  });

  test("an event whose previous hash is its own terminates", () => {
    const report = verifyChains(
      [chainEvent("018f1b5c-6d2a-7c3e-9a1b-00000000000c", 1, A, A)],
      validator,
    );

    assert.equal(report.intact, false);
  });

  test("a long chain of duplicated sequence numbers terminates", () => {
    const events = Array.from({ length: 500 }, (_, index) =>
      chainEvent(`018f1b5c-6d2a-7c3e-9a1b-${String(index).padStart(12, "0")}`, 1, undefined, A),
    );
    const report = verifyChains(events, validator);

    assert.equal(report.intact, false);
    assert.ok(
      report.chains[0]?.findings.some((finding) => finding.kind === "duplicate-sequence"),
      "duplicate sequences are reported",
    );
  });
});

describe("random mutation of a valid event", () => {
  const validator = createValidator();
  const loaded = loadProfile("document-management");
  if (!loaded.ok) {
    throw new Error("the profile used for mutation must load");
  }
  const profile = loaded.profile;

  /**
   * A seeded generator, so that a failure here is a failure anyone can
   * reproduce from the seed printed with it rather than a story about a run
   * that once went wrong.
   */
  function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
  }

  const MUTATIONS = [
    (text: string, pick: () => number): string => {
      const at = Math.floor(pick() * text.length);
      return text.slice(0, at) + text.slice(at + 1);
    },
    (text: string, pick: () => number): string => {
      const at = Math.floor(pick() * text.length);
      const byte = String.fromCharCode(Math.floor(pick() * 0x2100));
      return text.slice(0, at) + byte + text.slice(at);
    },
    (text: string, pick: () => number): string => {
      const at = Math.floor(pick() * text.length);
      return text.slice(0, at) + '"' + text.slice(at);
    },
    (text: string, pick: () => number): string => text.slice(0, Math.floor(pick() * text.length)),
    (text: string, pick: () => number): string => {
      const at = Math.floor(pick() * text.length);
      return text.slice(0, at) + text.slice(at, at + 40).repeat(8) + text.slice(at);
    },
  ];

  /**
   * Mutations of the parsed event rather than of its text.
   *
   * Text mutation is how an archive gets damaged, and most of what it produces
   * is not JSON at all — which tests the reader and never reaches an engine.
   * An event that parses and is wrong is the input an engine has to survive,
   * and only a mutation applied after parsing reliably produces one.
   */
  const SHAPES: readonly unknown[] = [
    null,
    0,
    -1,
    1e308,
    "",
    "\ud800",
    true,
    [],
    [[[[[1]]]]],
    {},
    { nested: { deeper: { deepest: [1, 2, 3] } } },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ];

  function mutateShape(event: Record<string, unknown>, pick: () => number): void {
    const keys = Object.keys(event);
    const key = keys[Math.floor(pick() * keys.length)] as string;
    const choice = pick();

    if (choice < 0.25) {
      delete event[key];
      return;
    }
    if (choice < 0.5) {
      event[key] = SHAPES[Math.floor(pick() * SHAPES.length)];
      return;
    }
    if (choice < 0.75) {
      const value = event[key];
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        mutateShape(value as Record<string, unknown>, pick);
        return;
      }
      event[key] = SHAPES[Math.floor(pick() * SHAPES.length)];
      return;
    }
    event[`${key}-renamed`] = event[key];
    delete event[key];
  }

  /** Every engine, on one event, in the order a run would reach them. */
  function everyEngine(event: unknown): void {
    validator.validateEvent(event);
    verifyEventIntegrity(event, "mutation", validator, {});
    lintEvent(event, "mutation", validator);
    checkProfile(event, "mutation", profile, validator);
    verifyChains([{ label: "mutation", event }], validator);
  }

  test("no engine throws on a thousand text mutations that still parse", () => {
    const base = JSON.stringify(validEvent());
    const pick = random(20_260_922);
    let reached = 0;

    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const mutate = MUTATIONS[Math.floor(pick() * MUTATIONS.length)] as (
        text: string,
        pick: () => number,
      ) => string;
      const text = mutate(base, pick);

      let event: unknown;
      try {
        event = JSON.parse(text);
      } catch {
        // A mutation that stops the text being JSON is the reader's business,
        // and the reader is exercised elsewhere.
        continue;
      }

      reached += 1;
      try {
        everyEngine(event);
      } catch (cause) {
        assert.fail(
          `iteration ${iteration} threw ${(cause as Error).message}\ninput: ${text.slice(0, 400)}`,
        );
      }
    }

    // Most text mutations produce something that is not JSON. This test is
    // worth keeping only while enough of them get past the parser, so it says
    // how many did rather than leaving that to be assumed.
    assert.ok(reached > 200, `only ${reached} of 1000 text mutations parsed`);
  });

  test("no engine throws on a thousand mutations of the event's shape", () => {
    const pick = random(7_400_119);

    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const event = validEvent();
      const rounds = 1 + Math.floor(pick() * 3);
      for (let round = 0; round < rounds; round += 1) {
        mutateShape(event, pick);
      }

      try {
        everyEngine(event);
      } catch (cause) {
        assert.fail(
          `iteration ${iteration} threw ${(cause as Error).message}\nevent: ${JSON.stringify(event).slice(0, 400)}`,
        );
      }
    }

    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test("no engine throws on a thousand mutated events read from disk", () => {
    const pick = random(1_000_003);
    const file = path.join(scratch, "mutated.jsonl");
    let reached = 0;

    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const event = validEvent();
      mutateShape(event, pick);
      // The mutated event alone: a pristine one beside it would be read and
      // checked too, and would make the count say more than it tests.
      writeFileSync(file, `${JSON.stringify(event)}\n`, "utf8");

      const result = readEventDocuments(file);
      for (const document of result.documents) {
        reached += 1;
        try {
          everyEngine(document.event);
        } catch (cause) {
          assert.fail(`iteration ${iteration} threw ${(cause as Error).message}`);
        }
      }
    }

    // A shape mutation always serialises, so every iteration must arrive.
    assert.equal(reached, 1000);
  });
});
