/**
 * The published IAM profile fixtures, and the `check-profile` command.
 *
 * The fixtures carry the cross-cutting guarantee: every event this profile
 * accepts is also core-conforming and privacy-clean. A profile that could
 * accept an event the core rejects, or one carrying a credential, would be
 * worse than no profile.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";
import { fileURLToPath } from "node:url";
import { createValidator, resolveSchemaPath } from "../src/validate.js";
import { loadProfile } from "../src/profiles/load-profile.js";
import { checkProfile } from "../src/profiles/check-profile.js";
import { lintEvent } from "../src/privacy/lint-event.js";
import type { ProfileDefinition } from "../src/profiles/types.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const validator = createValidator(schemaPath);

const PROFILE = "identity-and-access-management";
const FIXTURES = path.join(repoRoot, "examples", "profiles", PROFILE);
const RELATIVE = `examples/profiles/${PROFILE}`;

const loaded = loadProfile(PROFILE);
assert.ok(loaded.ok, "the identity profile must load");
const iam: ProfileDefinition = loaded.ok ? loaded.profile : ({} as ProfileDefinition);

const scratch = mkdtempSync(path.join(tmpdir(), "openauditmodel-profile-"));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

type Event = Record<string, unknown>;

function fixtureNames(kind: "valid" | "invalid" | "not-applicable"): string[] {
  return readdirSync(path.join(FIXTURES, kind))
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function readFixture(kind: string, name: string): Event {
  return JSON.parse(readFileSync(path.join(FIXTURES, kind, name), "utf8")) as Event;
}

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

function auditmodel(...args: string[]): CliResult {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status ?? -1, stdout, stderr, output: `${stdout}${stderr}` };
}

function writeScratch(name: string, contents: string): string {
  const file = path.join(scratch, name);
  writeFileSync(file, contents, "utf8");
  return file;
}

describe("published IAM fixtures", () => {
  test("the documented fixture set is present", () => {
    assert.deepEqual(fixtureNames("valid"), [
      "credential-rotate.json",
      "permission-revoke.json",
      "role-assign-privileged.json",
      "role-assign-standard.json",
      "service-account-create.json",
      "user-create.json",
      "user-disable.json",
    ]);
    assert.deepEqual(fixtureNames("invalid"), [
      "credential-rotate-missing-reason.json",
      "permission-grant-missing-scope.json",
      "privileged-role-without-approval.json",
      "privileged-role-without-mfa.json",
      "role-assign-missing-authorization.json",
      "role-assign-missing-role-id.json",
      "service-account-missing-owner.json",
    ]);
    assert.deepEqual(fixtureNames("not-applicable"), ["document-share.json"]);
  });

  for (const name of fixtureNames("valid")) {
    test(`valid/${name} conforms to the profile`, () => {
      const result = checkProfile(readFixture("valid", name), name, iam, validator);
      assert.equal(result.status, "conforming", JSON.stringify(result.errors));
      assert.equal(result.profileValid, true);
      assert.ok(result.matchedRules.length > 0, "a conforming event must match at least one rule");
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
    "role-assign-missing-role-id.json": ["IAM-ROLE-001", "/metadata/role/id"],
    "role-assign-missing-authorization.json": ["IAM-CORE-001", "/authorization"],
    "privileged-role-without-approval.json": ["IAM-ROLE-002", "/approval"],
    "privileged-role-without-mfa.json": ["IAM-ROLE-002", "/authentication/mfa"],
    "permission-grant-missing-scope.json": ["IAM-PERM-001", "/metadata/permission/scope"],
    "service-account-missing-owner.json": ["IAM-SVC-001", "/metadata/serviceAccount/ownerId"],
    "credential-rotate-missing-reason.json": ["IAM-CRED-001", "/reason"],
  };

  for (const name of fixtureNames("invalid")) {
    const expectation = expectations[name];

    test(`invalid/${name} violates ${expectation?.[0]} at ${expectation?.[1]}`, () => {
      const result = checkProfile(readFixture("invalid", name), name, iam, validator);

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

    test(`invalid/${name} is still core-valid, so only the profile rejects it`, () => {
      assert.deepEqual(validator.validateEvent(readFixture("invalid", name)), []);
    });
  }

  test("the not-applicable fixture is not governed by this profile", () => {
    const result = checkProfile(
      readFixture("not-applicable", "document-share.json"),
      "d",
      iam,
      validator,
    );
    assert.equal(result.status, "not-applicable");
    assert.deepEqual(result.matchedRules, []);
  });
});

describe("credential and secret hygiene in fixtures", () => {
  test("credential rotation fixtures record the kind of credential, never a credential", () => {
    for (const kind of ["valid", "invalid"] as const) {
      for (const name of fixtureNames(kind).filter((entry) => entry.includes("credential"))) {
        const raw = readFileSync(path.join(FIXTURES, kind, name), "utf8");
        const event = JSON.parse(raw) as Event;
        const metadata = event["metadata"] as Record<string, Record<string, unknown>>;

        assert.equal(typeof metadata["credential"]?.["type"], "string");
        for (const forbidden of ["value", "secret", "oldValue", "newValue", "password", "token"]) {
          assert.equal(forbidden in (metadata["credential"] ?? {}), false, `${name}: ${forbidden}`);
        }
        assert.doesNotMatch(raw, /BEGIN [A-Z ]*PRIVATE KEY/);
      }
    }
  });

  test("service account fixtures carry no tokens or keys", () => {
    for (const name of fixtureNames("valid").filter((entry) => entry.includes("service-account"))) {
      const event = readFixture("valid", name);
      const account = (event["metadata"] as Record<string, Record<string, unknown>>)[
        "serviceAccount"
      ];

      assert.equal(typeof account?.["purpose"], "string");
      for (const forbidden of ["secret", "token", "privateKey", "apiKey", "credential"]) {
        assert.equal(forbidden in (account ?? {}), false, forbidden);
      }
      assert.equal(lintEvent(event, name, validator).status, "clean");
    }
  });
});

describe("check-profile exit codes", () => {
  test("a conforming event exits 0", () => {
    const result = auditmodel(
      "check-profile",
      `${RELATIVE}/valid/role-assign-privileged.json`,
      "--profile",
      PROFILE,
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /IAM-ROLE-002/);
  });

  test("a violating event exits 1 and names the rule and pointer", () => {
    const result = auditmodel(
      "check-profile",
      `${RELATIVE}/invalid/privileged-role-without-mfa.json`,
      "--profile",
      PROFILE,
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /IAM-ROLE-002/);
    assert.match(result.stdout, /\/authentication\/mfa/);
  });

  test("a core-invalid event is reported as such and its rules are not evaluated", () => {
    const result = auditmodel(
      "check-profile",
      "examples/invalid/missing-actor.json",
      "--profile",
      PROFILE,
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /core-invalid: profile rules not evaluated/);
    assert.match(result.stdout, /actor/);
  });

  test("a not-applicable event exits 3", () => {
    const result = auditmodel(
      "check-profile",
      `${RELATIVE}/not-applicable/document-share.json`,
      "--profile",
      PROFILE,
    );
    assert.equal(result.status, 3);
    assert.match(result.stdout, /no rule in this profile governs this event/);
  });

  test("a mix of conforming and not-applicable events exits 0", () => {
    const result = auditmodel(
      "check-profile",
      `${RELATIVE}/valid/user-create.json`,
      `${RELATIVE}/not-applicable/document-share.json`,
      "--profile",
      PROFILE,
    );
    assert.equal(result.status, 0);
  });

  test("an unknown profile exits 2 and lists what is available", () => {
    const result = auditmodel(
      "check-profile",
      `${RELATIVE}/valid/user-create.json`,
      "--profile",
      "no-such",
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no profile named/);
    assert.match(result.stderr, new RegExp(PROFILE));
  });

  test("a missing --profile exits 2", () => {
    const result = auditmodel("check-profile", `${RELATIVE}/valid/user-create.json`);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires --profile/);
  });

  test("a profile name that tries to escape the directory exits 2", () => {
    for (const name of ["../schemas", "..", "a/b"]) {
      const result = auditmodel(
        "check-profile",
        `${RELATIVE}/valid/user-create.json`,
        "--profile",
        name,
      );
      assert.equal(result.status, 2, name);
    }
  });

  test("a missing file exits 2", () => {
    const result = auditmodel(
      "check-profile",
      `${RELATIVE}/valid/no-such.json`,
      "--profile",
      PROFILE,
    );
    assert.equal(result.status, 2);
  });

  test("invalid JSON exits 2", () => {
    const file = writeScratch("malformed.json", '{"specVersion": "0.1",');
    const result = auditmodel("check-profile", file, "--profile", PROFILE);
    assert.equal(result.status, 2);
    assert.match(result.output, /cannot parse JSON/);
  });
});

describe("check-profile input forms", () => {
  test("a directory is checked", () => {
    const result = auditmodel("check-profile", `${RELATIVE}/valid`, "--profile", PROFILE);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /7 events checked: 7 conforming/);
  });

  test("a JSON array in one file is checked", () => {
    const events = ["user-create.json", "user-disable.json"].map((name) =>
      readFixture("valid", name),
    );
    const file = writeScratch("array.json", JSON.stringify(events));

    const result = auditmodel("check-profile", file, "--profile", PROFILE);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /2 events checked: 2 conforming/);
  });

  test("JSON Lines input is checked", () => {
    const lines = ["user-create.json", "role-assign-standard.json"]
      .map((name) => JSON.stringify(readFixture("valid", name)))
      .join("\n");
    const file = writeScratch("events.jsonl", `${lines}\n`);

    const result = auditmodel("check-profile", file, "--profile", PROFILE);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /2 events checked: 2 conforming/);
  });

  test("multiple paths are checked together", () => {
    const result = auditmodel(
      "check-profile",
      `${RELATIVE}/valid/user-create.json`,
      `${RELATIVE}/invalid/role-assign-missing-role-id.json`,
      "--profile",
      PROFILE,
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /2 events checked: 1 conforming, 1 with violations/);
  });
});

describe("check-profile output", () => {
  test("JSON output carries the profile, summary and findings", () => {
    const result = auditmodel(
      "check-profile",
      `${RELATIVE}/invalid`,
      "--profile",
      PROFILE,
      "--format",
      "json",
    );
    assert.equal(result.status, 1);

    const report = JSON.parse(result.stdout) as {
      tool: string;
      profile: { name: string; version: string };
      summary: { events: number; violations: number };
      results: Array<{ status: string; errors: Array<Record<string, unknown>> }>;
    };

    assert.equal(report.tool, "auditmodel check-profile");
    assert.equal(report.profile.name, PROFILE);
    assert.equal(report.summary.events, 7);
    assert.equal(report.summary.violations, 7);

    for (const entry of report.results) {
      for (const error of entry.errors) {
        for (const field of ["ruleId", "path", "message", "severity"]) {
          assert.ok(field in error, `missing ${field}`);
        }
      }
    }
  });

  test("output never contains event content", () => {
    for (const format of [[], ["--format", "json"]]) {
      const result = auditmodel(
        "check-profile",
        `${RELATIVE}/valid`,
        "--profile",
        PROFILE,
        ...format,
      );

      // Distinctive values that appear in the fixtures but must never be echoed.
      for (const marker of [
        "Generates scheduled customer activity exports",
        "role-platform-administrator",
        "Approved change window",
        "corporate-idp",
        "onboarding-7741",
      ]) {
        assert.ok(!result.output.includes(marker), `${format.join(" ")} leaked ${marker}`);
      }
    }
  });

  test("quiet mode suppresses conforming events but keeps the summary", () => {
    const result = auditmodel(
      "check-profile",
      `${RELATIVE}/valid`,
      "--profile",
      PROFILE,
      "--quiet",
    );
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /^ok {4}/m);
    assert.match(result.stdout, /7 conforming/);
  });

  test("help documents the command, the profile option and the not-applicable code", () => {
    const result = auditmodel("--help");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /auditmodel check-profile <path\.\.\.>/);
    assert.match(result.stdout, /--profile <name>/);
    // 3 must be documented as its own outcome, and tied to this command.
    assert.match(result.stdout, /3 {2}no verdict was produced/);
    assert.match(result.stdout, /check-profile {2}no checked event is governed by the profile/);
    assert.match(result.stdout, /A profile only ever adds requirements/);
  });
});

describe("cross-command guarantees", () => {
  test("every valid fixture passes validate, lint-privacy and check-profile through the CLI", () => {
    assert.equal(auditmodel("validate", `${RELATIVE}/valid`).status, 0);
    assert.equal(auditmodel("lint-privacy", `${RELATIVE}/valid`).status, 0);
    assert.equal(auditmodel("check-profile", `${RELATIVE}/valid`, "--profile", PROFILE).status, 0);
  });

  test("every invalid profile fixture still passes core validation", () => {
    assert.equal(auditmodel("validate", `${RELATIVE}/invalid`).status, 0);
  });
});
