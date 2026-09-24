/**
 * Event digest calculation and single-event verification.
 *
 * The normative procedure these tests pin down is specified in
 * specification/integrity.md §4.
 */
import assert from "node:assert/strict";
import {
  constants as cryptoConstants,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
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
import { canonicalBytes } from "../src/integrity/canonicalize.js";
import { verifyEventIntegrity } from "../src/integrity/verify-event.js";
import {
  isSmallOrderEd25519Point,
  isSupportedSignatureAlgorithm,
  loadPublicKey,
  UnusablePublicKeyError,
  verifyEventSignature,
} from "../src/integrity/signature.js";
import { SUPPORTED_HASH_ALGORITHMS } from "../src/integrity/types.js";
import { checkFixtures } from "../tools/generate-integrity-fixtures.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const integrityValid = path.join(repoRoot, "examples", "integrity", "valid");
const integrityInvalid = path.join(repoRoot, "examples", "integrity", "invalid");
const integrityKeys = path.join(repoRoot, "examples", "integrity", "keys");
const validator = createValidator(schemaPath);
const testPublicKey = loadPublicKey(
  readFileSync(path.join(integrityKeys, "ed25519-test-public.pem"), "utf8"),
);

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

describe("signatures", () => {
  const { publicKey: keyA, privateKey: keyAPrivate } = generateKeyPairSync("ed25519");
  const { publicKey: keyB } = generateKeyPairSync("ed25519");

  /** Signs `event`'s digest input with `keyAPrivate`, base64-encoded. */
  function signWithKeyA(event: unknown): string {
    return cryptoSign(null, canonicalBytes(buildDigestInput(event)), keyAPrivate).toString(
      "base64",
    );
  }

  function withSignature(event: Event, signature: Event): Event {
    return { ...event, integrity: { ...integrityOf(event), signature } };
  }

  test("algorithm identifiers are matched case-sensitively", () => {
    assert.equal(isSupportedSignatureAlgorithm("Ed25519"), true);
    for (const identifier of [
      "ed25519",
      "ED25519",
      "EdDSA",
      "ECDSA-P384-SHA384",
      "rsa-pss-sha256",
    ]) {
      assert.equal(isSupportedSignatureAlgorithm(identifier), false, identifier);
    }
  });

  test("loadPublicKey refuses a private key by name, and never repeats it", () => {
    // Node would derive the public half and the verdict would be right, but a
    // private key where a public one belongs is a mistake to say out loud —
    // and on the MCP server it has just crossed the network.
    for (const privatePem of [
      keyAPrivate.export({ type: "pkcs8", format: "pem" }) as string,
      "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----\n",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n",
      "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF\n-----END ENCRYPTED PRIVATE KEY-----\n",
    ]) {
      assert.throws(
        () => loadPublicKey(privatePem),
        (error: Error) =>
          /this is a private key/.test(error.message) && !error.message.includes("MI"),
      );
    }
  });

  test("loadPublicKey rejects unreadable text", () => {
    assert.throws(() => loadPublicKey("not a key"), /not a readable public key/);
  });

  test("loadPublicKey refuses a private key whatever the case of its label", () => {
    // OpenSSL reads `-----BEGIN rsa PRIVATE KEY-----` as a private key too.
    const { privateKey: ecPrivate } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = ecPrivate.export({ type: "sec1", format: "pem" }) as string;
    for (const label of ["ec PRIVATE KEY", "Ec PRIVATE KEY", "ec private key"]) {
      const relabelled = pem.replaceAll("EC PRIVATE KEY", label);
      assert.throws(() => loadPublicKey(relabelled), /this is a private key/, label);
    }
  });

  test("an EC key at the point at infinity is refused, and does not end the process", () => {
    // Where OpenSSL parses it, reading its details aborts the process with a
    // native assertion, so nothing may read them before it is refused. An
    // OpenSSL that refuses the point itself leaves nothing to test past that.
    const infinity =
      "-----BEGIN PUBLIC KEY-----\nMBkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDAgAA\n-----END PUBLIC KEY-----\n";
    let key: KeyObject;
    try {
      key = createPublicKey(infinity);
    } catch {
      assert.throws(() => loadPublicKey(infinity));
      return;
    }
    assert.throws(
      () => loadPublicKey(infinity),
      (error: Error) =>
        error instanceof UnusablePublicKeyError && /EC public key/.test(error.message),
    );
    const event = sealEvent(baseEvent());
    const result = verifyEventSignature(event, "ECDSA-P256-SHA256", "AAAA", key);
    assert.equal(!result.ok && result.kind, "signature-invalid");
  });

  test("an RSA key with an exponent of 1 is refused", () => {
    // Under e = 1 a "signature" is the encoded message itself: anyone can make
    // one. The modulus is a real one; only the exponent is replaced. An
    // OpenSSL that refuses to build such a key leaves nothing to test.
    const { publicKey: rsa } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = rsa.export({ format: "jwk" });
    let weak: KeyObject;
    try {
      weak = createPublicKey({ key: { ...jwk, e: "AQ" }, format: "jwk" });
    } catch {
      return;
    }
    assert.equal(weak.asymmetricKeyDetails?.publicExponent, 1n);
    assert.throws(
      () => loadPublicKey(weak.export({ type: "spki", format: "pem" }) as string),
      (error: Error) => error instanceof UnusablePublicKeyError && /exponent/.test(error.message),
    );
    const event = sealEvent(baseEvent());
    const value = Buffer.alloc(256, 1).toString("base64");
    const result = verifyEventSignature(event, "RSA-PSS-SHA256", value, weak);
    assert.equal(!result.ok && result.kind, "signature-invalid");
    assert.match(!result.ok ? result.message : "", /exponent/);
  });

  describe("small-order Ed25519 points", () => {
    const p = 2n ** 255n - 19n;
    const order = 2n ** 252n + 27742317777372353535851937790883648493n;
    const IDENTITY = Buffer.from(`01${"00".repeat(31)}`, "hex");

    /** An Ed25519 SubjectPublicKeyInfo around a raw 32-byte point, parsed without checks. */
    function rawEd25519Key(point: Uint8Array): KeyObject {
      const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), point]);
      return createPublicKey({ key: der, format: "der", type: "spki" });
    }

    function pem(key: KeyObject): string {
      return key.export({ type: "spki", format: "pem" }) as string;
    }

    function littleEndian(bytes: Uint8Array): bigint {
      return BigInt(`0x${Buffer.from(bytes).reverse().toString("hex") || "0"}`);
    }

    function toLittleEndian(value: bigint): Buffer {
      return Buffer.from(value.toString(16).padStart(64, "0"), "hex").reverse();
    }

    // The encodings are y-coordinates, sign bit cleared. Each is checked here
    // against the curve itself rather than against the list it came from:
    // y = 0, 1 and p - 1 (and the non-canonical p, p + 1) are the points of
    // order 4, 1 and 2; the two others satisfy the order-8 condition that
    // doubling them lands on y = 0.
    test("every refused encoding is a point of order dividing 8", () => {
      const d = (-121665n * modPow(121666n, p - 2n, p)) % p;
      const mod = (value: bigint) => ((value % p) + p) % p;
      const doubledY = (y: bigint) => {
        // On -x² + y² = 1 + d·x²·y², x² = (y² − 1) / (d·y² + 1), and the
        // y-coordinate of 2P is (y² + x²) / (2 − y² + x²).
        const x2 = mod((y * y - 1n) * modPow(mod(d * y * y + 1n), p - 2n, p));
        return mod((y * y + x2) * modPow(mod(2n - y * y + x2), p - 2n, p));
      };
      const orderEight = [
        "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
        "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
      ];
      for (const hex of orderEight) {
        const y = littleEndian(Buffer.from(hex, "hex"));
        assert.equal(doubledY(doubledY(y)), p - 1n, `${hex}: 4P is the point of order 2`);
        assert.equal(isSmallOrderEd25519Point(Buffer.from(hex, "hex")), true, hex);
      }
      for (const y of [0n, 1n, p - 1n, p, p + 1n]) {
        const encoded = toLittleEndian(y);
        assert.equal(isSmallOrderEd25519Point(encoded), true, y.toString());
        const negative = Buffer.from(encoded);
        negative[31] = (negative[31] as number) | 0x80;
        assert.equal(isSmallOrderEd25519Point(negative), true, `-${y.toString()}`);
      }
      assert.equal(isSmallOrderEd25519Point(toLittleEndian(2n)), false);
    });

    function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
      let result = 1n;
      let b = base % modulus;
      let e = exponent;
      while (e > 0n) {
        if (e & 1n) result = (result * b) % modulus;
        b = (b * b) % modulus;
        e >>= 1n;
      }
      return result;
    }

    test("loadPublicKey refuses a small-order key", () => {
      assert.throws(
        () => loadPublicKey(pem(rawEd25519Key(IDENTITY))),
        (error: Error) =>
          error instanceof UnusablePublicKeyError && /small-order point/.test(error.message),
      );
    });

    test("under the identity point, R = identity and S = 0 is refused", () => {
      const event = sealEvent(baseEvent());
      const key = rawEd25519Key(IDENTITY);
      const forged = Buffer.concat([IDENTITY, Buffer.alloc(32)]);
      // The verification equation holds for any message. Whether the primitive
      // alone accepts it depends on the OpenSSL build — the one this project's
      // Docker toolchain carries does, the CI runner's does not — so the
      // verifier refuses it before the primitive is asked.

      const result = verifyEventSignature(event, "Ed25519", forged.toString("base64"), key);
      assert.equal(!result.ok && result.kind, "signature-invalid");
      assert.match(!result.ok ? result.message : "", /small-order point/);
    });

    test("under a genuine key, a signature whose R is the identity is refused", () => {
      const event = sealEvent(baseEvent());
      const message = canonicalBytes(buildDigestInput(event));
      // R = identity is a nonce of zero, so S = H(R ‖ A ‖ M)·a: a signature
      // only the key's holder can make, and one no honest signer does.
      const seed = Buffer.from(keyAPrivate.export({ format: "jwk" }).d as string, "base64url");
      const expanded = createHash("sha512").update(seed).digest();
      const scalar = Buffer.from(expanded.subarray(0, 32));
      scalar[0] = (scalar[0] as number) & 248;
      scalar[31] = ((scalar[31] as number) & 127) | 64;
      const publicPoint = Buffer.from(keyA.export({ format: "jwk" }).x as string, "base64url");
      const k =
        littleEndian(
          createHash("sha512").update(IDENTITY).update(publicPoint).update(message).digest(),
        ) % order;
      const s = (k * littleEndian(scalar)) % order;
      const signature = Buffer.concat([IDENTITY, toLittleEndian(s)]);
      // As above, whether the primitive alone accepts it depends on the build.

      const result = verifyEventSignature(event, "Ed25519", signature.toString("base64"), keyA);
      assert.equal(!result.ok && result.kind, "signature-invalid");
      assert.match(!result.ok ? result.message : "", /R is a small-order point/);
    });
  });

  describe("verifyEventSignature", () => {
    test("a genuine signature over the event's digest input verifies", () => {
      const event = sealEvent(baseEvent());
      const value = signWithKeyA(event);
      assert.deepEqual(verifyEventSignature(event, "Ed25519", value, keyA), { ok: true });
    });

    test("a signature over different content does not verify", () => {
      const event = sealEvent(baseEvent());
      const value = signWithKeyA(event);
      const changed = structuredClone(event);
      (changed["resource"] as Event)["id"] = "resource-999";
      const result = verifyEventSignature(changed, "Ed25519", value, keyA);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.kind, "signature-invalid");
    });

    test("a signature verified against the wrong public key does not verify", () => {
      const event = sealEvent(baseEvent());
      const value = signWithKeyA(event);
      const result = verifyEventSignature(event, "Ed25519", value, keyB);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.kind, "signature-invalid");
    });

    test("an unimplemented algorithm is refused before any key material is touched", () => {
      const event = sealEvent(baseEvent());
      const result = verifyEventSignature(event, "ECDSA-P384-SHA384", "not-checked", keyA);
      assert.deepEqual(result, {
        ok: false,
        kind: "unsupported-signature-algorithm",
        message: 'signature algorithm "ECDSA-P384-SHA384" is not implemented by this verifier',
      });
    });

    test("a value that is not base64 is reported as malformed, never as invalid", () => {
      const event = sealEvent(baseEvent());
      const result = verifyEventSignature(event, "Ed25519", "not base64! ##", keyA);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.kind, "malformed-signature");
    });

    test("a value of the wrong byte length is reported as malformed", () => {
      const event = sealEvent(baseEvent());
      const short = Buffer.from("too short").toString("base64");
      const result = verifyEventSignature(event, "Ed25519", short, keyA);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.kind, "malformed-signature");
    });

    test("a key of the wrong type is rejected rather than throwing", () => {
      const event = sealEvent(baseEvent());
      const { publicKey: rsaKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const value = signWithKeyA(event);
      const result = verifyEventSignature(event, "Ed25519", value, rsaKey as unknown as KeyObject);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.kind, "signature-invalid");
    });
  });

  describe("verifyEventIntegrity with publicKey", () => {
    test("without a public key, a declared signature is reported as not checked", () => {
      const event = sealEvent(baseEvent());
      const signed = withSignature(event, {
        algorithm: "Ed25519",
        value: signWithKeyA(event),
        keyId: "test-key-a",
      });
      const result = verifyEventIntegrity(signed, "event", validator);
      // The hash was verified, so the verdict stands — but the declared
      // signature is named as unchecked, so silence never reads as a check.
      assert.equal(result.verified, true);
      assert.deepEqual(
        result.checks.map((check) => check.message),
        [
          "schema valid",
          "canonicalization: RFC8785",
          "hash algorithm: SHA-256",
          "integrity hash valid",
          "signature declared (Ed25519), not checked: no public key was supplied",
        ],
      );
    });

    test("without a public key, an unimplemented signature algorithm still fails verification", () => {
      const event = sealEvent(baseEvent());
      const signed = withSignature(event, {
        algorithm: "ECDSA-P384-SHA384",
        value: signWithKeyA(event),
        keyId: "test-key-a",
      });
      const result = verifyEventIntegrity(signed, "event", validator);
      // This verifier can never check this signature, key or no key. Reporting
      // the event as verified would let the signature's presence stand in for
      // a check that cannot happen (specification/integrity.md §6.1).
      assert.equal(result.verified, false);
      assert.deepEqual(
        result.findings.map((finding) => finding.kind),
        ["unsupported-signature-algorithm"],
      );
    });

    test("with a public key, a genuine signature is verified and reported", () => {
      const event = sealEvent(baseEvent());
      const signed = withSignature(event, {
        algorithm: "Ed25519",
        value: signWithKeyA(event),
        keyId: "test-key-a",
      });
      const result = verifyEventIntegrity(signed, "event", validator, { publicKey: keyA });
      assert.equal(result.verified, true);
      assert.deepEqual(
        result.checks.map((check) => check.message).at(-1),
        "signature valid (Ed25519)",
      );
    });

    test("with the wrong public key, verification fails on the signature alone", () => {
      const event = sealEvent(baseEvent());
      const signed = withSignature(event, {
        algorithm: "Ed25519",
        value: signWithKeyA(event),
        keyId: "test-key-a",
      });
      const result = verifyEventIntegrity(signed, "event", validator, { publicKey: keyB });
      assert.equal(result.verified, false);
      assert.deepEqual(
        result.findings.map((finding) => finding.kind),
        ["signature-invalid"],
      );
      // The hash was already proven valid; the signature is the only thing that failed.
      assert.ok(result.checks.some((check) => check.message === "integrity hash valid"));
    });

    test("a bad hash is still reported first, before the signature is ever checked", () => {
      const event = sealEvent(baseEvent());
      const signed = withSignature(event, {
        algorithm: "Ed25519",
        value: signWithKeyA(event),
        keyId: "test-key-a",
      });
      integrityOf(signed)["hash"] = "f".repeat(64);
      const result = verifyEventIntegrity(signed, "event", validator, { publicKey: keyB });
      assert.deepEqual(
        result.findings.map((finding) => finding.kind),
        ["hash-mismatch"],
      );
    });
  });
});

