#!/usr/bin/env node
/**
 * Proves the published CLI works for someone who does not have this repository.
 *
 * Packs the package, installs the tarball into a throwaway directory outside the
 * working tree, and drives the installed binary. Everything it asserts is a
 * property a consumer depends on and no in-repo test can observe: that the
 * canonical schema and the profile definitions are actually inside the tarball,
 * that the binary is on PATH under its documented name, and that the exit-code
 * contract holds through a real install.
 *
 * The failure this exists to catch is a path that resolves in the checkout and
 * nowhere else. `files` omitted `profiles/` for the whole of v0.1's development
 * and every test still passed, because the tests read the repository.
 *
 *   node scripts/package-smoke-test.mjs
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = "auditmodel";
const PROFILE = "document-management";

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
}

const consumer = mkdtempSync(path.join(tmpdir(), "openauditmodel-consumer-"));
let tarball;

function run(command, cwd, expectFailure = false) {
  try {
    return {
      status: 0,
      output: execSync(command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    };
  } catch (error) {
    if (!expectFailure) throw error;
    return { status: error.status ?? -1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/** Runs the installed binary and returns its exit code and output. */
function cli(args) {
  return run(`npx --no-install ${BIN} ${args}`, consumer, true);
}

try {
  console.log("packing");
  const packed = execSync("npm pack --json", {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = JSON.parse(packed)[0];
  tarball = path.join(root, entry.filename);
  check(
    existsSync(tarball),
    `tarball produced (${(entry.size / 1024).toFixed(0)} KiB, ${entry.entryCount} files)`,
  );

  console.log("installing into a clean directory");
  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", private: true }),
    "utf8",
  );
  execSync(`npm install "${tarball}"`, {
    cwd: consumer,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const installed = path.join(consumer, "node_modules", entry.name.replace("/", path.sep));
  check(existsSync(installed), "package installed");

  // The two directories the CLI reads at runtime must be inside the package.
  check(
    existsSync(path.join(installed, "schemas", "v0.1", "audit-event.schema.json")),
    "canonical schema shipped inside the package",
  );
  const profiles = existsSync(path.join(installed, "profiles"))
    ? readdirSync(path.join(installed, "profiles"), { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() && existsSync(path.join(installed, "profiles", e.name, "profile.json")),
        )
        .map((e) => e.name)
    : [];
  check(
    profiles.length > 0,
    `profile definitions shipped (${profiles.length})`,
    "profiles/ missing from the tarball",
  );
  check(profiles.includes(PROFILE), `${PROFILE} is available to a consumer`);

  // Nothing that must never ship.
  for (const forbidden of [
    "examples",
    path.join("dist", "mcp"),
    path.join("dist", "conformance", "tests"),
  ]) {
    check(!existsSync(path.join(installed, forbidden)), `${forbidden} is not shipped`);
  }

  console.log("driving the installed binary");
  check(cli("--help").output.includes("check-profile"), `${BIN} --help works`);

  const event = {
    specVersion: "0.1",
    id: "018f1b90-0001-7a2b-9c3d-4e5f60718293",
    time: "2026-03-14T10:00:00.000Z",
    event: { name: "document.file.upload", category: "data-modification", outcome: "success" },
    actor: { type: "user", id: "user-1" },
    resource: { type: "document", id: "document-1", classification: "internal" },
    application: { name: "document-service", environment: "production" },
    authorization: { decision: "allow" },
  };
  const write = (name, body) => {
    writeFileSync(path.join(consumer, name), `${JSON.stringify(body, null, 2)}\n`, "utf8");
    return name;
  };

  write("event.json", event);
  write("violating.json", { ...event, resource: { ...event.resource, classification: undefined } });
  write("notapplicable.json", { ...event, event: { ...event.event, name: "document.file.view" } });
  write("finding.json", { ...event, metadata: { note: "AKIAIOSFODNN7EXAMPLE" } });
  write("bogus.json", { foo: { bar: "sk_live_4eC39HqLyjWDarjtT1zdp7dc" } });

  check(cli("validate event.json").status === 0, "validate: conforming event exits 0");
  check(cli("validate bogus.json").status === 1, "validate: invalid event exits 1");
  check(cli("validate no-such-file.json").status === 2, "validate: missing file exits 2");

  check(cli("lint-privacy event.json").status === 0, "lint-privacy: clean exits 0");
  check(cli("lint-privacy finding.json").status === 1, "lint-privacy: findings exit 1");
  const unscanned = cli("lint-privacy bogus.json");
  check(
    unscanned.status === 3,
    "lint-privacy: unevaluable input exits 3, never 0",
    `got ${unscanned.status}`,
  );
  check(
    /NOT scanned/.test(unscanned.output),
    "lint-privacy: says plainly that nothing was scanned",
  );
  check(!/sk_live_/.test(unscanned.output), "lint-privacy: never echoes the value it did not scan");

  check(
    cli(`check-profile event.json --profile ${PROFILE}`).status === 0,
    "check-profile: conforming exits 0",
  );
  check(
    cli(`check-profile violating.json --profile ${PROFILE}`).status === 1,
    "check-profile: violations exit 1",
  );
  const na = cli(`check-profile notapplicable.json --profile ${PROFILE}`);
  check(na.status === 3, "check-profile: not-applicable exits 3, never 0", `got ${na.status}`);
  check(
    cli("check-profile event.json --profile no-such").status === 2,
    "check-profile: unknown profile exits 2",
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
  if (tarball && existsSync(tarball)) rmSync(tarball, { force: true });
}

console.log(
  failures === 0 ? "\npackage smoke test passed" : `\n${failures} package smoke failures`,
);
process.exit(failures ? 1 : 0);
