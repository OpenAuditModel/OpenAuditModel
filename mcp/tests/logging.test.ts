/**
 * The log field allowlist is a privacy control, not a formatting preference:
 * SECURITY.md and ADR 0011 both claim that no audit event content can reach an
 * operator's log aggregator through this service. These tests hold the claim to
 * the code, so that widening the allowlist has to be a deliberate act with a
 * failing test in front of it.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createLogger, type LogFields } from "../src/logging.js";

/** Captures emitted lines instead of writing them to stdout. */
function capture(level: Parameters<typeof createLogger>[0]): {
  logger: ReturnType<typeof createLogger>;
  lines: Record<string, unknown>[];
} {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger(level, (line) => {
    lines.push(JSON.parse(line) as Record<string, unknown>);
  });
  return { logger, lines };
}

const ALLOWED = new Set([
  "timestamp",
  "level",
  "requestId",
  "route",
  "toolName",
  "resultCategory",
  "statusCode",
  "port",
  "durationMs",
  "message",
]);

describe("log field allowlist", () => {
  test("a line carries only allowlisted fields", () => {
    const { logger, lines } = capture("debug");

    logger.info({
      requestId: "1e6b3f0a-0000-4000-8000-000000000000",
      route: "/mcp",
      toolName: "validate_event",
      resultCategory: "ok",
      statusCode: 200,
      durationMs: 4,
      message: "handled",
    });

    assert.equal(lines.length, 1);
    for (const key of Object.keys(lines[0]!)) {
      assert.ok(ALLOWED.has(key), `unexpected log field: ${key}`);
    }
  });

  test("an unexpected property cannot ride along into a line", () => {
    const { logger, lines } = capture("debug");

    // A caller that smuggles event content past the type system must still not
    // get it logged: the emitter reads named fields rather than spreading.
    const smuggled = {
      route: "/mcp",
      event: { actor: { id: "user-42" }, name: "user.create" },
      digest: "sha-256:0000",
      apiKey: "not-a-real-key",
    } as unknown as LogFields;

    logger.info(smuggled);

    const line = lines[0]!;
    assert.equal(line["route"], "/mcp");
    for (const key of ["event", "digest", "apiKey"]) {
      assert.ok(!(key in line), `${key} reached the log`);
    }
    assert.doesNotMatch(JSON.stringify(line), /user-42|user\.create|not-a-real-key/);
  });

  test("the port is logged as a port, not as a status code", () => {
    const { logger, lines } = capture("info");

    logger.info({ resultCategory: "started", port: 3000, message: "listening" });

    // A port in `statusCode` would be read as an HTTP status by any aggregator
    // that parses these lines, which is worse than not logging it at all.
    assert.equal(lines[0]!["port"], 3000);
    assert.ok(!("statusCode" in lines[0]!));
  });

  test("every line carries a timestamp and a level", () => {
    const { logger, lines } = capture("debug");

    logger.debug({ message: "a" });
    logger.info({ message: "b" });
    logger.error({ message: "c" });

    assert.deepEqual(
      lines.map((line) => line["level"]),
      ["debug", "info", "error"],
    );
    for (const line of lines) {
      assert.match(String(line["timestamp"]), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    }
  });

  test("an omitted field is absent rather than null", () => {
    const { logger, lines } = capture("debug");

    logger.info({ route: "/health" });

    assert.deepEqual(Object.keys(lines[0]!).sort(), ["level", "route", "timestamp"]);
  });
});

describe("log levels", () => {
  test("a level below the threshold is dropped", () => {
    const { logger, lines } = capture("error");

    logger.debug({ message: "a" });
    logger.info({ message: "b" });
    logger.error({ message: "c" });

    assert.deepEqual(
      lines.map((line) => line["message"]),
      ["c"],
    );
  });

  test("silent emits nothing at all", () => {
    const { logger, lines } = capture("silent");

    logger.debug({ message: "a" });
    logger.info({ message: "b" });
    logger.error({ message: "c" });

    assert.equal(lines.length, 0);
  });
});
