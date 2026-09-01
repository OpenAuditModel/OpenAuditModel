#!/usr/bin/env node
/**
 * Maintains the published archive of profile versions under
 * `profiles/<name>/<version>/profile.json`.
 *
 * Two problems are solved by one append-only directory.
 *
 * **A published profile URL must keep working.** The site serves every profile
 * document at a versioned address, and `deploy/Caddyfile` tells every cache to
 * hold those addresses for a year as `immutable`. A build that published only
 * the current version would withdraw the previous address the moment a profile
 * was revised — a URL that answered yesterday, was declared permanent, and
 * 404s today. The site therefore publishes from this archive, so a revision
 * *adds* an address instead of replacing one.
 *
 * **A rule change must not pass unnoticed.** ADR 0008 records that adding a
 * rule to a profile is a breaking change for producers and that profile
 * versions "are expected to move" — an expectation nothing enforced. Because
 * the archive is append-only, a rules change that leaves `version` alone makes
 * `profile.json` disagree with the snapshot already filed under that version,
 * and the check below fails. There are exactly two ways to make it pass again:
 * bump the version, which files a new snapshot, or revert the rules. The
 * archive cannot be re-pointed at the new content, which is the whole point.
 *
 * Usage:
 *   node dist/conformance/tools/archive-profile-versions.js          file the current version
 *   node dist/conformance/tools/archive-profile-versions.js --check  compare only
 *
 * `--check` compares parsed content rather than bytes, so formatting stays
 * Prettier's responsibility and content stays the profile author's. The test
 * suite runs the check; nothing writes during a normal test run.
 */
import { deepStrictEqual } from "node:assert";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { profilesDirectory, PROFILE_DEFINITION_FILE } from "../src/profiles/load-profile.js";

/**
 * Version directory names, matching the `version` pattern in
 * profile-definition.schema.json. Anything else under a profile directory is
 * not an archived version and is left alone.
 */
const VERSION_DIRECTORY = /^[0-9]+(\.[0-9]+){0,2}$/;

export interface ArchivedVersion {
  /** Profile directory name. */
  readonly profile: string;
  /** Version this snapshot was filed under, which is also its directory name. */
  readonly version: string;
  /** Path relative to the profiles root, for messages and for publishing. */
  readonly relativePath: string;
  /** Absolute path on disk. */
  readonly absolutePath: string;
}

/**
 * Profile directory names under a profiles root.
 *
 * Deliberately rooted rather than reusing `availableProfiles()`, so that the
 * checker can be pointed at a scratch tree and proved to fail. A test asserts
 * the two agree on the repository's own root, which is what keeps the
 * duplication honest.
 */
function profileNames(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(root, name, PROFILE_DEFINITION_FILE)))
    .sort((left, right) => left.localeCompare(right, "en"));
}

/** Reads a JSON document, or `undefined` when it is absent or unparsable. */
function readJson(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The version a document declares, or `undefined` when it declares none usable. */
function declaredVersion(document: Record<string, unknown> | undefined): string | undefined {
  const version = document?.["version"];
  return typeof version === "string" ? version : undefined;
}

/** Every snapshot filed for one profile, in directory-name order. */
export function archivedVersions(root: string, name: string): ArchivedVersion[] {
  const directory = path.join(root, name);
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && VERSION_DIRECTORY.test(entry.name))
    .map((entry) => entry.name)
    .filter((version) => existsSync(path.join(directory, version, PROFILE_DEFINITION_FILE)))
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((version) => ({
      profile: name,
      version,
      relativePath: path.join(name, version, PROFILE_DEFINITION_FILE),
      absolutePath: path.join(directory, version, PROFILE_DEFINITION_FILE),
    }));
}

/** Every snapshot filed for every profile under a profiles root. */
export function allArchivedVersions(root: string = profilesDirectory()): ArchivedVersion[] {
  return profileNames(root).flatMap((name) => archivedVersions(root, name));
}

/**
 * Compares each profile under `root` with its archive. Returns one line per
 * problem, so an empty array is the passing result.
 *
 * Three things are checked, and the second is the one that catches a forgotten
 * bump:
 *
 * 1. The current version has a snapshot at all.
 * 2. That snapshot is content-identical to the working document.
 * 3. Every snapshot declares the version it is filed under, so a directory name
 *    can never disagree with the document inside it.
 */
