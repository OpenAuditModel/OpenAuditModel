/**
 * The published api-and-integration-management profile fixtures.
 *
 * The fixtures carry the same cross-cutting guarantee the IAM and document
 * profiles carry: every event this profile accepts is also core-conforming and
 * privacy-clean.
 *
 * Three properties are specific to this profile and are asserted here because
 * they are design decisions rather than incidental behaviour:
 *
 *   - The data plane is deliberately ungoverned. No selector uses a bare `api.`,
 *     `api-key.`, `webhook.` or `integration.` prefix, so `api.request`,
 *     `webhook.delivery.attempt` and `integration.sync.progress` match nothing.
 *     A test holds that, because widening a prefix later would silently start
 *     governing every request, delivery and poll in a deployment.
 *   - The two authentication rules are one requirement split across two actor
 *     types, because the v0.1 rule language has no disjunction. A test holds
 *     both halves, so that deleting one would not quietly stop governing
 *     administrators.
 *   - Every invalid fixture differs from a valid one in exactly the field its
 *     rule is about, so a negative test fails for its documented reason rather
 *     than for any reason at all.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { createValidator, resolveSchemaPath } from "../src/validate.js";
import { loadProfile } from "../src/profiles/load-profile.js";
import { checkProfile } from "../src/profiles/check-profile.js";
import { lintEvent } from "../src/privacy/lint-event.js";
import { selectRules } from "../src/profiles/select-rules.js";
import type { ProfileDefinition } from "../src/profiles/types.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const validator = createValidator(schemaPath);

const PROFILE = "api-and-integration-management";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the api-and-integration-management profile must load");
const profile: ProfileDefinition = loaded.ok ? loaded.profile : ({} as ProfileDefinition);

type Event = Record<string, unknown>;

function fixtureNames(kind: "valid" | "invalid" | "not-applicable"): string[] {
  return readdirSync(path.join(FIXTURES, kind))
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function readFixture(kind: string, name: string): Event {
  return JSON.parse(readFileSync(path.join(FIXTURES, kind, name), "utf8")) as Event;
}

describe("api-and-integration-management profile definition", () => {
  test("the profile is experimental and applies to core 0.1", () => {
    assert.equal(profile.name, PROFILE);
    assert.equal(profile.status, "experimental");
    assert.deepEqual(profile.coreVersions, ["0.1"]);
  });

  test("every rule identifier is unique and namespaced to this profile", () => {
    const ids = profile.rules.map((rule) => rule.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const id of ids) {
      assert.match(id, /^INTEGRATION-/, `${id} should be namespaced to the integration profile`);
    }
  });

  test("every rule has a selector, so no rule governs every event by accident", () => {
    for (const rule of profile.rules) {
      assert.ok(
        (rule.events?.length ?? 0) + (rule.eventPrefixes?.length ?? 0) > 0,
        `${rule.id} has no event selector`,
      );
    }
  });

  test("every rule carries a rationale", () => {
    for (const rule of profile.rules) {
      assert.ok((rule.rationale ?? "").length > 0, `${rule.id} has no rationale`);
    }
  });

  test("every requirement under metadata is namespaced to /integration", () => {
    for (const rule of profile.rules) {
      for (const requirement of rule.requiredMetadata ?? []) {
        assert.match(
          requirement.path,
          /^\/integration\//,
          `${rule.id} requires ${requirement.path}, which is outside this profile's namespace`,
        );
      }
    }
  });
});

describe("data-plane events are deliberately ungoverned", () => {
  test("no selector uses a bare domain prefix", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        for (const bare of ["api.", "api-key.", "webhook.", "integration."]) {
          assert.notEqual(
            prefix,
            bare,
            `${rule.id} uses a bare ${bare} prefix, which would govern data-plane events`,
          );
        }
      }
    }
  });

  for (const name of [
    "api.request",
    "webhook.delivery.attempt",
    "webhook.delivery.retry",
    "integration.sync.progress",
    "integration.poll",
    "api-key.verify",
  ]) {
    test(`${name} matches no rule`, () => {
      assert.deepEqual(selectRules(profile, name), []);
    });
  }

  test("governed administration events are still selected", () => {
    for (const name of [
      "api-key.create",
      "api-key.rotate",
      "api-key.revoke",
      "api-key.delete",
      "webhook.create",
      "webhook.update",
      "webhook.enable",
      "webhook.disable",
      "webhook.delete",
      "webhook.test",
      "integration.connect",
      "integration.disconnect",
      "integration.enable",
      "integration.disable",
      "integration.reauthorize",
      "integration.configuration.update",
      "integration.sync.start",
      "integration.sync.cancel",
    ]) {
      assert.ok(selectRules(profile, name).length > 0, `${name} should be governed`);
    }
  });
});

describe("published api-and-integration-management fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "api-key-create.json",
      "api-key-revoke.json",
      "api-key-rotate.json",
      "integration-configuration-update.json",
      "integration-connect.json",
      "integration-disconnect.json",
      "integration-reauthorize-failure.json",
      "integration-sync-cancel.json",
      "integration-sync-start.json",
      "webhook-create.json",
      "webhook-disable.json",
      "webhook-test.json",
      "webhook-update.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "api-key-create-missing-authentication.json",
      "api-key-create-missing-authorization.json",
      "api-key-rotate-missing-credential-reference.json",
      "integration-configuration-update-missing-connection-id.json",
      "integration-connect-missing-approval-status.json",
      "integration-disconnect-missing-authentication.json",
      "integration-reauthorize-missing-error-type.json",
      "integration-sync-start-missing-correlation-id.json",
      "webhook-create-missing-endpoint-class.json",
      "webhook-create-missing-type.json",
      "webhook-disable-missing-reason.json",
      "webhook-update-missing-change.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), [
      "api-request.json",
      "integration-sync-progress.json",
      "webhook-delivery.json",
    ]);
  });

  for (const name of fixtureNames("valid")) {
    test(`valid/${name} conforms to the profile`, () => {
      const result = checkProfile(readFixture("valid", name), name, profile, validator);
      assert.equal(result.status, "conforming", JSON.stringify(result.errors));
    });

    test(`valid/${name} is core-conforming`, () => {
      assert.deepEqual(validator.validateEvent(readFixture("valid", name)), []);
    });

    test(`valid/${name} is privacy-clean`, () => {
      const result = lintEvent(readFixture("valid", name), name, validator);
      assert.equal(result.status, "clean", JSON.stringify(result.findings));
    });
  }

  /** The rule each invalid fixture must violate, and where. */
  const expectations: Readonly<Record<string, readonly [string, string]>> = {
    "api-key-create-missing-authentication.json": ["INTEGRATION-AUTHN-001", "/authentication"],
    "api-key-create-missing-authorization.json": ["INTEGRATION-CORE-001", "/authorization"],
    "api-key-rotate-missing-credential-reference.json": [
      "INTEGRATION-KEY-001",
      "/metadata/integration/credentialReference",
    ],
    "integration-configuration-update-missing-connection-id.json": [
      "INTEGRATION-CONN-001",
      "/metadata/integration/connectionId",
    ],
    "integration-connect-missing-approval-status.json": [
      "INTEGRATION-CORE-003",
      "/approval/status",
    ],
    "integration-disconnect-missing-authentication.json": [
      "INTEGRATION-AUTHN-002",
      "/authentication",
    ],
    "integration-reauthorize-missing-error-type.json": [
      "INTEGRATION-FAIL-001",
      "/event/error/type",
    ],
    "integration-sync-start-missing-correlation-id.json": [
      "INTEGRATION-FLOW-001",
      "/request/correlationId",
    ],
    "webhook-create-missing-endpoint-class.json": [
      "INTEGRATION-HOOK-001",
      "/metadata/integration/endpointClass",
    ],
    "webhook-create-missing-type.json": ["INTEGRATION-CORE-001", "/metadata/integration/type"],
    "webhook-disable-missing-reason.json": ["INTEGRATION-REVOKE-001", "/reason"],
    "webhook-update-missing-change.json": ["INTEGRATION-CONFIG-001", "/change"],
  };

  for (const name of fixtureNames("invalid")) {
    const expectation = expectations[name];

    test(`invalid/${name} violates ${expectation?.[0]} at ${expectation?.[1]}`, () => {
      const result = checkProfile(readFixture("invalid", name), name, profile, validator);

      assert.equal(result.status, "violations");
      assert.equal(result.profileValid, false);
      assert.ok(
        result.errors.some(
          (error) => error.ruleId === expectation?.[0] && error.path === expectation?.[1],
        ),
        `expected ${expectation?.[0]} at ${expectation?.[1]}, got ${JSON.stringify(
          result.errors.map((error) => `${error.ruleId} ${error.path}`),
        )}`,
      );
    });

    test(`invalid/${name} fails for exactly one reason`, () => {
      const result = checkProfile(readFixture("invalid", name), name, profile, validator);
      assert.equal(
        result.errors.length,
        1,
        `a negative fixture that fails several rules cannot show which rule it tests: ${JSON.stringify(
          result.errors.map((error) => `${error.ruleId} ${error.path}`),
        )}`,
      );
    });

    test(`invalid/${name} is still core-valid, so only the profile rejects it`, () => {
      assert.deepEqual(validator.validateEvent(readFixture("invalid", name)), []);
    });

    test(`invalid/${name} is privacy-clean`, () => {
      const result = lintEvent(readFixture("invalid", name), name, validator);
      assert.equal(result.status, "clean", JSON.stringify(result.findings));
    });
  }

  test("every enforceable rule has a negative fixture", () => {
    const covered = new Set(Object.values(expectations).map(([ruleId]) => ruleId));
    for (const rule of profile.rules) {
      if ((rule.severity ?? "error") !== "error") {
        continue;
      }
      assert.ok(covered.has(rule.id), `${rule.id} is enforceable but has no invalid fixture`);
    }
  });

  for (const name of fixtureNames("not-applicable")) {
    test(`not-applicable/${name} is not governed by this profile`, () => {
      const result = checkProfile(readFixture("not-applicable", name), name, profile, validator);
      assert.equal(result.status, "not-applicable");
      assert.deepEqual(result.matchedRules, []);
    });

    test(`not-applicable/${name} is core-conforming and privacy-clean`, () => {
      assert.deepEqual(validator.validateEvent(readFixture("not-applicable", name)), []);
      const result = lintEvent(readFixture("not-applicable", name), name, validator);
      assert.equal(result.status, "clean", JSON.stringify(result.findings));
    });
  }
});

