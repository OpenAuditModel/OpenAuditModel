/**
 * The declarative profile engine: definition validation, rule selection,
 * pointer resolution, presence semantics and rule evaluation.
 *
 * The engine's defining property is what it cannot do. A profile is data;
 * nothing in it is ever executed, and no rule vocabulary exists that could
 * remove a core requirement.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createValidator, resolveSchemaPath } from "../src/validate.js";
import {
  availableProfiles,
  loadProfile,
  MAX_PROFILE_BYTES,
  supportsCoreVersion,
} from "../src/profiles/load-profile.js";
import {
  loadProfileDefinitionSchema,
  PROFILE_DEFINITION_SCHEMA_ID,
  validateProfileDefinition,
} from "../src/profiles/validate-profile-definition.js";
import {
  isPresent,
  matchesMetadataType,
  MAX_POINTER_DEPTH,
  resolvePointer,
} from "../src/profiles/resolve-pointer.js";
import { ruleMatches, selectRules, eventName } from "../src/profiles/select-rules.js";
import { conditionHolds, evaluateRule } from "../src/profiles/evaluate-rule.js";
import { checkProfile } from "../src/profiles/check-profile.js";
import type { ProfileDefinition, ProfileRule } from "../src/profiles/types.js";

const validator = createValidator(resolveSchemaPath());

/** A minimal well-formed profile definition. */
function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profileVersion: "0.1",
    name: "example-profile",
    version: "0.1",
    status: "experimental",
    coreVersions: ["0.1"],
    title: "Example Profile",
    description: "A profile used by the conformance tests.",
    rules: [
      {
        id: "EX-001",
        description: "Example rule.",
        events: ["identity.role.assign"],
        requiredPaths: ["/authorization"],
      },
    ],
    ...overrides,
  };
}

function rule(overrides: Partial<ProfileRule> = {}): ProfileRule {
  return {
    id: "EX-001",
    description: "Example rule.",
    events: ["identity.role.assign"],
    ...overrides,
  } as ProfileRule;
}

/** A rule selected by prefix rather than by exact name. */
function prefixRule(
  prefixes: readonly string[],
  overrides: Partial<ProfileRule> = {},
): ProfileRule {
  return {
    id: "EX-001",
    description: "Example rule.",
    eventPrefixes: prefixes,
    ...overrides,
  } as ProfileRule;
}

function profile(rules: readonly ProfileRule[]): ProfileDefinition {
  return {
    profileVersion: "0.1",
    name: "example-profile",
    version: "0.1",
    status: "experimental",
    coreVersions: ["0.1"],
    title: "Example Profile",
    description: "A profile used by the conformance tests.",
    rules,
  };
}

describe("profile definition schema", () => {
  test("is a separate schema from the canonical audit event schema", () => {
    const schema = loadProfileDefinitionSchema();
    assert.equal(schema["$id"], PROFILE_DEFINITION_SCHEMA_ID);
    assert.notEqual(
      schema["$id"],
      "https://openauditmodel.org/schemas/audit-event/0.1/schema.json",
    );
    assert.match(String(schema["description"]), /NOT part of the canonical audit event schema/);
  });

  test("a valid definition passes", () => {
    assert.deepEqual(validateProfileDefinition(definition()), []);
  });

  const rejected: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["a missing name", { name: undefined }],
    ["a missing core version list", { coreVersions: undefined }],
    ["an empty core version list", { coreVersions: [] }],
    ["a missing profile format version", { profileVersion: undefined }],
    ["a wrong profile format version", { profileVersion: "0.2" }],
    ["a missing rule list", { rules: undefined }],
    ["an empty rule list", { rules: [] }],
    ["an unknown top-level property", { registry: "https://example.com" }],
    ["an invalid status", { status: "production" }],
    ["an upper-case profile name", { name: "Example" }],
  ];

  for (const [description, overrides] of rejected) {
    test(`${description} is rejected`, () => {
      const document = definition(overrides);
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete document[key];
        }
      }
      assert.notEqual(validateProfileDefinition(document).length, 0);
    });
  }

  const rejectedRules: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["a lower-case rule identifier", { id: "ex-001" }],
    ["a rule identifier without a segment", { id: "EX" }],
    ["a missing description", { description: undefined }],
    ["no selector at all", { events: undefined }],
    ["an unsupported selector type", { eventRegex: ["^identity\\..*$"] }],
    ["an unknown rule property", { requiredFields: ["/authorization"] }],
    ["an invalid JSON Pointer", { requiredPaths: ["authorization"] }],
    ["an invalid metadata type", { requiredMetadata: [{ path: "/role/id", type: "uuid" }] }],
    ["an invalid conditional operator", { when: { path: "/metadata/x", greaterThan: 1 } }],
    ["a conditional without a comparison", { when: { path: "/metadata/x" } }],
    ["a conditional comparing against an object", { when: { path: "/metadata/x", equals: {} } }],
    ["an event prefix that does not end with a dot", { eventPrefixes: ["identity"] }],
    ["an upper-case event name", { events: ["Identity.Role.Assign"] }],
    ["an unknown severity", { severity: "critical" }],
  ];

  for (const [description, overrides] of rejectedRules) {
    test(`a rule with ${description} is rejected`, () => {
      const ruleDocument: Record<string, unknown> = {
        id: "EX-001",
        description: "Example rule.",
        events: ["identity.role.assign"],
        ...overrides,
      };
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete ruleDocument[key];
        }
      }
      assert.notEqual(validateProfileDefinition(definition({ rules: [ruleDocument] })).length, 0);
    });
  }

  test("the rule vocabulary has no keyword that could remove a core requirement", () => {
    const schema = loadProfileDefinitionSchema() as Record<string, Record<string, unknown>>;
    const defs = schema["$defs"] as Record<string, Record<string, unknown>>;
    const ruleProperties = Object.keys(
      (defs["rule"] as Record<string, Record<string, unknown>>)["properties"] ?? {},
    );

    for (const forbidden of [
      "optionalPaths",
      "relaxedPaths",
      "notRequired",
      "exemptPaths",
      "overrides",
      "allowMissing",
      "disableCoreRule",
    ]) {
      assert.equal(ruleProperties.includes(forbidden), false, forbidden);
    }
    assert.deepEqual(
      ruleProperties.filter((name) => /relax|optional|exempt|override|disable|allow/i.test(name)),
      [],
    );
  });
});

