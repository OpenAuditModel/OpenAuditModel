/**
 * Chain checkpoints: the schema, and the comparison of an archive with one.
 *
 * `verifyChains` proves that the events it is given are consistent with each
 * other; a deleted tail leaves nothing for it to find (integrity.md §8, item
 * 4). These tests pin down the one check that can see it, and what that check
 * does and does not establish.
 */
import assert from "node:assert/strict";
import {
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import {
  CHECKPOINT_SCHEMA_ID,
  createCheckpointValidator,
  createValidator,
  loadSchema,
  resolveCheckpointSchemaPath,
  resolveSchemaPath,
  validateSchemaDocument,
} from "../src/validate.js";
import { buildDigestInput, sealEvent } from "../src/integrity/digest.js";
import { canonicalBytes } from "../src/integrity/canonicalize.js";
import { documentSignatureInput } from "../src/integrity/signature.js";
import { verifyChains, type ChainEventInput } from "../src/integrity/verify-chain.js";
import { verifyCheckpoint } from "../src/integrity/verify-checkpoint.js";
import type { CheckpointReport } from "../src/integrity/types.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const integrityRoot = path.join(repoRoot, "examples", "integrity");
const validator = createValidator(schemaPath);
const checkpointValidator = createCheckpointValidator(schemaPath);
const validators = { events: validator, checkpoint: checkpointValidator };

type Document = Record<string, unknown>;

const CHAIN_ID = "chain-test-instance-1";

function integrityOf(event: Document): Document {
  return event["integrity"] as Document;
}

function hashOf(event: Document): string {
  return integrityOf(event)["hash"] as string;
}

/** Builds a sealed chain with the given sequences, linked in that order. */
function buildChain(sequences: readonly number[], chainId = CHAIN_ID): Document[] {
  const events: Document[] = [];
  let previousHash: string | undefined;
  for (const [index, sequence] of sequences.entries()) {
    const sealed = sealEvent({
      specVersion: "0.1",
      id: `018f2a30-2222-7333-8444-00000000000${index + 1}`,
      time: `2026-04-03T09:0${index}:00.000Z`,
      sequence,
      event: { name: "data.record.update", category: "data-modification", outcome: "success" },
      actor: { type: "user", id: "user-123" },
      resource: { type: "record", id: `record-${index + 1}` },
      application: { name: "application-service", environment: "production" },
      integrity: {
        canonicalization: "RFC8785",
        hashAlgorithm: "SHA-256",
        hash: "",
        ...(previousHash === undefined ? {} : { previousHash }),
        chainId,
      },
    }) as Document;
    previousHash = hashOf(sealed);
    events.push(sealed);
  }
  return events;
}

function inputs(events: readonly Document[]): ChainEventInput[] {
  return events.map((event, index) => ({ label: `event-${index + 1}`, event }));
}

/** A checkpoint of `chain` at the event `head`, anchored, with optional overrides. */
function checkpointFor(head: Document, overrides: Document = {}): Document {
  return {
    checkpointVersion: "0.1",
    chainId: integrityOf(head)["chainId"],
    hashAlgorithm: "SHA-256",
    canonicalization: "RFC8785",
    head: { sequence: head["sequence"], hash: hashOf(head) },
    createdAt: "2026-04-03T10:00:00Z",
    anchor: { type: "manual", reference: "ticket CHG-1, countersigned" },
    ...overrides,
  };
}

function verify(
  events: readonly Document[],
  checkpoint: unknown,
  publicKey?: KeyObject,
): CheckpointReport {
  return verifyCheckpoint(inputs(events), checkpoint, validators, { publicKey });
}

function kinds(report: CheckpointReport, chain = 0): string[] {
  return report.chains[chain]?.findings.map((finding) => finding.kind) ?? [];
}

function loadDirectory(...segments: string[]): Document[] {
  const directory = path.join(integrityRoot, ...segments);
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((entry) => JSON.parse(readFileSync(path.join(directory, entry), "utf8")) as Document);
}

function loadCheckpoint(name: string): Document {
  return JSON.parse(
    readFileSync(path.join(integrityRoot, "checkpoints", name), "utf8"),
  ) as Document;
}

function signWith(document: Document, privateKey: KeyObject, keyId = "test-key"): Document {
  const value = cryptoSign(null, canonicalBytes(documentSignatureInput(document)), privateKey);
  return {
    ...document,
    signature: { algorithm: "Ed25519", value: value.toString("base64"), keyId },
  };
}

describe("the checkpoint schema", () => {
  const checkpointSchema = loadSchema(resolveCheckpointSchemaPath(schemaPath));

  test("passes Draft 2020-12 meta-schema validation and declares its canonical identifier", () => {
    assert.deepEqual(validateSchemaDocument(checkpointSchema), []);
    assert.equal(checkpointSchema["$id"], CHECKPOINT_SCHEMA_ID);
    assert.equal(checkpointValidator.schemaId, CHECKPOINT_SCHEMA_ID);
  });

  test("borrows its digest, identifier, timestamp and signature definitions from the event schema", () => {
    const rendered = JSON.stringify(checkpointSchema);
    for (const definition of [
      "hexDigest",
      "identifier",
      "timestamp",
      "signature",
      "algorithmIdentifier",
    ]) {
      assert.match(
        rendered,
        new RegExp(`audit-event/0\\.1/schema\\.json#/\\$defs/${definition}`),
        definition,
      );
    }
    assert.equal(
      checkpointSchema["$defs"] && "hexDigest" in (checkpointSchema["$defs"] as object),
      false,
    );
  });

  test("accepts every published checkpoint except the unanchored one", () => {
    for (const name of readdirSync(path.join(integrityRoot, "checkpoints")).sort()) {
      const issues = checkpointValidator.validateEvent(loadCheckpoint(name));
      if (name.includes("unanchored")) {
        assert.deepEqual(
          issues.map((issue) => `${issue.path} ${issue.keyword}`),
          ["/anchor required"],
          name,
        );
      } else {
        assert.deepEqual(issues, [], name);
      }
    }
  });

  test("the anchoring rule: an anchor must name a type and a reference, and neither may be blank", () => {
    const head = buildChain([1])[0] as Document;
    for (const anchor of [
      undefined,
      {},
      { type: "manual" },
      { type: "manual", reference: "" },
      { type: "manual", reference: "   " },
      { type: "", reference: "somewhere" },
    ]) {
      const document = checkpointFor(head, anchor === undefined ? {} : { anchor });
      if (anchor === undefined) {
        delete document["anchor"];
      }
      assert.notEqual(
        checkpointValidator.validateEvent(document).length,
        0,
        JSON.stringify(anchor),
      );
    }
  });

  test("the single-chain and multi-chain forms exclude each other", () => {
    const [one] = buildChain([1]);
    const single = checkpointFor(one as Document);
    const multi: Document = {
      ...single,
      chains: [{ chainId: CHAIN_ID, head: single["head"], eventCount: 1 }],
    };
    delete multi["chainId"];
    delete multi["head"];

    assert.deepEqual(checkpointValidator.validateEvent(single), []);
    assert.deepEqual(checkpointValidator.validateEvent(multi), []);
    assert.notEqual(
      checkpointValidator.validateEvent({ ...single, chains: multi["chains"] }).length,
      0,
      "both forms at once",
    );
    assert.notEqual(
      checkpointValidator.validateEvent({ ...multi, eventCount: 1 }).length,
      0,
      "a top-level count with the multi-chain form",
    );
  });

  test("a head hash that is not a verifiable digest is rejected through the borrowed definition", () => {
    const [one] = buildChain([1]);
    const document = checkpointFor(one as Document, { head: { sequence: 1, hash: "ABCDEF" } });
    const issues = checkpointValidator.validateEvent(document);
    assert.ok(
      issues.some((issue) => issue.path === "/head/hash"),
      JSON.stringify(issues),
    );
  });

  test("rejects an unknown version and unknown members", () => {
    const [one] = buildChain([1]);
    const head = one as Document;
    assert.notEqual(
      checkpointValidator.validateEvent(checkpointFor(head, { checkpointVersion: "0.2" })).length,
      0,
    );
    assert.notEqual(checkpointValidator.validateEvent(checkpointFor(head, { extra: 1 })).length, 0);
  });
});

describe("comparing an archive with a checkpoint", () => {
  test("agrees when the archive reaches the recorded head", () => {
    const chain = buildChain([1, 2, 3]);
    const report = verify(chain, checkpointFor(chain[2] as Document, { eventCount: 3 }));

    assert.equal(report.outcome, "agrees");
    assert.equal(report.chains[0]?.status, "agrees");
    assert.deepEqual(
      report.chains[0]?.checks.map((check) => check.message),
      [
        "event at sequence 3 matches the recorded head",
        "3 events up to the head, as the checkpoint records",
      ],
    );
    assert.deepEqual(report.anchor, { type: "manual", reference: "ticket CHG-1, countersigned" });
  });

  test("the deleted tail: consistent to verify-chain, truncated to the checkpoint", () => {
    const chain = buildChain([1, 2, 3]);
    const truncated = chain.slice(0, 2);
    const checkpoint = checkpointFor(chain[2] as Document, { eventCount: 3 });

    assert.equal(verifyChains(inputs(truncated), validator).intact, true);

    const report = verify(truncated, checkpoint);
    assert.equal(report.outcome, "disagrees");
    assert.equal(report.chains[0]?.chain?.intact, true, "the chain itself is still intact");
    assert.deepEqual(kinds(report), ["tail-truncated"]);
    assert.match(report.chains[0]?.findings[0]?.message ?? "", /ends at sequence 2/);
  });

  test("a stale checkpoint still agrees, and the uncovered tail is a note", () => {
    const chain = buildChain([1, 2, 3]);
    const report = verify(chain, checkpointFor(chain[1] as Document, { eventCount: 2 }));

    assert.equal(report.outcome, "agrees");
    assert.deepEqual(
      report.chains[0]?.notes.map((note) => note.message),
      ["1 event after the checkpoint is not covered by it"],
    );
  });

  test("a head whose hash differs is a mismatch, and both hashes are shown", () => {
    const chain = buildChain([1, 2, 3]);
    const wrong = checkpointFor(chain[2] as Document, {
      head: { sequence: 3, hash: hashOf(chain[1] as Document) },
    });
    const report = verify(chain, wrong);

    assert.equal(report.outcome, "disagrees");
    assert.deepEqual(kinds(report), ["checkpoint-head-mismatch"]);
    const detail = report.chains[0]?.findings[0]?.detail?.join("\n") ?? "";
    assert.match(detail, new RegExp(hashOf(chain[1] as Document)));
    assert.match(detail, new RegExp(hashOf(chain[2] as Document)));
  });

  test("a recorded event count that the archive does not hold is a mismatch", () => {
    const chain = buildChain([1, 2, 3]);
    const report = verify(chain, checkpointFor(chain[2] as Document, { eventCount: 5 }));
    assert.equal(report.outcome, "disagrees");
    assert.deepEqual(kinds(report), ["checkpoint-count-mismatch"]);
  });

  test("a head the chain skips over is missing, not truncated", () => {
    const chain = buildChain([1, 2, 9]);
    const phantom = { ...(chain[1] as Document), sequence: 3 };
    const report = verify(chain, checkpointFor(sealEvent(phantom) as Document));

    assert.equal(report.chains[0]?.chain?.intact, true, "gaps are permitted");
    assert.deepEqual(kinds(report), ["checkpoint-head-missing"]);
    assert.match(report.chains[0]?.findings[0]?.message ?? "", /continues to sequence 9/);
  });

  test("a chain with no sequenced event cannot locate the head", () => {
    const [only] = buildChain([1]);
    const unsequenced = { ...(only as Document) };
    delete unsequenced["sequence"];
    const checkpoint = checkpointFor(only as Document);
    const report = verify([sealEvent(unsequenced) as Document], checkpoint);

    assert.equal(report.outcome, "disagrees");
    assert.deepEqual(kinds(report), ["checkpoint-head-missing"]);
    assert.match(
      report.chains[0]?.findings[0]?.message ?? "",
      /no event in the chain declares a sequence/,
    );
  });

  test("an event whose own signature fails under the supplied key breaks the archive", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const { publicKey: otherKey } = generateKeyPairSync("ed25519");
    const chain = buildChain([1, 2, 3]);
    const signed = structuredClone(chain[2] as Document);
    const value = cryptoSign(null, canonicalBytes(buildDigestInput(signed)), privateKey);
    (signed["integrity"] as Document)["signature"] = {
      algorithm: "Ed25519",
      value: value.toString("base64"),
    };
    const archive = [chain[0] as Document, chain[1] as Document, signed];
    const checkpoint = checkpointFor(signed);

    assert.equal(verify(archive, checkpoint).outcome, "agrees", "declared, not checked");
    const report = verify(archive, checkpoint, otherKey);
    assert.equal(report.outcome, "disagrees");
    assert.equal(report.chains[0]?.chain?.intact, false);
    assert.deepEqual(kinds(report), [], "the head itself matches");
  });

  test("a checkpoint under another algorithm cannot be compared", () => {
    const chain = buildChain([1, 2, 3]);
    const report = verify(chain, checkpointFor(chain[2] as Document, { hashAlgorithm: "SHA-512" }));
    assert.deepEqual(kinds(report), ["checkpoint-algorithm-mismatch"]);
  });

  test("a broken archive never agrees, even when the head matches", () => {
    const chain = buildChain([1, 2, 3]);
    ((chain[1] as Document)["resource"] as Document)["id"] = "record-tampered";
    const report = verify(chain, checkpointFor(chain[2] as Document));

    assert.equal(report.outcome, "disagrees");
    assert.equal(report.chains[0]?.status, "disagrees");
    assert.deepEqual(kinds(report), [], "the comparison itself found nothing");
    assert.deepEqual(
      report.chains[0]?.chain?.findings.map((finding) => finding.kind),
      ["hash-mismatch"],
    );
    assert.doesNotMatch(
      JSON.stringify(report),
      /record-tampered/,
      "no event content in the report",
    );
  });

  test("an archive holding none of the named chains yields no verdict", () => {
    const chain = buildChain([1, 2, 3]);
    const other = buildChain([1, 2], "chain-test-instance-2");
    const report = verify(other, checkpointFor(chain[2] as Document));

    assert.equal(report.outcome, "no-chain");
    assert.equal(report.chains[0]?.status, "missing");
    assert.deepEqual(kinds(report), ["checkpoint-chain-missing"]);
    assert.equal(report.archive?.chains.length, 1, "the archive was still verified");
  });

  test("the multi-chain form compares every chain it names", () => {
    const first = buildChain([1, 2, 3]);
    const second = buildChain([1, 2], "chain-test-instance-2");
    const manifest = {
      checkpointVersion: "0.1",
      hashAlgorithm: "SHA-256",
      canonicalization: "RFC8785",
      chains: [
        {
          chainId: CHAIN_ID,
          head: { sequence: 3, hash: hashOf(first[2] as Document) },
          eventCount: 3,
        },
        {
          chainId: "chain-test-instance-2",
          head: { sequence: 2, hash: hashOf(second[1] as Document) },
        },
      ],
      createdAt: "2026-04-03T10:00:00Z",
      anchor: { type: "publication", reference: "https://archive.example/heads/2026-04-03" },
      description: "both chains",
    };

    const both = verify([...first, ...second], manifest);
    assert.equal(both.outcome, "agrees");
    assert.deepEqual(
      both.chains.map((entry) => entry.status),
      ["agrees", "agrees"],
    );
    assert.equal(both.description, "both chains");

    const one = verify(first, manifest);
    assert.equal(one.outcome, "disagrees", "one named chain present, one absent");
    assert.deepEqual(
      one.chains.map((entry) => entry.status),
      ["agrees", "missing"],
    );
  });

  test("a document that is not a checkpoint judges nothing", () => {
    const chain = buildChain([1, 2, 3]);
    const report = verify(chain, { checkpointVersion: "0.1" });

    assert.equal(report.outcome, "invalid-checkpoint");
    assert.deepEqual(
      report.findings.map((finding) => finding.kind),
      ["checkpoint-schema-invalid"],
    );
    assert.equal(report.archive, undefined);
    assert.deepEqual(report.chains, []);
  });
});

