/**
 * Event digest calculation and single-event verification.
 *
 * The normative procedure these tests pin down is specified in
 * specification/integrity.md §4.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { createValidator, resolveSchemaPath } from "../src/validate.js";
import {
  buildDigestInput,
  calculateDigest,
  canonicalDigestInput,
  digestsEqual,
  isHexDigest,
  isSupportedHashAlgorithm,
  sealEvent,
} from "../src/integrity/digest.js";
import { verifyEventIntegrity } from "../src/integrity/verify-event.js";
import { SUPPORTED_HASH_ALGORITHMS } from "../src/integrity/types.js";
import { checkFixtures } from "../tools/generate-integrity-fixtures.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const integrityValid = path.join(repoRoot, "examples", "integrity", "valid");
const integrityInvalid = path.join(repoRoot, "examples", "integrity", "invalid");
const validator = createValidator(schemaPath);

type Event = Record<string, unknown>;

/** A minimal sealable event. Each call returns a fresh object. */
function baseEvent(algorithm = "SHA-256"): Event {
  return {
    specVersion: "0.1",
    id: "018f2a10-4c21-7b83-9e05-1d2f3a4b5c60",
    time: "2026-04-02T13:20:44.117Z",
    event: { name: "data.record.update", category: "data-modification", outcome: "success" },
    actor: { type: "user", id: "user-123" },
    resource: { type: "record", id: "resource-123" },
    application: { name: "application-service", environment: "production" },
    integrity: { canonicalization: "RFC8785", hashAlgorithm: algorithm, hash: "" },
  };
}

function integrityOf(event: Event): Event {
  return event["integrity"] as Event;
}

function readFixture(...segments: string[]): Event {
  return JSON.parse(readFileSync(path.join(...segments), "utf8")) as Event;
}

function kinds(event: unknown, label = "event"): string[] {
  return verifyEventIntegrity(event, label, validator).findings.map((finding) => finding.kind);
}

describe("fixture reproducibility", () => {
  test("every integrity fixture matches the generator", () => {
    assert.deepEqual(
      checkFixtures(),
      [],
      'integrity fixtures drifted; run "npm run fixtures:integrity"',
    );
  });
});

describe("digest input", () => {
  test("the source event is never mutated", () => {
    const event = sealEvent(baseEvent());
    const before = JSON.stringify(event);
    buildDigestInput(event);
    calculateDigest(event, "SHA-256");
    assert.equal(JSON.stringify(event), before);
  });

  test("/integrity/hash is excluded from its own digest", () => {
    const event = sealEvent(baseEvent());
    const altered = structuredClone(event);
    integrityOf(altered)["hash"] = "f".repeat(64);
    assert.equal(canonicalDigestInput(altered), canonicalDigestInput(event));
    assert.equal(calculateDigest(altered, "SHA-256"), calculateDigest(event, "SHA-256"));
  });

  test("/integrity/signature is excluded from the digest", () => {
    const event = sealEvent(baseEvent());
    const signed = structuredClone(event);
    integrityOf(signed)["signature"] = {
      algorithm: "Ed25519",
      value: "3045022100c0ffee1234567890",
      keyId: "key-2026-04",
    };
    assert.equal(calculateDigest(signed, "SHA-256"), calculateDigest(event, "SHA-256"));
  });

  test("an integrity object emptied by the exclusions is retained as an empty object", () => {
    const event = { ...baseEvent(), integrity: { hash: "a".repeat(64) } };
    assert.match(canonicalDigestInput(event), /"integrity":\{\}/);
  });

  const includedFields: ReadonlyArray<readonly [string, (event: Event) => void]> = [
    ["sequence", (event) => void (event["sequence"] = 7)],
    [
      "integrity.previousHash",
      (event) => void (integrityOf(event)["previousHash"] = "b".repeat(64)),
    ],
    ["integrity.chainId", (event) => void (integrityOf(event)["chainId"] = "chain-2")],
    ["integrity.batchId", (event) => void (integrityOf(event)["batchId"] = "batch-2")],
    ["integrity.hashAlgorithm", (event) => void (integrityOf(event)["hashAlgorithm"] = "SHA-512")],
    [
      "integrity.canonicalization",
      (event) => void (integrityOf(event)["canonicalization"] = "OTHER"),
    ],
    ["observedTime", (event) => void (event["observedTime"] = "2026-04-02T13:25:00Z")],
    ["actor.id", (event) => void ((event["actor"] as Event)["id"] = "user-999")],
  ];

  for (const [field, mutate] of includedFields) {
    test(`${field} is part of the digest input`, () => {
      const original = baseEvent();
      const changed = baseEvent();
      mutate(changed);
      assert.notEqual(
        calculateDigest(changed, "SHA-256"),
        calculateDigest(original, "SHA-256"),
        `changing ${field} must change the digest`,
      );
    });
  }

  test("chain metadata cannot be altered without invalidating the event hash", () => {
    const event = sealEvent({
      ...baseEvent(),
      sequence: 2,
      integrity: {
        canonicalization: "RFC8785",
        hashAlgorithm: "SHA-256",
        hash: "",
        previousHash: "c".repeat(64),
        chainId: "chain-1",
      },
    });
    assert.equal(verifyEventIntegrity(event, "event", validator).verified, true);

    const relinked = structuredClone(event);
    integrityOf(relinked)["previousHash"] = "d".repeat(64);
    assert.deepEqual(kinds(relinked), ["hash-mismatch"]);
  });

  test("key order in the stored event does not affect the digest", () => {
    const event = sealEvent(baseEvent());
    const reordered = JSON.parse(
      JSON.stringify({
        integrity: event["integrity"],
        application: event["application"],
        resource: event["resource"],
        actor: event["actor"],
        event: event["event"],
        time: event["time"],
        id: event["id"],
        specVersion: event["specVersion"],
      }),
    ) as Event;
    assert.equal(calculateDigest(reordered, "SHA-256"), calculateDigest(event, "SHA-256"));
  });
});