describe("profile loading", () => {
  test("the identity profile ships with the repository", () => {
    assert.ok(availableProfiles().includes("identity-and-access-management"));
  });

  test("a known profile loads and validates", () => {
    const loaded = loadProfile("identity-and-access-management");
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.profile.name, "identity-and-access-management");
      assert.deepEqual(loaded.profile.coreVersions, ["0.1"]);
      assert.ok(loaded.profile.rules.length > 0);
    }
  });

  test("an unknown profile is refused and lists what is available", () => {
    const loaded = loadProfile("no-such-profile");
    assert.equal(loaded.ok, false);
    if (!loaded.ok) {
      assert.match(loaded.error, /no profile named/);
      assert.match(loaded.error, /identity-and-access-management/);
    }
  });

  test("a profile name cannot escape the profiles directory", () => {
    for (const name of ["../schemas", "..", "/etc/passwd", "a/b", "Profile", "profile name"]) {
      const loaded = loadProfile(name);
      assert.equal(loaded.ok, false, name);
      if (!loaded.ok) {
        assert.match(loaded.error, /not a valid profile name|no profile named/);
      }
    }
  });

  test("a profile file size limit is enforced", () => {
    assert.equal(MAX_PROFILE_BYTES, 256 * 1024);
  });

  test("core version support is explicit", () => {
    const loaded = loadProfile("identity-and-access-management");
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(supportsCoreVersion(loaded.profile, "0.1"), true);
      assert.equal(supportsCoreVersion(loaded.profile, "0.2"), false);
      assert.equal(supportsCoreVersion(loaded.profile, undefined), false);
    }
  });
});

describe("rule selection", () => {
  test("an exact selector matches its event", () => {
    assert.equal(
      ruleMatches(rule({ events: ["identity.role.assign"] }), "identity.role.assign"),
      true,
    );
  });

  test("an exact selector does not over-match", () => {
    const exact = rule({ events: ["identity.role.assign"] });
    for (const name of ["identity.role.revoke", "identity.role.assignment", "identity.role"]) {
      assert.equal(ruleMatches(exact, name), false, name);
    }
  });

  test("a prefix selector matches the events it intends to", () => {
    const prefixed = prefixRule(["identity.permission."]);
    assert.equal(ruleMatches(prefixed, "identity.permission.grant"), true);
    assert.equal(ruleMatches(prefixed, "identity.permission.revoke"), true);
  });

  test("a prefix selector does not match unrelated domains", () => {
    const prefixed = prefixRule(["identity.role."]);
    for (const name of [
      "document.share.create",
      "identity.user.create",
      "identity.roles-export.create",
      "configuration.setting.update",
    ]) {
      assert.equal(ruleMatches(prefixed, name), false, name);
    }
  });

  test("rules are selected in definition order and never duplicated", () => {
    const selected = selectRules(
      profile([
        rule({ id: "EX-001", events: ["identity.role.assign"] }),
        prefixRule(["identity."], { id: "EX-002" }),
        rule({ id: "EX-001", events: ["identity.role.assign"] }),
        rule({ id: "EX-003", events: ["document.share.create"] }),
      ]),
      "identity.role.assign",
    );
    assert.deepEqual(
      selected.map((entry) => entry.id),
      ["EX-001", "EX-002"],
    );
  });

  test("the event name is read from /event/name", () => {
    assert.equal(eventName({ event: { name: "identity.role.assign" } }), "identity.role.assign");
    assert.equal(eventName({ event: {} }), undefined);
    assert.equal(eventName({}), undefined);
    assert.equal(eventName(null), undefined);
  });
});

