/**
 * Tests that the published invalid examples fail for their documented reason,
 * and that the constraints the specification promises to enforce are in fact
 * enforced.
 *
 * These tests assert the *reason* a document is rejected, not merely that it is
 * rejected. A schema change that keeps a document invalid for a different
 * reason is still a compatibility question and must fail here.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { createValidator, resolveSchemaPath, type ValidationIssue } from "../src/validate.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const invalidDir = path.join(repoRoot, "examples", "invalid");
const validDir = path.join(repoRoot, "examples", "valid");
const validator = createValidator(schemaPath);

interface Expectation {
  readonly file: string;
  readonly path: string;
  readonly keyword: string;
  readonly reason: string;
}

/** Mirrors the table in examples/invalid/README.md. */
const EXPECTATIONS: readonly Expectation[] = [
  {
    file: "missing-actor.json",
    path: "/actor",
    keyword: "required",
    reason: "an audit event must identify who performed the operation",
  },
  {
    file: "missing-resource.json",
    path: "/resource",
    keyword: "required",
    reason: "an audit event must identify what the operation acted upon",
  },
  {
    file: "invalid-event-name.json",
    path: "/event/name",
    keyword: "pattern",
    reason: "event names are lower-case dotted names",
  },
  {
    file: "failure-without-error.json",
    path: "/event/error",
    keyword: "required",
    reason: "a failed operation must carry a sanitized error descriptor",
  },
  {
    file: "delegation-without-subject.json",
    path: "/subject",
    keyword: "required",
    reason: "acting for a principal requires that principal to be identified",
  },
  {
    file: "invalid-extension-name.json",
    path: "/extensions/clusterId",
    keyword: "propertyNames",
    reason: "extension keys must use a reverse-domain namespace",
  },
  {
    file: "unknown-core-property.json",
    path: "/actor/department",
    keyword: "additionalProperties",
    reason: "core objects reject unknown properties",
  },
];

