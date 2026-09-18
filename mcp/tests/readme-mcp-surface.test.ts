/**
 * The root README's description of the MCP surface must match what the server serves.
 *
 * mcp/README.md described it correctly while README.md said the resources cover "the
 * IAM profile" — true only until the other nine profiles were bundled, and wrong in
 * every release since. The manifest is generated, so a claim about it can be checked
 * against it rather than re-read by a human.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { PROMPT_NAMES } from "../src/register-prompts.js";
import { TOOL_NAMES } from "../src/register-tools.js";
import { BUNDLED_RESOURCES } from "../src/resource-manifest.generated.js";
import { resolveSchemaPath } from "../../conformance/src/validate.js";

const repoRoot = path.dirname(path.dirname(path.dirname(resolveSchemaPath())));
const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

const UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** Reads "34", "thirty-four" or "eight" as a number — the README writes counts either way. */
function count(written: string): number {
  if (/^\d+$/.test(written)) {
    return Number(written);
  }
  const lower = written.toLowerCase();
  const unit = UNITS.indexOf(lower);
  if (unit >= 0) {
    return unit;
  }
  const [tens, rest] = lower.split("-");
  assert.ok(tens !== undefined && tens in TENS, `cannot read "${written}" as a number`);
  const base = TENS[tens as keyof typeof TENS];
  if (rest === undefined) {
    return base;
  }
  const trailing = UNITS.indexOf(rest);
  assert.ok(trailing > 0, `cannot read "${written}" as a number`);
  return base + trailing;
}

/** The paragraph in README.md that describes what the MCP server exposes. */
function surfaceParagraph(): string {
  const match = /\n(Eight tools[\s\S]*?)\n\n/.exec(readme);
  const paragraph = match?.[1];
  assert.ok(paragraph !== undefined, "README.md no longer describes the MCP surface");
  return paragraph;
}

/** The number the paragraph states for `subject`, however it is spelled. */
function stated(paragraph: string, subject: RegExp): number {
  const written = subject.exec(paragraph)?.[1];
  assert.ok(written !== undefined, `the README no longer states a count for ${subject}`);
  return count(written);
}

describe("the README's description of the MCP surface", () => {
  const paragraph = surfaceParagraph();

  test("names every tool the server registers, and no others", () => {
    const named = [...paragraph.matchAll(/`([a-z_]+)`/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    assert.deepEqual([...named].sort(), [...TOOL_NAMES].sort());
  });

  test("states the number of prompts the server registers", () => {
    assert.equal(stated(paragraph, /([A-Za-z-]+|\d+) prompts/), PROMPT_NAMES.length);
  });

  test("states the number of resources the manifest bundles", () => {
    assert.equal(
      stated(paragraph, /([A-Za-z-]+|\d+) read-only resources/),
      BUNDLED_RESOURCES.length,
    );
  });

  test("claims the profiles the manifest serves, not one of them", () => {
    const profiles = BUNDLED_RESOURCES.filter((resource) =>
      /^openauditmodel:\/\/profiles\/[^/]+\/\d/.test(resource.uri),
    );
    assert.equal(profiles.length, 10);
    assert.match(paragraph, /all ten profile definitions/);
  });
});