describe("pointer resolution", () => {
  const document = {
    metadata: { role: { id: "role-1", privileged: false }, "a/b": { "c~d": 1 }, list: [10, 20] },
    empty: { string: "", array: [], object: {}, nothing: null },
    zero: 0,
    untrue: false,
  };

  test("nested pointers resolve", () => {
    assert.deepEqual(resolvePointer(document, "/metadata/role/id"), {
      found: true,
      value: "role-1",
    });
  });

  test("JSON Pointer escaping is decoded", () => {
    assert.equal(resolvePointer(document, "/metadata/a~1b/c~0d").value, 1);
  });

  test("array indices resolve and are bounded", () => {
    assert.equal(resolvePointer(document, "/metadata/list/1").value, 20);
    assert.equal(resolvePointer(document, "/metadata/list/2").found, false);
    assert.equal(resolvePointer(document, "/metadata/list/x").found, false);
  });

  test("a missing member is not found", () => {
    assert.equal(resolvePointer(document, "/metadata/role/missing").found, false);
    assert.equal(resolvePointer(document, "/nothing/at/all").found, false);
  });

  test("prototype members are unreachable", () => {
    for (const pointer of [
      "/__proto__",
      "/constructor",
      "/metadata/__proto__/polluted",
      "/toString",
      "/metadata/constructor/prototype",
    ]) {
      assert.equal(resolvePointer(document, pointer).found, false, pointer);
    }
  });

  test("a malformed pointer resolves to nothing", () => {
    for (const pointer of ["metadata", "metadata/role", " /metadata"]) {
      assert.equal(resolvePointer(document, pointer).found, false, pointer);
    }
  });

  test("pointer depth is bounded", () => {
    const deep = `/${Array.from({ length: MAX_POINTER_DEPTH + 1 }, () => "a").join("/")}`;
    assert.equal(resolvePointer(document, deep).found, false);
  });
});

describe("presence semantics", () => {
  const present = (value: unknown) => isPresent({ found: true, value });

  test("a non-empty string is present", () => {
    assert.equal(present("value"), true);
  });

  test("false and zero are present, because they are answers", () => {
    assert.equal(present(false), true);
    assert.equal(present(0), true);
  });

  test("absent, null and empty values are not present", () => {
    assert.equal(isPresent({ found: false, value: undefined }), false);
    assert.equal(present(null), false);
    assert.equal(present(""), false);
    assert.equal(present([]), false);
    assert.equal(present({}), false);
  });

  test("non-empty containers are present", () => {
    assert.equal(present(["a"]), true);
    assert.equal(present({ a: 1 }), true);
  });

  test("metadata types are checked, with integer a subset of number", () => {
    assert.equal(matchesMetadataType("a", "string"), true);
    assert.equal(matchesMetadataType(1, "integer"), true);
    assert.equal(matchesMetadataType(1, "number"), true);
    assert.equal(matchesMetadataType(1.5, "number"), true);
    assert.equal(matchesMetadataType(1.5, "integer"), false);
    assert.equal(matchesMetadataType(true, "boolean"), true);
    assert.equal(matchesMetadataType("true", "boolean"), false);
    assert.equal(matchesMetadataType([], "array"), true);
    assert.equal(matchesMetadataType({}, "object"), true);
    assert.equal(matchesMetadataType([], "object"), false);
  });
});

