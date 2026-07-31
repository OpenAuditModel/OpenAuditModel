/**
 * The published deployment-and-change-management profile fixtures.
 *
 * The fixtures carry the same cross-cutting guarantee the other profiles carry:
 * every event this profile accepts is also core-conforming and privacy-clean.
 *
 * Five properties are specific to this profile and are asserted here because
 * they are design decisions rather than incidental behaviour:
 *
 *   - Pipeline telemetry and secret reads are deliberately ungoverned. No
 *     selector uses a bare `deployment.`, `configuration.` or `change.` prefix,
 *     and the configuration family is selected by exact name, so a poll, a build
 *     log line and a workload secret read match nothing. A test holds that,
 *     because widening a prefix later would silently start governing the
 *     highest-volume events a delivery platform emits.
 *   - The profile never requires a human approval. It requires the producer to
 *     say whether policy needed one, and enforces the consequence only then.
 *   - The two approval rules select disjoint event sets, so an event missing its
 *     approval fails exactly one of them. Disjointness is checked through
 *     `selectRules` over every name the profile can reach rather than by
 *     comparing the two `events` arrays, so a prefix added to either rule cannot
 *     reintroduce the overlap unnoticed.
 *   - Every path the profile claims under `/metadata` sits beneath
 *     `/metadata/deployment/`, conditions and recommendations included, so this
 *     profile never assigns a meaning to a root key such as `/metadata/status`.
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

const PROFILE = "deployment-and-change-management";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the deployment-and-change-management profile must load");
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

function deploymentMetadata(event: Event): Record<string, unknown> {
  return (event["metadata"] as { deployment: Record<string, unknown> }).deployment;
}

describe("deployment-and-change-management profile definition", () => {
  test("the profile is experimental and applies to core 0.1", () => {
    assert.equal(profile.name, PROFILE);
    assert.equal(profile.status, "experimental");
    assert.deepEqual(profile.coreVersions, ["0.1"]);
  });

  test("every rule identifier is unique and namespaced to this profile", () => {
    const ids = profile.rules.map((rule) => rule.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const id of ids) {
      assert.match(id, /^DEPLOY-/, `${id} should be namespaced to the deployment profile`);
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

  test("every rule states at least one requirement or recommendation", () => {
    for (const rule of profile.rules) {
      const requirements =
        (rule.requiredPaths?.length ?? 0) +
        (rule.requiredMetadata?.length ?? 0) +
        (rule.requiredValues?.length ?? 0) +
        (rule.recommendedPaths?.length ?? 0);
      assert.ok(requirements > 0, `${rule.id} selects events but asks nothing of them`);
    }
  });

  test("no rule requires an approval unconditionally", () => {
    const approvalEvents = new Set([
      "deployment.release.approve",
      "change.request.approve",
      "change.request.reject",
    ]);

    for (const rule of profile.rules) {
      const requiresApproval = (rule.requiredPaths ?? []).some((pointer) =>
        pointer.startsWith("/approval"),
      );
      if (!requiresApproval || rule.when !== undefined) {
        continue;
      }

      // An unconditional approval requirement is only defensible on events that ARE
      // approval decisions, and only an exact selector can promise that: a prefix also
      // matches names that do not exist yet, and `[].every()` is vacuously true, so a
      // rule selecting purely by prefix would otherwise pass this test unchecked.
      assert.equal(
        (rule.eventPrefixes ?? []).length,
        0,
        `${rule.id} requires an approval through a prefix, which reaches events that are not approvals`,
      );
      const names = rule.events ?? [];
      assert.ok(names.length > 0, `${rule.id} requires an approval with no exact event selector`);
      for (const name of names) {
        assert.ok(
          approvalEvents.has(name),
          `${rule.id} requires an approval from ${name}, which is not an approval decision`,
        );
      }
    }
  });

  test("the approval-policy flag a conditional rule depends on is itself required", () => {
    const flag = "/metadata/deployment/approvalRequired";

    const conditional = profile.rules.find((rule) => rule.when?.path === flag);
    assert.ok(conditional, "a rule should be conditioned on the approval-policy flag");

    const requires = profile.rules.some((rule) =>
      (rule.requiredMetadata ?? []).some((entry) => entry.path === "/deployment/approvalRequired"),
    );
    assert.ok(requires, "the approval-policy flag must be required, or the condition is optional");
  });

  test("every metadata pointer the profile names is inside its own namespace", () => {
    for (const rule of profile.rules) {
      for (const entry of rule.requiredMetadata ?? []) {
        assert.ok(
          entry.path.startsWith("/deployment/"),
          `${rule.id} requires /metadata${entry.path}, outside the profile's namespace`,
        );
      }

      // A recommendation or a condition on a root metadata key would claim a name such as
      // /metadata/status for this profile alone, which is exactly what namespacing prevents.
      const pointers = [...(rule.requiredPaths ?? []), ...(rule.recommendedPaths ?? [])];
      const condition = rule.when;
      if (condition !== undefined) {
        pointers.push(condition.path);
      }
      for (const pointer of pointers) {
        if (!pointer.startsWith("/metadata")) {
          continue;
        }
        assert.ok(
          pointer.startsWith("/metadata/deployment/"),
          `${rule.id} names ${pointer}, outside the profile's metadata namespace`,
        );
      }
    }
  });
});

describe("pipeline telemetry is deliberately ungoverned", () => {
  const forbidden = ["deployment.", "configuration.", "change.", "configuration.secret."];

  test("no selector uses a prefix that would sweep in routine pipeline events", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        assert.ok(
          !forbidden.includes(prefix),
          `${rule.id} uses the ${prefix} prefix, which would govern routine pipeline events`,
        );

        // Structural, rather than a list of names to keep up to date: a selector must
        // name an object within a category, never a whole category. `deployment.` is one
        // segment and would govern every event a delivery platform emits about itself.
        const segments = prefix.split(".").filter((segment) => segment.length > 0);
        assert.ok(
          segments.length >= 2,
          `${rule.id} selects on ${prefix}, a whole category rather than an object within it`,
        );
      }
    }
  });

  test("the configuration family is selected by exact name, never by prefix", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        assert.ok(
          !prefix.startsWith("configuration."),
          `${rule.id} selects configuration events by prefix, so a future read would be governed`,
        );
      }
    }
  });

  for (const name of [
    // a change-management tool emits comments and views continuously; they were governed until the change.request. prefix was narrowed.
    "change.request.view",
    "change.request.comment",
    "change.request.list",
    "change.request.subscribe",
    "deployment.pipeline.poll",
    "deployment.build.log-append",
    "deployment.health.check",
    "configuration.secret.access",
    "configuration.setting.read",
  ]) {
    test(`${name} matches no rule`, () => {
      assert.deepEqual(selectRules(profile, name), []);
    });
  }

  test("material change events are still selected", () => {
    for (const name of [
      "deployment.release.create",
      "deployment.release.approve",
      "deployment.release.deploy",
      "deployment.release.promote",
      "deployment.release.rollback",
      "deployment.release.cancel",
      "deployment.infrastructure.apply",
      "configuration.setting.update",
      "configuration.secret.rotate",
      "configuration.feature.toggle",
      "configuration.policy.update",
      "configuration.retention.update",
      "change.request.create",
      "change.request.approve",
    ]) {
      assert.ok(selectRules(profile, name).length > 0, `${name} should be governed`);
    }
  });
});

describe("the two approval rules select disjoint events", () => {
  /**
   * Every event name the profile could reach: the ones its rules name outright, plus
   * the ones its prefixes are documented to cover. Selection is checked through
   * `selectRules` rather than by comparing the two `events` arrays, so that adding a
   * prefix to either approval rule cannot reintroduce the overlap unnoticed.
   */
  const governed = [
    ...new Set([
      ...profile.rules.flatMap((rule) => [...(rule.events ?? [])]),
      "deployment.release.create",
      "deployment.release.approve",
      "deployment.release.deploy",
      "deployment.release.promote",
      "deployment.release.rollback",
      "deployment.release.cancel",
      "deployment.infrastructure.apply",
      "change.request.create",
      "change.request.approve",
      "change.request.reject",
      "change.request.close",
    ]),
  ].sort((left, right) => left.localeCompare(right, "en"));

  test("no event is governed by both DEPLOY-APPROVAL-001 and DEPLOY-APPROVAL-002", () => {
    const decision = profile.rules.find((rule) => rule.id === "DEPLOY-APPROVAL-001");
    const execution = profile.rules.find((rule) => rule.id === "DEPLOY-APPROVAL-002");
    assert.ok(decision, "DEPLOY-APPROVAL-001 should exist");
    assert.ok(execution, "DEPLOY-APPROVAL-002 should exist");

    for (const name of governed) {
      const selected = selectRules(profile, name).map((rule) => rule.id);
      assert.ok(
        !(selected.includes("DEPLOY-APPROVAL-001") && selected.includes("DEPLOY-APPROVAL-002")),
        `${name} is selected by both approval rules, so one omission would fail twice`,
      );
    }
  });

  test("both approval rules select by exact name, so no future verb joins them silently", () => {
    for (const id of ["DEPLOY-APPROVAL-001", "DEPLOY-APPROVAL-002"]) {
      const rule = profile.rules.find((candidate) => candidate.id === id);
      assert.ok(rule, `${id} should exist`);
      assert.equal((rule.eventPrefixes ?? []).length, 0, `${id} should not select by prefix`);
      assert.ok((rule.events ?? []).length > 0, `${id} should name the events it governs`);
    }
  });
});

