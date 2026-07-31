/**
 * The published backup-and-recovery profile fixtures.
 *
 * The fixtures carry the same cross-cutting guarantee the other published
 * profiles carry: every event this profile accepts is also core-conforming and
 * privacy-clean.
 *
 * Three properties are specific to this profile and are asserted here because
 * they are design decisions rather than incidental behaviour:
 *
 *   - Data-plane events are deliberately ungoverned. No selector uses a bare
 *     `backup.`, `snapshot.`, `restore.`, `recovery.` or `storage.` prefix, so
 *     `backup.chunk.write`, `restore.progress` and `storage.replica.heartbeat`
 *     match nothing. A test holds that, because widening a prefix later would
 *     silently start governing every chunk write in a backup run.
 *   - The recovery-point requirement is conditional on a successful outcome. A
 *     failed backup run produces no recovery point, and a rule that demanded one
 *     would push producers to fabricate a value for the failure case.
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

const PROFILE = "backup-and-recovery";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the backup-and-recovery profile must load");
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

function backupMetadata(event: Event): Record<string, unknown> {
  return (event["metadata"] as { backup: Record<string, unknown> }).backup;
}

describe("backup-and-recovery profile definition", () => {
  test("the profile is experimental and applies to core 0.1", () => {
    assert.equal(profile.name, PROFILE);
    assert.equal(profile.status, "experimental");
    assert.deepEqual(profile.coreVersions, ["0.1"]);
  });

  test("every rule identifier is unique and namespaced to this profile", () => {
    const ids = profile.rules.map((rule) => rule.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const id of ids) {
      assert.match(id, /^BACKUP-/, `${id} should be namespaced to the backup profile`);
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

  test("every requirement under /metadata stays in this profile's namespace", () => {
    for (const rule of profile.rules) {
      for (const requirement of rule.requiredMetadata ?? []) {
        assert.match(
          requirement.path,
          /^\/backup\//,
          `${rule.id} requires ${requirement.path} outside /metadata/backup`,
        );
      }
    }
  });
});

describe("data-plane events are deliberately ungoverned", () => {
  test("no selector uses a bare domain prefix", () => {
    for (const rule of profile.rules) {
      for (const prefix of rule.eventPrefixes ?? []) {
        for (const bare of ["backup.", "snapshot.", "restore.", "recovery.", "storage."]) {
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
    "backup.chunk.write",
    "backup.progress",
    "restore.progress",
    "storage.replica.heartbeat",
    "storage.block.write",
  ]) {
    test(`${name} matches no rule`, () => {
      assert.deepEqual(selectRules(profile, name), []);
    });
  }

  test("governed lifecycle events are still selected", () => {
    for (const name of [
      "backup.create",
      "backup.complete",
      "backup.verify",
      "backup.delete",
      "backup.expire",
      "backup.policy.update",
      "snapshot.create",
      "snapshot.delete",
      "restore.start",
      "restore.complete",
      "recovery.start",
      "recovery.complete",
      "recovery.failover",
      "recovery.failback",
    ]) {
      assert.ok(selectRules(profile, name).length > 0, `${name} should be governed`);
    }
  });
});

describe("published backup-and-recovery fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "backup-complete-failed.json",
      "backup-complete.json",
      "backup-create.json",
      "backup-delete.json",
      "backup-expire.json",
      "backup-verify.json",
      "policy-update.json",
      "recovery-complete.json",
      "recovery-failback.json",
      "recovery-failover.json",
      "recovery-start.json",
      "restore-complete.json",
      "restore-start.json",
      "snapshot-create.json",
      "snapshot-delete.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "backup-complete-missing-backup-id.json",
      "backup-complete-missing-recovery-point.json",
      "backup-create-missing-authorization.json",
      "backup-delete-missing-reason.json",
      "backup-expire-missing-retention-class.json",
      "backup-verify-missing-verification-status.json",
      "policy-update-missing-change.json",
      "recovery-failover-missing-recovery-id.json",
      "recovery-failover-missing-target-scope.json",
      "restore-start-missing-approval.json",
      "restore-start-missing-source-id.json",
      "snapshot-create-missing-snapshot-id.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), [
      "backup-chunk-write.json",
      "restore-progress.json",
      "storage-replica-heartbeat.json",
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
    "backup-complete-missing-backup-id.json": ["BACKUP-SET-001", "/metadata/backup/backupId"],
    "backup-complete-missing-recovery-point.json": [
      "BACKUP-SET-002",
      "/metadata/backup/recoveryPoint",
    ],
    "backup-create-missing-authorization.json": ["BACKUP-CORE-001", "/authorization"],
    "backup-delete-missing-reason.json": ["BACKUP-DELETE-001", "/reason"],
    "backup-expire-missing-retention-class.json": [
      "BACKUP-EXPIRE-001",
      "/metadata/backup/retentionClass",
    ],
    "backup-verify-missing-verification-status.json": [
      "BACKUP-VERIFY-001",
      "/metadata/backup/verificationStatus",
    ],
    "policy-update-missing-change.json": ["BACKUP-POLICY-001", "/change"],
    "recovery-failover-missing-recovery-id.json": [
      "BACKUP-RECOVERY-001",
      "/metadata/backup/recoveryId",
    ],
    "recovery-failover-missing-target-scope.json": [
      "BACKUP-FAILOVER-001",
      "/metadata/backup/targetScope",
    ],
    "restore-start-missing-approval.json": ["BACKUP-APPROVAL-001", "/approval"],
    "restore-start-missing-source-id.json": ["BACKUP-RESTORE-001", "/metadata/backup/sourceId"],
    "snapshot-create-missing-snapshot-id.json": [
      "BACKUP-SNAPSHOT-001",
      "/metadata/backup/snapshotId",
    ],
  };

  test("every event name a rule selects has a valid fixture", () => {
    const governed = new Set(profile.rules.flatMap((rule) => rule.events ?? []));
    const illustrated = new Set(
      fixtureNames("valid").map(
        (name) => (readFixture("valid", name)["event"] as { name: string }).name,
      ),
    );
    for (const name of governed) {
      assert.ok(illustrated.has(name), `${name} is governed but no valid fixture shows it`);
    }
  });

  test("every enforceable rule has a negative fixture", () => {
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

describe("the recovery-point condition", () => {
  test("a failed backup run is not required to carry a recovery point", () => {
    const failed = readFixture("valid", "backup-complete-failed.json");
    assert.equal((failed["event"] as { outcome: string }).outcome, "failure");
    assert.equal(backupMetadata(failed)["recoveryPoint"], undefined);

    const result = checkProfile(failed, "failed", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same run recorded as successful must carry one", () => {
    const succeeded = readFixture("valid", "backup-complete-failed.json");
    const descriptor = succeeded["event"] as { outcome: string; error?: unknown };
    descriptor.outcome = "success";
    delete descriptor.error;

    const result = checkProfile(succeeded, "succeeded", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((error) => `${error.ruleId} ${error.path}`),
      ["BACKUP-SET-002 /metadata/backup/recoveryPoint"],
    );
  });

  test("a conditional rule is reported as matched even when its condition does not hold", () => {
    const result = checkProfile(
      readFixture("valid", "backup-complete-failed.json"),
      "failed",
      profile,
      validator,
    );
    assert.ok(result.matchedRules.includes("BACKUP-SET-002"));
  });
});

describe("the locally declared approval condition", () => {
  test("a deletion that declares no approval requirement is not required to carry one", () => {
    const deletion = readFixture("valid", "backup-delete.json");
    delete (deletion as { approval?: unknown }).approval;
    delete backupMetadata(deletion)["approvalRequired"];

    const result = checkProfile(deletion, "undeclared", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
  });

  test("the same deletion declaring approval required must carry the approval record", () => {
    const deletion = readFixture("valid", "backup-delete.json");
    delete (deletion as { approval?: unknown }).approval;
    backupMetadata(deletion)["approvalRequired"] = true;

    const result = checkProfile(deletion, "declared", profile, validator);
    assert.equal(result.status, "violations");
    assert.deepEqual(
      result.errors.map((error) => `${error.ruleId} ${error.path}`),
      ["BACKUP-APPROVAL-001 /approval"],
    );
  });

  test("a deletion declaring approvalRequired: false is not asked for one either", () => {
    const deletion = readFixture("valid", "snapshot-delete.json");
    assert.equal(backupMetadata(deletion)["approvalRequired"], false);
    assert.equal((deletion as { approval?: unknown }).approval, undefined);

    const result = checkProfile(deletion, "declined", profile, validator);
    assert.equal(result.status, "conforming", JSON.stringify(result.errors));
    assert.ok(
      result.matchedRules.includes("BACKUP-APPROVAL-001"),
      "the rule still matches; only its condition fails to hold",
    );
  });

  test("routine scheduled backup creation is never asked for an approval", () => {
    const selected = profile.rules
      .filter((rule) => rule.id === "BACKUP-APPROVAL-001")
      .flatMap((rule) => [...(rule.events ?? []), ...(rule.eventPrefixes ?? [])]);

    assert.ok(selected.length > 0, "BACKUP-APPROVAL-001 is missing");
    for (const name of ["backup.create", "backup.complete", "snapshot.create"]) {
      assert.ok(!selected.includes(name), `${name} must never require an approval`);
    }
  });
});

describe("the integrity batch identifier is never used as a backup identifier", () => {
  test("no rule requires anything under /integrity", () => {
    for (const rule of profile.rules) {
      for (const pointer of [
        ...(rule.requiredPaths ?? []),
        ...(rule.recommendedPaths ?? []),
        ...(rule.requiredValues ?? []).map((requirement) => requirement.path),
      ]) {
        assert.ok(
          !pointer.startsWith("/integrity"),
          `${rule.id} reaches into /integrity, which identifies a sealing batch and never a backup job`,
        );
      }
    }
  });

  test("no fixture carries an integrity batch identifier", () => {
    for (const kind of ["valid", "invalid", "not-applicable"] as const) {
      for (const name of fixtureNames(kind)) {
        const integrity = readFixture(kind, name)["integrity"] as
          Record<string, unknown> | undefined;
        assert.equal(
          integrity?.["batchId"],
          undefined,
          `${kind}/${name} uses /integrity/batchId, which is a sealing batch and not a backup set`,
        );
      }
    }
  });
});

describe("the profile only adds requirements", () => {
  test("no rule can make a core-invalid event conform", () => {
    // A core-invalid event: `outcome` is required by the schema.
    const broken = readFixture("valid", "backup-create.json");
    delete (broken["event"] as { outcome?: unknown }).outcome;

    const result = checkProfile(broken, "broken", profile, validator);
    assert.equal(result.status, "core-invalid");
  });
});