describe("published integrity fixtures", () => {
  test("every valid fixture verifies", () => {
    const files = [
      path.join(integrityValid, "single-event-sha256.json"),
      path.join(integrityValid, "unicode-and-number-event.json"),
      ...["three-event-chain", "chain-in-two-batches"].flatMap((directory) =>
        readdirSync(path.join(integrityValid, directory)).map((entry) =>
          path.join(integrityValid, directory, entry),
        ),
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

  test("signed-event-ed25519.json verifies its hash without a key, and its signature with one", () => {
    const event = readFixture(integrityValid, "signed-event-ed25519.json");

    const withoutKey = verifyEventIntegrity(event, "signed", validator);
    assert.equal(withoutKey.verified, true);
    assert.ok(!withoutKey.checks.some((check) => check.message.startsWith("signature valid")));

    const withKey = verifyEventIntegrity(event, "signed", validator, { publicKey: testPublicKey });
    assert.equal(withKey.verified, true);
    assert.ok(withKey.checks.some((check) => check.message === "signature valid (Ed25519)"));
  });

  test("tampered-signed-event.json fails on the hash before the signature is reached", () => {
    const event = readFixture(integrityInvalid, "tampered-signed-event.json");
    assert.deepEqual(
      verifyEventIntegrity(event, "signed", validator, { publicKey: testPublicKey }).findings.map(
        (finding) => finding.kind,
      ),
      ["hash-mismatch"],
    );
  });

  test("unsupported-signature-algorithm.json is refused once a key is supplied to check it", () => {
    const event = readFixture(integrityInvalid, "unsupported-signature-algorithm.json");
    assert.deepEqual(
      verifyEventIntegrity(event, "signed", validator, { publicKey: testPublicKey }).findings.map(
        (finding) => finding.kind,
      ),
      ["unsupported-signature-algorithm"],
    );
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

describe("the algorithms added in 0.5.0", () => {
  const ecdsa = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ecdsaP384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaSmall = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const ed = generateKeyPairSync("ed25519");

  function ecdsaSign(event: unknown): string {
    return cryptoSign("sha256", canonicalBytes(buildDigestInput(event)), {
      key: ecdsa.privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64");
  }
  function rsaSign(event: unknown, key: KeyObject = rsa.privateKey): string {
    return cryptoSign("sha256", canonicalBytes(buildDigestInput(event)), {
      key,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }).toString("base64");
  }

  test("ECDSA-P256-SHA256 verifies with a P-256 key and an IEEE P1363 signature", () => {
    const event = sealEvent(baseEvent());
    assert.deepEqual(
      verifyEventSignature(event, "ECDSA-P256-SHA256", ecdsaSign(event), ecdsa.publicKey),
      { ok: true },
    );
  });

  test("ECDSA-P256-SHA256 refuses a key on another curve before verifying", () => {
    const event = sealEvent(baseEvent());
    const result = verifyEventSignature(
      event,
      "ECDSA-P256-SHA256",
      ecdsaSign(event),
      ecdsaP384.publicKey,
    );
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.kind, "signature-invalid");
    assert.match(!result.ok ? result.message : "", /secp384r1/);
  });

  test("a key of another type is named as such, not reported as a mismatching signature", () => {
    const event = sealEvent(baseEvent());
    const result = verifyEventSignature(event, "ECDSA-P256-SHA256", ecdsaSign(event), ed.publicKey);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /is ed25519, but ECDSA-P256-SHA256 needs ec/);
  });

  test("RSA-PSS-SHA256 verifies whatever salt length the signer chose", () => {
    const event = sealEvent(baseEvent());
    assert.deepEqual(verifyEventSignature(event, "RSA-PSS-SHA256", rsaSign(event), rsa.publicKey), {
      ok: true,
    });
  });

  test("RSA-PSS-SHA256 refuses a modulus under 2048 bits", () => {
    const event = sealEvent(baseEvent());
    const result = verifyEventSignature(
      event,
      "RSA-PSS-SHA256",
      rsaSign(event, rsaSmall.privateKey),
      rsaSmall.publicKey,
    );
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /1024-bit modulus/);
  });

  test("an RSA signature of the wrong length is malformed, never invalid", () => {
    const event = sealEvent(baseEvent());
    const short = Buffer.alloc(128, 1).toString("base64");
    const result = verifyEventSignature(event, "RSA-PSS-SHA256", short, rsa.publicKey);
    assert.equal(!result.ok && result.kind, "malformed-signature");
  });

  test("a tampered event fails both new schemes on the signature", () => {
    const event = sealEvent(baseEvent());
    const ecdsaValue = ecdsaSign(event);
    const rsaValue = rsaSign(event);
    const changed = structuredClone(event);
    (changed["resource"] as Event)["id"] = "resource-999";
    assert.equal(
      !verifyEventSignature(changed, "ECDSA-P256-SHA256", ecdsaValue, ecdsa.publicKey).ok,
      true,
    );
    assert.equal(
      !verifyEventSignature(changed, "RSA-PSS-SHA256", rsaValue, rsa.publicKey).ok,
      true,
    );
  });

  test("the committed fixtures verify with the committed test keys", () => {
    for (const [file, key, algorithm] of [
      ["signed-event-ecdsa-p256.json", "ecdsa-p256-test-public.pem", "ECDSA-P256-SHA256"],
      ["signed-event-rsa-pss.json", "rsa-pss-test-public.pem", "RSA-PSS-SHA256"],
    ] as const) {
      const event = readFixture(integrityValid, file);
      const publicKey = loadPublicKey(readFileSync(path.join(integrityKeys, key), "utf8"));
      const result = verifyEventIntegrity(event, file, validator, { publicKey });
      assert.equal(result.verified, true, file);
      assert.ok(
        result.checks.some((check) => check.message === `signature valid (${algorithm})`),
        JSON.stringify(result.checks),
      );
      // Without a key the same event is declared, not checked, and still verified on its hash.
      const unkeyed = verifyEventIntegrity(event, file, validator);
      assert.equal(unkeyed.verified, true);
      assert.ok(
        unkeyed.checks.some((check) =>
          check.message.startsWith(`signature declared (${algorithm})`),
        ),
      );
    }
  });
});
