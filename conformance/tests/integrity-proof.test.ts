/**
 * Inclusion proofs: the tree hashing, the schema, and the verification of one
 * event against a published root.
 *
 * The hashing is RFC 6962's, and the tests below pin it by recomputing the
 * small cases by hand, so that the module cannot quietly define its own tree.
 */
import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import {
  createProofValidator,
  createValidator,
  loadSchema,
  PROOF_SCHEMA_ID,
  resolveProofSchemaPath,
  resolveSchemaPath,
  validateSchemaDocument,
} from "../src/validate.js";
import { sealEvent } from "../src/integrity/digest.js";
import { canonicalBytes } from "../src/integrity/canonicalize.js";
import { documentSignatureInput } from "../src/integrity/signature.js";
import {
  auditPath,
  expectedSides,
  leafHash,
  merkleRoot,
  nodeHash,
  rootFromPath,
} from "../src/integrity/merkle.js";
import { verifyProof } from "../src/integrity/verify-proof.js";
import type { ProofReport } from "../src/integrity/types.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const integrityRoot = path.join(repoRoot, "examples", "integrity");
const validator = createValidator(schemaPath);
const proofValidator = createProofValidator(schemaPath);
const validators = { events: validator, proof: proofValidator };

type Document = Record<string, unknown>;

function sha256(...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
}

function hashOf(event: Document): string {
  return (event["integrity"] as Document)["hash"] as string;
}

/** Sealed events with sequences 1..count in one chain. */
function buildEvents(count: number): Document[] {
  const events: Document[] = [];
  let previousHash: string | undefined;
  for (let index = 0; index < count; index += 1) {
    const sealed = sealEvent({
      specVersion: "0.1",
      id: `018f2a30-3333-7444-8555-${String(index + 1).padStart(12, "0")}`,
      time: `2026-04-03T09:${String(index).padStart(2, "0")}:00.000Z`,
      sequence: index + 1,
      event: { name: "data.record.update", category: "data-modification", outcome: "success" },
      actor: { type: "user", id: "user-123" },
      resource: { type: "record", id: `record-${index + 1}` },
      application: { name: "application-service", environment: "production" },
      integrity: {
        canonicalization: "RFC8785",
        hashAlgorithm: "SHA-256",
        hash: "",
        ...(previousHash === undefined ? {} : { previousHash }),
        chainId: "chain-test-instance-1",
      },
    }) as Document;
    previousHash = hashOf(sealed);
    events.push(sealed);
  }
  return events;
}

const ANCHOR = { type: "publication", reference: "https://archive.example/trees/1" };

/** A proof for `events[index]` over the tree of all `events`. */
function proofFor(events: readonly Document[], index: number, overrides: Document = {}): Document {
  const leaves = events.map(hashOf);
  return {
    proofVersion: "0.1",
    hashAlgorithm: "SHA-256",
    leaf: { hash: leaves[index], index, eventId: events[index]?.["id"] },
    path: auditPath("SHA-256", leaves, index),
    root: {
      hash: merkleRoot("SHA-256", leaves).toString("hex"),
      leafCount: leaves.length,
      anchor: ANCHOR,
    },
    ...overrides,
  };
}

function verify(event: unknown, proof: unknown, publicKey?: KeyObject): ProofReport {
  return verifyProof(event, "event", proof, validators, { publicKey });
}

function kinds(report: ProofReport): string[] {
  return report.findings.map((finding) => finding.kind);
}

function loadFixture(...segments: string[]): Document {
  return JSON.parse(readFileSync(path.join(integrityRoot, ...segments), "utf8")) as Document;
}

function signRoot(root: Document, privateKey: KeyObject): Document {
  const value = cryptoSign(null, canonicalBytes(documentSignatureInput(root)), privateKey);
  return {
    ...root,
    signature: { algorithm: "Ed25519", value: value.toString("base64"), keyId: "test" },
  };
}