describe("hash algorithms", () => {
  const expectedLengths: Readonly<Record<string, number>> = {
    "SHA-256": 64,
    "SHA-384": 96,
    "SHA-512": 128,
  };

  for (const algorithm of SUPPORTED_HASH_ALGORITHMS) {
    test(`${algorithm} seals and verifies`, () => {
      const event = sealEvent(baseEvent(algorithm));
      const declared = integrityOf(event)["hash"] as string;

      assert.equal(declared.length, expectedLengths[algorithm]);
      assert.equal(isHexDigest(declared), true);
      assert.equal(verifyEventIntegrity(event, "event", validator).verified, true);
    });

    test(`${algorithm} detects a modified event`, () => {
      const event = sealEvent(baseEvent(algorithm));
      (event["resource"] as Event)["id"] = "resource-999";
      assert.deepEqual(kinds(event), ["hash-mismatch"]);
    });
  }

  test("the three algorithms produce different digests for the same event", () => {
    const digests = new Set(
      SUPPORTED_HASH_ALGORITHMS.map((algorithm) => calculateDigest(baseEvent(), algorithm)),
    );
    assert.equal(digests.size, SUPPORTED_HASH_ALGORITHMS.length);
  });

  test("algorithm identifiers are matched case-sensitively", () => {
    assert.equal(isSupportedHashAlgorithm("SHA-256"), true);
    for (const identifier of ["sha-256", "SHA256", "sha256", "BLAKE3", "MD5"]) {
      assert.equal(isSupportedHashAlgorithm(identifier), false, identifier);
    }
  });

  test("calculating a digest with an unimplemented algorithm throws", () => {
    assert.throws(() => calculateDigest(baseEvent(), "BLAKE3"), /unsupported hash algorithm/);
  });
});

describe("digest comparison", () => {
  test("identical digests compare equal", () => {
    const digest = calculateDigest(baseEvent(), "SHA-256");
    assert.equal(digestsEqual(digest, digest), true);
  });

  test("differing digests compare unequal", () => {
    assert.equal(digestsEqual("a".repeat(64), "b".repeat(64)), false);
  });

  test("digests of different lengths compare unequal rather than throwing", () => {
    assert.equal(digestsEqual("a".repeat(64), "a".repeat(128)), false);
  });

  test("malformed encodings are rejected, never reinterpreted", () => {
    assert.equal(digestsEqual("A".repeat(64), "a".repeat(64)), false);
    assert.equal(digestsEqual("zz", "zz"), false);
    assert.equal(digestsEqual("abc", "abc"), false);
    assert.equal(isHexDigest("A".repeat(64)), false);
    assert.equal(isHexDigest("abc"), false);
    assert.equal(isHexDigest(""), false);
  });
});