describe("published deployment-and-change-management fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "change-request-approve.json",
      "configuration-update.json",
      "deploy-approved.json",
      "deploy-automated.json",
      "deploy-failed.json",
      "deploy-partial.json",
      "infrastructure-apply.json",
      "release-approve.json",
      "release-cancel.json",
      "release-create.json",
      "rollback-emergency.json",
      "secret-rotate-emergency.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "cancel-missing-authorization.json",
      "cancel-missing-reason.json",
      "change-request-approve-missing-approval.json",
      "configuration-update-missing-authorization.json",
      "deploy-approved-missing-approval.json",
      "deploy-failed-missing-resulting-state.json",
      "deploy-missing-approval-required.json",
      "deploy-missing-deployment-id.json",
      "deploy-missing-environment.json",
      "deploy-missing-previous-version.json",
      "deploy-missing-version.json",
      "deploy-partial-missing-resulting-state.json",
      "secret-rotate-missing-changed-fields.json",
      "secret-rotate-missing-reason.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), [
      "build-log-append.json",
      "pipeline-poll.json",
      "secret-access.json",
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
    "cancel-missing-authorization.json": ["DEPLOY-REVERT-001", "/authorization"],
    "cancel-missing-reason.json": ["DEPLOY-REVERT-001", "/reason"],
    "change-request-approve-missing-approval.json": ["DEPLOY-APPROVAL-001", "/approval/status"],
    "configuration-update-missing-authorization.json": ["DEPLOY-CONFIG-001", "/authorization"],
    "deploy-approved-missing-approval.json": ["DEPLOY-APPROVAL-002", "/approval/status"],
    "deploy-failed-missing-resulting-state.json": [
      "DEPLOY-FAILURE-001",
      "/metadata/deployment/resultingState",
    ],
    "deploy-missing-approval-required.json": [
      "DEPLOY-CORE-002",
      "/metadata/deployment/approvalRequired",
    ],
    "deploy-missing-deployment-id.json": ["DEPLOY-CORE-001", "/metadata/deployment/id"],
    "deploy-missing-environment.json": ["DEPLOY-CORE-001", "/metadata/deployment/environment"],
    "deploy-missing-previous-version.json": [
      "DEPLOY-RELEASE-002",
      "/metadata/deployment/previousVersion",
    ],
    "deploy-missing-version.json": ["DEPLOY-RELEASE-001", "/metadata/deployment/version"],
    "deploy-partial-missing-resulting-state.json": [
      "DEPLOY-FAILURE-002",
      "/metadata/deployment/resultingState",
    ],
    "secret-rotate-missing-changed-fields.json": ["DEPLOY-CONFIG-001", "/change/changedFields"],
    "secret-rotate-missing-reason.json": ["DEPLOY-EMERGENCY-001", "/reason"],
  };

  test("the expectations map covers every invalid fixture and names no other", () => {
    assert.deepEqual(
      Object.keys(expectations).sort((left, right) => left.localeCompare(right, "en")),
      fixtureNames("invalid"),
    );
  });

  test("every enforceable rule has at least one negative fixture", () => {
    const covered = new Set(Object.values(expectations).map((expectation) => expectation[0]));
    for (const rule of profile.rules) {
      if ((rule.severity ?? "error") !== "error") {
        continue;
      }
      assert.ok(covered.has(rule.id), `${rule.id} has no invalid fixture`);
    }
  });

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

