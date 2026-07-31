/**
 * Tests that every published valid example conforms, and that the constructs
 * the specification promises to accept are in fact accepted.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { createValidator, resolveSchemaPath, type ValidationIssue } from "../src/validate.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const validDir = path.join(repoRoot, "examples", "valid");
const validator = createValidator(schemaPath);

const exampleFiles = readdirSync(validDir)
  .filter((file) => file.endsWith(".json"))
  .sort((left, right) => left.localeCompare(right, "en"));

/** A fresh mutable copy of the canonical minimal event. */
function minimalEvent(): Record<string, unknown> {
  const raw = readFileSync(path.join(validDir, "minimal-event.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function report(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

function assertValid(event: unknown, context: string): void {
  const issues = validator.validateEvent(event);
  assert.deepEqual(issues, [], `${context} should be valid but reported: ${report(issues)}`);
}

describe("published valid examples", () => {
  test("the documented example set is present", () => {
    assert.deepEqual(exampleFiles, [
      "access-request-approval.json",
      "document-external-share.json",
      "incident-case-close.json",
      "kafka-consumer-offset-reset.json",
      "minimal-event.json",
      "nightly-reconciliation-job.json",
      "order-api-publish.json",
      "order-consumer-new-trace.json",
      "privileged-configuration-change.json",
      "service-account-data-export.json",
      "user-role-assignment.json",
    ]);
  });

  for (const file of exampleFiles) {
    test(`${file} validates against the canonical schema`, () => {
      const result = validator.validateFile(path.join(validDir, file));
      assert.equal(result.status, "valid", `${file} failed: ${report(result.issues)}`);
    });
  }

  test("the minimal example carries only the required fields", () => {
    assert.deepEqual(
      Object.keys(minimalEvent()).sort((a, b) => a.localeCompare(b, "en")),
      ["actor", "application", "event", "id", "resource", "specVersion", "time"],
    );
  });
});

describe("optional context is optional", () => {
  test("an event with no optional top-level object is valid", () => {
    assertValid(minimalEvent(), "an event without optional context");
  });

  test("authentication context may be absent for non-interactive operations", () => {
    const event = minimalEvent();
    event["actor"] = { type: "service", id: "service-account-batch-worker" };
    assertValid(event, "a service operation without authentication context");
  });

  test("observedTime may differ from time", () => {
    const event = minimalEvent();
    event["time"] = "2026-03-14T09:24:31.412Z";
    event["observedTime"] = "2026-03-14T09:31:02.006Z";
    assertValid(event, "an event observed later than it occurred");
  });

  test("outcomes other than failure do not require an error descriptor", () => {
    for (const outcome of ["success", "partial", "unknown"]) {
      const event = minimalEvent();
      (event["event"] as Record<string, unknown>)["outcome"] = outcome;
      assertValid(event, `outcome "${outcome}"`);
    }
  });

  test("a failure carries a sanitized error descriptor", () => {
    const event = minimalEvent();
    event["event"] = {
      name: "authentication.login",
      category: "authentication",
      outcome: "failure",
      error: { code: "invalid-credentials", type: "authentication", retryable: true },
    };
    assertValid(event, "a failure with an error code");
  });
});

describe("delegation", () => {
  test("service-chain delegation does not require a subject", () => {
    const event = minimalEvent();
    event["actor"] = { type: "service", id: "service-gateway" };
    event["delegation"] = { type: "service-chain", reference: "chain-4471" };
    assertValid(event, "service-to-service chaining without a subject");
  });

  test("delegation types that act for a principal accept a subject", () => {
    for (const type of ["impersonation", "on-behalf-of", "delegated"]) {
      const event = minimalEvent();
      event["actor"] = { type: "service", id: "service-worker" };
      event["subject"] = { type: "user", id: "user-8842" };
      event["delegation"] = { type, reason: "Acting for the subject." };
      assertValid(event, `delegation type "${type}" with a subject`);
    }
  });
});

describe("free-form containers", () => {
  test("metadata accepts arbitrary JSON values", () => {
    const event = minimalEvent();
    event["metadata"] = {
      stringValue: "csv",
      integerValue: 42,
      numberValue: 3.5,
      booleanValue: true,
      nullValue: null,
      arrayValue: [1, "two", false, null, { nested: true }],
      objectValue: { level1: { level2: { level3: ["deep", { level4: null }] } } },
      emptyObject: {},
      emptyArray: [],
    };
    assertValid(event, "free-form metadata");
  });

  test("metadata may be an empty object", () => {
    const event = minimalEvent();
    event["metadata"] = {};
    assertValid(event, "empty metadata");
  });

  test("extension values may be recursive JSON structures", () => {
    const event = minimalEvent();
    event["extensions"] = {
      "com.example.workflow.stage": "legal-review",
      "io.vendor.product.feature.enabled": true,
      "org.example.pipeline.graph": {
        nodes: [
          { id: "a", next: [{ id: "b", next: [] }] },
          { id: "c", next: null },
        ],
      },
    };
    assertValid(event, "recursive extension values");
  });

  test("resource and principal attributes accept arbitrary JSON values", () => {
    const event = minimalEvent();
    event["actor"] = {
      type: "service",
      id: "service-worker",
      attributes: { scheduling: { cron: "hourly", retries: [1, 2, 3] } },
    };
    event["resource"] = {
      type: "record",
      id: "resource-123",
      attributes: { shard: 4, replicated: true, labels: null },
    };
    assertValid(event, "free-form attributes");
  });
});

describe("correlation identifiers", () => {
  test("accepts W3C Trace Context compatible identifiers", () => {
    const event = minimalEvent();
    event["request"] = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      route: "/users/{userId}/roles",
      method: "POST",
      protocol: "https",
    };
    assertValid(event, "trace correlation context");
  });

  test("accepts both IPv4 and IPv6 request addresses", () => {
    for (const ipAddress of ["203.0.113.7", "2001:db8::8a2e:370:7334"]) {
      const event = minimalEvent();
      event["request"] = { ipAddress };
      assertValid(event, `request from ${ipAddress}`);
    }
  });
});

describe("integrity material", () => {
  test("accepts a hash chain entry", () => {
    const event = minimalEvent();
    event["integrity"] = {
      canonicalization: "RFC8785",
      hashAlgorithm: "SHA-256",
      hash: "b0d4f1e2a37c5589e6f1c0a4d7b2e93f8c15a6d0e4b7c9f2a1d3e5b8c0f7a294",
      previousHash: "5c9a1f3e7b204d68a1c5e9f0b3d7a2c48e6f0b9d1a3c5e7f9b0d2a4c6e8f0b13",
      chainId: "chain-instance-7c1a",
    };
    assertValid(event, "a hash chain entry");
  });

  test("accepts a signature without a chain", () => {
    const event = minimalEvent();
    event["integrity"] = {
      canonicalization: "RFC8785",
      signature: {
        algorithm: "Ed25519",
        value: "3045022100c0ffee1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        keyId: "key-2026-03",
      },
    };
    assertValid(event, "a signed event without a chain");
  });
});