describe("rule evaluation", () => {
  const event = {
    event: { name: "identity.role.assign" },
    authorization: { decision: "allow" },
    metadata: { role: { id: "role-1", privileged: true }, count: 3 },
    authentication: { mfa: false },
  };

  test("a satisfied required path produces nothing", () => {
    const evaluation = evaluateRule(event, rule({ requiredPaths: ["/authorization"] }));
    assert.deepEqual(evaluation.errors, []);
    assert.equal(evaluation.applied, true);
  });

  test("a missing required path produces an error at that pointer", () => {
    const evaluation = evaluateRule(event, rule({ requiredPaths: ["/approval"] }));
    assert.equal(evaluation.errors.length, 1);
    assert.equal(evaluation.errors[0]?.path, "/approval");
    assert.equal(evaluation.errors[0]?.severity, "error");
  });

  test("required metadata resolves relative to /metadata", () => {
    const evaluation = evaluateRule(
      event,
      rule({ requiredMetadata: [{ path: "/role/id", type: "string" }] }),
    );
    assert.deepEqual(evaluation.errors, []);
  });

  test("required metadata of the wrong type is reported with both types", () => {
    const evaluation = evaluateRule(
      event,
      rule({ requiredMetadata: [{ path: "/role/id", type: "boolean" }] }),
    );
    assert.equal(evaluation.errors.length, 1);
    assert.equal(evaluation.errors[0]?.path, "/metadata/role/id");
    assert.match(evaluation.errors[0]?.message ?? "", /must be of type "boolean".*is "string"/);
  });

  test("missing required metadata names the full pointer", () => {
    const evaluation = evaluateRule(
      event,
      rule({ requiredMetadata: [{ path: "/role/scope", type: "string" }] }),
    );
    assert.equal(evaluation.errors[0]?.path, "/metadata/role/scope");
  });

  test("a required value must match exactly", () => {
    const satisfied = evaluateRule(
      event,
      rule({ requiredValues: [{ path: "/metadata/role/privileged", equals: true }] }),
    );
    assert.deepEqual(satisfied.errors, []);

    const violated = evaluateRule(
      event,
      rule({ requiredValues: [{ path: "/authentication/mfa", equals: true }] }),
    );
    assert.equal(violated.errors.length, 1);
    assert.equal(violated.errors[0]?.path, "/authentication/mfa");
  });

  test("a required value that is absent is reported as absent", () => {
    const evaluation = evaluateRule(
      event,
      rule({ requiredValues: [{ path: "/authentication/assuranceLevel", equals: "high" }] }),
    );
    assert.match(evaluation.errors[0]?.message ?? "", /absent/);
  });

  test("a recommendation produces a warning, never an error", () => {
    const evaluation = evaluateRule(event, rule({ recommendedPaths: ["/request/correlationId"] }));
    assert.deepEqual(evaluation.errors, []);
    assert.equal(evaluation.warnings.length, 1);
    assert.equal(evaluation.warnings[0]?.severity, "warning");
  });

  test("a rule declared warning cannot fail conformance", () => {
    const evaluation = evaluateRule(
      event,
      rule({ severity: "warning", requiredPaths: ["/approval"] }),
    );
    assert.deepEqual(evaluation.errors, []);
    assert.equal(evaluation.warnings.length, 1);
  });

  test("evaluation never mutates the event", () => {
    const snapshot = JSON.stringify(event);
    evaluateRule(
      event,
      rule({
        requiredPaths: ["/approval"],
        requiredMetadata: [{ path: "/role/id", type: "string" }],
        requiredValues: [{ path: "/authentication/mfa", equals: true }],
        recommendedPaths: ["/request/correlationId"],
      }),
    );
    assert.equal(JSON.stringify(event), snapshot);
  });
});

describe("conditional rules", () => {
  const privileged = { metadata: { role: { privileged: true } } };
  const standard = { metadata: { role: { privileged: false } } };
  const unknown = { metadata: { role: {} } };

  test("a condition holds only on strict equality", () => {
    const condition = { path: "/metadata/role/privileged", equals: true };
    assert.equal(conditionHolds(privileged, condition), true);
    assert.equal(conditionHolds(standard, condition), false);
    assert.equal(conditionHolds(unknown, condition), false);
    assert.equal(conditionHolds({}, condition), false);
  });

  test("a truthy value is not equality", () => {
    const condition = { path: "/metadata/role/privileged", equals: true };
    assert.equal(conditionHolds({ metadata: { role: { privileged: "true" } } }, condition), false);
    assert.equal(conditionHolds({ metadata: { role: { privileged: 1 } } }, condition), false);
  });

  test("an absent condition path means the rule contributes nothing", () => {
    const conditional = rule({
      when: { path: "/metadata/role/privileged", equals: true },
      requiredPaths: ["/approval"],
    });
    const evaluation = evaluateRule(unknown, conditional);
    assert.equal(evaluation.applied, false);
    assert.deepEqual(evaluation.errors, []);
  });

  test("a condition that holds applies the requirements", () => {
    const conditional = rule({
      when: { path: "/metadata/role/privileged", equals: true },
      requiredPaths: ["/approval"],
    });
    const evaluation = evaluateRule(privileged, conditional);
    assert.equal(evaluation.applied, true);
    assert.equal(evaluation.errors.length, 1);
  });

  test("a condition never executes anything from the definition", () => {
    // A definition value that would be dangerous in an expression language is
    // just a string here: comparison is `Object.is`, never evaluation.
    const hostile = rule({
      when: { path: "/metadata/role/id", equals: "process.exit(1)" },
      requiredPaths: ["/approval"],
    });
    assert.doesNotThrow(() => evaluateRule({ metadata: { role: { id: "role-1" } } }, hostile));
    assert.equal(
      evaluateRule({ metadata: { role: { id: "process.exit(1)" } } }, hostile).applied,
      true,
    );
  });
});

