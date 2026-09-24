#!/usr/bin/env node
/**
 * Pre-pack guard for the published CLI package.
 *
 * The CLI resolves the canonical schema and the profile definitions from disk by
 * walking up from its own module location. That works in the repository by
 * accident of layout, and in an installed package only if those directories were
 * actually shipped. A missing `profiles/` entry in `files` does not break any
 * test in this repository — it breaks `check-profile` for every consumer, and
 * only after publish. This script is the check that turns that into a build
 * failure instead.
 *
 * It also refuses to pack anything that must never reach a consumer: tests, the
 * fixture generators and the MCP server.
 *
 * The example corpus does ship, and ships whole. `conformance-kit/manifest.json`
 * names fixture paths rather than embedding fixture content, so a tarball
 * carrying the manifest and only part of the corpus would describe files that
 * are not there — which is worse than shipping neither.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const problems = [];

/** Paths the CLI reads at runtime. Absent from the tarball means broken on install. */
const REQUIRED = [
  "dist/conformance/src/cli.js",
  "schemas/v1.0/audit-event.schema.json",
  "schemas/v0.1/audit-event.schema.json",
  "schemas/checkpoint/v0.1/checkpoint.schema.json",
  "schemas/proof/v0.1/proof.schema.json",
  "profiles/profile-definition.schema.json",
  "conformance-kit/manifest.json",
];

/** Nothing matching these may be packed. */
const FORBIDDEN = [/(^|\/)tests?\//, /(^|\/)dist\/mcp\//, /(^|\/)conformance\/tools\//];

/**
 * Every file under `directory`, as tarball-relative paths. Dot-files are left
 * out because npm never packs them, so a stray `.DS_Store` would otherwise
 * fail the build for a file that is not supposed to be there in the first place.
 */
function filesUnder(directory) {
  const entries = readdirSync(path.join(root, directory), { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .flatMap((entry) => {
      const relative = `${directory}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(relative) : [relative];
    });
}

for (const relative of REQUIRED) {
  if (!existsSync(path.join(root, relative))) {
    problems.push(`missing on disk: ${relative} — run npm run build first`);
  }
}

// Ask npm what it would actually pack, rather than guessing from `files`.
let packed = [];
try {
  // --ignore-scripts is required: this script runs from `prepack`, and without
  // it the dry run would trigger `prepack` again and recurse forever. The command
  // is a fixed literal with no interpolation, so running it through a shell —
  // which is what reaching npm portably requires — introduces nothing to escape.
  const raw = execSync("npm pack --dry-run --json --ignore-scripts", {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  packed = (JSON.parse(raw)[0]?.files ?? []).map((entry) => entry.path.replace(/\\/g, "/"));
} catch (error) {
  problems.push(`could not determine tarball contents: ${(error && error.message) || error}`);
}

if (packed.length > 0) {
  for (const relative of REQUIRED) {
    if (!packed.includes(relative)) {
      problems.push(`REQUIRED but not packed: ${relative} — the installed CLI would fail on it`);
    }
  }

  // Every profile the CLI advertises must ship, or check-profile lies about what is available.
  const advertised = packed.filter((f) => /^profiles\/[^/]+\/profile\.json$/.test(f));
  if (advertised.length === 0) {
    problems.push("no profile definition is packed — check-profile would have nothing to load");
  }

  // The corpus ships whole or not at all: the kit manifest names these paths.
  const missingFixtures = filesUnder("examples").filter((file) => !packed.includes(file));
  if (missingFixtures.length > 0) {
    problems.push(
      `${missingFixtures.length} of the example corpus is not packed, starting with ` +
        `${missingFixtures[0]} — conformance-kit/manifest.json names files the tarball does not carry`,
    );
  }

  for (const file of packed) {
    for (const pattern of FORBIDDEN) {
      if (pattern.test(file)) {
        problems.push(`must NOT be packed: ${file}`);
      }
    }
  }

  console.error(`package: ${manifest.name}`);
  console.error(`files:   ${packed.length}`);
  console.error(`profiles shipped: ${advertised.length}`);
  console.error(`example files shipped: ${packed.filter((f) => f.startsWith("examples/")).length}`);
}

if (problems.length > 0) {
  console.error("\npackage verification failed:\n");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.error("package contents verified");
