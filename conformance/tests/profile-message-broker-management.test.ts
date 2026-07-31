/**
 * The published message-broker-management profile fixtures.
 *
 * The fixtures carry the same cross-cutting guarantee the IAM and document
 * profiles carry: every event this profile accepts is also core-conforming and
 * privacy-clean.
 *
 * Three properties are specific to this profile and are asserted here because
 * they are design decisions rather than incidental behaviour:
 *
 *   - The data plane is deliberately ungoverned. No selector uses a bare
 *     `broker.` prefix, and none uses `broker.message.` or
 *     `broker.consumer-group.`, so publishing, consuming and automatic
 *     rebalancing match nothing. A test holds that, because widening a prefix
 *     later would silently impose an authorization requirement on every message
 *     a broker carries.
 *   - `broker.message.replay` and the consumer-group administration events are
 *     selected by exact name, which is what keeps the two families above
 *     separable at all.
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

const PROFILE = "message-broker-management";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the message-broker-management profile must load");
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

describe("message-broker-management profile definition", () => {
  test("the profile is experimental and applies to core 0.1", () => {
    assert.equal(profile.name, PROFILE);
    assert.equal(profile.status, "experimental");
    assert.deepEqual(profile.coreVersions, ["0.1"]);
  });

  test("every rule identifier is unique and namespaced to this profile", () => {
    const ids = profile.rules.map((rule) => rule.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const id of ids) {
      assert.match(id, /^BROKER-/, `${id} should be namespaced to the broker profile`);
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

  test("broker metadata requirements stay inside the profile's namespace", () => {
    for (const rule of profile.rules) {
      for (const requirement of rule.requiredMetadata ?? []) {
        assert.match(
          requirement.path,
          /^\/broker\//,
          `${rule.id} requires ${requirement.path}, which is outside /metadata/broker`,
        );
      }
    }
  });
});

describe("broker data-plane traffic is deliberately ungoverned", () => {
  test("no selector uses a prefix that would sweep in the data plane", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        for (const forbidden of ["broker.", "broker.message.", "broker.consumer-group."]) {
          assert.notEqual(
            prefix,
            forbidden,
            `${rule.id} uses a ${forbidden} prefix, which would govern data-plane events`,
          );
        }
      }
    }
  });

  for (const name of [
    "broker.message.publish",
    // Resource-first data-plane names. event-naming.md tells producers to use the
    // resource as the middle segment, so a publish to a topic is plausibly named
    // `broker.topic.publish`. These were governed until the family prefixes were
    // narrowed to exact administrative names, which is the defect this list exists
    // to keep fixed.
    "broker.topic.publish",
    "broker.topic.consume",
    "broker.topic.read",
    "broker.queue.consume",
    "broker.queue.acknowledge",
    "broker.stream.append",
    "broker.exchange.publish",
    "broker.topic.view",
    "broker.acl.view",
    "broker.message.consume",
    "broker.message.acknowledge",
    "broker.message.deliver",
    "broker.consumer-group.rebalance",
    "broker.consumer-group.lag-report",
    "broker.cluster.health-check",
  ]) {
    test(`${name} matches no rule`, () => {
      assert.deepEqual(selectRules(profile, name), []);
    });
  }

  test("control-plane operations are still selected", () => {
    for (const name of [
      "broker.cluster.upgrade",
      "broker.topic.create",
      "broker.topic.update",
      "broker.topic.delete",
      "broker.queue.purge",
      "broker.exchange.delete",
      "broker.stream.create",
      "broker.consumer-group.delete",
      "broker.acl.grant",
      "broker.permission.revoke",
      "broker.quota.update",
      "broker.configuration.update",
      "broker.offset.reset",
      "broker.message.replay",
    ]) {
      assert.ok(selectRules(profile, name).length > 0, `${name} should be governed`);
    }
  });
});

describe("published message-broker-management fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "acl-grant.json",
      "cluster-upgrade.json",
      "configuration-update.json",
      "consumer-group-delete.json",
      "message-replay.json",
      "offset-reset.json",
      "queue-purge.json",
      "quota-update.json",
      "topic-create.json",
      "topic-delete-denied.json",
      "topic-delete.json",
      "topic-retention-reduce.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "acl-grant-missing-principal.json",
      "configuration-update-missing-change.json",
      "message-replay-missing-scope.json",
      "offset-reset-missing-target.json",
      "queue-purge-missing-destructive-flag.json",
      "queue-purge-missing-reason.json",
      "quota-update-missing-dimension.json",
      "topic-create-missing-authorization.json",
      "topic-create-missing-classification.json",
      "topic-create-missing-cluster.json",
      "topic-delete-denied-missing-error-type.json",
      "topic-delete-missing-approval.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), [
      "consumer-group-rebalance.json",
      "message-consume.json",
      "message-publish.json",
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
    "acl-grant-missing-principal.json": ["BROKER-ACL-001", "/metadata/broker/acl/principalId"],
    "configuration-update-missing-change.json": ["BROKER-CHANGE-001", "/change"],
    "message-replay-missing-scope.json": ["BROKER-REPLAY-001", "/metadata/broker/replay/scope"],
    "offset-reset-missing-target.json": ["BROKER-OFFSET-001", "/metadata/broker/offset/target"],
    "queue-purge-missing-destructive-flag.json": [
      "BROKER-RISK-001",
      "/metadata/broker/operation/destructive",
    ],
    "queue-purge-missing-reason.json": ["BROKER-RISK-002", "/reason"],
    "quota-update-missing-dimension.json": ["BROKER-QUOTA-001", "/metadata/broker/quota/dimension"],
    "topic-create-missing-authorization.json": ["BROKER-CORE-001", "/authorization"],
    "topic-create-missing-classification.json": [
      "BROKER-LIFECYCLE-001",
      "/resource/classification",
    ],
    "topic-create-missing-cluster.json": ["BROKER-CORE-001", "/metadata/broker/clusterId"],
    "topic-delete-denied-missing-error-type.json": ["BROKER-FAIL-001", "/event/error/type"],
    "topic-delete-missing-approval.json": ["BROKER-RISK-003", "/approval"],
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
  }

  test("every enforceable rule has a negative fixture", () => {
    const covered = new Set(Object.values(expectations).map(([ruleId]) => ruleId));
    for (const rule of profile.rules) {
      if ((rule.severity ?? "error") !== "error") {
        continue;
      }
      assert.ok(covered.has(rule.id), `${rule.id} fails conformance but has no invalid fixture`);
    }
  });

  for (const name of fixtureNames("not-applicable")) {
    test(`not-applicable/${name} is not governed by this profile`, () => {
      const result = checkProfile(readFixture("not-applicable", name), name, profile, validator);
      assert.equal(result.status, "not-applicable");
      assert.deepEqual(result.matchedRules, []);
    });

    test(`not-applicable/${name} is core-conforming and privacy-clean`, () => {
      const event = readFixture("not-applicable", name);
      assert.deepEqual(validator.validateEvent(event), []);
      assert.equal(lintEvent(event, name, validator).status, "clean");
    });
  }
});

describe("the destructive-operation condition", () => {
  test("a non-destructive operation is not required to carry a justification", () => {
    const routine = readFixture("valid", "topic-create.json");
    delete (routine as { reason?: unknown }).reason;

    const result = checkProfile(routine, "routine", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same operation declared destructive must be justified", () => {
    const destructive = readFixture("valid", "topic-create.json");
    delete (destructive as { reason?: unknown }).reason;
    const broker = (destructive["metadata"] as { broker: Record<string, unknown> }).broker;
    (broker["operation"] as Record<string, unknown>)["destructive"] = true;

    const result = checkProfile(destructive, "destructive", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((error) => `${error.ruleId} ${error.path}`),
      ["BROKER-RISK-002 /reason"],
    );
  });

  test("a conditional rule is reported as matched even when its condition does not hold", () => {
    const result = checkProfile(
      readFixture("valid", "topic-create.json"),
      "routine",
      profile,
      validator,
    );
    assert.ok(result.matchedRules.includes("BROKER-RISK-002"));
    assert.ok(result.matchedRules.includes("BROKER-RISK-003"));
    assert.ok(result.matchedRules.includes("BROKER-FAIL-001"));
  });
});

describe("the approval condition", () => {
  test("approval is not required when the producer did not declare it necessary", () => {
    const event = readFixture("valid", "topic-delete.json");
    delete (event as { approval?: unknown }).approval;
    const broker = (event["metadata"] as { broker: Record<string, unknown> }).broker;
    delete broker["approvalRequired"];

    const result = checkProfile(event, "unapproved", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("a rejected approval still satisfies the rule, so blocked changes stay recordable", () => {
    const event = readFixture("valid", "topic-delete.json");
    event["approval"] = { status: "rejected", requiredApprovals: 2, receivedApprovals: 1 };

    const result = checkProfile(event, "rejected", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });
});

describe("the profile only adds requirements", () => {
  test("no rule can make a core-invalid event conform", () => {
    // A core-invalid event: `outcome` is required by the schema.
    const broken = readFixture("valid", "topic-create.json");
    delete (broken["event"] as { outcome?: unknown }).outcome;

    const result = checkProfile(broken, "broken", profile, validator);
    assert.equal(result.status, "core-invalid");
  });
});
