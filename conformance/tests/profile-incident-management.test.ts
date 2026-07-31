/**
 * The published incident-management profile fixtures.
 *
 * The fixtures carry the same cross-cutting guarantee the IAM and document
 * profiles carry: every event this profile accepts is also core-conforming and
 * privacy-clean.
 *
 * Three properties are specific to this profile and are asserted here because
 * they are design decisions rather than incidental behaviour:
 *
 *   - High-volume monitoring, timeline and read events are deliberately
 *     ungoverned. No selector uses a bare `incident.`, `incident.case.` or
 *     `problem.` prefix, so `monitoring.alert.raise`, `incident.note.create`
 *     and `incident.case.view` match nothing. Tests hold that, because widening
 *     a prefix later would silently start governing every alert and every read
 *     in a service management system.
 *   - Closure approval is conditional on a producer-set flag, never universal.
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

const PROFILE = "incident-management";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the incident-management profile must load");
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

describe("incident-management profile definition", () => {
  test("the profile is experimental and applies to core 0.1", () => {
    assert.equal(profile.name, PROFILE);
    assert.equal(profile.status, "experimental");
    assert.deepEqual(profile.coreVersions, ["0.1"]);
  });

  test("every rule identifier is unique and namespaced to this profile", () => {
    const ids = profile.rules.map((rule) => rule.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const id of ids) {
      assert.match(id, /^INC-/, `${id} should be namespaced to the incident profile`);
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

  test("every metadata requirement stays inside the profile's namespace", () => {
    for (const rule of profile.rules) {
      for (const requirement of rule.requiredMetadata ?? []) {
        assert.match(
          requirement.path,
          /^\/incident\//,
          `${rule.id} requires ${requirement.path} outside /metadata/incident`,
        );
      }
    }
  });
});

describe("high-volume monitoring, timeline and read events are deliberately ungoverned", () => {
  test("no selector uses a prefix broad enough to sweep them in", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        for (const forbidden of ["incident.", "incident.case.", "problem.", "monitoring."]) {
          assert.notEqual(
            prefix,
            forbidden,
            `${rule.id} uses a bare ${forbidden} prefix, which would govern alerts, notes or reads`,
          );
        }
      }
    }
  });

  for (const name of [
    // reads of an analysis or a corrective action were governed until the bare domain prefixes were narrowed to exact names.
    "incident.rca.view",
    "incident.rca.list",
    "corrective-action.view",
    "corrective-action.list",
    "monitoring.alert.raise",
    "monitoring.alert.clear",
    "incident.note.create",
    "incident.timeline.append",
    "incident.case.view",
  ]) {
    test(`${name} matches no rule`, () => {
      assert.deepEqual(selectRules(profile, name), []);
    });
  }

  test("governed lifecycle events are still selected", () => {
    for (const name of [
      "incident.case.create",
      "incident.case.resolve",
      "incident.case.close",
      "incident.case.cancel",
      "incident.case.reopen",
      "incident.priority.change",
      "incident.assignment.change",
      "incident.major.declare",
      "incident.sla.breach",
      "incident.rca.create",
      "incident.rca.approve",
      "problem.case.create",
      "problem.case.close",
      "corrective-action.open",
      "corrective-action.verify",
      "corrective-action.close",
    ]) {
      assert.ok(selectRules(profile, name).length > 0, `${name} should be governed`);
    }
  });
});

describe("published incident-management fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "assignment-change.json",
      "case-close.json",
      "case-create.json",
      "case-reopen.json",
      "case-resolve.json",
      "corrective-action-open.json",
      "corrective-action-verify.json",
      "major-declare.json",
      "priority-change.json",
      "problem-case-close.json",
      "rca-approve.json",
      "rca-create.json",
      "sla-breach.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "assignment-change-missing-assignee.json",
      "assignment-change-missing-change.json",
      "case-close-missing-approval.json",
      "case-close-missing-authorization.json",
      "case-close-missing-reason.json",
      "case-create-missing-status.json",
      "case-reopen-missing-change.json",
      "case-reopen-missing-reason.json",
      "case-resolve-missing-resolution-type.json",
      "corrective-action-verify-missing-method.json",
      "priority-change-missing-priority.json",
      "rca-approve-missing-approval.json",
      "rca-create-missing-method.json",
      "sla-breach-missing-target.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), [
      "case-view.json",
      "monitoring-alert-raise.json",
      "note-create.json",
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
    "assignment-change-missing-change.json": ["INC-STATE-001", "/change"],
    "assignment-change-missing-assignee.json": ["INC-ASSIGN-001", "/metadata/incident/assigneeId"],
    "case-close-missing-approval.json": ["INC-CLOSE-001", "/approval/status"],
    "case-close-missing-authorization.json": ["INC-CORE-001", "/authorization"],
    "case-close-missing-reason.json": ["INC-STATE-002", "/reason"],
    "case-create-missing-status.json": ["INC-CORE-001", "/metadata/incident/status"],
    "case-reopen-missing-change.json": ["INC-REOPEN-001", "/change"],
    "case-reopen-missing-reason.json": ["INC-REOPEN-001", "/reason"],
    "case-resolve-missing-resolution-type.json": [
      "INC-RESOLVE-001",
      "/metadata/incident/resolutionType",
    ],
    "corrective-action-verify-missing-method.json": [
      "INC-CAPA-001",
      "/metadata/incident/correctiveAction/verificationMethod",
    ],
    "priority-change-missing-priority.json": ["INC-PRIORITY-001", "/metadata/incident/priority"],
    "rca-approve-missing-approval.json": ["INC-RCA-002", "/approval/status"],
    "rca-create-missing-method.json": ["INC-RCA-001", "/metadata/incident/rca/method"],
    "sla-breach-missing-target.json": ["INC-SLA-001", "/metadata/incident/sla/target"],
  };

  test("every enforceable requirement has an invalid fixture that proves it", () => {
    const covered = new Set(
      Object.values(expectations).map(([ruleId, pointer]) => `${ruleId} ${pointer}`),
    );
    const required: string[] = [];

    for (const rule of profile.rules) {
      if ((rule.severity ?? "error") !== "error") {
        continue;
      }
      for (const pointer of rule.requiredPaths ?? []) {
        required.push(`${rule.id} ${pointer}`);
      }
      for (const requirement of rule.requiredMetadata ?? []) {
        required.push(`${rule.id} /metadata${requirement.path}`);
      }
    }

    assert.deepEqual(
      required.filter((entry) => !covered.has(entry)),
      [],
      "an enforceable requirement with no negative fixture is a rule nothing holds in place",
    );
  });

  test("every invalid fixture is named in the expectations map", () => {
    assert.deepEqual(Object.keys(expectations).sort(), [...fixtureNames("invalid")].sort());
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

    test(`invalid/${name} is privacy-clean`, () => {
      const result = lintEvent(readFixture("invalid", name), name, validator);
      assert.equal(result.status, "clean", JSON.stringify(result.findings));
    });
  }

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

describe("the closure-approval condition", () => {
  test("a closure the producer declared as not needing approval carries none", () => {
    const routine = readFixture("valid", "problem-case-close.json");
    const incident = (routine["metadata"] as { incident: Record<string, unknown> }).incident;
    assert.equal(incident["approvalRequired"], false);
    assert.equal("approval" in routine, false);

    const result = checkProfile(routine, "routine", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same closure declared as needing approval must record the decision", () => {
    const governed = readFixture("valid", "problem-case-close.json");
    const incident = (governed["metadata"] as { incident: Record<string, unknown> }).incident;
    incident["approvalRequired"] = true;

    const result = checkProfile(governed, "governed", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((error) => `${error.ruleId} ${error.path}`),
      ["INC-CLOSE-001 /approval/status"],
    );
  });

  test("a conditional rule is reported as matched even when its condition does not hold", () => {
    const result = checkProfile(
      readFixture("valid", "problem-case-close.json"),
      "routine",
      profile,
      validator,
    );
    assert.ok(result.matchedRules.includes("INC-CLOSE-001"));
  });

  test("closure approval is never demanded unconditionally", () => {
    for (const rule of profile.rules) {
      if ((rule.requiredPaths ?? []).some((pointer) => pointer.startsWith("/approval"))) {
        const selected = rule.events ?? [];
        const intrinsic =
          selected.length > 0 &&
          (rule.eventPrefixes ?? []).length === 0 &&
          selected.every((name) => name.endsWith(".approve"));
        assert.ok(
          rule.when !== undefined || intrinsic,
          `${rule.id} requires an approval without a condition and without being an approval event`,
        );
      }
    }
  });
});

describe("a reopen is a new transition, not a retraction", () => {
  test("reopening is governed by its own rule and reuses the original correlation", () => {
    const reopen = readFixture("valid", "case-reopen.json");
    const result = checkProfile(reopen, "reopen", profile, validator);

    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
    assert.ok(result.matchedRules.includes("INC-REOPEN-001"));

    const close = readFixture("valid", "case-close.json");
    const correlation = (request: Event): unknown =>
      (request["request"] as Record<string, unknown>)["correlationId"];
    assert.equal(correlation(reopen), correlation(close));
  });

  test("no rule requires a fresh approval on a reopen", () => {
    for (const rule of profile.rules) {
      if (!(rule.events ?? []).includes("incident.case.reopen")) {
        continue;
      }
      assert.deepEqual(
        (rule.requiredPaths ?? []).filter((pointer) => pointer.startsWith("/approval")),
        [],
        `${rule.id} requires an approval on a reopen, which this profile does not assert`,
      );
    }
  });
});

describe("the profile only adds requirements", () => {
  test("no rule can make a core-invalid event conform", () => {
    // A core-invalid event: `outcome` is required by the schema.
    const broken = readFixture("valid", "case-create.json");
    delete (broken["event"] as { outcome?: unknown }).outcome;

    const result = checkProfile(broken, "broken", profile, validator);
    assert.equal(result.status, "core-invalid");
  });
});