describe("a checkpoint's own signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const { publicKey: otherKey } = generateKeyPairSync("ed25519");
  const chain = buildChain([1, 2, 3]);
  const signed = signWith(checkpointFor(chain[2] as Document, { eventCount: 3 }), privateKey);

  test("verifies with the matching key", () => {
    const report = verify(chain, signed, publicKey);
    assert.equal(report.outcome, "agrees");
    assert.equal(report.signature?.status, "valid");
    assert.ok(report.checks.some((check) => check.message === "signature valid (Ed25519)"));
  });

  test("is declared but not checked without a key, and the verdict rests on the comparison", () => {
    const report = verify(chain, signed);
    assert.equal(report.outcome, "agrees");
    assert.equal(report.signature?.status, "not-checked");
  });

  test("fails with another key, and the failure is the verdict", () => {
    const report = verify(chain, signed, otherKey);
    assert.equal(report.outcome, "disagrees");
    assert.equal(report.signature?.status, "invalid");
    assert.deepEqual(
      report.findings.map((finding) => `${finding.kind}@${finding.label}`),
      ["signature-invalid@checkpoint"],
    );
    assert.equal(report.chains[0]?.status, "agrees", "the archive itself still agrees");
  });

  test("covers every member of the document: a changed count after signing breaks it", () => {
    const edited = { ...signed, eventCount: 2 };
    const report = verify(chain, edited, publicKey);
    assert.equal(report.signature?.status, "invalid");
    assert.equal(report.outcome, "disagrees");
  });

  test("an algorithm this verifier does not implement fails with or without a key", () => {
    const foreign = {
      ...checkpointFor(chain[2] as Document),
      signature: { algorithm: "ECDSA-P384-SHA384", value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    };
    for (const key of [undefined, publicKey]) {
      const report = verify(chain, foreign, key);
      assert.equal(report.outcome, "disagrees");
      assert.deepEqual(
        report.findings.map((finding) => finding.kind),
        ["unsupported-signature-algorithm"],
      );
    }
  });

  test("the published checkpoint verifies with the published test key", () => {
    const pem = readFileSync(path.join(integrityRoot, "keys", "ed25519-test-public.pem"), "utf8");
    const report = verify(
      loadDirectory("valid", "three-event-chain"),
      loadCheckpoint("three-event-chain.checkpoint.json"),
      createPublicKey(pem),
    );
    assert.equal(report.outcome, "agrees");
    assert.equal(report.signature?.status, "valid");
  });
});

