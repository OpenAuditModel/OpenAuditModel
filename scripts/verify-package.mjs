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
 * fixture generators, the synthetic privacy fixtures and the MCP server.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const problems = [];

/** Paths the CLI reads at runtime. Absent from the tarball means broken on install. */
const REQUIRED = [
  "dist/conformance/src/cli.js",
  "schemas/v0.1/audit-event.schema.json",
  "profiles/profile-definition.schema.json",
];

/** Nothing matching these may be packed. */
const FORBIDDEN = [
  /(^|\/)tests?\//,
  /(^|\/)dist\/mcp\//,
  /(^|\/)examples\//,
  /(^|\/)conformance\/tools\//,
];

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
}

if (problems.length > 0) {
  console.error("\npackage verification failed:\n");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.error("package contents verified");