function minimalEvent(): Record<string, unknown> {
  const raw = readFileSync(path.join(validDir, "minimal-event.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function report(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path} [${issue.keyword}]`).join("; ");
}

/** Asserts that an event is rejected, and that it is rejected at the expected place. */
function assertRejected(event: unknown, expectedPath: string, keyword: string): void {
  const issues = validator.validateEvent(event);
  assert.notEqual(issues.length, 0, "expected the event to be rejected");
  assert.ok(
    issues.some((issue) => issue.path === expectedPath && issue.keyword === keyword),
    `expected a "${keyword}" failure at ${expectedPath}, got: ${report(issues)}`,
  );
}

describe("published invalid examples", () => {
  test("every fixture in the directory has a documented expectation", () => {
    const files = readdirSync(invalidDir)
      .filter((file) => file.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right, "en"));
    const documented = EXPECTATIONS.map((expectation) => expectation.file).sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    assert.deepEqual(files, documented);
  });

  for (const expectation of EXPECTATIONS) {
    test(`${expectation.file} is rejected because ${expectation.reason}`, () => {
      const result = validator.validateFile(path.join(invalidDir, expectation.file));
      assert.equal(result.status, "invalid", `${expectation.file} unexpectedly validated`);
      assert.ok(
        result.issues.some(
          (issue) => issue.path === expectation.path && issue.keyword === expectation.keyword,
        ),
        `expected a "${expectation.keyword}" failure at ${expectation.path}, got: ${report(result.issues)}`,
      );
    });
  }
});

describe("required fields", () => {
  for (const field of ["specVersion", "id", "time", "event", "actor", "resource", "application"]) {
    test(`an event without ${field} is rejected`, () => {
      const event = minimalEvent();
      delete event[field];
      assertRejected(event, `/${field}`, "required");
    });
  }

  test("an unknown top-level field is rejected", () => {
    const event = minimalEvent();
    event["environment"] = "production";
    assertRejected(event, "/environment", "additionalProperties");
  });

  test("a domain-specific field cannot be added at the top level", () => {
    const event = minimalEvent();
    event["documentClassification"] = "confidential";
    assertRejected(event, "/documentClassification", "additionalProperties");
  });

  test("specVersion is pinned to 0.1", () => {
    const event = minimalEvent();
    event["specVersion"] = "0.2";
    assertRejected(event, "/specVersion", "const");
  });
});

describe("empty values", () => {
  test("the event identifier cannot be empty", () => {
    const event = minimalEvent();
    event["id"] = "";
    assertRejected(event, "/id", "minLength");
  });

  test("an identifier cannot be whitespace only", () => {
    const event = minimalEvent();
    event["id"] = "   ";
    assertRejected(event, "/id", "pattern");
  });

  test("the actor identifier cannot be empty", () => {
    const event = minimalEvent();
    event["actor"] = { type: "user", id: "" };
    assertRejected(event, "/actor/id", "minLength");
  });

  test("the resource identifier cannot be empty", () => {
    const event = minimalEvent();
    event["resource"] = { type: "record", id: "" };
    assertRejected(event, "/resource/id", "minLength");
  });

  test("the application name cannot be empty", () => {
    const event = minimalEvent();
    event["application"] = { name: "", environment: "production" };
    assertRejected(event, "/application/name", "minLength");
  });

  test("the event name cannot be empty", () => {
    const event = minimalEvent();
    (event["event"] as Record<string, unknown>)["name"] = "";
    assertRejected(event, "/event/name", "minLength");
  });

  test("an optional object cannot be present but empty", () => {
    const event = minimalEvent();
    event["organization"] = {};
    assertRejected(event, "/organization", "minProperties");
  });

  test("an optional array cannot be present but empty", () => {
    const event = minimalEvent();
    event["relatedResources"] = [];
    assertRejected(event, "/relatedResources", "minItems");
  });
});

describe("event naming", () => {
  const rejected = [
    ["Document.Share.Create", "upper-case segments"],
    ["document", "a single segment"],
    ["document.", "a trailing separator"],
    [".document.share", "a leading separator"],
    ["document..share", "an empty segment"],
    ["document.share.Create", "a mixed-case action"],
    ["document.share_create", "an underscore separator"],
    ["document share create", "spaces"],
    ["2document.share.create", "a leading digit"],
    ["document.share.create-", "a trailing hyphen"],
  ] as const;

  for (const [name, why] of rejected) {
    test(`"${name}" is rejected because it uses ${why}`, () => {
      const event = minimalEvent();
      (event["event"] as Record<string, unknown>)["name"] = name;
      assertRejected(event, "/event/name", "pattern");
    });
  }

  test("a hyphenated action segment is accepted", () => {
    const event = minimalEvent();
    (event["event"] as Record<string, unknown>)["name"] = "queue.consumer.offset-reset";
    assert.deepEqual(validator.validateEvent(event), []);
  });
});

describe("outcome and error", () => {
  test("a failure without an error descriptor is rejected", () => {
    const event = minimalEvent();
    (event["event"] as Record<string, unknown>)["outcome"] = "failure";
    assertRejected(event, "/event/error", "required");
  });

  test("an error descriptor without a code is rejected", () => {
    const event = minimalEvent();
    event["event"] = {
      name: "authentication.login",
      category: "authentication",
      outcome: "failure",
      error: { message: "Sign-in rejected." },
    };
    assertRejected(event, "/event/error/code", "required");
  });

  test("an unknown outcome value is rejected", () => {
    const event = minimalEvent();
    (event["event"] as Record<string, unknown>)["outcome"] = "denied";
    assertRejected(event, "/event/outcome", "enum");
  });

  test("an unknown severity value is rejected", () => {
    const event = minimalEvent();
    (event["event"] as Record<string, unknown>)["severity"] = "catastrophic";
    assertRejected(event, "/event/severity", "enum");
  });
});

describe("delegation and subject", () => {
  for (const type of ["impersonation", "on-behalf-of", "delegated"]) {
    test(`delegation type "${type}" without a subject is rejected`, () => {
      const event = minimalEvent();
      event["delegation"] = { type };
      assertRejected(event, "/subject", "required");
    });
  }

  test("delegation without a type is rejected", () => {
    const event = minimalEvent();
    event["subject"] = { type: "user", id: "user-8842" };
    event["delegation"] = { reason: "Acting for the subject." };
    assertRejected(event, "/delegation/type", "required");
  });

  test("an unknown delegation type is rejected", () => {
    const event = minimalEvent();
    event["delegation"] = { type: "proxy" };
    assertRejected(event, "/delegation/type", "enum");
  });
});

describe("extension namespaces", () => {
  const rejected = [
    ["clusterId", "no namespace and mixed case"],
    ["customValue", "no namespace"],
    ["com.example", "only two segments"],
    ["Com.Example.Key", "upper-case segments"],
    ["com..example.key", "an empty segment"],
    ["com.example.key ", "a trailing space"],
    ["com.example.key.", "a trailing separator"],
    ["_com.example.key", "an illegal leading character"],
  ] as const;

  for (const key of rejected) {
    test(`extension key "${key[0]}" is rejected because it has ${key[1]}`, () => {
      const event = minimalEvent();
      event["extensions"] = { [key[0]]: "value" };
      assertRejected(event, `/extensions/${key[0]}`, "propertyNames");
    });
  }

  test("reverse-domain extension keys are accepted", () => {
    const event = minimalEvent();
    event["extensions"] = {
      "com.example.identity.directory.id": "directory-1",
      "io.vendor.product.feature.enabled": true,
      "org.example.workflow.stage": "legal-review",
    };
    assert.deepEqual(validator.validateEvent(event), []);
  });
});

describe("strict core objects", () => {
  const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["event", { name: "data.record.update", category: "data", outcome: "success" }],
    ["actor", { type: "user", id: "user-123" }],
    ["resource", { type: "record", id: "resource-123" }],
    ["application", { name: "application-service", environment: "production" }],
    ["organization", { tenantId: "tenant-1" }],
    ["authentication", { method: "oidc" }],
    ["authorization", { decision: "allow" }],
    ["approval", { status: "approved" }],
    ["request", { requestId: "request-1" }],
    ["change", { type: "update" }],
    ["reason", { code: "customer-request" }],
    ["privacy", { containsPersonalData: false }],
    ["integrity", { canonicalization: "RFC8785" }],
    ["delegation", { type: "service-chain" }],
  ];

  for (const [field, base] of cases) {
    test(`an unknown property inside "${field}" is rejected`, () => {
      const event = minimalEvent();
      event[field] = { ...base, unexpectedProperty: "value" };
      assertRejected(event, `/${field}/unexpectedProperty`, "additionalProperties");
    });
  }

  test("an unknown property inside an evidence item is rejected", () => {
    const event = minimalEvent();
    event["evidence"] = [{ type: "ticket", reference: "ticket-1", storageBucket: "audit" }];
    assertRejected(event, "/evidence/0/storageBucket", "additionalProperties");
  });

  test("an unknown property inside a related resource is rejected", () => {
    const event = minimalEvent();
    event["relatedResources"] = [{ type: "topic", id: "topic-1", partitionCount: 12 }];
    assertRejected(event, "/relatedResources/0/partitionCount", "additionalProperties");
  });

  test("an unknown property inside a signature is rejected", () => {
    const event = minimalEvent();
    event["integrity"] = {
      signature: { algorithm: "Ed25519", value: "3045022100c0ffee1234567890", token: "secret" },
    };
    assertRejected(event, "/integrity/signature/token", "additionalProperties");
  });
});