describe("RFC 6962 tree hashing", () => {
  const digests = [
    "aa".repeat(32),
    "bb".repeat(32),
    "cc".repeat(32),
    "dd".repeat(32),
    "ee".repeat(32),
  ];
  const raw = digests.map((digest) => Buffer.from(digest, "hex"));

  test("a leaf is H(0x00 ‖ digest) and a node is H(0x01 ‖ left ‖ right)", () => {
    assert.deepEqual(
      leafHash("SHA-256", raw[0] as Buffer),
      sha256(Uint8Array.of(0), raw[0] as Buffer),
    );
    const left = leafHash("SHA-256", raw[0] as Buffer);
    const right = leafHash("SHA-256", raw[1] as Buffer);
    assert.deepEqual(nodeHash("SHA-256", left, right), sha256(Uint8Array.of(1), left, right));
  });

  test("the root of one leaf is the leaf hash, unprefixed a second time", () => {
    assert.deepEqual(
      merkleRoot("SHA-256", digests.slice(0, 1)),
      leafHash("SHA-256", raw[0] as Buffer),
    );
  });

  test("three leaves split at two, and the odd leaf is promoted unchanged", () => {
    const l = raw.slice(0, 3).map((digest) => leafHash("SHA-256", digest));
    const expected = sha256(
      Uint8Array.of(1),
      sha256(Uint8Array.of(1), l[0] as Buffer, l[1] as Buffer),
      l[2] as Buffer,
    );
    assert.deepEqual(merkleRoot("SHA-256", digests.slice(0, 3)), expected);
  });

  test("five leaves split at four", () => {
    const l = raw.map((digest) => leafHash("SHA-256", digest));
    const n = (a: Buffer, b: Buffer) => sha256(Uint8Array.of(1), a, b);
    const expected = n(
      n(n(l[0] as Buffer, l[1] as Buffer), n(l[2] as Buffer, l[3] as Buffer)),
      l[4] as Buffer,
    );
    assert.deepEqual(merkleRoot("SHA-256", digests), expected);
  });

  test("every audit path recomputes the root, and has the shape its position implies", () => {
    for (let size = 1; size <= 9; size += 1) {
      const leaves = Array.from({ length: size }, (_, i) => String(i).padStart(2, "0").repeat(32));
      const root = merkleRoot("SHA-256", leaves);
      for (let index = 0; index < size; index += 1) {
        const path = auditPath("SHA-256", leaves, index);
        const recomputed = rootFromPath(
          "SHA-256",
          Buffer.from(leaves[index] as string, "hex"),
          path,
        );
        assert.deepEqual(recomputed, root, `size ${size}, index ${index}`);
        assert.deepEqual(
          path.map((step) => step.side),
          expectedSides(index, size),
          `size ${size}, index ${index}`,
        );
      }
    }
  });

  test("a path with its sides swapped recomputes to another root", () => {
    const path = auditPath("SHA-256", digests, 1).map((step) => ({
      ...step,
      side: step.side === "left" ? ("right" as const) : ("left" as const),
    }));
    const recomputed = rootFromPath("SHA-256", raw[1] as Buffer, path);
    assert.notDeepEqual(recomputed, merkleRoot("SHA-256", digests));
  });

  test("refuses a leaf index outside the tree and a digest of the wrong length", () => {
    assert.throws(() => auditPath("SHA-256", digests, 5), /outside a tree/);
    assert.throws(() => merkleRoot("SHA-256", ["abcd"]), /not a SHA-256 digest/);
    assert.equal(
      rootFromPath("SHA-256", raw[0] as Buffer, [{ side: "left", hash: "abcd" }]),
      undefined,
    );
  });
});

