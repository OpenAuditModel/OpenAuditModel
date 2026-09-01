/**
 * The profile lint, and the first assertions that run over all ten profiles.
 *
 * Every existing profile test is scoped to one profile and hand-written, which
 * leaves two gaps this suite closes: `identity-and-access-management` has no
 * profile-definition test block at all, and a new profile inherits none of the
 * nine hand-written sets until someone remembers to copy them.
 *
 * The first block proves each error-severity check can fail, on synthetic
 * profiles. Asserting only that the shipped corpus is clean would leave a lint
 * that always returned an empty array indistinguishable from a working one —
 * and this corpus *is* clean of every error, so that failure would be invisible.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { availableProfiles, loadProfile } from "../src/profiles/load-profile.js";
import { validateProfileDefinition } from "../src/profiles/validate-profile-definition.js";
import type { ProfileDefinition, ProfileRule } from "../src/profiles/types.js";
import { lintAllProfiles, lintProfile } from "../tools/lint-profiles.js";

/** A profile carrying exactly the rules a test needs. */
function profileOf(...rules: readonly Partial<ProfileRule>[]): ProfileDefinition {
  return {
    profileVersion: "0.1",
    name: "lint-fixture",
    version: "0.1",
    status: "experimental",
    coreVersions: ["0.1"],
    title: "Lint fixture",
    description: "A profile that exists only for the lint tests.",
    rules: rules.map((rule, index) => {
      const base: Record<string, unknown> = {
        id: `LINT-${String(index + 1).padStart(3, "0")}`,
        description: "A rule.",
        ...rule,
      };
      // A rule needs a selector; the default is an exact name, unless the case
      // under test supplied prefixes instead.
      if (base["events"] === undefined && base["eventPrefixes"] === undefined) {
        base["events"] = ["thing.widget.create"];
      }
      return base as unknown as ProfileRule;
    }),
  } as ProfileDefinition;
}

function checks(profile: ProfileDefinition): string[] {
  return lintProfile(profile).map((finding) => finding.check);
}

