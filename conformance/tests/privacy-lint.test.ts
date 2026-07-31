/**
 * Event-level privacy linting: which paths are inspected, how findings are
 * shaped, and the guarantee that no finding ever carries the value that
 * produced it.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { createValidator, resolveSchemaPath } from "../src/validate.js";
import { lintEvent } from "../src/privacy/lint-event.js";
import { RULES } from "../src/privacy/rules.js";
import { summarise } from "../src/privacy/types.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const privacyRoot = path.join(repoRoot, "examples", "privacy");
const validator = createValidator(schemaPath);

type Event = Record<string, unknown>;

/** A distinctive value that must never appear in any report. */
const CANARY = "CANARY0000SYNTHETIC0000VALUE0000";

function baseEvent(extra: Event = {}): Event {
  return {
    specVersion: "0.1",
    id: "018f3a01-1c20-7b40-9d51-2e3f4a5b6c70",
    time: "2026-05-04T08:12:44.501Z",
    event: { name: "data.record.update", category: "data-modification", outcome: "success" },
    actor: { type: "user", id: "user-123" },
    resource: { type: "record", id: "resource-123" },
    application: { name: "application-service", environment: "production" },
    ...extra,
  };
}

function lint(event: Event) {
  return lintEvent(event, "event", validator);
}

function ruleIds(event: Event): string[] {
  return lint(event).findings.map((finding) => finding.ruleId);
}

function readFixture(...segments: string[]): Event {
  return JSON.parse(readFileSync(path.join(privacyRoot, ...segments), "utf8")) as Event;
}

function fixtureNames(kind: "clean" | "findings"): string[] {
  return readdirSync(path.join(privacyRoot, kind))
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
}