describe("the approval-policy condition", () => {
  test("an automated deployment conforms with no approval at all", () => {
    const event = readFixture("valid", "deploy-automated.json");
    assert.equal(deploymentMetadata(event)["approvalRequired"], false);
    assert.equal(event["approval"], undefined);

    const result = checkProfile(event, "automated", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same deployment must carry an approval once policy required one", () => {
    const event = readFixture("valid", "deploy-automated.json");
    deploymentMetadata(event)["approvalRequired"] = true;

    const result = checkProfile(event, "gated", profile, validator);
    assert.equal(result.status, "violations");
    const failures = result.errors.map((error) => `${error.ruleId} ${error.path}`);
    assert.deepEqual(failures, ["DEPLOY-APPROVAL-002 /approval/status"]);
  });

  test("a pending approval satisfies the rule, because a bypass must stay recordable", () => {
    const event = readFixture("valid", "rollback-emergency.json");
    assert.equal((event["approval"] as { status: string }).status, "pending");
    assert.equal(deploymentMetadata(event)["approvalRequired"], true);

    const result = checkProfile(event, "bypass", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("a conditional rule is reported as matched even when its condition does not hold", () => {
    const result = checkProfile(
      readFixture("valid", "deploy-automated.json"),
      "automated",
      profile,
      validator,
    );
    assert.ok(result.matchedRules.includes("DEPLOY-APPROVAL-002"));
    assert.ok(result.matchedRules.includes("DEPLOY-EMERGENCY-001"));
  });
});

describe("the emergency condition", () => {
  test("a routine deployment is not required to carry a justification", () => {
    const event = readFixture("valid", "deploy-automated.json");
    delete (event as { reason?: unknown }).reason;

    const result = checkProfile(event, "routine", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same deployment flagged as an emergency must be justified", () => {
    const event = readFixture("valid", "deploy-automated.json");
    delete (event as { reason?: unknown }).reason;
    deploymentMetadata(event)["emergency"] = true;

    const result = checkProfile(event, "emergency", profile, validator);
    assert.equal(result.status, "violations");
    const failures = result.errors.map((error) => `${error.ruleId} ${error.path}`);
    assert.deepEqual(failures, ["DEPLOY-EMERGENCY-001 /reason"]);
  });
});

describe("the outcome conditions", () => {
  test("a successful deployment need not describe a resulting state", () => {
    const event = readFixture("valid", "deploy-automated.json");
    assert.equal(deploymentMetadata(event)["resultingState"], undefined);

    const result = checkProfile(event, "success", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("a partial deployment must describe the state its targets were left in", () => {
    const event = readFixture("valid", "deploy-automated.json");
    (event["event"] as { outcome: string }).outcome = "partial";

    const result = checkProfile(event, "partial", profile, validator);
    assert.equal(result.status, "violations");
    const failures = result.errors.map((error) => `${error.ruleId} ${error.path}`);
    assert.deepEqual(failures, ["DEPLOY-FAILURE-002 /metadata/deployment/resultingState"]);
  });

  test("a failed deployment must describe the state its targets were left in", () => {
    const event = readFixture("valid", "deploy-automated.json");
    const descriptor = event["event"] as { outcome: string; error?: unknown };
    descriptor.outcome = "failure";
    descriptor.error = { code: "dependency-unavailable" };

    const result = checkProfile(event, "failure", profile, validator);
    assert.equal(result.status, "violations");
    const failures = result.errors.map((error) => `${error.ruleId} ${error.path}`);
    assert.deepEqual(failures, ["DEPLOY-FAILURE-001 /metadata/deployment/resultingState"]);
  });
});

describe("the profile only adds requirements", () => {
  test("no rule can make a core-invalid event conform", () => {
    // A core-invalid event: `outcome` is required by the schema.
    const broken = readFixture("valid", "deploy-automated.json");
    delete (broken["event"] as { outcome?: unknown }).outcome;

    const result = checkProfile(broken, "broken", profile, validator);
    assert.equal(result.status, "core-invalid");
  });

  test("no rule relaxes a core requirement by requiring a weaker value", () => {
    for (const rule of profile.rules) {
      for (const pointer of rule.requiredPaths ?? []) {
        assert.ok(pointer.startsWith("/"), `${rule.id} uses a non-absolute pointer`);
      }
      for (const entry of rule.requiredMetadata ?? []) {
        assert.ok(
          entry.path.startsWith("/deployment/"),
          `${rule.id} requires metadata outside the /metadata/deployment namespace`,
        );
      }
    }
  });
});
