/**
 * The published document-management profile fixtures.
 *
 * The fixtures carry the same cross-cutting guarantee the IAM profile carries:
 * every event this profile accepts is also core-conforming and privacy-clean.
 *
 * Two properties are specific to this profile and are asserted here because
 * they are design decisions rather than incidental behaviour:
 *
 *   - High-volume read events are deliberately ungoverned. No selector uses a
 *     bare `document.` prefix, so `document.file.view` matches nothing. A test
 *     holds that, because widening a prefix later would silently start
 *     governing every view event in a document system.
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

const PROFILE = "document-management";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the document-management profile must load");
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

describe("document-management profile definition", () => {
  test("the profile is experimental and applies to core 0.1", () => {
    assert.equal(profile.name, PROFILE);
    assert.equal(profile.status, "experimental");
    assert.deepEqual(profile.coreVersions, ["0.1"]);
  });

  test("every rule identifier is unique and namespaced to this profile", () => {
    const ids = profile.rules.map((rule) => rule.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const id of ids) {
      assert.match(id, /^DOC-/, `${id} should be namespaced to the document profile`);
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
});

describe("high-volume read events are deliberately ungoverned", () => {
  test("no selector uses a bare document. prefix", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        assert.notEqual(
          prefix,
          "document.",
          `${rule.id} uses a bare document. prefix, which would govern read events`,
        );
      }
    }
  });

  for (const name of ["document.file.view", "document.file.preview", "document.file.thumbnail"]) {
    test(`${name} matches no rule`, () => {
      assert.deepEqual(selectRules(profile, name), []);
    });
  }

  test("governed lifecycle events are still selected", () => {
    for (const name of [
      "document.file.upload",
      "document.file.download",
      "document.file.delete",
      "document.share.create",
      "document.permission.grant",
      "document.version.rollback",
      "document.retention.update",
      "document.legal-hold.apply",
    ]) {
      assert.ok(selectRules(profile, name).length > 0, `${name} should be governed`);
    }
  });
});

describe("published document-management fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "file-delete.json",
      "file-download.json",
      "file-upload.json",
      "legal-hold-apply.json",
      "permission-grant.json",
      "retention-update.json",
      "share-external.json",
      "share-internal.json",
      "share-revoke.json",
      "version-rollback.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "delete-missing-reason.json",
      "download-missing-classification.json",
      "external-share-missing-expiry.json",
      "external-share-missing-reason.json",
      "legal-hold-missing-state.json",
      "permission-grant-missing-grantee.json",
      "retention-update-missing-class.json",
      "share-create-missing-permission.json",
      "share-missing-recipient-type.json",
      "upload-missing-authorization.json",
      "version-rollback-missing-previous.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), ["file-view.json"]);
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
    "delete-missing-reason.json": ["DOC-DELETE-001", "/reason"],
    "download-missing-classification.json": ["DOC-CORE-001", "/resource/classification"],
    "external-share-missing-expiry.json": ["DOC-SHARE-003", "/metadata/share/expiresAt"],
    "external-share-missing-reason.json": ["DOC-SHARE-003", "/reason"],
    "legal-hold-missing-state.json": ["DOC-HOLD-001", "/metadata/legalHold/active"],
    "permission-grant-missing-grantee.json": ["DOC-PERM-001", "/metadata/permission/granteeId"],
    "retention-update-missing-class.json": ["DOC-RETENTION-001", "/metadata/retention/class"],
    "share-create-missing-permission.json": ["DOC-SHARE-002", "/metadata/share/permission"],
    "share-missing-recipient-type.json": ["DOC-SHARE-001", "/metadata/share/recipientType"],
    "upload-missing-authorization.json": ["DOC-CORE-001", "/authorization"],
    "version-rollback-missing-previous.json": ["DOC-VERSION-002", "/metadata/version/previousId"],
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

  test("the not-applicable fixture is not governed by this profile", () => {
    const result = checkProfile(
      readFixture("not-applicable", "file-view.json"),
      "file-view.json",
      profile,
      validator,
    );
    assert.equal(result.status, "not-applicable");
    assert.deepEqual(result.matchedRules, []);
  });
});

describe("the external-share condition", () => {
  test("an internal share is not required to carry an expiry or a reason", () => {
    const internal = readFixture("valid", "share-internal.json");
    delete (internal as { reason?: unknown }).reason;
    const metadata = (internal["metadata"] as { share: Record<string, unknown> }).share;
    delete metadata["expiresAt"];

    const result = checkProfile(internal, "internal", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same event shared externally must carry both", () => {
    const external = readFixture("valid", "share-internal.json");
    delete (external as { reason?: unknown }).reason;
    const metadata = (external["metadata"] as { share: Record<string, unknown> }).share;
    delete metadata["expiresAt"];
    metadata["recipientType"] = "external";

    const result = checkProfile(external, "external", profile, validator);
    assert.equal(result.status, "violations");
    const failures = result.errors.map((error) => error.path).sort();
    assert.deepEqual(failures, ["/metadata/share/expiresAt", "/reason"]);
  });

  test("a conditional rule is reported as matched even when its condition does not hold", () => {
    const result = checkProfile(
      readFixture("valid", "share-internal.json"),
      "internal",
      profile,
      validator,
    );
    assert.ok(result.matchedRules.includes("DOC-SHARE-003"));
  });
});

describe("the profile only adds requirements", () => {
  test("no rule can make a core-invalid event conform", () => {
    // A core-invalid event: `outcome` is required by the schema.
    const broken = readFixture("valid", "file-upload.json");
    delete (broken["event"] as { outcome?: unknown }).outcome;

    const result = checkProfile(broken, "broken", profile, validator);
    assert.equal(result.status, "core-invalid");
  });
});