describe("the locally declared approval requirement", () => {
  test("an integration change is not required to carry an approval by default", () => {
    const event = readFixture("valid", "integration-configuration-update.json");
    delete (event as { approval?: unknown }).approval;
    const metadata = (event["metadata"] as { integration: Record<string, unknown> }).integration;
    delete metadata["approvalRequired"];

    const result = checkProfile(event, "unflagged", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same change must carry one once the producer declares approval was required", () => {
    const event = readFixture("valid", "integration-configuration-update.json");
    delete (event as { approval?: unknown }).approval;
    const metadata = (event["metadata"] as { integration: Record<string, unknown> }).integration;
    metadata["approvalRequired"] = true;

    const result = checkProfile(event, "flagged", profile, validator);
    assert.equal(result.status, "violations");
    const failures = result.errors.map((error) => error.path).sort();
    assert.deepEqual(failures, ["/approval", "/approval/status"]);
  });

  test("a conditional rule is reported as matched even when its condition does not hold", () => {
    const result = checkProfile(
      readFixture("valid", "webhook-create.json"),
      "webhook-create",
      profile,
      validator,
    );
    assert.ok(result.matchedRules.includes("INTEGRATION-CORE-003"));
    assert.ok(result.matchedRules.includes("INTEGRATION-FAIL-001"));
  });
});

describe("the human-actor authentication condition", () => {
  test("a machine rotation is not required to carry an authentication context", () => {
    const event = readFixture("valid", "api-key-rotate.json");
    assert.equal((event["actor"] as { type: string }).type, "service");
    assert.equal((event as { authentication?: unknown }).authentication, undefined);

    const result = checkProfile(event, "machine", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  for (const [actorType, ruleId] of [
    ["user", "INTEGRATION-AUTHN-001"],
    ["admin", "INTEGRATION-AUTHN-002"],
  ] as const) {
    test(`the same rotation performed by a ${actorType} must carry one`, () => {
      const event = readFixture("valid", "api-key-rotate.json");
      (event["actor"] as { type: string }).type = actorType;

      const result = checkProfile(event, actorType, profile, validator);
      assert.equal(result.status, "violations");
      assert.deepEqual(
        result.errors.map((error) => `${error.ruleId} ${error.path}`),
        [`${ruleId} /authentication`],
      );
    });
  }
});

describe("the failure classification condition", () => {
  test("a successful operation is not asked to classify a failure", () => {
    const result = checkProfile(
      readFixture("valid", "integration-connect.json"),
      "success",
      profile,
      validator,
    );
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("a failed operation must classify the failure the core only makes it name", () => {
    const event = readFixture("valid", "integration-reauthorize-failure.json");
    const error = (event["event"] as { error: Record<string, unknown> }).error;
    delete error["type"];

    // The core still accepts it: `code` is the only field the schema requires.
    assert.deepEqual(validator.validateEvent(event), []);

    const result = checkProfile(event, "failure", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((finding) => `${finding.ruleId} ${finding.path}`),
      ["INTEGRATION-FAIL-001 /event/error/type"],
    );
  });
});

describe("the profile only adds requirements", () => {
  test("no rule can make a core-invalid event conform", () => {
    // A core-invalid event: `outcome` is required by the schema.
    const broken = readFixture("valid", "api-key-create.json");
    delete (broken["event"] as { outcome?: unknown }).outcome;

    const result = checkProfile(broken, "broken", profile, validator);
    assert.equal(result.status, "core-invalid");
  });

  test("no rule vocabulary keyword can relax a core requirement", () => {
    const relaxing = ["optionalPaths", "exemptPaths", "overrides", "forbiddenPaths"];
    const serialized = JSON.stringify(profile);
    for (const keyword of relaxing) {
      assert.ok(
        !serialized.includes(keyword),
        `${keyword} must not appear in a profile definition`,
      );
    }
  });
});