export function archiveProblems(root: string): string[] {
  const problems: string[] = [];

  for (const name of profileNames(root)) {
    const source = path.join(root, name, PROFILE_DEFINITION_FILE);
    const profile = readJson(source);

    if (profile === undefined) {
      problems.push(`${name}/${PROFILE_DEFINITION_FILE} could not be read as JSON`);
      continue;
    }

    const version = declaredVersion(profile);
    if (version === undefined) {
      problems.push(`${name}/${PROFILE_DEFINITION_FILE} declares no version`);
      continue;
    }

    const snapshotPath = path.join(name, version, PROFILE_DEFINITION_FILE);
    const snapshot = readJson(path.join(root, snapshotPath));

    if (snapshot === undefined) {
      problems.push(`${snapshotPath} (missing)`);
    } else {
      try {
        deepStrictEqual(snapshot, profile);
      } catch {
        // Deliberately does not say what changed: the diff is one `git diff`
        // away, and naming "the rules" would be a claim this check has not
        // established — a description or a rationale edit lands here too.
        problems.push(
          `${snapshotPath} differs from ${name}/${PROFILE_DEFINITION_FILE} — ` +
            'a filed version never changes, so bump "version" or revert the edit',
        );
      }
    }

    for (const archived of archivedVersions(root, name)) {
      const filed = declaredVersion(readJson(archived.absolutePath));
      if (filed !== archived.version) {
        problems.push(
          `${archived.relativePath} declares version ${JSON.stringify(filed)}, ` +
            `but is filed under ${archived.version}`,
        );
      }
    }
  }

  return problems;
}

/** The repository's own archive check, as the CLI and the test suite run it. */
export function checkProfileArchive(): string[] {
  return archiveProblems(profilesDirectory());
}

/**
 * Files the current version of every profile that has no snapshot yet.
 *
 * An existing snapshot is never rewritten. If the working document has moved
 * away from it under the same version, the fix is a version bump or a revert,
 * and this tool says so rather than papering over the difference.
 */
function writeArchive(): number {
  const root = profilesDirectory();
  let written = 0;
  let blocked = 0;

  for (const name of profileNames(root)) {
    const source = path.join(root, name, PROFILE_DEFINITION_FILE);
    const profile = readJson(source);
    const version = declaredVersion(profile);

    if (version === undefined) {
      process.stderr.write(`${name}/${PROFILE_DEFINITION_FILE} declares no usable version\n`);
      blocked += 1;
      continue;
    }

    const relative = path.join(name, version, PROFILE_DEFINITION_FILE);
    const snapshotPath = path.join(root, relative);
    const snapshot = readJson(snapshotPath);

    if (snapshot !== undefined) {
      try {
        deepStrictEqual(snapshot, profile);
      } catch {
        process.stderr.write(
          `${relative} is already filed and differs from ${name}/${PROFILE_DEFINITION_FILE}.\n` +
            `  A filed version is immutable: bump "version" in ${name}/${PROFILE_DEFINITION_FILE}\n` +
            "  and run this again, or revert the rule change.\n",
        );
        blocked += 1;
      }
      continue;
    }

    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, readFileSync(source));
    process.stdout.write(`filed ${relative}\n`);
    written += 1;
  }

  if (blocked > 0) {
    return 1;
  }

  process.stdout.write(
    written === 0
      ? "every profile version is already filed\n"
      : `\n${written} profile ${written === 1 ? "version" : "versions"} filed.\n`,
  );
  return 0;
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { check: { type: "boolean", default: false } },
  });

  if (values.check === true) {
    const problems = checkProfileArchive();
    if (problems.length === 0) {
      const count = allArchivedVersions().length;
      const noun = count === 1 ? "version" : "versions";
      process.stdout.write(
        `${count} archived profile ${noun} match the profiles they were filed from\n`,
      );
      return 0;
    }
    process.stderr.write("the profile archive is out of step:\n");
    for (const problem of problems) {
      process.stderr.write(`  ${problem}\n`);
    }
    process.stderr.write('\nRun "npm run profiles:archive" to file a new version.\n');
    return 1;
  }

  return writeArchive();
}

if (process.argv[1] !== undefined && process.argv[1].includes("archive-profile-versions")) {
  process.exitCode = main();
}
