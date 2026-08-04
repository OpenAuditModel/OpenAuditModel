/**
 * The README quick start must actually work.
 *
 * Documented commands rot silently: a selector narrows, a required field is
 * added, a rule id changes, and the first thing a new reader copies stops
 * working — with nothing failing in CI. The quick start is the highest-traffic
 * code in the repository and it had a schema-invalid event in it until this test
 * was written, because `resource.type` may not contain a dot.
 *
 * This extracts the event and the commands from README.md itself, so the test
 * cannot pass while the documentation says something else.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveSchemaPath } from "../src/validate.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

const scratch = mkdtempSync(path.join(tmpdir(), "openauditmodel-readme-"));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function auditmodel(...args: string[]): { status: number; output: string } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: scratch,
    encoding: "utf8",
  });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** The event the quick start tells the reader to write. */
function quickStartEvent(): Record<string, unknown> {
  const match = /cat > audit-event\.json <<'EOF'\n([\s\S]*?)\nEOF/.exec(readme);
  assert.ok(match?.[1], "the README quick start no longer contains the heredoc event");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

const eventFile = path.join(scratch, "audit-event.json");
writeFileSync(eventFile, `${JSON.stringify(quickStartEvent(), null, 2)}\n`, "utf8");

describe("the README quick start event", () => {
  test("is schema-valid, so `validate` exits 0 as documented", () => {
    const result = auditmodel("validate", eventFile);
    assert.equal(result.status, 0, result.output);
  });

  test("is privacy-clean, so `lint-privacy` exits 0 as documented", () => {
    const result = auditmodel("lint-privacy", eventFile);
    assert.equal(result.status, 0, result.output);
  });

  test("fails the financial profile, which is what the README says it does", () => {
    const result = auditmodel(
      "check-profile",
      eventFile,
      "--profile",
      "financial-transaction-management",
    );
    assert.equal(result.status, 1, result.output);
  });

  test("is not-applicable to an unrelated profile, exiting 3 rather than passing", () => {
    const result = auditmodel("check-profile", eventFile, "--profile", "document-management");
    assert.equal(result.status, 3, result.output);
  });

  test("every field the README tells the reader to add is really required", () => {
    const result = auditmodel(
      "check-profile",
      eventFile,
      "--profile",
      "financial-transaction-management",
    );
    for (const pointer of [
      "/authorization",
      "/request/correlationId",
      "/metadata/financial/transactionId",
      "/metadata/financial/amount",
      "/metadata/financial/currency",
      "/metadata/financial/direction",
      "/metadata/financial/status",
      "/relatedResources",
    ]) {
      assert.ok(result.output.includes(pointer), `${pointer} is documented but not required`);
    }
  });

  test("adding exactly what the README shows makes the event conform", () => {
    const completed = {
      ...quickStartEvent(),
      authorization: { decision: "allow" },
      request: { correlationId: "transfer-2026-004418" },
      relatedResources: [{ type: "account", id: "account-ref-781" }],
      metadata: {
        financial: {
          transactionId: "txn-2026-0314-0091",
          amount: 1250.5,
          currency: "EUR",
          direction: "outbound",
          status: "settled",
        },
      },
    };
    const file = path.join(scratch, "completed.json");
    writeFileSync(file, `${JSON.stringify(completed, null, 2)}\n`, "utf8");

    assert.equal(auditmodel("validate", file).status, 0);
    assert.equal(auditmodel("lint-privacy", file).status, 0);
    const result = auditmodel(
      "check-profile",
      file,
      "--profile",
      "financial-transaction-management",
    );
    assert.equal(result.status, 0, result.output);
  });
});

describe("the README documents the commands that exist", () => {
  test("the package name in the quick start is the published package name", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    const quickStart = readme.slice(
      readme.indexOf("## Quick start"),
      readme.indexOf("## What is OpenAuditModel?"),
    );
    assert.ok(
      quickStart.includes(`npx ${manifest["name"] as string} validate`),
      "the quick start does not use the package's own name",
    );
    assert.ok(
      !quickStart.includes("npm run auditmodel --"),
      "the quick start still drives the CLI through the build-from-source invocation — " +
        "now that the package is published, it should use npx instead",
    );
  });

  test("the profile is passed with --profile, never positionally", () => {
    // `check-profile <file> <profile>` silently ignores the profile and exits 2.
    // Only real invocations, not prose that happens to name the command. Shell
    // line continuations are joined first: the flag is often on the next line.
    const joined = readme.replace(/\\\n\s*/g, " ");
    const invocation = /^\s*(?:npx\s+\S+|auditmodel|openauditmodel)\s+check-profile\b/;
    const commands = joined.split("\n").filter((line) => invocation.test(line));
    assert.ok(commands.length > 0, "the README documents no check-profile command at all");
    for (const line of commands) {
      assert.ok(
        line.includes("--profile"),
        `a documented check-profile command omits --profile: ${line.trim()}`,
      );
    }
  });

  test("the documented binary names are the ones the package installs", () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };
    assert.ok(manifest.bin["auditmodel"], "auditmodel is documented as the canonical binary");
    assert.ok(readme.includes("`auditmodel`"), "the README does not name the canonical binary");
  });
});
