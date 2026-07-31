/**
 * The published customer-and-account-management profile fixtures.
 *
 * The fixtures carry the same cross-cutting guarantee the IAM and document
 * profiles carry: every event this profile accepts is also core-conforming and
 * privacy-clean.
 *
 * Four properties are specific to this profile and are asserted here because
 * they are design decisions rather than incidental behaviour:
 *
 *   - High-volume reads are deliberately ungoverned. No selector uses a bare
 *     `customer.` or `account.` prefix, so `customer.profile.view`,
 *     `customer.search` and `account.balance.view` match nothing. A test holds
 *     that, because widening a prefix later would silently start governing
 *     every profile view in a customer platform.
 *   - The boundary with identity-and-access-management is structural. No
 *     selector here matches an `identity.` event, so no event is ever governed
 *     by both profiles and the two can never impose conflicting requirements.
 *   - The three conditional rules fire only on a producer-set discriminator,
 *     and contribute nothing when it is absent.
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

const PROFILE = "customer-and-account-management";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the customer-and-account-management profile must load");
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

function customerMetadata(event: Event): Record<string, unknown> {
  return (event["metadata"] as { customer: Record<string, unknown> }).customer;
}

describe("customer-and-account-management profile definition", () => {
  test("the profile is experimental and applies to core 0.1", () => {
    assert.equal(profile.name, PROFILE);
    assert.equal(profile.status, "experimental");
    assert.deepEqual(profile.coreVersions, ["0.1"]);
  });

  test("every rule identifier is unique and namespaced to this profile", () => {
    const ids = profile.rules.map((rule) => rule.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const id of ids) {
      assert.match(id, /^CUSTOMER-/, `${id} should be namespaced to the customer profile`);
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

  test("every metadata requirement lives under the customer namespace", () => {
    for (const rule of profile.rules) {
      for (const requirement of rule.requiredMetadata ?? []) {
        assert.match(
          requirement.path,
          /^\/customer\//,
          `${rule.id} requires ${requirement.path}, which is not namespaced`,
        );
      }
    }
  });
});

describe("high-volume reads are deliberately ungoverned", () => {
  test("no selector uses a bare customer. or account. prefix", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        assert.ok(
          prefix !== "customer." && prefix !== "account.",
          `${rule.id} uses a bare ${prefix} prefix, which would govern every read`,
        );
      }
    }
  });

  for (const name of [
    "customer.profile.view",
    "customer.search",
    "customer.record.export",
    "account.balance.view",
    "account.statement.view",
    "account.transaction.list",
  ]) {
    test(`${name} matches no rule`, () => {
      assert.deepEqual(selectRules(profile, name), []);
    });
  }

  test("governed lifecycle events are still selected", () => {
    for (const name of [
      "customer.create",
      "customer.update",
      "customer.merge",
      "customer.close",
      "customer.delete",
      "customer.restrict",
      "customer.restore",
      "account.open",
      "account.update",
      "account.close",
      "account.reopen",
      "account.freeze",
      "account.unfreeze",
      "account.restrict",
      "account.limit.increase",
      "account.status.update",
    ]) {
      assert.ok(selectRules(profile, name).length > 0, `${name} should be governed`);
    }
  });
});

describe("the boundary with identity and access management", () => {
  test("no selector matches an identity event", () => {
    for (const name of [
      "identity.user.create",
      "identity.user.disable",
      "identity.role.assign",
      "identity.permission.grant",
      "identity.service-account.create",
      "identity.credential.rotate",
      "authentication.login",
    ]) {
      assert.deepEqual(
        selectRules(profile, name),
        [],
        `${name} belongs to the identity profile, not this one`,
      );
    }
  });

  test("no selector reaches into the identity namespace at all", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        assert.ok(!prefix.startsWith("identity."), `${rule.id} selects ${prefix}`);
      }
      for (const name of rule.events ?? []) {
        assert.ok(!name.startsWith("identity."), `${rule.id} selects ${name}`);
      }
    }
  });

  test("neighbouring domains keep their own events", () => {
    // `financial.limit.*` is the closest neighbour: a control on a payment
    // flow, as against `account.limit.*`, an attribute of the account.
    for (const name of [
      "financial.limit.breach",
      "financial.transfer.execute",
      "document.share.create",
      "incident.case.create",
      "configuration.setting.update",
    ]) {
      assert.deepEqual(selectRules(profile, name), [], `${name} is not this profile's event`);
    }
  });
});

describe("published customer-and-account-management fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "account-close-approved.json",
      "account-freeze.json",
      "account-limit-increase.json",
      "account-open.json",
      "account-status-on-behalf.json",
      "account-update-override.json",
      "customer-close.json",
      "customer-create.json",
      "customer-delete.json",
      "customer-merge.json",
      "customer-restrict.json",
      "customer-update.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "account-close-missing-approval.json",
      "account-freeze-missing-restriction-scope.json",
      "account-freeze-missing-status.json",
      "account-limit-missing-before.json",
      "account-open-missing-owner.json",
      "account-status-missing-subject.json",
      "account-update-missing-override-reason.json",
      "customer-close-missing-authorization.json",
      "customer-create-missing-customer-type.json",
      "customer-delete-missing-scope.json",
      "customer-merge-missing-source.json",
      "customer-update-missing-change.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), [
      "account-balance-view.json",
      "customer-profile-view.json",
      "customer-search.json",
    ]);
  });

  for (const name of fixtureNames("valid")) {
    test(`valid/${name} conforms to the profile`, () => {
      const result = checkProfile(readFixture("valid", name), name, profile, validator);
      assert.equal(result.status, "conforming", JSON.stringify(result.errors));
    });

    test(`valid/${name} conforms without a single recommendation warning`, () => {
      const result = checkProfile(readFixture("valid", name), name, profile, validator);
      assert.deepEqual(
        result.warnings.map((warning) => `${warning.ruleId} ${warning.path}`),
        [],
      );
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
    "account-close-missing-approval.json": ["CUSTOMER-APPROVAL-001", "/approval/status"],
    "account-freeze-missing-restriction-scope.json": [
      "CUSTOMER-RESTRICT-001",
      "/metadata/customer/restrictionScope",
    ],
    "account-freeze-missing-status.json": ["CUSTOMER-STATE-001", "/metadata/customer/status"],
    "account-limit-missing-before.json": ["CUSTOMER-LIMIT-001", "/change/before"],
    "account-open-missing-owner.json": ["CUSTOMER-ACCOUNT-001", "/resource/ownerId"],
    "account-status-missing-subject.json": ["CUSTOMER-SUBJECT-001", "/subject"],
    "account-update-missing-override-reason.json": ["CUSTOMER-OVERRIDE-001", "/reason"],
    "customer-close-missing-authorization.json": ["CUSTOMER-CONTROL-001", "/authorization"],
    "customer-create-missing-customer-type.json": [
      "CUSTOMER-CORE-001",
      "/metadata/customer/customerType",
    ],
    "customer-delete-missing-scope.json": [
      "CUSTOMER-DELETE-001",
      "/metadata/customer/deletionScope",
    ],
    "customer-merge-missing-source.json": ["CUSTOMER-MERGE-001", "/metadata/customer/mergedFromId"],
    "customer-update-missing-change.json": ["CUSTOMER-UPDATE-001", "/change"],
  };

  test("every enforceable rule has at least one invalid fixture", () => {
    const covered = new Set(Object.values(expectations).map(([ruleId]) => ruleId));
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
      const lint = lintEvent(readFixture("not-applicable", name), name, validator);
      assert.equal(lint.status, "clean", JSON.stringify(lint.findings));
    });
  }
});

describe("the manual-override condition", () => {
  test("an ordinary account update needs no justification", () => {
    const ordinary = readFixture("valid", "account-update-override.json");
    delete (ordinary as { reason?: unknown }).reason;
    delete (ordinary as { authorization?: unknown }).authorization;
    delete customerMetadata(ordinary)["manualOverride"];

    const result = checkProfile(ordinary, "ordinary", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same update declared a manual override must carry both", () => {
    const overridden = readFixture("valid", "account-update-override.json");
    delete (overridden as { reason?: unknown }).reason;
    delete (overridden as { authorization?: unknown }).authorization;

    const result = checkProfile(overridden, "overridden", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(result.errors.map((error) => error.path).sort(), [
      "/authorization",
      "/reason",
    ]);
  });
});

describe("the declared-approval condition", () => {
  test("an account closure without the flag is not required to carry an approval", () => {
    const closure = readFixture("valid", "account-close-approved.json");
    delete (closure as { approval?: unknown }).approval;
    delete customerMetadata(closure)["approvalRequired"];

    const result = checkProfile(closure, "closure", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same closure declared to require approval must record its state", () => {
    const closure = readFixture("valid", "account-close-approved.json");
    delete (closure as { approval?: unknown }).approval;

    const result = checkProfile(closure, "closure", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((error) => `${error.ruleId} ${error.path}`),
      ["CUSTOMER-APPROVAL-001 /approval/status"],
    );
  });

  test("a rejected approval is still conforming, because the profile records state not verdicts", () => {
    const closure = readFixture("valid", "account-close-approved.json");
    (closure["approval"] as Record<string, unknown>)["status"] = "rejected";

    const result = checkProfile(closure, "closure", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });
});

describe("the acting-for condition", () => {
  test("a status change not declared on behalf of anyone needs no subject", () => {
    const direct = readFixture("valid", "account-status-on-behalf.json");
    delete (direct as { subject?: unknown }).subject;
    delete customerMetadata(direct)["onBehalfOf"];

    const result = checkProfile(direct, "direct", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("a conditional rule is reported as matched even when its condition does not hold", () => {
    const result = checkProfile(
      readFixture("valid", "customer-create.json"),
      "customer-create",
      profile,
      validator,
    );
    assert.ok(result.matchedRules.includes("CUSTOMER-SUBJECT-001"));
    assert.ok(result.matchedRules.includes("CUSTOMER-APPROVAL-001"));
    assert.ok(result.matchedRules.includes("CUSTOMER-OVERRIDE-001"));
  });
});

describe("the profile only adds requirements", () => {
  test("no rule can make a core-invalid event conform", () => {
    // A core-invalid event: `outcome` is required by the schema.
    const broken = readFixture("valid", "customer-create.json");
    delete (broken["event"] as { outcome?: unknown }).outcome;

    const result = checkProfile(broken, "broken", profile, validator);
    assert.equal(result.status, "core-invalid");
  });

  test("no rule relaxes a core requirement", () => {
    // The core requires a subject whenever delegation transfers authority.
    // The profile cannot make an event without one acceptable.
    const delegated = readFixture("valid", "account-status-on-behalf.json");
    delete (delegated as { subject?: unknown }).subject;
    (delegated as Record<string, unknown>)["delegation"] = { type: "on-behalf-of" };

    const result = checkProfile(delegated, "delegated", profile, validator);
    assert.equal(result.status, "core-invalid");
  });
});
