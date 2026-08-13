/**
 * Host validation is on by default: with no OAM_ALLOWED_HOSTS configured, the
 * server answers on loopback names only. These tests hold that default to the
 * code, and pin the allowlist and trusted-proxy semantics the deployment
 * documentation describes.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isHostAllowed } from "../src/http-server.js";

const noHosts = { allowedHosts: new Set<string>(), trustProxy: false };
const publicHosts = { allowedHosts: new Set(["mcp.example.org"]), trustProxy: false };

describe("host validation defaults", () => {
  const local = [
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "[::1]",
    "[::1]:3000",
  ];
  for (const host of local) {
    test(`with no allowlist configured, loopback host "${host}" is accepted`, () => {
      assert.equal(isHostAllowed({ host }, noHosts), true);
    });
  }

  test("with no allowlist configured, a public host is refused", () => {
    assert.equal(isHostAllowed({ host: "mcp.example.org" }, noHosts), false);
  });

  test("with no allowlist configured, a missing Host header is refused", () => {
    assert.equal(isHostAllowed({}, noHosts), false);
  });
});

describe("host allowlist", () => {
  test("a listed host is accepted, with or without a port", () => {
    assert.equal(isHostAllowed({ host: "mcp.example.org" }, publicHosts), true);
    assert.equal(isHostAllowed({ host: "mcp.example.org:443" }, publicHosts), true);
  });

  test("an unlisted host is refused, including loopback", () => {
    assert.equal(isHostAllowed({ host: "evil.example.org" }, publicHosts), false);
    // The default loopback names apply only when nothing is configured; an
    // explicit allowlist is the complete statement of what is answered.
    assert.equal(isHostAllowed({ host: "localhost" }, publicHosts), false);
  });

  test("a bracketed IPv6 host has its port stripped before comparison", () => {
    const v6 = { allowedHosts: new Set(["[::1]"]), trustProxy: false };
    assert.equal(isHostAllowed({ host: "[::1]:8880" }, v6), true);
  });
});

describe("X-Forwarded-Host", () => {
  test("is ignored unless the deployment trusts its proxy", () => {
    const headers = { host: "127.0.0.1:8880", "x-forwarded-host": "evil.example.org" };
    assert.equal(isHostAllowed(headers, noHosts), true);
  });

  test("is believed when the deployment trusts its proxy", () => {
    const trusted = { allowedHosts: new Set(["mcp.example.org"]), trustProxy: true };
    const headers = { host: "127.0.0.1:8880", "x-forwarded-host": "mcp.example.org" };
    assert.equal(isHostAllowed(headers, trusted), true);
    assert.equal(
      isHostAllowed({ host: "127.0.0.1:8880", "x-forwarded-host": "evil.example.org" }, trusted),
      false,
    );
  });
});
