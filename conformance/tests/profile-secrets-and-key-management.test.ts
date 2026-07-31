/**
 * The published secrets-and-key-management profile fixtures.
 *
 * The fixtures carry the same cross-cutting guarantee every published profile
 * carries: every event this profile accepts is also core-conforming and
 * privacy-clean. In this domain the second half of that guarantee is the whole
 * point, so it is asserted here twice — once for every fixture, and once as a
 * standing invariant that no fixture may carry secret-shaped material.
 *
 * Three properties are specific to this profile and are asserted here because
 * they are design decisions rather than incidental behaviour:
 *
 *   - Routine automated retrieval of a secret, cache refreshes and ordinary
 *     cryptographic operations against a key are deliberately ungoverned. No
 *     selector uses a bare `secret.`, `key.` or `certificate.` prefix, so
 *     `secret.retrieve` and `key.decrypt` match nothing. A test holds that,
 *     because widening a prefix later would silently start requiring an
 *     authorization decision and a classification on the highest-volume event a
 *     custody system emits.
 *   - Approval is demanded conditionally, never universally: on the producer's
 *     own `approvalRequired` declaration, and on break-glass access.
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

const PROFILE = "secrets-and-key-management";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the secrets-and-key-management profile must load");
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

describe("secrets-and-key-management profile definition", () => {
  test("the profile is experimental and applies to core 0.1", () => {
    assert.equal(profile.name, PROFILE);
    assert.equal(profile.status, "experimental");
    assert.deepEqual(profile.coreVersions, ["0.1"]);
  });

  test("every rule identifier is unique and namespaced to this profile", () => {
    const ids = profile.rules.map((rule) => rule.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const id of ids) {
      assert.match(id, /^SECRET-/, `${id} should be namespaced to the secrets profile`);
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

  test("no rule requires approval unconditionally", () => {
    for (const rule of profile.rules) {
      if ((rule.requiredPaths ?? []).includes("/approval")) {
        assert.ok(
          rule.when !== undefined,
          `${rule.id} requires /approval with no condition; approval in this domain is required only where the producer or a break-glass declaration asks for it`,
        );
      }
    }
  });

  test("every metadata field this profile touches is namespaced under /metadata/secret", () => {
    for (const rule of profile.rules) {
      for (const required of rule.requiredMetadata ?? []) {
        assert.match(
          required.path,
          /^\/secret\//,
          `${rule.id} requires ${required.path} under /metadata; an unnamespaced key such as /metadata/type means whatever the next profile decides it means`,
        );
      }

      const pointers = [
        ...(rule.requiredPaths ?? []),
        ...(rule.recommendedPaths ?? []),
        ...(rule.requiredValues ?? []).map((value) => value.path),
        ...(rule.when === undefined ? [] : [rule.when.path]),
      ];

      for (const pointer of pointers.filter((entry) => entry.startsWith("/metadata"))) {
        assert.match(
          pointer,
          /^\/metadata\/secret\//,
          `${rule.id} addresses ${pointer}; this profile owns /metadata/secret/ and nothing else under /metadata`,
        );
      }
    }
  });
});

describe("routine custody traffic is deliberately ungoverned", () => {
  test("no selector uses a bare domain prefix", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        for (const bare of ["secret.", "key.", "certificate."]) {
          assert.notEqual(
            prefix,
            bare,
            `${rule.id} uses a bare ${bare} prefix, which would govern routine retrieval and data-plane events`,
          );
        }
      }
    }
  });

  for (const name of [
    "secret.retrieve",
    "secret.cache-refresh",
    "key.decrypt",
    "key.encrypt",
    "key.sign",
    "key.verify",
    "certificate.validate",
  ]) {
    test(`${name} matches no rule`, () => {
      assert.deepEqual(selectRules(profile, name), []);
    });
  }

  test("governed custody events are still selected", () => {
    for (const name of [
      "secret.create",
      "secret.update",
      "secret.rotate",
      "secret.revoke",
      "secret.delete",
      "secret.reveal",
      "secret.export",
      "secret.policy.update",
      "key.generate",
      "key.import",
      "key.rotate",
      "key.enable",
      "key.disable",
      "key.destroy",
      "key.export",
      "key.policy.update",
      "certificate.issue",
      "certificate.renew",
      "certificate.revoke",
      "certificate.delete",
    ]) {
      assert.ok(selectRules(profile, name).length > 0, `${name} should be governed`);
    }
  });
});

describe("published secrets-and-key-management fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "certificate-issue.json",
      "key-destroy.json",
      "key-export.json",
      "key-generate.json",
      "key-import.json",
      "secret-create.json",
      "secret-export.json",
      "secret-policy-update.json",
      "secret-reveal-emergency.json",
      "secret-reveal.json",
      "secret-revoke.json",
      "secret-rotate.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "certificate-issue-missing-expiry.json",
      "emergency-reveal-missing-approval.json",
      "key-destroy-missing-approval.json",
      "key-generate-missing-owner.json",
      "key-import-missing-reason.json",
      "policy-update-missing-change.json",
      "secret-create-missing-authorization.json",
      "secret-export-missing-destination.json",
      "secret-reveal-missing-reason.json",
      "secret-revoke-missing-reason.json",
      "secret-rotate-missing-change.json",
      "secret-rotate-missing-type.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), [
      "key-decrypt.json",
      "secret-cache-refresh.json",
      "secret-retrieve.json",
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
    "certificate-issue-missing-expiry.json": ["SECRET-CERT-001", "/metadata/secret/expiresAt"],
    "emergency-reveal-missing-approval.json": ["SECRET-ACCESS-002", "/approval"],
    "key-destroy-missing-approval.json": ["SECRET-APPROVAL-001", "/approval"],
    "key-generate-missing-owner.json": ["SECRET-LIFECYCLE-001", "/resource/ownerId"],
    "key-import-missing-reason.json": ["SECRET-KEY-001", "/reason"],
    "policy-update-missing-change.json": ["SECRET-POLICY-001", "/change"],
    "secret-create-missing-authorization.json": ["SECRET-CORE-001", "/authorization"],
    "secret-export-missing-destination.json": [
      "SECRET-EXPORT-001",
      "/metadata/secret/destinationType",
    ],
    "secret-reveal-missing-reason.json": ["SECRET-ACCESS-001", "/reason"],
    "secret-revoke-missing-reason.json": ["SECRET-DESTROY-001", "/reason"],
    "secret-rotate-missing-change.json": ["SECRET-ROTATE-001", "/change"],
    "secret-rotate-missing-type.json": ["SECRET-CORE-002", "/metadata/secret/type"],
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
      assert.ok(covered.has(rule.id), `${rule.id} has no invalid fixture`);
    }
  });

  test("no enforceable rule is covered twice, so the mapping is one fixture per rule", () => {
    const ruleIds = Object.values(expectations).map(([ruleId]) => ruleId);
    assert.deepEqual(
      [...new Set(ruleIds)],
      ruleIds,
      "both READMEs state that each enforceable rule has exactly one negative fixture; two fixtures on one rule means another rule is untested",
    );
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

describe("no fixture carries the material it describes", () => {
  /**
   * The profile records that a custody operation happened. A fixture that
   * carried a value under one of these names would be teaching producers the
   * one thing this domain must never do, so the check is explicit rather than
   * left to the privacy linter alone.
   */
  const FORBIDDEN = new Set([
    "secret",
    "secretkey",
    "clientsecret",
    "password",
    "passphrase",
    "privatekey",
    "signingkey",
    "encryptionkey",
    "apikey",
    "credential",
    "credentials",
    "accesstoken",
    "refreshtoken",
    "keymaterial",
    "recoveryphrase",
  ]);

  function scalarsUnderForbiddenNames(value: unknown, at: string, found: string[]): void {
    if (Array.isArray(value)) {
      for (const [index, entry] of value.entries()) {
        scalarsUnderForbiddenNames(entry, `${at}/${index}`, found);
      }
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replaceAll(/[-_. ]/g, "");
      const pointer = `${at}/${key}`;
      if (FORBIDDEN.has(normalized) && (typeof member === "string" || typeof member === "number")) {
        found.push(pointer);
      }
      scalarsUnderForbiddenNames(member, pointer, found);
    }
  }

  for (const kind of ["valid", "invalid", "not-applicable"] as const) {
    for (const name of fixtureNames(kind)) {
      test(`${kind}/${name} carries no value under a credential name`, () => {
        const found: string[] = [];
        scalarsUnderForbiddenNames(readFixture(kind, name), "", found);
        assert.deepEqual(found, []);
      });
    }
  }
});