describe("the lint can fail", () => {
  test("a duplicated rule id is an error, because the later rule is never evaluated", () => {
    const profile = profileOf(
      { id: "LINT-DUP", requiredPaths: ["/authorization"] },
      { id: "LINT-DUP", requiredPaths: ["/reason"] },
    );
    const findings = lintProfile(profile);
    assert.deepEqual(
      findings.map((finding) => finding.check),
      ["PROFILE-LINT-001"],
    );
    assert.equal(findings[0]?.severity, "error");
    assert.match(findings[0]?.message ?? "", /never evaluated/);
  });

  test("a rule that requires nothing is an error, because it makes not-applicable read as conforming", () => {
    const findings = lintProfile(profileOf({}));
    assert.deepEqual(
      findings.map((finding) => finding.check),
      ["PROFILE-LINT-002"],
    );
    assert.equal(findings[0]?.severity, "error");
  });

  test("a pointer with an empty reference token is an error", () => {
    assert.deepEqual(checks(profileOf({ requiredPaths: ["/metadata/"] })), ["PROFILE-LINT-003"]);
    assert.deepEqual(checks(profileOf({ recommendedPaths: ["//reason"] })), ["PROFILE-LINT-003"]);
  });

  test("a metadata path that repeats /metadata is an error, because it addresses /metadata/metadata", () => {
    const findings = lintProfile(
      profileOf({ requiredMetadata: [{ path: "/metadata/role/id", type: "string" }] }),
    );
    assert.deepEqual(
      findings.map((finding) => finding.check),
      ["PROFILE-LINT-003"],
    );
    assert.match(findings[0]?.message ?? "", /\/metadata\/metadata\/role\/id/);
  });

  test("two required values on one pointer are an error when they disagree", () => {
    assert.deepEqual(
      checks(
        profileOf({
          requiredValues: [
            { path: "/authorization/decision", equals: "allow" },
            { path: "/authorization/decision", equals: "deny" },
          ],
        }),
      ),
      ["PROFILE-LINT-004"],
    );
  });

  test("requiring a pointer to be present and also empty is an error", () => {
    assert.deepEqual(
      checks(
        profileOf({
          requiredPaths: ["/reason/code"],
          requiredValues: [{ path: "/reason/code", equals: null }],
        }),
      ),
      ["PROFILE-LINT-004"],
    );
  });

  test("a metadata type contradicting a required value is an error", () => {
    assert.deepEqual(
      checks(
        profileOf({
          requiredMetadata: [{ path: "/role/privileged", type: "boolean" }],
          requiredValues: [{ path: "/metadata/role/privileged", equals: "yes" }],
        }),
      ),
      ["PROFILE-LINT-004"],
    );
  });

  test("a matching metadata type and required value is not an error", () => {
    assert.deepEqual(
      checks(
        profileOf({
          requiredMetadata: [{ path: "/role/privileged", type: "boolean" }],
          requiredValues: [{ path: "/metadata/role/privileged", equals: true }],
        }),
      ),
      [],
    );
  });

  test("an unguarded condition is a warning, and a guaranteed one is not", () => {
    const unguarded = profileOf({
      when: { path: "/metadata/thing/approvalRequired", equals: true },
      requiredPaths: ["/approval/status"],
    });
    assert.deepEqual(checks(unguarded), ["PROFILE-LINT-005"]);
    assert.equal(lintProfile(unguarded)[0]?.severity, "warning");

    const guarded = profileOf(
      { requiredMetadata: [{ path: "/thing/approvalRequired", type: "boolean" }] },
      {
        when: { path: "/metadata/thing/approvalRequired", equals: true },
        requiredPaths: ["/approval/status"],
      },
    );
    assert.deepEqual(checks(guarded), []);
  });

  test("a condition on a core-mandatory path is never an unguarded gate", () => {
    // The core schema guarantees these are present, so the condition always has
    // a value to read. Flagging them would produce eight findings on a corpus
    // whose authors were right.
    for (const path of ["/event/outcome", "/actor/type"]) {
      assert.deepEqual(
        checks(profileOf({ when: { path, equals: "x" }, requiredPaths: ["/reason"] })),
        [],
        path,
      );
    }
  });

  test("a prefix that selects nothing in the profile's own world is a warning", () => {
    assert.deepEqual(
      checks(
        profileOf({
          eventPrefixes: ["nothing.here."],
          requiredPaths: ["/authorization"],
        }),
      ),
      ["PROFILE-LINT-006"],
    );
    // A prefix an exact selector on another rule falls under is reachable.
    assert.deepEqual(
      checks(
        profileOf(
          { events: ["thing.widget.create"], requiredPaths: ["/authorization"] },
          { eventPrefixes: ["thing.widget."], requiredPaths: ["/reason"] },
        ),
      ),
      [],
    );
  });

  test("a selector another selector on the same rule already covers is a warning", () => {
    assert.deepEqual(
      checks(
        profileOf({
          events: ["thing.widget.create"],
          eventPrefixes: ["thing.widget."],
          requiredPaths: ["/authorization"],
        }),
      ),
      ["PROFILE-LINT-007"],
    );
    // A second rule supplies a reachable name, so this isolates the overlap
    // from the unreachable-prefix check.
    assert.deepEqual(
      checks(
        profileOf(
          { events: ["thing.widget.create"], requiredPaths: ["/authorization"] },
          { eventPrefixes: ["thing.", "thing.widget."], requiredPaths: ["/reason"] },
        ),
      ),
      ["PROFILE-LINT-007"],
    );
  });

  test("a well-formed rule produces no finding at all", () => {
    assert.deepEqual(
      checks(
        profileOf({
          requiredPaths: ["/authorization"],
          requiredMetadata: [{ path: "/thing/status", type: "string" }],
          recommendedPaths: ["/reason"],
        }),
      ),
      [],
    );
  });
});

