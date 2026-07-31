/**
 * The published financial-transaction-management profile fixtures.
 *
 * The fixtures carry the same cross-cutting guarantee the IAM and document
 * profiles carry: every event this profile accepts is also core-conforming and
 * privacy-clean. For a profile over money the second half matters more than
 * anywhere else, because an account number or a scheme credential in a
 * published fixture is the first thing an implementer copies.
 *
 * Three properties are specific to this profile and are asserted here because
 * they are design decisions rather than incidental behaviour:
 *
 *   - Non-mutating financial reads are deliberately ungoverned. No selector
 *     uses a bare `financial.` prefix, so `financial.balance.view` matches
 *     nothing. A test holds that, because widening a prefix later would
 *     silently impose an amount, a currency, a direction and a correlation
 *     identifier on every balance lookup in a retail application.
 *   - Approval is never unconditionally required. Only `FIN-APPROVAL-001` names
 *     `/approval/status`, and only behind a `when` condition the producer sets.
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

const PROFILE = "financial-transaction-management";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the financial-transaction-management profile must load");
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

function financialMetadata(event: Event): Record<string, unknown> {
  return (event["metadata"] as { financial: Record<string, unknown> }).financial;
}

describe("financial-transaction-management profile definition", () => {
  test("the profile is experimental and applies to core 0.1", () => {
    assert.equal(profile.name, PROFILE);
    assert.equal(profile.status, "experimental");
    assert.deepEqual(profile.coreVersions, ["0.1"]);
  });

  test("every rule identifier is unique and namespaced to this profile", () => {
    const ids = profile.rules.map((rule) => rule.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const id of ids) {
      assert.match(id, /^FIN-/, `${id} should be namespaced to the financial profile`);
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

  test("every metadata requirement is namespaced under /metadata/financial", () => {
    for (const rule of profile.rules) {
      for (const requirement of rule.requiredMetadata ?? []) {
        assert.match(
          requirement.path,
          /^\/financial\//,
          `${rule.id} requires ${requirement.path}, which is not in the profile's namespace`,
        );
      }
    }
  });

  test("amount is required as a number, because the engine cannot check a range", () => {
    const amounts = profile.rules.flatMap((rule) =>
      (rule.requiredMetadata ?? []).filter(
        (requirement) => requirement.path === "/financial/amount",
      ),
    );
    assert.ok(amounts.length > 0, "some rule must require an amount");
    for (const requirement of amounts) {
      assert.equal(requirement.type, "number");
    }
  });
});

describe("non-mutating financial reads are deliberately ungoverned", () => {
  test("no selector uses a bare financial. prefix", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        assert.notEqual(
          prefix,
          "financial.",
          `${rule.id} uses a bare financial. prefix, which would govern balance reads`,
        );
      }
    }
  });

  for (const name of [
    // a limit check runs on every transaction; it was governed until FIN-LIMIT-001 and the core rules were narrowed to the three mutating limit operations.
    "financial.limit.check",
    "financial.limit.evaluate",
    "financial.limit.view",
    "financial.limit.breach",
    "financial.balance.view",
    "financial.quote.create",
    "financial.report.generate",
    "financial.statement.view",
  ]) {
    test(`${name} matches no rule`, () => {
      assert.deepEqual(selectRules(profile, name), []);
    });
  }

  test("governed financial events are still selected", () => {
    for (const name of [
      "financial.transfer.execute",
      "financial.payment.capture",
      "financial.withdrawal.execute",
      "financial.deposit.record",
      "financial.refund.create",
      "financial.reversal.execute",
      "financial.payout.execute",
      "financial.settlement.execute",
      "financial.chargeback.open",
      "financial.reconciliation.adjust",
      "financial.limit.update",
    ]) {
      assert.ok(selectRules(profile, name).length > 0, `${name} should be governed`);
    }
  });

  test("a prefix cannot match a sibling family whose name merely starts the same way", () => {
    // Prefixes end with a dot, so `financial.limit.` cannot match this name.
    assert.deepEqual(selectRules(profile, "financial.limits-export.create"), []);
  });
});

describe("published financial-transaction-management fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "chargeback-open.json",
      "deposit-manual-correction.json",
      "limit-update.json",
      "payment-capture.json",
      "payment-reject.json",
      "payout-execute.json",
      "reconciliation-adjust.json",
      "refund-create.json",
      "reversal-execute.json",
      "settlement-execute.json",
      "transfer-execute.json",
      "withdrawal-execute.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "limit-update-missing-limit-type.json",
      "manual-deposit-missing-change.json",
      "payment-capture-missing-amount.json",
      "payment-capture-missing-authorization.json",
      "payout-missing-direction.json",
      "reconciliation-adjust-missing-change.json",
      "reconciliation-missing-identifier.json",
      "refund-missing-reason.json",
      "reversal-missing-original-transaction.json",
      "transfer-missing-related-resources.json",
      "withdrawal-missing-approval-status.json",
      "withdrawal-missing-correlation.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), [
      "balance-view.json",
      "quote-create.json",
      "report-generate.json",
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
    "limit-update-missing-limit-type.json": ["FIN-LIMIT-001", "/metadata/financial/limitType"],
    "manual-deposit-missing-change.json": ["FIN-MANUAL-001", "/change"],
    "payment-capture-missing-amount.json": ["FIN-TXN-001", "/metadata/financial/amount"],
    "payment-capture-missing-authorization.json": ["FIN-CORE-001", "/authorization"],
    "payout-missing-direction.json": ["FIN-TXN-002", "/metadata/financial/direction"],
    "reconciliation-adjust-missing-change.json": ["FIN-RECON-002", "/change"],
    "reconciliation-missing-identifier.json": [
      "FIN-RECON-001",
      "/metadata/financial/reconciliationId",
    ],
    "refund-missing-reason.json": ["FIN-REASON-001", "/reason"],
    "reversal-missing-original-transaction.json": [
      "FIN-REVERSAL-001",
      "/metadata/financial/originalTransactionId",
    ],
    "transfer-missing-related-resources.json": ["FIN-LINK-001", "/relatedResources"],
    "withdrawal-missing-approval-status.json": ["FIN-APPROVAL-001", "/approval/status"],
    "withdrawal-missing-correlation.json": ["FIN-TXN-001", "/request/correlationId"],
  };

  test("every enforceable rule has at least one negative fixture", () => {
    const covered = new Set(Object.values(expectations).map((expectation) => expectation[0]));
    for (const rule of profile.rules) {
      if ((rule.severity ?? "error") !== "error") {
        continue;
      }
      assert.ok(covered.has(rule.id), `${rule.id} has no invalid fixture`);
    }
  });

  test("the expectations map covers every invalid fixture and names no missing one", () => {
    // Without this, a new invalid fixture would silently be checked against an
    // `undefined` expectation, and a deleted one would leave a stale entry that
    // nothing ever reads.
    const documented = Object.keys(expectations).sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    assert.deepEqual(documented, fixtureNames("invalid"));
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

    test(`not-applicable/${name} is still core-valid and privacy-clean`, () => {
      assert.deepEqual(validator.validateEvent(readFixture("not-applicable", name)), []);
      const lint = lintEvent(readFixture("not-applicable", name), name, validator);
      assert.equal(lint.status, "clean", JSON.stringify(lint.findings));
    });
  }
});

describe("the approval condition", () => {
  test("an automated payout conforms with no approval at all", () => {
    const payout = readFixture("valid", "payout-execute.json");
    assert.equal(payout["approval"], undefined);
    assert.equal(financialMetadata(payout)["approvalRequired"], false);

    const result = checkProfile(payout, "payout", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same payout must carry a decision once approval is declared required", () => {
    const payout = readFixture("valid", "payout-execute.json");
    financialMetadata(payout)["approvalRequired"] = true;

    const result = checkProfile(payout, "payout", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((error) => `${error.ruleId} ${error.path}`),
      ["FIN-APPROVAL-001 /approval/status"],
    );
  });

  test("a conditional rule is reported as matched even when its condition does not hold", () => {
    const result = checkProfile(
      readFixture("valid", "payout-execute.json"),
      "payout",
      profile,
      validator,
    );
    assert.ok(result.matchedRules.includes("FIN-APPROVAL-001"));
    assert.ok(result.matchedRules.includes("FIN-MANUAL-001"));
  });

  test("no rule requires an approval status to equal a particular value", () => {
    // A rejected or pending approval is a legitimate audit event, so the
    // profile requires the decision to be recorded and never requires it to be
    // favourable.
    for (const rule of profile.rules) {
      for (const requirement of rule.requiredValues ?? []) {
        assert.ok(
          !requirement.path.startsWith("/approval"),
          `${rule.id} pins ${requirement.path}, which would reject a recorded refusal`,
        );
      }
    }
  });
});

describe("the manual-intervention condition", () => {
  test("an automated deposit is not required to carry a change or a reason", () => {
    const deposit = readFixture("valid", "deposit-manual-correction.json");
    delete (deposit as { change?: unknown }).change;
    delete (deposit as { reason?: unknown }).reason;
    financialMetadata(deposit)["manual"] = false;

    const result = checkProfile(deposit, "automated", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same deposit must carry both once it is declared manual", () => {
    const deposit = readFixture("valid", "deposit-manual-correction.json");
    delete (deposit as { change?: unknown }).change;
    delete (deposit as { reason?: unknown }).reason;
    financialMetadata(deposit)["manual"] = true;

    const result = checkProfile(deposit, "manual", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(result.errors.map((error) => error.path).sort(), ["/change", "/reason"]);
  });
});

describe("the profile only adds requirements", () => {
  test("no rule can make a core-invalid event conform", () => {
    // A core-invalid event: `outcome` is required by the schema.
    const broken = readFixture("valid", "payment-capture.json");
    delete (broken["event"] as { outcome?: unknown }).outcome;

    const result = checkProfile(broken, "broken", profile, validator);
    assert.equal(result.status, "core-invalid");
  });

  test("the rule vocabulary has no keyword that could relax a core requirement", () => {
    const allowed = new Set([
      "id",
      "description",
      "rationale",
      "severity",
      "events",
      "eventPrefixes",
      "when",
      "requiredPaths",
      "requiredMetadata",
      "requiredValues",
      "recommendedPaths",
    ]);
    for (const rule of profile.rules) {
      for (const key of Object.keys(rule)) {
        assert.ok(allowed.has(key), `${rule.id} uses unknown rule keyword "${key}"`);
      }
    }
  });
});