describe("the emergency-access condition", () => {
  test("an ordinary reveal is not required to carry an approval", () => {
    const ordinary = readFixture("valid", "secret-reveal.json");
    delete (ordinary as { approval?: unknown }).approval;

    const result = checkProfile(ordinary, "ordinary", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same reveal declared as emergency access must carry one", () => {
    const emergency = readFixture("valid", "secret-reveal.json");
    delete (emergency as { approval?: unknown }).approval;
    const metadata = (emergency["metadata"] as { secret: Record<string, unknown> }).secret;
    metadata["emergencyAccess"] = true;

    const result = checkProfile(emergency, "emergency", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((error) => `${error.ruleId} ${error.path}`),
      ["SECRET-ACCESS-002 /approval"],
    );
  });

  test("emergency access from a single-factor session is a violation, not an omission", () => {
    const emergency = readFixture("valid", "secret-reveal-emergency.json");
    (emergency["authentication"] as Record<string, unknown>)["mfa"] = false;

    const result = checkProfile(emergency, "single-factor", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((error) => `${error.ruleId} ${error.path}`),
      ["SECRET-ACCESS-002 /authentication/mfa"],
    );
  });

  test("a pending approval on a completed emergency access still conforms", () => {
    const emergency = readFixture("valid", "secret-reveal-emergency.json");
    assert.equal((emergency["approval"] as Record<string, unknown>)["status"], "pending");

    const result = checkProfile(emergency, "pending", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("a conditional rule is reported as matched even when its condition does not hold", () => {
    const result = checkProfile(
      readFixture("valid", "secret-reveal.json"),
      "ordinary",
      profile,
      validator,
    );
    assert.ok(result.matchedRules.includes("SECRET-ACCESS-002"));
    assert.ok(result.matchedRules.includes("SECRET-APPROVAL-001"));
  });
});

describe("the locally declared approval requirement", () => {
  test("an operation that declares no approval requirement needs no approval", () => {
    const rotate = readFixture("valid", "secret-rotate.json");
    assert.equal(rotate["approval"], undefined);

    const result = checkProfile(rotate, "unattended", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same rotation declared as requiring approval must carry one", () => {
    const rotate = readFixture("valid", "secret-rotate.json");
    const metadata = (rotate["metadata"] as { secret: Record<string, unknown> }).secret;
    metadata["approvalRequired"] = true;

    const result = checkProfile(rotate, "approval-required", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((error) => `${error.ruleId} ${error.path}`),
      ["SECRET-APPROVAL-001 /approval"],
    );
  });

  test("a declaration of false is a recorded answer, not a missing one", () => {
    const create = readFixture("valid", "secret-create.json");
    delete (create as { approval?: unknown }).approval;
    const metadata = (create["metadata"] as { secret: Record<string, unknown> }).secret;
    assert.equal(metadata["approvalRequired"], false);

    const result = checkProfile(create, "declared-false", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });
});

describe("the profile only adds requirements", () => {
  test("no rule can make a core-invalid event conform", () => {
    // A core-invalid event: `outcome` is required by the schema.
    const broken = readFixture("valid", "secret-create.json");
    delete (broken["event"] as { outcome?: unknown }).outcome;

    const result = checkProfile(broken, "broken", profile, validator);
    assert.equal(result.status, "core-invalid");
  });
});