describe("single event verification", () => {
  test("a sealed event verifies and reports what it proved", () => {
    const result = verifyEventIntegrity(sealEvent(baseEvent()), "event", validator);
    assert.equal(result.verified, true);
    assert.deepEqual(
      result.checks.map((check) => check.message),
      [
        "schema valid",
        "canonicalization: RFC8785",
        "hash algorithm: SHA-256",
        "integrity hash valid",
      ],
    );
  });

  test("an event without an integrity object cannot be verified", () => {
    const event = baseEvent();
    delete event["integrity"];
    assert.deepEqual(kinds(event), ["integrity-missing"]);
  });

  test("a schema-invalid event is rejected before any digest work", () => {
    const event = sealEvent(baseEvent());
    delete event["actor"];
    assert.deepEqual(kinds(event), ["schema-invalid"]);
  });

  test("an unimplemented algorithm is reported, not treated as verified", () => {
    const event = sealEvent(baseEvent());
    integrityOf(event)["hashAlgorithm"] = "BLAKE3";
    assert.deepEqual(kinds(event), ["unsupported-algorithm"]);
  });

  test("an unimplemented canonicalization is reported", () => {
    const event = sealEvent(baseEvent());
    integrityOf(event)["canonicalization"] = "JCS";
    assert.deepEqual(kinds(event), ["unsupported-canonicalization"]);
  });

  test("a hash whose length disagrees with the algorithm is reported", () => {
    const event = sealEvent(baseEvent());
    integrityOf(event)["hash"] = "a".repeat(128);
    assert.deepEqual(kinds(event), ["digest-length-mismatch"]);
  });

  test("a hash that is not lowercase hexadecimal is reported when the schema is bypassed", () => {
    const event = sealEvent(baseEvent());
    integrityOf(event)["hash"] = "A".repeat(64);
    const result = verifyEventIntegrity(event, "event", validator, { validateSchema: false });
    assert.deepEqual(
      result.findings.map((finding) => finding.kind),
      ["malformed-hash"],
    );
  });

  test("a hash that is not lowercase hexadecimal is rejected by the schema", () => {
    const event = sealEvent(baseEvent());
    integrityOf(event)["hash"] = "A".repeat(64);
    assert.deepEqual(kinds(event), ["schema-invalid"]);
  });

  test("a failure report never contains event content", () => {
    const event = sealEvent({
      ...baseEvent(),
      metadata: { customerReference: "extremely-distinctive-value" },
    });
    (event["metadata"] as Event)["customerReference"] = "extremely-distinctive-value-changed";

    const result = verifyEventIntegrity(event, "event", validator);
    const rendered = JSON.stringify(result.findings);
    assert.equal(result.verified, false);
    assert.doesNotMatch(rendered, /extremely-distinctive-value/);
  });
});

describe("published integrity fixtures", () => {
  test("every valid fixture verifies", () => {
    const files = [
      path.join(integrityValid, "single-event-sha256.json"),
      path.join(integrityValid, "unicode-and-number-event.json"),
      ...readdirSync(path.join(integrityValid, "three-event-chain")).map((entry) =>
        path.join(integrityValid, "three-event-chain", entry),
      ),
    ];

    for (const file of files) {
      const result = verifyEventIntegrity(readFixture(file), path.basename(file), validator);
      assert.equal(result.verified, true, `${file}: ${JSON.stringify(result.findings)}`);
    }
  });

  test("the unicode and number fixture round-trips through canonicalization", () => {
    const event = readFixture(integrityValid, "unicode-and-number-event.json");
    const canonical = canonicalDigestInput(event);
    // Sorted keys, non-ASCII emitted literally, ECMAScript number forms.
    assert.match(canonical, /"10":.*"9":/s);
    assert.match(canonical, /日本語/);
    assert.match(canonical, /1e\+21/);
    assert.match(canonical, /1e-7/);
    assert.equal(verifyEventIntegrity(event, "unicode", validator).verified, true);
  });

  test("tampered-event.json fails because its content changed after sealing", () => {
    assert.deepEqual(kinds(readFixture(integrityInvalid, "tampered-event.json")), [
      "hash-mismatch",
    ]);
  });

  test("wrong-declared-hash.json fails because the declared digest is not its own", () => {
    assert.deepEqual(kinds(readFixture(integrityInvalid, "wrong-declared-hash.json")), [
      "hash-mismatch",
    ]);
  });

  test("unsupported-algorithm.json is refused before any comparison", () => {
    assert.deepEqual(kinds(readFixture(integrityInvalid, "unsupported-algorithm.json")), [
      "unsupported-algorithm",
    ]);
  });
});

describe("published examples", () => {
  test("every example that declares an integrity hash verifies", () => {
    const exampleDir = path.join(repoRoot, "examples", "valid");
    let checked = 0;

    for (const entry of readdirSync(exampleDir).filter((file) => file.endsWith(".json"))) {
      const event = readFixture(exampleDir, entry);
      const integrity = event["integrity"] as Event | undefined;
      if (integrity?.["hash"] === undefined) {
        continue;
      }
      checked += 1;
      const result = verifyEventIntegrity(event, entry, validator);
      assert.equal(result.verified, true, `${entry}: ${JSON.stringify(result.findings)}`);
    }

    assert.ok(checked > 0, "expected at least one published example to carry an integrity hash");
  });

  test("an example without integrity is still a conforming event", () => {
    const event = readFixture(repoRoot, "examples", "valid", "minimal-event.json");
    assert.deepEqual(validator.validateEvent(event), []);
    assert.deepEqual(kinds(event), ["integrity-missing"]);
  });
});
