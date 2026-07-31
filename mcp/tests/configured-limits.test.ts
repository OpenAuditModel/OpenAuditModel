/**
 * The configured input limits must be the limits actually enforced.
 *
 * `OAM_MAX_EVENT_BYTES` and `OAM_MAX_CHAIN_EVENTS` were parsed, range-checked,
 * cross-validated against the request limit and documented as operator
 * controls — while the tools enforced hardcoded constants instead, so setting
 * either had no effect. Nothing detected it because every existing test ran on
 * the default configuration, where the two values happen to be identical.
 *
 * These tests run a server on a *non-default* configuration, which is the only
 * way the difference is observable.
 */
import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";

import { createHttpApplication } from "../src/http-server.js";
import { loadConfig } from "../src/config.js";

const ORIGIN = "https://openauditmodel.org";

/** Deliberately far below the defaults, so an unwired limit cannot pass. */
const MAX_EVENT_BYTES = 2_000;
const MAX_CHAIN_EVENTS = 3;

const application = createHttpApplication(
  loadConfig({
    PORT: "0",
    HOST: "127.0.0.1",
    OAM_LOG_LEVEL: "silent",
    OAM_MAX_EVENT_BYTES: String(MAX_EVENT_BYTES),
    OAM_MAX_CHAIN_EVENTS: String(MAX_CHAIN_EVENTS),
  }),
);

let origin = "";

before(async () => {
  const { port } = await application.listen();
  origin = `http://127.0.0.1:${port}`;
});

after(async () => {
  await application.close();
});

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      origin: ORIGIN,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const text = await response.text();
  const payload = text.includes("data: ")
    ? (text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .pop()
        ?.slice(6) ?? text)
    : text;
  const json = JSON.parse(payload) as {
    result?: { content?: { text?: string }[] };
  };
  return json.result?.content?.[0]?.text ?? "";
}

/** A valid event padded to a known serialized size. */
function eventOfAtLeast(bytes: number): Record<string, unknown> {
  return {
    specVersion: "0.1",
    id: "01952d4e-0000-7000-8000-000000000000",
    time: "2026-01-01T00:00:00.000Z",
    name: "limits.test.run",
    outcome: "success",
    actor: { type: "service", id: "limits-test" },
    resource: { type: "limits-test", id: "limits-test" },
    source: { service: "limits-test" },
    metadata: { padding: "x".repeat(bytes) },
  };
}

describe("configured event size limit", () => {
  test("an event above OAM_MAX_EVENT_BYTES is refused", async () => {
    const body = await call("validate_event", { event: eventOfAtLeast(MAX_EVENT_BYTES * 2) });

    assert.match(body, /event-too-large/);
    // The message must quote the configured limit, not the built-in default.
    assert.match(body, new RegExp(String(MAX_EVENT_BYTES)));
    assert.doesNotMatch(body, /256000/);
  });

  test("an event below the configured limit is still accepted", async () => {
    const body = await call("validate_event", { event: eventOfAtLeast(10) });

    assert.doesNotMatch(body, /event-too-large/);
  });
});

describe("configured chain length limit", () => {
  test("more events than OAM_MAX_CHAIN_EVENTS are refused", async () => {
    const events = Array.from({ length: MAX_CHAIN_EVENTS + 1 }, () => eventOfAtLeast(10));

    const body = await call("verify_chain", { events });

    assert.match(body, /too-many-events/);
    assert.match(body, new RegExp(String(MAX_CHAIN_EVENTS)));
    // The default would have accepted these, so a stale constant is visible.
    assert.doesNotMatch(body, /limit of 200/);
  });

  test("the configured maximum itself is accepted", async () => {
    const events = Array.from({ length: MAX_CHAIN_EVENTS }, () => eventOfAtLeast(10));

    const body = await call("verify_chain", { events });

    assert.doesNotMatch(body, /too-many-events/);
  });

  test("verify_chain reports the configured limit rather than the default", async () => {
    const events = Array.from({ length: MAX_CHAIN_EVENTS }, () => eventOfAtLeast(10));

    const body = await call("verify_chain", { events });
    const parsed = JSON.parse(body) as {
      limits?: { maxEventsPerRequest?: number };
    };

    assert.equal(parsed.limits?.maxEventsPerRequest, MAX_CHAIN_EVENTS);
  });
});