describe("the proof schema", () => {
  const proofSchema = loadSchema(resolveProofSchemaPath(schemaPath));

  test("passes meta-schema validation and declares its canonical identifier", () => {
    assert.deepEqual(validateSchemaDocument(proofSchema), []);
    assert.equal(proofSchema["$id"], PROOF_SCHEMA_ID);
    assert.equal(proofValidator.schemaId, PROOF_SCHEMA_ID);
  });

  test("borrows digests and signatures from the event schema and the anchor from the checkpoint schema", () => {
    const rendered = JSON.stringify(proofSchema);
    assert.match(rendered, /audit-event\/0\.1\/schema\.json#\/\$defs\/hexDigest/);
    assert.match(rendered, /audit-event\/0\.1\/schema\.json#\/\$defs\/signature/);
    assert.match(rendered, /checkpoint\/0\.1\/schema\.json#\/\$defs\/anchor/);
  });

  test("defines the hashing in prose, where an implementer in another language reads it", () => {
    const description = proofSchema["description"] as string;
    assert.match(description, /RFC 6962/);
    assert.match(description, /H\(0x00 ‖ d\)/);
    assert.match(description, /H\(0x01 ‖ left ‖ right\)/);
    assert.match(description, /promoted unchanged/);
  });

  test("accepts every published proof", () => {
    for (const name of readdirSync(path.join(integrityRoot, "proofs")).sort()) {
      assert.deepEqual(proofValidator.validateEvent(loadFixture("proofs", name)), [], name);
    }
  });

  test("the root's anchor is required, under the checkpoint schema's rule", () => {
    const events = buildEvents(2);
    const proof = proofFor(events, 0);
    const root = { ...(proof["root"] as Document) };
    delete root["anchor"];
    assert.notEqual(proofValidator.validateEvent({ ...proof, root }).length, 0);
    assert.notEqual(
      proofValidator.validateEvent({
        ...proof,
        root: { ...root, anchor: { type: "manual", reference: " " } },
      }).length,
      0,
    );
  });

  test("rejects a negative index, an empty tree, an unknown side and unknown members", () => {
    const events = buildEvents(2);
    const proof = proofFor(events, 0);
    const leaf = proof["leaf"] as Document;
    const root = proof["root"] as Document;
    assert.notEqual(
      proofValidator.validateEvent({ ...proof, leaf: { ...leaf, index: -1 } }).length,
      0,
    );
    assert.notEqual(
      proofValidator.validateEvent({ ...proof, root: { ...root, leafCount: 0 } }).length,
      0,
    );
    assert.notEqual(
      proofValidator.validateEvent({ ...proof, path: [{ side: "up", hash: "aa".repeat(32) }] })
        .length,
      0,
    );
    assert.notEqual(proofValidator.validateEvent({ ...proof, extra: true }).length, 0);
  });
});

describe("verifying an event against a proof", () => {
  const events = buildEvents(5);

  test("verifies every leaf of a five-leaf tree", () => {
    for (const [index, event] of events.entries()) {
      const report = verify(event, proofFor(events, index));
      assert.equal(report.outcome, "verified", `leaf ${index}`);
      assert.equal(report.calculatedRoot, (report.root as { hash: string }).hash);
      assert.deepEqual(
        report.checks.map((check) => check.message),
        [
          "proof schema valid",
          `path has the shape of leaf ${index} in a tree of 5 leaves`,
          "path recomputes to the recorded root",
          "the leaf is this event's integrity hash",
        ],
      );
    }
  });

  test("a tree of one leaf has an empty path and verifies", () => {
    const [only] = buildEvents(1);
    const report = verify(only, proofFor([only as Document], 0));
    assert.equal(report.outcome, "verified");
    assert.deepEqual((report.root as { leafCount: number }).leafCount, 1);
  });

  test("a path that leads to another root fails", () => {
    const proof = proofFor(events, 1, {
      root: {
        hash: merkleRoot("SHA-256", events.slice(0, 2).map(hashOf)).toString("hex"),
        leafCount: 5,
        anchor: ANCHOR,
      },
    });
    const report = verify(events[1], proof);
    assert.equal(report.outcome, "failed");
    assert.deepEqual(kinds(report), ["proof-root-mismatch"]);
    assert.match(report.findings[0]?.detail?.join("\n") ?? "", /recorded:.*\n.*calculated:/);
  });

  test("a proof for another event names another leaf", () => {
    const report = verify(events[2], proofFor(events, 1));
    assert.equal(report.outcome, "failed");
    assert.deepEqual(kinds(report), ["proof-leaf-mismatch"]);
    assert.equal(report.event?.verified, true, "the event itself is fine");
  });

  test("a path whose shape is not the leaf's position is inconsistent, before any hashing", () => {
    const proof = proofFor(events, 1);
    const swapped = (proof["path"] as { side: string; hash: string }[]).map((step) => ({
      ...step,
      side: step.side === "left" ? "right" : "left",
    }));
    const report = verify(events[1], { ...proof, path: swapped });
    assert.ok(kinds(report).includes("proof-path-inconsistent"));
    assert.equal(report.outcome, "failed");
  });

  test("a leaf index outside the tree is an invalid position", () => {
    const proof = proofFor(events, 1);
    const leaf = { ...(proof["leaf"] as Document), index: 5 };
    const report = verify(events[1], { ...proof, leaf });
    assert.deepEqual(kinds(report), ["proof-position-invalid"]);
  });

  test("digests of the wrong length for the declared algorithm are reported by pointer", () => {
    const report = verify(events[1], { ...proofFor(events, 1), hashAlgorithm: "SHA-512" });
    assert.equal(report.outcome, "failed");
    assert.ok(kinds(report).includes("proof-digest-length-mismatch"));
    const detail =
      report.findings.find((f) => f.kind === "proof-digest-length-mismatch")?.detail ?? [];
    assert.ok(detail.includes("/leaf/hash") && detail.includes("/root/hash"));
  });

  test("an algorithm this verifier does not implement fails without computing anything", () => {
    const report = verify(events[1], { ...proofFor(events, 1), hashAlgorithm: "BLAKE3" });
    assert.deepEqual(kinds(report), ["proof-algorithm-unsupported"]);
    assert.equal(report.calculatedRoot, undefined);
  });

  test("a tampered event fails on its own digest, and the proof fails with it", () => {
    const tampered = structuredClone(events[1] as Document);
    (tampered["resource"] as Document)["id"] = "record-tampered";
    const report = verify(tampered, proofFor(events, 1));
    assert.equal(report.outcome, "failed");
    assert.deepEqual(
      report.event?.findings.map((f) => f.kind),
      ["hash-mismatch"],
    );
    assert.deepEqual(kinds(report), [], "the proof itself is consistent");
    assert.doesNotMatch(JSON.stringify(report), /record-tampered/);
  });

  test("an event whose hash cannot be established yields no verdict", () => {
    const bare = structuredClone(events[1] as Document);
    delete bare["integrity"];
    const report = verify(bare, proofFor(events, 1));
    assert.equal(report.outcome, "no-leaf");
    assert.deepEqual(kinds(report), ["proof-leaf-unavailable"]);
    assert.match(report.findings[0]?.detail?.[0] ?? "", /^integrity-missing:/);
  });

  test("no leaf and a broken proof is a failed proof, not a missing verdict", () => {
    const bare = structuredClone(events[1] as Document);
    delete bare["integrity"];
    const proof = proofFor(events, 1, { hashAlgorithm: "BLAKE3" });
    assert.equal(verify(bare, proof).outcome, "failed");
  });

  test("a document that is not a proof judges nothing", () => {
    const report = verify(events[1], { proofVersion: "0.1" });
    assert.equal(report.outcome, "invalid-proof");
    assert.deepEqual(kinds(report), ["proof-schema-invalid"]);
    assert.equal(report.event, undefined);
  });
});

describe("the root's signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const { publicKey: otherKey } = generateKeyPairSync("ed25519");
  const events = buildEvents(3);
  const unsigned = proofFor(events, 2);
  const signed = { ...unsigned, root: signRoot(unsigned["root"] as Document, privateKey) };

  test("verifies with the matching key, and is declared but not checked without one", () => {
    assert.equal(verify(events[2], signed, publicKey).signature?.status, "valid");
    assert.equal(verify(events[2], signed).signature?.status, "not-checked");
    assert.equal(verify(events[2], signed).outcome, "verified");
  });

  test("fails with another key, and the failure is the verdict", () => {
    const report = verify(events[2], signed, otherKey);
    assert.equal(report.outcome, "failed");
    assert.deepEqual(
      report.findings.map((f) => `${f.kind}@${f.label}`),
      ["signature-invalid@proof"],
    );
  });

  test("covers the root only, so one signed root serves every proof of its tree", () => {
    const root = signed["root"] as Document;
    for (const index of [0, 1]) {
      const other = { ...proofFor(events, index), root };
      assert.equal(verify(events[index], other, publicKey).outcome, "verified", `leaf ${index}`);
    }
    const edited = { ...root, leafCount: 4 };
    assert.equal(
      verify(events[2], { ...signed, root: edited }, publicKey).signature?.status,
      "invalid",
    );
  });

  test("an algorithm this verifier does not implement fails with or without a key", () => {
    const root = {
      ...(unsigned["root"] as Document),
      signature: { algorithm: "ECDSA-P384-SHA384", value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    };
    for (const key of [undefined, publicKey]) {
      assert.deepEqual(kinds(verify(events[2], { ...unsigned, root }, key)), [
        "unsupported-signature-algorithm",
      ]);
    }
  });
});

describe("the published proof fixtures", () => {
  const event002 = loadFixture("valid", "three-event-chain", "002.json");
  const proof = loadFixture("proofs", "three-event-chain.002.proof.json");

  test("the proof for event 2 verifies, with the test key too", () => {
    const pem = readFileSync(path.join(integrityRoot, "keys", "ed25519-test-public.pem"), "utf8");
    const report = verify(event002, proof, createPublicKey(pem));
    assert.equal(report.outcome, "verified");
    assert.equal(report.signature?.status, "valid");
  });

  test("its root is the tree over the three chain digests", () => {
    const chain = ["001.json", "002.json", "003.json"].map((file) =>
      hashOf(loadFixture("valid", "three-event-chain", file)),
    );
    assert.equal((proof["root"] as Document)["hash"], merkleRoot("SHA-256", chain).toString("hex"));
  });

  test("the wrong-root variant fails on the root and nothing else", () => {
    const report = verify(
      event002,
      loadFixture("proofs", "three-event-chain.002.wrong-root.proof.json"),
    );
    assert.equal(report.outcome, "failed");
    assert.deepEqual(kinds(report), ["proof-root-mismatch"]);
  });

  test("the proof names event 2's leaf, so event 1 does not verify against it", () => {
    const report = verify(loadFixture("valid", "three-event-chain", "001.json"), proof);
    assert.deepEqual(kinds(report), ["proof-leaf-mismatch"]);
  });
});