describe("core invariant", () => {
  const loaded = loadProfile("identity-and-access-management");
  assert.ok(loaded.ok);
  const iam = loaded.ok ? loaded.profile : profile([]);

  const conformingEvent = {
    specVersion: "0.1",
    id: "018f4a03-1111-7222-8333-000000000003",
    time: "2026-06-01T09:00:00.000Z",
    event: { name: "identity.role.assign", category: "identity", outcome: "success" },
    actor: { type: "admin", id: "admin-4821" },
    resource: { type: "user", id: "user-7391" },
    application: { name: "identity-service", environment: "production" },
    authorization: { decision: "allow" },
    reason: { code: "access-request" },
    metadata: { role: { id: "role-support-agent", privileged: false } },
  };

  test("a core-invalid event can never be profile-valid", () => {
    const invalid = { ...conformingEvent } as Record<string, unknown>;
    delete invalid["actor"];

    const result = checkProfile(invalid, "event", iam, validator);
    assert.equal(result.status, "core-invalid");
    assert.equal(result.coreValid, false);
    assert.equal(result.profileValid, false);
    assert.deepEqual(result.matchedRules, []);
    assert.ok(result.coreIssues.length > 0);
  });

  test("profile rules are not evaluated for a core-invalid event", () => {
    // The event would violate IAM-ROLE-001 as well; only the core failure is
    // reported, so a profile can never be the thing that passes an invalid event.
    const invalid = { ...conformingEvent, metadata: {} } as Record<string, unknown>;
    delete invalid["actor"];

    const result = checkProfile(invalid, "event", iam, validator);
    assert.equal(result.status, "core-invalid");
    assert.deepEqual(result.errors, []);
  });

  test("a profile-conforming event is core-conforming by construction", () => {
    const result = checkProfile(conformingEvent, "event", iam, validator);
    assert.equal(result.status, "conforming");
    assert.equal(result.coreValid, true);
    assert.deepEqual(validator.validateEvent(conformingEvent), []);
  });

  test("a profile cannot introduce a new top-level event property", () => {
    // Whatever a profile requires, the core schema still rejects unknown
    // top-level properties: a profile has no way to make one acceptable.
    const withExtra = { ...conformingEvent, roleAssignment: { id: "role-1" } };
    const result = checkProfile(withExtra, "event", iam, validator);
    assert.equal(result.status, "core-invalid");
    assert.match(result.coreIssues.join("\n"), /roleAssignment/);
  });

  test("profile checking never mutates the input event", () => {
    const snapshot = JSON.stringify(conformingEvent);
    checkProfile(conformingEvent, "event", iam, validator);
    assert.equal(JSON.stringify(conformingEvent), snapshot);
  });

  test("an event declaring another core version is out of scope, not in violation", () => {
    const other = { ...conformingEvent, specVersion: "0.2" };
    const result = checkProfile(other, "event", iam, validator, { validateCore: false });
    assert.equal(result.status, "not-applicable");
    assert.equal(result.profileValid, true);
  });
});

describe("not applicable", () => {
  const loaded = loadProfile("identity-and-access-management");
  const iam = loaded.ok ? loaded.profile : profile([]);

  test("an event no rule governs is not-applicable, never conforming", () => {
    const document = {
      specVersion: "0.1",
      id: "018f4c01-1111-7222-8333-000000000001",
      time: "2026-06-03T09:00:00.000Z",
      event: { name: "document.share.create", category: "data-access", outcome: "success" },
      actor: { type: "user", id: "user-5120" },
      resource: { type: "document", id: "document-90311" },
      application: { name: "document-service", environment: "production" },
    };

    const result = checkProfile(document, "event", iam, validator);
    assert.equal(result.status, "not-applicable");
    assert.deepEqual(result.matchedRules, []);
    assert.deepEqual(result.errors, []);
  });
});