describe("the published checkpoint fixtures", () => {
  const full = loadDirectory("valid", "three-event-chain");

  test("the truncated chain passes verify-chain and fails the checkpoint", () => {
    const truncated = loadDirectory("invalid", "truncated-chain");
    assert.equal(verifyChains(inputs(truncated), validator).intact, true);

    const report = verify(truncated, loadCheckpoint("three-event-chain.checkpoint.json"));
    assert.equal(report.outcome, "disagrees");
    assert.deepEqual(kinds(report), ["tail-truncated"]);
  });

  test("each document does what its name says", () => {
    assert.equal(
      verify(full, loadCheckpoint("three-event-chain.checkpoint.json")).outcome,
      "agrees",
    );
    assert.equal(
      verify(full, loadCheckpoint("three-event-chain.stale.checkpoint.json")).outcome,
      "agrees",
    );
    assert.deepEqual(
      kinds(verify(full, loadCheckpoint("three-event-chain.wrong-head.checkpoint.json"))),
      ["checkpoint-head-mismatch"],
    );
    assert.equal(
      verify(full, loadCheckpoint("three-event-chain.unanchored.checkpoint.json")).outcome,
      "invalid-checkpoint",
    );
    assert.equal(
      verify(
        loadDirectory("valid", "chain-in-two-batches"),
        loadCheckpoint("three-event-chain.checkpoint.json"),
      ).outcome,
      "no-chain",
    );
  });

  test("the archive checkpoint agrees with both chains together and not with one alone", () => {
    const batched = loadDirectory("valid", "chain-in-two-batches");
    const archive = loadCheckpoint("archive.checkpoint.json");
    assert.equal(verify([...full, ...batched], archive).outcome, "agrees");
    assert.equal(verify(full, archive).outcome, "disagrees");
  });
});
