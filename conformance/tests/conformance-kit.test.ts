/**
 * The language-neutral conformance kit.
 *
 * The kit is what turns ADR 0001's promise — "an implementation in any language
 * can be checked against the same fixtures" — from a statement about the
 * fixtures into a statement anyone can act on. This suite holds it to three
 * things: it is what the engines currently say, it covers every published
 * fixture, and it records nothing an implementation is free to word differently.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { resolveSchemaPath } from "../src/validate.js";
import { availableProfiles } from "../src/profiles/load-profile.js";
import { buildKit, checkKit, CHECKPOINT_DIRECTORY } from "../tools/generate-kit.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const kit = buildKit();

/** Every `.json` fixture the kit is expected to cover. */
function publishedFixtures(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...publishedFixtures(full));
    } else if (entry.name.endsWith(".json")) {
      found.push(path.relative(repoRoot, full).split(path.sep).join("/"));
    }
  }
  return found;
}

describe("the conformance kit", () => {
  test("the checked-in manifest is what the engines currently say", () => {
    assert.deepEqual(checkKit(), [], 'the conformance kit drifted; run "npm run kit:build"');
  });

  test("every published fixture is covered, and nothing else is", () => {
    const expected = publishedFixtures(path.join(repoRoot, "examples"))
      .filter(
        (file) =>
          !file.startsWith("examples/integrity/keys/") && !file.startsWith(CHECKPOINT_DIRECTORY),
      )
      .sort((left, right) => left.localeCompare(right, "en"));
    const covered = kit.fixtures
      .map((record) => record.fixture)
      .sort((left, right) => left.localeCompare(right, "en"));

    assert.deepEqual(covered, expected);
  });

  test("every fixture the kit names exists on disk", () => {
    for (const record of kit.fixtures) {
      assert.ok(existsSync(path.join(repoRoot, record.fixture)), record.fixture);
    }
    for (const chain of kit.chains) {
      assert.ok(existsSync(path.join(repoRoot, chain.fixtures)), chain.fixtures);
    }
    for (const record of kit.checkpoints) {
      assert.ok(existsSync(path.join(repoRoot, record.checkpoint)), record.checkpoint);
      for (const directory of record.archive) {
        assert.ok(existsSync(path.join(repoRoot, directory)), directory);
      }
    }
  });

  test("every published checkpoint document is compared with at least one archive", () => {
    const published = publishedFixtures(path.join(repoRoot, CHECKPOINT_DIRECTORY)).sort();
    const recorded = [...new Set(kit.checkpoints.map((record) => record.checkpoint))].sort();
    assert.ok(published.length > 0);
    assert.deepEqual(recorded, published);
  });

  test("the deleted tail is recorded as intact by verify-chain and as truncated by the checkpoint", () => {
    // The one case the whole checkpoint family exists for: two records about
    // the same directory that disagree on purpose.
    const truncated = "examples/integrity/invalid/truncated-chain";
    const asChain = kit.chains.find((record) => record.fixtures === truncated);
    assert.equal(asChain?.intact, true);

    const againstCheckpoint = kit.checkpoints.find(
      (record) => record.archive.length === 1 && record.archive[0] === truncated,
    );
    assert.equal(againstCheckpoint?.outcome, "disagrees");
    assert.deepEqual(againstCheckpoint?.chains[0]?.findings, ["tail-truncated"]);
  });

  test("no human-readable message is recorded anywhere in it", () => {
    // Wording is not the contract. A kit that compared prose would fail every
    // translation and every improvement to a sentence, so the generator records
    // identifiers, pointers and statuses and nothing else.
    const rendered =
      JSON.stringify(kit.fixtures) + JSON.stringify(kit.chains) + JSON.stringify(kit.checkpoints);
    for (const forbidden of ["message", "recommendation", "detail", "summary"]) {
      assert.doesNotMatch(rendered, new RegExp(`"${forbidden}"`), forbidden);
    }
  });

  test("no fixture content is embedded, so there is one copy of every event", () => {
    const rendered = JSON.stringify(kit);
    for (const forbidden of ['specVersion":"0.1","id"', '"actor"', '"application"']) {
      assert.doesNotMatch(rendered, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  test("it states what it does not claim", () => {
    const claims = kit.claims.join(" ");
    assert.match(claims, /no badge/i);
    assert.match(claims, /nothing else|and nothing/i);
    assert.doesNotMatch(claims, /certif|compliant|approved/i);
  });

  test("the kit's README refuses to confer a status", () => {
    const readme = readFileSync(path.join(repoRoot, "conformance-kit", "README.md"), "utf8");
    assert.match(readme, /no badge/i);
    assert.match(readme, /confers nothing/i);
    assert.doesNotMatch(readme, /is certified|we certify|officially compatible/i);
  });

  test("it pins the specification version, the schema identifier and every profile version", () => {
    assert.equal(kit.specVersion, "0.1");
    assert.match(kit.schemaId, /^https:\/\/openauditmodel\.org\/schemas\/audit-event\//);
    assert.deepEqual(
      kit.profiles.map((profile) => profile.name).sort((a, b) => a.localeCompare(b, "en")),
      availableProfiles(),
    );
    for (const profile of kit.profiles) {
      assert.match(profile.version, /^[0-9]+(\.[0-9]+){0,2}$/, profile.name);
    }
  });

  test("the recorded verdicts are the ones the suites already assert", () => {
    // Spot checks against fixtures whose verdict other suites pin by hand, so
    // the kit cannot quietly record something the tests contradict.
    const byPath = new Map(kit.fixtures.map((record) => [record.fixture, record]));

    const coreInvalid = byPath.get("examples/invalid/missing-actor.json");
    assert.equal(coreInvalid?.validate.valid, false);
    assert.deepEqual(coreInvalid?.validate.issues, [{ path: "/actor", keyword: "required" }]);

    const password = byPath.get("examples/privacy/findings/password-field.json");
    assert.equal(password?.lintPrivacy.status, "findings");
    assert.deepEqual(password?.lintPrivacy.findings, [
      {
        ruleId: "OAM-PRIV-001",
        path: "/metadata/password",
        severity: "critical",
        confidence: "high",
      },
    ]);

    const notApplicable = byPath.get(
      "examples/profiles/identity-and-access-management/not-applicable/document-share.json",
    );
    assert.equal(notApplicable?.checkProfile?.status, "not-applicable");
    assert.deepEqual(notApplicable?.checkProfile?.matchedRules, []);

    const tampered = byPath.get("examples/integrity/invalid/tampered-event.json");
    assert.equal(tampered?.verifyIntegrity?.verified, false);
    assert.deepEqual(tampered?.verifyIntegrity?.findings, ["hash-mismatch"]);
  });

  test("a broken chain is recorded as broken, and an intact one as intact", () => {
    const byPath = new Map(kit.chains.map((record) => [record.fixtures, record]));

    const intact = byPath.get("examples/integrity/valid/three-event-chain");
    assert.equal(intact?.intact, true);
    assert.equal(intact?.eventCount, 3);

    const broken = byPath.get("examples/integrity/invalid/broken-previous-hash");
    assert.equal(broken?.intact, false);
    assert.ok((broken?.chains[0]?.findings.length ?? 0) > 0);
  });
});