describe("every shipped profile", () => {
  const findings = lintAllProfiles();

  test("has no error-severity lint finding", () => {
    const errors = findings.filter((finding) => finding.severity === "error");
    assert.deepEqual(
      errors.map((finding) => `${finding.profile} ${finding.ruleId} ${finding.check}`),
      [],
    );
  });

  test("carries the warnings the corpus is known to have, and no others", () => {
    // Pinned rather than merely counted, so that fixing one of these is a
    // visible change to this table and not a silently shrinking number.
    const warnings = findings
      .filter((finding) => finding.severity === "warning")
      .map((finding) => `${finding.check} ${finding.profile} ${finding.ruleId}`)
      .sort((left, right) => left.localeCompare(right, "en"));

    assert.deepEqual(warnings, [
      "PROFILE-LINT-005 api-and-integration-management INTEGRATION-CORE-003",
      "PROFILE-LINT-005 backup-and-recovery BACKUP-APPROVAL-001",
      "PROFILE-LINT-005 customer-and-account-management CUSTOMER-APPROVAL-001",
      "PROFILE-LINT-005 customer-and-account-management CUSTOMER-OVERRIDE-001",
      "PROFILE-LINT-005 customer-and-account-management CUSTOMER-SUBJECT-001",
      "PROFILE-LINT-005 deployment-and-change-management DEPLOY-EMERGENCY-001",
      "PROFILE-LINT-005 financial-transaction-management FIN-APPROVAL-001",
      "PROFILE-LINT-005 financial-transaction-management FIN-MANUAL-001",
      "PROFILE-LINT-005 incident-management INC-CLOSE-001",
      "PROFILE-LINT-005 message-broker-management BROKER-RISK-003",
      "PROFILE-LINT-005 secrets-and-key-management SECRET-ACCESS-002",
      "PROFILE-LINT-005 secrets-and-key-management SECRET-APPROVAL-001",
      "PROFILE-LINT-006 secrets-and-key-management SECRET-APPROVAL-001",
      "PROFILE-LINT-006 secrets-and-key-management SECRET-CORE-001",
      "PROFILE-LINT-006 secrets-and-key-management SECRET-CORE-002",
      "PROFILE-LINT-006 secrets-and-key-management SECRET-CORE-003",
      "PROFILE-LINT-006 secrets-and-key-management SECRET-POLICY-001",
    ]);
  });

  test("loads, and is a valid profile definition", () => {
    for (const name of availableProfiles()) {
      const loaded = loadProfile(name);
      assert.ok(loaded.ok, `${name} did not load: ${loaded.ok ? "" : loaded.error}`);
      assert.deepEqual(validateProfileDefinition(loaded.profile), [], name);
    }
  });

  test("declares core version 0.1 and a unique, rationale-carrying rule set", () => {
    // Nine of the ten profile test files assert this by hand; identity-and-
    // access-management has no definition block at all, and a new profile would
    // inherit none of them. Asserted here for every profile, including the two
    // the hand-written suites miss.
    for (const name of availableProfiles()) {
      const loaded = loadProfile(name);
      assert.ok(loaded.ok);
      const profile = loaded.profile;

      assert.deepEqual(profile.coreVersions, ["0.1"], name);
      assert.equal(profile.name, name);

      const ids = profile.rules.map((rule) => rule.id);
      assert.deepEqual([...new Set(ids)], ids, `${name} declares a rule id twice`);

      for (const rule of profile.rules) {
        assert.ok((rule.rationale ?? "").length > 0, `${name} ${rule.id} carries no rationale`);
        assert.ok(
          (rule.events?.length ?? 0) + (rule.eventPrefixes?.length ?? 0) > 0,
          `${name} ${rule.id} has no event selector`,
        );
      }
    }
  });
});
