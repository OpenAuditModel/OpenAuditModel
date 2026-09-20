#!/usr/bin/env node
/**
 * Generates standalone Ajv validators for the canonical audit event schema and
 * for the checkpoint and proof schemas, which refer into the event schema's
 * $defs (and the proof into the checkpoint's).
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

const EVENT_SCHEMA_PATH = path.join(repoRoot, "schemas", "v0.1", "audit-event.schema.json");
const CHECKPOINT_SCHEMA_PATH = path.join(
  repoRoot,
  "schemas",
  "checkpoint",
  "v0.1",
  "checkpoint.schema.json",
);
const PROOF_SCHEMA_PATH = path.join(repoRoot, "schemas", "proof", "v0.1", "proof.schema.json");

/** One generated module per schema. `referenced` schemas are registered for `$ref` resolution. */
const TARGETS = [
  {
    schema: EVENT_SCHEMA_PATH,
    referenced: [],
    output: path.join(packageRoot, "src", "schema-validator.generated.ts"),
    source: "schemas/v0.1/audit-event.schema.json",
  },
  {
    schema: CHECKPOINT_SCHEMA_PATH,
    referenced: [EVENT_SCHEMA_PATH],
    output: path.join(packageRoot, "src", "checkpoint-validator.generated.ts"),
    source:
      "schemas/checkpoint/v0.1/checkpoint.schema.json, with the audit event schema registered for its $refs",
  },
  {
    schema: PROOF_SCHEMA_PATH,
    referenced: [EVENT_SCHEMA_PATH, CHECKPOINT_SCHEMA_PATH],
    output: path.join(packageRoot, "src", "proof-validator.generated.ts"),
    source:
      "schemas/proof/v0.1/proof.schema.json, with the audit event and checkpoint schemas registered for its $refs",
  },
];

/** Ajv options here MUST match `createAjv()` in conformance/src/validate-core.ts. */
const AJV_OPTIONS = {
  strict: true,
  allowUnionTypes: true,
  strictRequired: false,
  allErrors: true,
};

/** Rewrites Ajv's CJS `require` helpers into ESM imports. */
function toEsm(code, source) {
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
 * ${source}. Regenerate with:
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

function generate(target) {
  const schema = JSON.parse(readFileSync(target.schema, "utf8"));
  const ajv = new Ajv2020.default({ ...AJV_OPTIONS, code: { source: true, esm: true } });
  addFormats.default(ajv);
  for (const referenced of target.referenced) {
    ajv.addSchema(JSON.parse(readFileSync(referenced, "utf8")));
  }
  return toEsm(standaloneCode.default(ajv, ajv.compile(schema)), target.source);
}

const check = process.argv.includes("--check");
let stale = false;

for (const target of TARGETS) {
  const generated = generate(target);
  const shown = path.relative(repoRoot, target.output);
  if (check) {
    let current;
    try {
      current = readFileSync(target.output, "utf8");
    } catch {
      process.stderr.write(`missing ${shown}\n`);
      stale = true;
      continue;
    }
    if (current !== generated) {
      process.stderr.write(`${shown} is stale; run: npm run generate --workspace mcp\n`);
      stale = true;
    }
  } else {
    writeFileSync(target.output, generated, "utf8");
    process.stdout.write(`wrote ${shown} (${generated.length} bytes)\n`);
  }
}

if (check) {
  if (stale) {
    process.exit(1);
  }
  process.stdout.write("schema validators are current\n");
}