describe("correlation identifiers", () => {
  const traceIds = [
    ["4bf92f3577b34da6a3ce929d0e0e473", "31 characters"],
    ["4bf92f3577b34da6a3ce929d0e0e47366", "33 characters"],
    ["4BF92F3577B34DA6A3CE929D0E0E4736", "upper-case hexadecimal"],
    ["4bf92f3577b34da6a3ce929d0e0e473g", "a non-hexadecimal character"],
  ] as const;

  for (const [traceId, why] of traceIds) {
    test(`a trace identifier with ${why} is rejected`, () => {
      const event = minimalEvent();
      event["request"] = { traceId };
      assertRejected(event, "/request/traceId", "pattern");
    });
  }

  test("an all-zero trace identifier is rejected", () => {
    const event = minimalEvent();
    event["request"] = { traceId: "00000000000000000000000000000000" };
    assertRejected(event, "/request/traceId", "not");
  });

  const spanIds = [
    ["00f067aa0ba902b", "15 characters"],
    ["00f067aa0ba902b77", "17 characters"],
    ["00F067AA0BA902B7", "upper-case hexadecimal"],
  ] as const;

  for (const [spanId, why] of spanIds) {
    test(`a span identifier with ${why} is rejected`, () => {
      const event = minimalEvent();
      event["request"] = { spanId };
      assertRejected(event, "/request/spanId", "pattern");
    });
  }

  test("an all-zero span identifier is rejected", () => {
    const event = minimalEvent();
    event["request"] = { spanId: "0000000000000000" };
    assertRejected(event, "/request/spanId", "not");
  });

  test("a route containing a query string is rejected", () => {
    const event = minimalEvent();
    event["request"] = { route: "/users?email=person@example.com" };
    assertRejected(event, "/request/route", "pattern");
  });

  test("an invalid IP address is rejected", () => {
    const event = minimalEvent();
    event["request"] = { ipAddress: "not-an-address" };
    assertRejected(event, "/request/ipAddress", "format");
  });
});