describe("finding shape", () => {
  test("a finding carries a rule, severity, confidence, path and message", () => {
    const [finding] = lint(baseEvent({ metadata: { password: "synthetic-value" } })).findings;

    assert.ok(finding);
    assert.equal(finding.ruleId, RULES.PROHIBITED_CREDENTIAL_FIELD.id);
    assert.equal(finding.severity, "critical");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.path, "/metadata/password");
    assert.ok(finding.message.length > 0);
    assert.ok(finding.recommendation !== undefined);
    assert.equal(finding.eventId, "018f3a01-1c20-7b40-9d51-2e3f4a5b6c70");
  });

  test("findings never carry the value that produced them", () => {
    const event = baseEvent({
      metadata: {
        password: CANARY,
        upstreamHeader: `Bearer ${CANARY}`,
        exportLocation: `https://user:${CANARY}@example.com/a`,
        dataSource: `postgresql://user:${CANARY}@db.example.com/records`,
        handle: `Zq7Z9dK2mR4xT6vB${CANARY}`,
        responseBody: `{"secret":"${CANARY}"}`,
      },
    });

    const result = lint(event);
    assert.ok(result.findings.length >= 5);
    assert.doesNotMatch(JSON.stringify(result), /CANARY/);
  });

  test("a finding has no value-bearing property", () => {
    const [finding] = lint(baseEvent({ metadata: { password: CANARY } })).findings;
    assert.ok(finding);

    for (const forbidden of ["actualValue", "matchedValue", "valuePreview", "prefix", "suffix"]) {
      assert.equal(forbidden in finding, false, forbidden);
    }
  });

  test("findings are ordered by severity", () => {
    const result = lint(
      baseEvent({
        metadata: {
          handle: "Zq7Z9dK2mR4xT6vB8nH1jL3pW5sY0cF2gJ4kM6",
          password: "synthetic-value",
        },
      }),
    );

    assert.deepEqual(
      result.findings.map((finding) => finding.severity),
      ["critical", "medium"],
    );
  });

  test("one finding is reported per rule and path", () => {
    const result = lint(baseEvent({ metadata: { password: "synthetic-value" } }));
    const keys = result.findings.map((finding) => `${finding.ruleId}|${finding.path}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("inspected locations", () => {
  const locations: ReadonlyArray<readonly [string, Event, string]> = [
    ["/metadata", { metadata: { password: "v" } }, "/metadata/password"],
    [
      "/extensions",
      { extensions: { "com.example.audit.password": "v" } },
      "/extensions/com.example.audit.password",
    ],
    [
      "/actor/attributes",
      { actor: { type: "user", id: "user-1", attributes: { password: "v" } } },
      "/actor/attributes/password",
    ],
    [
      "/resource/attributes",
      { resource: { type: "record", id: "record-1", attributes: { password: "v" } } },
      "/resource/attributes/password",
    ],
    [
      "/relatedResources/0/attributes",
      { relatedResources: [{ type: "topic", id: "topic-1", attributes: { password: "v" } }] },
      "/relatedResources/0/attributes/password",
    ],
    ["/change/before", { change: { before: { password: "v" } } }, "/change/before/password"],
    ["/change/after", { change: { after: { password: "v" } } }, "/change/after/password"],
  ];

  for (const [location, extra, expectedPath] of locations) {
    test(`${location} is inspected`, () => {
      const result = lint(baseEvent(extra));
      assert.ok(
        result.findings.some((finding) => finding.path === expectedPath),
        `expected a finding at ${expectedPath}, got ${JSON.stringify(result.findings.map((f) => f.path))}`,
      );
    });
  }

  test("subject attributes are inspected", () => {
    const event = baseEvent({
      actor: { type: "service", id: "service-worker" },
      subject: { type: "user", id: "user-1", attributes: { apiKey: "synthetic-value" } },
      delegation: { type: "on-behalf-of" },
    });
    assert.ok(
      lint(event).findings.some((finding) => finding.path === "/subject/attributes/apiKey"),
    );
  });

  const scalarLocations: ReadonlyArray<readonly [string, Event]> = [
    [
      "/event/summary",
      { event: { name: "a.b.c", category: "x", outcome: "success", summary: "" } },
    ],
    ["/reason/text", { reason: { text: "" } }],
    ["/authorization/reason", { authorization: { decision: "allow", reason: "" } }],
  ];

  for (const [location, shape] of scalarLocations) {
    test(`${location} is inspected for credential-shaped values`, () => {
      const marker = "-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----";
      const event = baseEvent(
        JSON.parse(JSON.stringify(shape).replaceAll('""', JSON.stringify(marker))) as Event,
      );
      const result = lint(event);
      assert.ok(
        result.findings.some(
          (finding) =>
            finding.path === location && finding.ruleId === RULES.PRIVATE_KEY_MATERIAL.id,
        ),
        `${location}: ${JSON.stringify(result.findings)}`,
      );
    });
  }

  test("nested property names are inspected recursively", () => {
    const event = baseEvent({
      metadata: { outer: { inner: { clientSecret: "synthetic-value" } } },
    });
    assert.ok(
      lint(event).findings.some((finding) => finding.path === "/metadata/outer/inner/clientSecret"),
    );
  });

  test("JSON Pointer escaping is applied to property names", () => {
    const event = baseEvent({ metadata: { "a/b": { "c~d": { password: "synthetic-value" } } } });
    assert.ok(
      lint(event).findings.some((finding) => finding.path === "/metadata/a~1b/c~0d/password"),
    );
  });

  test("integrity digests and correlation identifiers are not inspected for entropy", () => {
    const event = baseEvent({
      request: {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
      },
      integrity: {
        canonicalization: "RFC8785",
        hashAlgorithm: "SHA-256",
        hash: "9f2a4c1d5e6b7a8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e",
      },
    });
    assert.deepEqual(lint(event).findings, []);
  });
});

describe("populated values", () => {
  test("an empty or placeholder credential field is not reported", () => {
    for (const value of ["", "[REDACTED]", "***", "n/a"]) {
      assert.deepEqual(ruleIds(baseEvent({ metadata: { password: value } })), [], value);
    }
  });

  test("a boolean under a credential name is treated as a flag", () => {
    assert.deepEqual(ruleIds(baseEvent({ metadata: { secret: true } })), []);
  });

  test("a null or absent value is not reported", () => {
    assert.deepEqual(ruleIds(baseEvent({ metadata: { password: null } })), []);
  });

  test("a scalar under a credential name is reported", () => {
    assert.deepEqual(ruleIds(baseEvent({ metadata: { password: "synthetic-value" } })), [
      RULES.PROHIBITED_CREDENTIAL_FIELD.id,
    ]);
    assert.deepEqual(ruleIds(baseEvent({ metadata: { apiKey: 4471 } })), [
      RULES.PROHIBITED_CREDENTIAL_FIELD.id,
    ]);
  });

  test("a container under a credential name is a descriptor, not a credential", () => {
    // `credential: { type: "api-key" }` describes a credential without carrying
    // one, and is the shape the identity profile requires for rotation events.
    assert.deepEqual(ruleIds(baseEvent({ metadata: { credential: { type: "api-key" } } })), []);
    assert.deepEqual(ruleIds(baseEvent({ metadata: { credentials: { user: "a" } } })), []);
    assert.deepEqual(ruleIds(baseEvent({ metadata: { credentials: {} } })), []);
  });

  test("members inside such a container are still inspected individually", () => {
    assert.deepEqual(
      ruleIds(baseEvent({ metadata: { credential: { password: "synthetic-value" } } })),
      [RULES.PROHIBITED_CREDENTIAL_FIELD.id],
    );
    assert.deepEqual(
      ruleIds(baseEvent({ metadata: { credential: { value: `ghp_${"S".repeat(36)}` } } })),
      [RULES.GITHUB_TOKEN.id],
    );
  });
});

describe("rule interaction", () => {
  test("a recognised token is not also reported as an anonymous high-entropy value", () => {
    const ids = ruleIds(baseEvent({ metadata: { handle: `ghp_${"S".repeat(36)}` } }));
    assert.deepEqual(ids, [RULES.GITHUB_TOKEN.id]);
  });

  test("a credential-named field holding a token reports both the name and the format", () => {
    const ids = ruleIds(baseEvent({ metadata: { apiKey: `AIza${"S".repeat(35)}` } })).sort();
    assert.deepEqual(ids, [RULES.PROHIBITED_CREDENTIAL_FIELD.id, RULES.CLOUD_API_KEY.id].sort());
  });

  test("a data-system URL is reported as a connection string, not as generic user information", () => {
    const ids = ruleIds(
      baseEvent({ metadata: { store: "postgresql://u:p@db.example.com/records" } }),
    );
    assert.deepEqual(ids, [RULES.CONNECTION_STRING_WITH_CREDENTIALS.id]);
  });

  test("entropy confidence rises when the property name is suspicious", () => {
    const neutral = lint(
      baseEvent({ metadata: { handle: "Zq7Z9dK2mR4xT6vB8nH1jL3pW5sY0cF2gJ4kM6" } }),
    );
    const suspicious = lint(
      baseEvent({ metadata: { token: "Zq7Z9dK2mR4xT6vB8nH1jL3pW5sY0cF2gJ4kM6" } }),
    );

    assert.equal(neutral.findings[0]?.confidence, "low");
    assert.equal(suspicious.findings[0]?.confidence, "medium");
    assert.equal(suspicious.findings[0]?.severity, "medium");
  });
});

describe("evidence references", () => {
  const evidence = (reference: string): Event => ({
    evidence: [{ type: "document", reference }],
  });

  test("a query string is reported", () => {
    assert.deepEqual(ruleIds(baseEvent(evidence("https://example.com/e/1?token=synthetic"))), [
      RULES.EVIDENCE_REFERENCE_QUERY.id,
    ]);
  });

  test("a fragment is reported", () => {
    assert.deepEqual(ruleIds(baseEvent(evidence("https://example.com/e/1#page=3"))), [
      RULES.EVIDENCE_REFERENCE_QUERY.id,
    ]);
  });

  test("a query string in a non-URL reference is reported", () => {
    assert.deepEqual(ruleIds(baseEvent(evidence("records/evidence/9921?signature=synthetic"))), [
      RULES.EVIDENCE_REFERENCE_QUERY.id,
    ]);
  });

  test("a clean reference is not reported", () => {
    assert.deepEqual(
      ruleIds(baseEvent(evidence("https://example.com/evidence/rca-2026-0418"))),
      [],
    );
    assert.deepEqual(ruleIds(baseEvent(evidence("workflow-closure/approval-request-9921"))), []);
  });

  test("user information in an evidence reference is reported by the URL rule", () => {
    const ids = ruleIds(baseEvent(evidence("https://u:p@example.com/evidence/1")));
    assert.ok(ids.includes(RULES.URL_USERINFO.id));
  });
});

describe("schema-invalid events", () => {
  test("a schema-invalid event is not deep linted", () => {
    const event = baseEvent({ metadata: { password: "synthetic-value" } });
    delete event["actor"];

    const result = lint(event);
    assert.equal(result.status, "schema-invalid");
    assert.deepEqual(result.findings, []);
    assert.ok(result.schemaIssues.length > 0);
    assert.match(result.schemaIssues.join("\n"), /actor/);
  });

  test("schema issues never contain event content", () => {
    const event = baseEvent({ metadata: { password: CANARY } });
    delete event["actor"];
    assert.doesNotMatch(JSON.stringify(lint(event)), /CANARY/);
  });

  test("linting can be requested without schema validation", () => {
    const event = baseEvent({ metadata: { password: "synthetic-value" } });
    delete event["actor"];

    const result = lintEvent(event, "event", validator, { validateSchema: false });
    assert.equal(result.status, "findings");
    assert.deepEqual(
      result.findings.map((finding) => finding.ruleId),
      [RULES.PROHIBITED_CREDENTIAL_FIELD.id],
    );
  });
});

describe("published fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("clean"), [
      "hashes-and-identifiers.json",
      "minimal-clean-event.json",
      "safe-evidence-reference.json",
      "sanitized-change.json",
      "structured-metadata.json",
    ]);
    assert.deepEqual(fixtureNames("findings"), [
      "access-token-field.json",
      "bearer-token.json",
      "credentialed-connection-string.json",
      "evidence-query-string.json",
      "high-entropy-token.json",
      "jwt-token.json",
      "oversized-change-before.json",
      "password-field.json",
      "private-key.json",
      "raw-response-body.json",
      "url-userinfo.json",
    ]);
  });

  for (const name of fixtureNames("clean")) {
    test(`clean/${name} produces no findings`, () => {
      const result = lintEvent(readFixture("clean", name), name, validator);
      assert.equal(result.status, "clean", JSON.stringify(result.findings));
    });
  }

  const expectations: Readonly<Record<string, string>> = {
    "password-field.json": RULES.PROHIBITED_CREDENTIAL_FIELD.id,
    "access-token-field.json": RULES.PROHIBITED_CREDENTIAL_FIELD.id,
    "bearer-token.json": RULES.AUTHORIZATION_HEADER_VALUE.id,
    "jwt-token.json": RULES.JWT_TOKEN.id,
    "private-key.json": RULES.PRIVATE_KEY_MATERIAL.id,
    "url-userinfo.json": RULES.URL_USERINFO.id,
    "evidence-query-string.json": RULES.EVIDENCE_REFERENCE_QUERY.id,
    "credentialed-connection-string.json": RULES.CONNECTION_STRING_WITH_CREDENTIALS.id,
    "high-entropy-token.json": RULES.HIGH_ENTROPY_TOKEN_CANDIDATE.id,
    "oversized-change-before.json": RULES.OVERSIZED_UNFILTERED_VALUE.id,
    "raw-payload-field.json": RULES.RAW_PAYLOAD_FIELD.id,
    "raw-response-body.json": RULES.RAW_PAYLOAD_FIELD.id,
  };

  for (const name of fixtureNames("findings")) {
    test(`findings/${name} raises ${expectations[name]}`, () => {
      const result = lintEvent(readFixture("findings", name), name, validator);
      assert.equal(result.status, "findings");
      assert.ok(
        result.findings.some((finding) => finding.ruleId === expectations[name]),
        `expected ${expectations[name]}, got ${JSON.stringify(result.findings.map((f) => f.ruleId))}`,
      );
    });
  }

  test("no fixture report contains a synthetic value from its own event", () => {
    for (const name of fixtureNames("findings")) {
      const event = readFixture("findings", name);
      const result = lintEvent(event, name, validator);
      const rendered = JSON.stringify(result);

      for (const marker of ["synthetic", "SYNTHETIC", "eyJ", "BEGIN PRIVATE", "customerId"]) {
        assert.doesNotMatch(rendered, new RegExp(marker), `${name} leaked ${marker}`);
      }
    }
  });
});

describe("dogfooding", () => {
  test("every published example outside examples/privacy is clean", () => {
    const directories = [
      path.join(repoRoot, "examples", "valid"),
      path.join(repoRoot, "examples", "integrity", "valid"),
      path.join(repoRoot, "examples", "integrity", "valid", "three-event-chain"),
    ];

    for (const directory of directories) {
      for (const entry of readdirSync(directory).filter((file) => file.endsWith(".json"))) {
        const event = JSON.parse(readFileSync(path.join(directory, entry), "utf8")) as Event;
        const result = lintEvent(event, entry, validator);
        assert.equal(
          result.status,
          "clean",
          `${entry} raised ${JSON.stringify(result.findings.map((f) => `${f.ruleId} ${f.path}`))}`,
        );
      }
    }
  });
});

describe("summaries", () => {
  test("counts are grouped by severity", () => {
    const results = [
      lintEvent(readFixture("findings", "password-field.json"), "a", validator),
      lintEvent(readFixture("clean", "minimal-clean-event.json"), "b", validator),
    ];
    const summary = summarise(results);

    assert.equal(summary.events, 2);
    assert.equal(summary.clean, 1);
    assert.equal(summary.withFindings, 1);
    assert.equal(summary.findings, 1);
    assert.equal(summary.bySeverity.critical, 1);
    assert.equal(summary.bySeverity.medium, 0);
  });
});
