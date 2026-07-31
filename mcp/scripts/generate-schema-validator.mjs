#!/usr/bin/env node
/**
 * Generates a standalone Ajv validator for the canonical audit event schema.
 *
 * The validator is compiled ahead of time so that no schema compilation
 * happens at runtime, in any deployment. Ajv's standalone generator emits that
 * same compiled code ahead of time, so the server gets **Ajv's own validation
 * logic** rather than an approximation written for the server.
 *
 * Ajv's `esm: true` mode emits ESM exports but still reaches for its runtime
 * helpers with CJS `require`, which fails in an ES module. Those calls are
 * rewritten here into real imports. Ajv publishes no `exports` map, so a `.js`
 * extension is appended: Node's ESM resolver does not guess extensions for a
 * bare specifier's subpath.
 *
 * Usage:
 *   node scripts/generate-schema-validator.mjs           write
 *   node scripts/generate-schema-validator.mjs --check   fail if stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import addFormats from "ajv-formats";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(here);
const repoRoot = path.dirname(packageRoot);

const SCHEMA_PATH = path.join(repoRoot, "schemas", "v0.1", "audit-event.schema.json");
const OUTPUT_PATH = path.join(packageRoot, "src", "schema-validator.generated.ts");

/** Ajv options here MUST match `createAjv()` in conformance/src/validate-core.ts. */
const AJV_OPTIONS = {
  strict: true,
  allowUnionTypes: true,
  strictRequired: false,
  allErrors: true,
};

/** Rewrites Ajv's CJS `require` helpers into ESM imports. */
function toEsm(code) {
  const specifiers = new Map();
  let next = 0;

  const rewritten = code.replaceAll(/require\((["'])([^"']+)\1\)/g, (_match, _quote, specifier) => {
    const resolved = /\.(js|cjs|mjs|json)$/.test(specifier) ? specifier : `${specifier}.js`;
    let binding = specifiers.get(resolved);
    if (binding === undefined) {
      binding = `generatedRuntime${next}`;
      next += 1;
      specifiers.set(resolved, binding);
    }
    return binding;
  });

  const imports = [...specifiers.entries()]
    .map(([specifier, binding]) => `import ${binding} from "${specifier}";`)
    .join("\n");

  // The emitted code is Ajv's, not ours: it is excluded from linting and type
  // checking rather than edited to satisfy either.
  return `/* eslint-disable */
// @ts-nocheck
/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by mcp/scripts/generate-schema-validator.mjs from
 * schemas/v0.1/audit-event.schema.json. Regenerate with:
 *
 *   npm run generate --workspace mcp
 *
 * CI fails when this file is stale. Editing it by hand would silently make the
 * server validate against something other than the canonical schema.
 */
${imports}

${rewritten}
`;
}

function generate() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv2020.default({ ...AJV_OPTIONS, code: { source: true, esm: true } });
  addFormats.default(ajv);
  return toEsm(standaloneCode.default(ajv, ajv.compile(schema)));
}

const generated = generate();
const check = process.argv.includes("--check");

if (check) {
  let current = "";
  try {
    current = readFileSync(OUTPUT_PATH, "utf8");
  } catch {
    process.stderr.write(`missing ${path.relative(repoRoot, OUTPUT_PATH)}\n`);
    process.exit(1);
  }
  if (current !== generated) {
    process.stderr.write(
      "the generated schema validator is stale; run: npm run generate --workspace mcp\n",
    );
    process.exit(1);
  }
  process.stdout.write("schema validator is current\n");
} else {
  writeFileSync(OUTPUT_PATH, generated, "utf8");
  process.stdout.write(
    `wrote ${path.relative(repoRoot, OUTPUT_PATH)} (${generated.length} bytes)\n`,
  );
}