describe("dependent and required context", () => {
  test("authorization context without a decision is rejected", () => {
    const event = minimalEvent();
    event["authorization"] = { policy: "data-access" };
    assertRejected(event, "/authorization/decision", "required");
  });

  test("an integrity hash without its algorithm is rejected", () => {
    const event = minimalEvent();
    event["integrity"] = {
      hash: "b0d4f1e2a37c5589e6f1c0a4d7b2e93f8c15a6d0e4b7c9f2a1d3e5b8c0f7a294",
    };
    assertRejected(event, "/integrity/hashAlgorithm", "dependentRequired");
  });

  test("a signature without a value is rejected", () => {
    const event = minimalEvent();
    event["integrity"] = { signature: { algorithm: "Ed25519" } };
    assertRejected(event, "/integrity/signature/value", "required");
  });

  test("an evidence item without a reference is rejected", () => {
    const event = minimalEvent();
    event["evidence"] = [{ type: "document" }];
    assertRejected(event, "/evidence/0/reference", "required");
  });

  test("a principal without an identifier is rejected", () => {
    const event = minimalEvent();
    event["approval"] = { status: "approved", approvers: [{ type: "user" }] };
    assertRejected(event, "/approval/approvers/0/id", "required");
  });

  test("a negative sequence is rejected", () => {
    const event = minimalEvent();
    event["sequence"] = -1;
    assertRejected(event, "/sequence", "minimum");
  });

  test("a non-integer sequence is rejected", () => {
    const event = minimalEvent();
    event["sequence"] = 1.5;
    assertRejected(event, "/sequence", "type");
  });
});

describe("timestamps", () => {
  for (const value of ["2026-03-14", "14/03/2026", "1773481471", "2026-13-01T00:00:00Z"]) {
    test(`"${value}" is not an accepted date-time`, () => {
      const event = minimalEvent();
      event["time"] = value;
      const issues = validator.validateEvent(event);
      assert.ok(
        issues.some((issue) => issue.path === "/time"),
        `expected "${value}" to be rejected, got: ${report(issues)}`,
      );
    });
  }
});

describe("vocabulary tokens", () => {
  test("an upper-case control category is rejected", () => {
    const event = minimalEvent();
    event["controlCategories"] = ["Privileged-Access"];
    assertRejected(event, "/controlCategories/0", "pattern");
  });

  test("duplicate control categories are rejected", () => {
    const event = minimalEvent();
    event["controlCategories"] = ["privileged-access", "privileged-access"];
    assertRejected(event, "/controlCategories", "uniqueItems");
  });

  test("an unknown privacy processing method is rejected", () => {
    const event = minimalEvent();
    event["privacy"] = { processing: "anonymize" };
    assertRejected(event, "/privacy/processing", "enum");
  });

  test("an unknown authorization decision is rejected", () => {
    const event = minimalEvent();
    event["authorization"] = { decision: "permit" };
    assertRejected(event, "/authorization/decision", "enum");
  });

  test("an unknown actor type is rejected", () => {
    const event = minimalEvent();
    event["actor"] = { type: "robot", id: "robot-1" };
    assertRejected(event, "/actor/type", "enum");
  });
});
