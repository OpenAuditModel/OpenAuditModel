/**
 * The archive of published profile versions, and the version-bump obligation
 * it enforces.
 *
 * ADR 0008 records that adding a rule to a profile is a breaking change for
 * producers and that profile versions "are expected to move". Nothing enforced
 * that expectation until this suite: `profiles/<name>/<version>/profile.json`
 * is append-only, so a rules change that leaves `version` alone makes the
 * working document disagree with the snapshot filed under that version.
 *
 * The first describe block proves the mechanism can fail, on scratch trees.
 * Asserting only that the repository is currently clean would leave a checker
 * that always returned an empty array indistinguishable from a working one.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";
import { resolveSchemaPath } from "../src/validate.js";
import { availableProfiles } from "../src/profiles/load-profile.js";
import { validateProfileDefinition } from "../src/profiles/validate-profile-definition.js";
import {
  allArchivedVersions,
  archiveProblems,
  archivedVersions,
  checkProfileArchive,
} from "../tools/archive-profile-versions.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const profilesRoot = path.join(repoRoot, "profiles");

const scratch = mkdtempSync(path.join(tmpdir(), "openauditmodel-archive-"));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

let trees = 0;

/** A minimal profile document. Only the fields the archive reads are meaningful. */
function definition(version: string, rules: readonly unknown[]): Record<string, unknown> {
  return {
    profileVersion: "0.1",
    name: "scratch-profile",
    version,
    status: "experimental",
    coreVersions: ["0.1"],
    title: "Scratch",
    description: "A profile that exists only for this test.",
    rules,
  };
}

/** Writes a profiles root holding one profile plus the snapshots it names. */
function tree(
  current: Record<string, unknown>,
  snapshots: Readonly<Record<string, Record<string, unknown>>>,
): string {
  const root = path.join(scratch, `tree-${(trees += 1)}`);
  const profile = path.join(root, "scratch-profile");
  mkdirSync(profile, { recursive: true });
  writeFileSync(path.join(profile, "profile.json"), `${JSON.stringify(current, null, 2)}\n`);

  for (const [version, document] of Object.entries(snapshots)) {
    mkdirSync(path.join(profile, version), { recursive: true });
    writeFileSync(
      path.join(profile, version, "profile.json"),
      `${JSON.stringify(document, null, 2)}\n`,
    );
  }

  return root;
}

const RULE = { id: "SCRATCH-001", description: "A rule.", events: ["scratch.thing.do"] };
const OTHER_RULE = {
  id: "SCRATCH-002",
  description: "Another rule.",
  events: ["scratch.thing.undo"],
};

describe("the archive check can fail", () => {
  test("a filed snapshot that matches the profile is clean", () => {
    const root = tree(definition("0.1", [RULE]), { "0.1": definition("0.1", [RULE]) });
    assert.deepEqual(archiveProblems(root), []);
  });

  test("editing a profile without bumping the version is reported", () => {
    const root = tree(definition("0.1", [RULE, OTHER_RULE]), { "0.1": definition("0.1", [RULE]) });
    const problems = archiveProblems(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /a filed version never changes/);
  });

  test("bumping the version and filing the new snapshot is clean, and the old one is untouched", () => {
    const root = tree(definition("0.2", [RULE, OTHER_RULE]), {
      "0.1": definition("0.1", [RULE]),
      "0.2": definition("0.2", [RULE, OTHER_RULE]),
    });
    assert.deepEqual(archiveProblems(root), []);

    const superseded = JSON.parse(
      readFileSync(path.join(root, "scratch-profile", "0.1", "profile.json"), "utf8"),
    ) as { rules: unknown[] };
    assert.equal(superseded.rules.length, 1, "filing a new version must not rewrite the old one");
  });

  test("bumping the version without filing a snapshot is reported as missing", () => {
    const root = tree(definition("0.2", [RULE]), { "0.1": definition("0.1", [RULE]) });
    const problems = archiveProblems(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /0\.2\/profile\.json \(missing\)/);
  });

  test("a snapshot filed under a directory it does not declare is reported", () => {
    const root = tree(definition("0.1", [RULE]), { "0.1": definition("0.9", [RULE]) });
    const problems = archiveProblems(root);
    assert.equal(problems.length, 2, "the mismatch is reported, and so is the content difference");
    assert.ok(
      problems.some((problem) => /declares version "0\.9", but is filed under 0\.1/.test(problem)),
      problems.join("; "),
    );
  });

  test("a profile declaring no version is reported rather than skipped", () => {
    const withoutVersion = definition("0.1", [RULE]);
    delete withoutVersion["version"];
    const root = tree(withoutVersion, {});
    assert.deepEqual(archiveProblems(root), ["scratch-profile/profile.json declares no version"]);
  });

  test("a directory that is not a version is not mistaken for a snapshot", () => {
    const root = tree(definition("0.1", [RULE]), { "0.1": definition("0.1", [RULE]) });
    mkdirSync(path.join(root, "scratch-profile", "fixtures"), { recursive: true });
    writeFileSync(path.join(root, "scratch-profile", "fixtures", "profile.json"), "{}\n");
    assert.deepEqual(archiveProblems(root), []);
    assert.deepEqual(
      archivedVersions(root, "scratch-profile").map((entry) => entry.version),
      ["0.1"],
    );
  });
});

describe("the shipped profile archive", () => {
  test("every profile's current version is filed and matches it", () => {
    assert.deepEqual(
      checkProfileArchive(),
      [],
      'the profile archive drifted; run "npm run profiles:archive"',
    );
  });

  test("the archive scan and the profile loader agree on what a profile is", () => {
    const archived = new Set(allArchivedVersions(profilesRoot).map((entry) => entry.profile));
    assert.deepEqual([...archived].sort(), availableProfiles());
  });

  test("every shipped profile has at least one filed version", () => {
    for (const name of availableProfiles()) {
      assert.ok(
        archivedVersions(profilesRoot, name).length > 0,
        `${name} has no filed version; run "npm run profiles:archive"`,
      );
    }
  });

  test("every filed version is itself a valid profile definition", () => {
    for (const archived of allArchivedVersions(profilesRoot)) {
      const document: unknown = JSON.parse(readFileSync(archived.absolutePath, "utf8"));
      assert.deepEqual(
        validateProfileDefinition(document),
        [],
        `${archived.relativePath} is not a valid profile definition`,
      );
    }
  });

  test("a filed version is byte-identical to the document it was filed from, while it is current", () => {
    // Byte equality, not content equality, so that Prettier's formatting of the
    // working document is what gets published rather than this tool's.
    for (const name of availableProfiles()) {
      const source = path.join(profilesRoot, name, "profile.json");
      const version = (JSON.parse(readFileSync(source, "utf8")) as { version: string }).version;
      const filed = path.join(profilesRoot, name, version, "profile.json");
      assert.equal(readFileSync(filed, "utf8"), readFileSync(source, "utf8"), name);
    }
  });
});
