#!/usr/bin/env node
/**
 * Generates the integrity conformance fixtures under `examples/integrity/`.
 *
 * The fixtures carry real digests, so they cannot be maintained by hand: a
 * single edited character invalidates a hash, and a hand-corrected hash hides
 * whatever the edit broke. This tool is the single source of truth for their
 * content, and it uses the same digest code the verifier uses, so a fixture can
 * never encode a procedure the implementation does not follow.
 *
 * Usage:
 *   node dist/conformance/tools/generate-integrity-fixtures.js          write
 *   node dist/conformance/tools/generate-integrity-fixtures.js --check  compare only
 *
 * `--check` compares parsed content rather than bytes, so formatting stays
 * Prettier's responsibility and content stays this tool's. The test suite runs
 * `--check`; nothing writes fixtures during a normal test run.
 */
import { deepStrictEqual } from "node:assert";
import { constants, createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { resolveSchemaPath } from "../src/validate.js";
import { buildDigestInput, calculateDigest, sealEvent } from "../src/integrity/digest.js";
import { canonicalBytes } from "../src/integrity/canonicalize.js";
import {
  CANONICALIZATION_RFC8785,
  type SupportedSignatureAlgorithm,
} from "../src/integrity/types.js";
import { verifyEventSignature } from "../src/integrity/signature.js";

type Event = Record<string, unknown>;

const repoRoot = path.dirname(path.dirname(path.dirname(resolveSchemaPath())));
const fixtureRoot = path.join(repoRoot, "examples", "integrity");

const CHAIN_ID = "chain-platform-control-service-instance-7c1a";

// ---------------------------------------------------------------------------
// Signature fixtures
//
// TEST-ONLY key pairs, one per implemented algorithm. The private keys are
// committed and public, deliberately: they exist only to make the signed
// fixtures below reproducible by this generator, the same way their hashes
// are. Anyone can therefore forge a "validly signed" event under these keys,
// which is exactly why a real key must never be generated this way or checked
// into a repository — see the caution note in examples/integrity/README.md.
// ---------------------------------------------------------------------------

const TEST_SIGNING_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEINSFExEuYKx62r0fQ6EQuZZunDj34W2McAZ3OAf8qz9S
-----END PRIVATE KEY-----
`;

const TEST_ECDSA_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgauNuEj0i2ZzY8GpR
CCWhDBrZoV55rbJf9MM7zvZ8TfWhRANCAATlF03PjiYCSbeiO411xL6C7dqmJ7UY
bZ8hupz6XshhuKZcmMKD414AielbtRk+iFeHjz0fYuYcZBcJ9RFnWFZG
-----END PRIVATE KEY-----
`;

const TEST_RSA_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC2NUA4VrIWelT4
ajcFKS8kaFiEht/mySuiKF4VHAEcsCs2dLXaB0IdhUeWfwa+8k4Qung4V+rB1wXv
BdzyXPVZ2b1NrPNMtvbITs3IWubMgdr1zU7K2ZRt/+Hupom/T5LfU83G49K7Q2N/
+Y22Bvd3U5BuEMQSkzrgMIM4SqY5tvOLnQxOYkDmiawUjzYWRDyQovDtvA1VQSze
ZeIXVNqBWCfdxRV1hA4XVJpiQjwSfSGWAwb/OYJeyWWFBZLZYjCPabEE8lBoZhIr
Xdz6Y+y8fwQobOGGmMvqm7NZxPfxPprFAlySSBIPZEIvFoVvw5AWktt1NLkNRDc8
i1NR2LgzAgMBAAECggEAQEZXoagfiWNc/waE4yqsiRTQCOwFJsXXQQwpaBvpXoPc
soiIL+G4lm5SGwozSH90P11wFDwbQYbG/pLcZpiZKjlvmGuGpgyy0GVQHTnHyeOS
6HukrFUFkaoeuo9/7v80idhnsh3i1BFJE7dmIIyjljHhtJnweLb8IWKrn1th+OBx
W9zAqWNpiY/4bOipkiScEhTfwImsFEWmm/5MuAfkaG9XhVW/jaRIgovteqOQxXGU
hLfQGQHY1Tj2Sk6YGGsGgEjxMp6vOEWxZpp64X/nDLlAhKPGw8hbphQTzmcLOfN2
XHGymRgx078wcHKPP4slEdLbd/kTXrxIENnHVJhoaQKBgQD5wA7RgAeWqiQASCJC
sWdVgh91traIVo78LZ6Gk7MGam/8l6z6TxC+I4isNFUOliwXPgqf0vDhZ6ouvMug
4sXZJGBh3nuvxCMFvEP4QAP0aDohn+E6MJInIznnNDd63hKglNuUdQDljc2UWz4f
LnKhnVUPMqVTaxNwnCbUgcvmKQKBgQC6xIGSk+LJDa2v3SJk1mEzDoZ5FChpEvDx
wkf+nxfIZ0fBRZqc1lvExG+6Qtf2Sky7uCT/YO1bsevM1aYIlgs/ckMq9MocjDj5
tKNFIKmAlfP65syEXZq05Zfeu8xKMsMWNdex9AsEwN9vQuq5RWobCe1Rn8lVrcye
jO1h7HNe+wKBgB+iOP5GNi/aOxciC9zgtZL6GVwCmZopRJEighrPqHRelPKsj4dg
7mD3BT+ynTdsxAbpn9Tglgwm4kJrPWuSbbb0SZT75jS8Jid60i0mhpm1fe92XcPO
FSUJ7DKhxYk1iax3Tly+eS+aR3jMGdE/Q9u+nuB+7LvlKyAvVyfBjP8JAoGAFNZ3
3nLBis0L4+M4QyfoEFo+hqPJHnAOkeqrPa1iaemcB+RMK9N+yaVhEdcDYWdIyGjz
N8sIsIJZXLE5pRuYhaup8tD8+9JpSPLuhHfwcXhJkGTPzLTk3en/18n8MQsY2RGI
z0H7OLyMMU22ApXMENg6sjCxte1+NvJiSdqnxKECgYAs+nAeZaFEy5oFSjbHKATO
oGgDOV0+OyHrtH+EBriVU2M5QtEuyGDmPTHLlthceLarqy2d92XL6qP/MEJkcQF9
ypgHxYxkP3ZJ6ZUaH4McLWvfDvNrES7DgkKSUAh6l7gXmgZ2TbrXhf5R6Jx/UUb0
BFaSiplGTYPY6RwVDzFCpw==
-----END PRIVATE KEY-----
`;

const TEST_SIGNING_KEY_ID = "example-fixture-key-2026";
const TEST_ECDSA_KEY_ID = "example-fixture-ecdsa-key-2026";
const TEST_RSA_KEY_ID = "example-fixture-rsa-key-2026";

const testPrivateKey = createPrivateKey(TEST_SIGNING_KEY_PEM);
const testEcdsaKey = createPrivateKey(TEST_ECDSA_KEY_PEM);
const testRsaKey = createPrivateKey(TEST_RSA_KEY_PEM);

function publicPem(key: ReturnType<typeof createPrivateKey>): string {
  return createPublicKey(key).export({ type: "spki", format: "pem" }) as string;
}
const testPublicKeyPem = publicPem(testPrivateKey);
const testEcdsaPublicKeyPem = publicPem(testEcdsaKey);
const testRsaPublicKeyPem = publicPem(testRsaKey);

/**
 * Returns a copy of `event` with `integrity.signature` set to a signature in
 * `algorithm` over the same canonicalized input `sealEvent` hashes — computed
 * with the same `buildDigestInput`/canonicalization code the verifier uses,
 * so a fixture cannot encode a signing procedure the implementation does not
 * follow.
 *
 * Two of the three schemes are not deterministic in Node — ECDSA draws a nonce
 * and RSA-PSS a salt — and this generator's check compares regenerated
 * fixtures with the committed ones. RSA-PSS is therefore signed with a
 * zero-length salt, which makes it deterministic and still verifies under
 * `RSA_PSS_SALTLEN_AUTO`. ECDSA has no such switch, so its fixture is checked
 * by verifying the committed signature rather than by regenerating it.
 */
function signEventWith<T>(event: T, algorithm: SupportedSignatureAlgorithm): T {
  const data = canonicalBytes(buildDigestInput(event));
  const [value, keyId] = ((): [string, string] => {
    switch (algorithm) {
      case "Ed25519":
        return [cryptoSign(null, data, testPrivateKey).toString("base64"), TEST_SIGNING_KEY_ID];
      case "ECDSA-P256-SHA256":
        return [
          cryptoSign("sha256", data, { key: testEcdsaKey, dsaEncoding: "ieee-p1363" }).toString(
            "base64",
          ),
          TEST_ECDSA_KEY_ID,
        ];
      case "RSA-PSS-SHA256":
        return [
          cryptoSign("sha256", data, {
            key: testRsaKey,
            padding: constants.RSA_PKCS1_PSS_PADDING,
            saltLength: 0,
          }).toString("base64"),
          TEST_RSA_KEY_ID,
        ];
    }
  })();
  const record = event as Record<string, unknown>;
  const integrityRecord = record["integrity"] as Record<string, unknown>;
  return {
    ...record,
    integrity: { ...integrityRecord, signature: { algorithm, value, keyId } },
  } as T;
}

function signEvent<T>(event: T): T {
  return signEventWith(event, "Ed25519");
}

/** The sealed event without its signature, so another key can sign the same content. */
function unsigned(event: Event): Event {
  const integrityRecord = { ...(event["integrity"] as Event) };
  delete integrityRecord["signature"];
  return { ...event, integrity: integrityRecord };
}

/** An unsealed integrity object. `hash` is a placeholder so that key order is stable. */
function integrity(
  options: { previousHash?: string; chainId?: string; batchId?: string } = {},
): Event {
  return {
    canonicalization: CANONICALIZATION_RFC8785,
    hashAlgorithm: "SHA-256",
    hash: "",
    ...(options.previousHash === undefined ? {} : { previousHash: options.previousHash }),
    ...(options.chainId === undefined ? {} : { chainId: options.chainId }),
    ...(options.batchId === undefined ? {} : { batchId: options.batchId }),
  };
}

function declaredHash(event: Event): string {
  const integrityObject = event["integrity"] as Record<string, unknown>;
  return integrityObject["hash"] as string;
}

// ---------------------------------------------------------------------------
// Valid fixtures
// ---------------------------------------------------------------------------

const singleEvent: Event = sealEvent({
  specVersion: "0.1",
  id: "018f2a10-4c21-7b83-9e05-1d2f3a4b5c60",
  time: "2026-04-02T13:20:44.117Z",
  sequence: 1,
  event: {
    name: "configuration.setting.update",
    category: "configuration",
    type: "update",
    outcome: "success",
    severity: "high",
    summary: "Audit retention period extended on the production configuration.",
  },
  actor: { type: "admin", id: "admin-0091", roles: ["platform-administrator"] },
  resource: {
    type: "configuration",
    id: "configuration-audit-retention",
    classification: "restricted",
  },
  application: {
    name: "platform-control-service",
    environment: "production",
    version: "9.1.0",
    instance: "instance-7c1a",
  },
  authorization: { decision: "allow", policy: "privileged-configuration-change" },
  change: {
    type: "update",
    changedFields: ["retentionDays"],
    before: { retentionDays: 365 },
    after: { retentionDays: 2555 },
    ticketId: "change-10241",
  },
  controlCategories: ["configuration-integrity", "privileged-access"],
  integrity: integrity(),
});

/**
 * Exercises the parts of RFC 8785 that differ between naive serializers:
 * property ordering across cases and scripts, non-BMP characters, escapes, and
 * the ECMAScript number-to-string forms. The members are deliberately not in
 * sorted order on disk.
 */
const unicodeAndNumberEvent: Event = sealEvent({
  specVersion: "0.1",
  id: "018f2a2b-7d40-7c19-a562-3e4f5a6b7c81",
  time: "2026-04-02T14:05:09.004Z",
  event: {
    name: "data.record.update",
    category: "data-modification",
    outcome: "success",
    summary: "Record updated with mixed-script content.",
  },
  actor: { type: "user", id: "user-4471" },
  resource: { type: "record", id: "record-88213" },
  application: { name: "records-service", environment: "production" },
  metadata: {
    zeta: "sorts last among the lower-case keys",
    Alpha: "upper-case sorts before lower-case in UTF-16 code unit order",
    "10": "digit keys sort as strings, so 10 precedes 9",
    "9": "digit keys sort as strings",
    alpha: "sorts after the upper-case key",
    äpfel: "Latin-1 supplement",
    日本語: "CJK key",
    strings: {
      emoji: "\u{1f512} sealed",
      combining: "é is not é",
      escapes: 'quote " backslash \\ tab \t newline \n',
      controlCharacter: "",
    },
    numbers: {
      zero: 0,
      negative: -17,
      fraction: 3.14159,
      small: 0.000001,
      verySmall: 1e-7,
      large: 1e21,
      maxSafeInteger: 9007199254740991,
    },
    containers: {
      emptyObject: {},
      emptyArray: [],
      nested: [1, [2, [3, { deep: null }]]],
    },
  },
  integrity: integrity(),
});

/**
 * A hash and a signature together: the hash lets any verifier detect
 * modification, the signature additionally proves who sealed it, to anyone
 * holding the corresponding public key.
 */
const signedEvent: Event = signEvent(
  sealEvent({
    specVersion: "0.1",
    id: "018f2a45-9d31-7e42-8b17-2c3d4e5f6a71",
    time: "2026-04-05T16:42:08.900Z",
    event: {
      name: "secret.rotate",
      category: "configuration",
      type: "update",
      outcome: "success",
      severity: "high",
      summary: "Database credential rotated ahead of schedule after a suspected exposure.",
    },
    actor: { type: "admin", id: "admin-0091", roles: ["platform-administrator"] },
    resource: { type: "secret", id: "secret-db-primary", classification: "secret" },
    application: {
      name: "platform-control-service",
      environment: "production",
      instance: "instance-7c1a",
    },
    authorization: { decision: "allow", policy: "privileged-configuration-change" },
    reason: { code: "suspected-exposure" },
    controlCategories: ["configuration-integrity", "privileged-access"],
    integrity: integrity(),
  }),
);

const chain001: Event = sealEvent({
  specVersion: "0.1",
  id: "018f2a30-1111-7222-8333-444455556601",
  time: "2026-04-03T08:00:12.500Z",
  sequence: 1,
  event: {
    name: "privileged.access.grant",
    category: "privileged-operation",
    type: "grant",
    outcome: "success",
    severity: "critical",
    summary: "Time-bound platform administrator access granted for a change window.",
  },
  actor: { type: "user", id: "user-1180", roles: ["access-approver"] },
  resource: { type: "user", id: "admin-0091" },
  application: {
    name: "platform-control-service",
    environment: "production",
    instance: "instance-7c1a",
  },
  authorization: { decision: "allow", policy: "just-in-time-access" },
  approval: {
    status: "approved",
    requiredApprovals: 1,
    receivedApprovals: 1,
    approvedAt: "2026-04-03T07:58:40Z",
  },
  reason: { code: "scheduled-maintenance", reference: "change-10241" },
  controlCategories: ["privileged-access", "change-approval"],
  metadata: { grantedRole: "platform-administrator", expiresAt: "2026-04-03T10:00:00Z" },
  integrity: integrity({ chainId: CHAIN_ID }),
});

const chain002: Event = sealEvent({
  specVersion: "0.1",
  id: "018f2a30-1111-7222-8333-444455556602",
  time: "2026-04-03T08:14:31.882Z",
  sequence: 2,
  event: {
    name: "configuration.setting.update",
    category: "configuration",
    type: "update",
    outcome: "success",
    severity: "critical",
    summary: "Session lifetime reduced under the approved change window.",
  },
  actor: { type: "admin", id: "admin-0091", roles: ["platform-administrator"] },
  resource: {
    type: "configuration",
    id: "configuration-authentication-session",
    classification: "restricted",
  },
  application: {
    name: "platform-control-service",
    environment: "production",
    instance: "instance-7c1a",
  },
  authorization: { decision: "allow", policy: "privileged-configuration-change" },
  change: {
    type: "update",
    changedFields: ["sessionLifetimeMinutes"],
    before: { sessionLifetimeMinutes: 720 },
    after: { sessionLifetimeMinutes: 60 },
    ticketId: "change-10241",
  },
  controlCategories: ["configuration-integrity", "privileged-access"],
  integrity: integrity({ chainId: CHAIN_ID, previousHash: declaredHash(chain001) }),
});

const chain003: Event = sealEvent({
  specVersion: "0.1",
  id: "018f2a30-1111-7222-8333-444455556603",
  time: "2026-04-03T09:47:02.310Z",
  sequence: 3,
  event: {
    name: "privileged.access.revoke",
    category: "privileged-operation",
    type: "revoke",
    outcome: "success",
    severity: "high",
    summary: "Time-bound platform administrator access revoked after the change window.",
  },
  actor: { type: "system", id: "system-access-expiry" },
  resource: { type: "user", id: "admin-0091" },
  application: {
    name: "platform-control-service",
    environment: "production",
    instance: "instance-7c1a",
  },
  authorization: { decision: "allow", policy: "just-in-time-access" },
  reason: { code: "grant-expired", reference: "change-10241" },
  controlCategories: ["privileged-access"],
  integrity: integrity({ chainId: CHAIN_ID, previousHash: declaredHash(chain002) }),
});

// The same three events from a second instance of the service, sealed in two
// batches: the first two together, the third on its own. `batchId` is inside
// the digest, so these are different events with different hashes, not the
// chain above relabelled. Batches are reported by `verify-chain`, not judged.
const BATCHED_CHAIN_ID = "chain-platform-control-service-instance-9e4b";
const BATCH_ONE = "batch-2026-04-03-08-instance-9e4b";
const BATCH_TWO = "batch-2026-04-03-09-instance-9e4b";

function inBatch(
  source: Event,
  options: { id: string; batchId: string; previousHash?: string },
): Event {
  const content = { ...source };
  delete content["integrity"];
  return sealEvent({
    ...content,
    id: options.id,
    application: { ...(source["application"] as Event), instance: "instance-9e4b" },
    integrity: integrity({
      chainId: BATCHED_CHAIN_ID,
      batchId: options.batchId,
      ...(options.previousHash === undefined ? {} : { previousHash: options.previousHash }),
    }),
  });
}

const batched001: Event = inBatch(chain001, {
  id: "018f2a30-1111-7222-8333-444455556611",
  batchId: BATCH_ONE,
});
const batched002: Event = inBatch(chain002, {
  id: "018f2a30-1111-7222-8333-444455556612",
  batchId: BATCH_ONE,
  previousHash: declaredHash(batched001),
});
const batched003: Event = inBatch(chain003, {
  id: "018f2a30-1111-7222-8333-444455556613",
  batchId: BATCH_TWO,
  previousHash: declaredHash(batched002),
});

// ---------------------------------------------------------------------------
// Checkpoints
//
// A checkpoint records a chain's head so that it can be kept somewhere the
// store's administrators do not control. These documents are not events: they
// validate against schemas/checkpoint/v0.1/checkpoint.schema.json, and
// `verify-checkpoint` compares an archive with them.
// ---------------------------------------------------------------------------

/** A copy of `document` with `/signature` removed: the input a checkpoint signature covers. */
function withoutDocumentSignature(document: Event): Event {
  const copy = { ...document };
  delete copy["signature"];
  return copy;
}

/**
 * Signs a checkpoint with the TEST-ONLY Ed25519 key over the canonical bytes of
 * the document without `/signature` — the same procedure an event's signature
 * uses, with the pointer at the document root instead of under `integrity`.
 */
function signDocument(document: Event): Event {
  const data = canonicalBytes(withoutDocumentSignature(document));
  const value = cryptoSign(null, data, testPrivateKey).toString("base64");
  return {
    ...document,
    signature: { algorithm: "Ed25519", value, keyId: TEST_SIGNING_KEY_ID },
  };
}

const CHECKPOINT_ANCHOR = {
  type: "manual",
  reference:
    "change-10241: chain head recorded in the change ticket and countersigned by the approver",
  recordedAt: "2026-04-03T10:02:00Z",
};

/** A single-chain checkpoint of the three-event chain at `head`. */
function checkpointAt(head: Event, eventCount: number, createdAt: string): Event {
  return {
    checkpointVersion: "0.1",
    chainId: CHAIN_ID,
    hashAlgorithm: "SHA-256",
    canonicalization: CANONICALIZATION_RFC8785,
    head: { sequence: head["sequence"], hash: declaredHash(head) },
    eventCount,
    createdAt,
    anchor: CHECKPOINT_ANCHOR,
  };
}

/** The chain's head at sequence 3, anchored and signed: what a producer publishes. */
const checkpoint: Event = signDocument(checkpointAt(chain003, 3, "2026-04-03T10:00:00Z"));

/** Taken at sequence 2, before the third event existed: still true, and it leaves a tail uncovered. */
const staleCheckpoint: Event = checkpointAt(chain002, 2, "2026-04-03T08:30:00Z");

/** Names sequence 3 but records event 2's hash for it: a checkpoint taken against the wrong event. */
const wrongHeadCheckpoint: Event = {
  ...checkpointAt(chain003, 3, "2026-04-03T10:00:00Z"),
  head: { sequence: 3, hash: declaredHash(chain002) },
};

/** No anchor at all. Schema-invalid on purpose: a checkpoint kept beside the events verifies nothing. */
const unanchoredCheckpoint: Event = (() => {
  const document = checkpointAt(chain003, 3, "2026-04-03T10:00:00Z");
  delete document["anchor"];
  return document;
})();

/** The multi-chain form: both instance chains of the service, taken together, as an archive manifest. */
const archiveCheckpoint: Event = signDocument({
  checkpointVersion: "0.1",
  hashAlgorithm: "SHA-256",
  canonicalization: CANONICALIZATION_RFC8785,
  chains: [
    { chainId: CHAIN_ID, head: { sequence: 3, hash: declaredHash(chain003) }, eventCount: 3 },
    {
      chainId: BATCHED_CHAIN_ID,
      head: { sequence: 3, hash: declaredHash(batched003) },
      eventCount: 3,
    },
  ],
  createdAt: "2026-04-03T10:00:00Z",
  anchor: {
    type: "publication",
    reference: "https://audit-archive.example/checkpoints/platform-control-service/2026-04-03",
    recordedAt: "2026-04-03T10:00:05Z",
  },
  description:
    "Both instance chains of platform-control-service at the close of change window change-10241.",
  applications: ["platform-control-service"],
  timeRange: { from: "2026-04-03T08:00:12.500Z", to: "2026-04-03T09:47:02.310Z" },
});

// ---------------------------------------------------------------------------
// Invalid fixtures, all derived from the valid ones
// ---------------------------------------------------------------------------

/** Content changed after sealing; the declared hash is left untouched. */
const tamperedEvent: Event = {
  ...structuredClone(singleEvent),
  resource: {
    type: "configuration",
    id: "configuration-audit-retention",
    classification: "internal",
  },
};

/** Content untouched; the declared hash is a digest of a different event. */
const wrongDeclaredHash: Event = {
  ...structuredClone(singleEvent),
  integrity: {
    ...(structuredClone(singleEvent)["integrity"] as Event),
    hash: calculateDigest(unicodeAndNumberEvent, "SHA-256"),
  },
};

/**
 * Sealed with SHA-256 and then relabelled. The verifier must refuse on the
 * algorithm before it compares anything, which is the point: the schema accepts
 * this identifier, and acceptance is not support.
 */
const unsupportedAlgorithm: Event = {
  ...structuredClone(singleEvent),
  integrity: {
    ...(structuredClone(singleEvent)["integrity"] as Event),
    hashAlgorithm: "BLAKE3",
  },
};

/**
 * Content changed after both sealing and signing. The hash mismatch is
 * reported first — hash verification runs before signature verification —
 * so this fixture exercises the same `hash-mismatch` path as
 * tampered-event.json, over a signed event.
 */
const tamperedSignedEvent: Event = {
  ...structuredClone(signedEvent),
  resource: { type: "secret", id: "secret-db-primary", classification: "restricted" },
};

/**
 * Signed with a valid Ed25519 signature, then relabelled to an algorithm this
 * verifier does not implement. Mirrors unsupported-algorithm.json for
 * signatures: the schema's open vocabulary accepts the identifier, and
 * acceptance is not support.
 */
const unsupportedSignatureAlgorithm: Event = {
  ...structuredClone(signedEvent),
  integrity: {
    ...(structuredClone(signedEvent)["integrity"] as Event),
    signature: {
      ...((structuredClone(signedEvent)["integrity"] as Event)["signature"] as Event),
      algorithm: "ECDSA-P384-SHA384",
    },
  },
};

/** The same sealed content signed under each of the other two implemented algorithms. */
const signedEventEcdsa: Event = signEventWith(unsigned(signedEvent), "ECDSA-P256-SHA256");
const signedEventRsaPss: Event = signEventWith(unsigned(signedEvent), "RSA-PSS-SHA256");

/** Event 3 re-linked past event 2 and re-sealed: every digest holds, the link does not. */
const brokenPreviousHash = [
  chain001,
  chain002,
  sealEvent({
    ...structuredClone(chain003),
    integrity: {
      ...(structuredClone(chain003)["integrity"] as Event),
      previousHash: declaredHash(chain001),
    },
  }),
];

/** Event 3 re-sequenced onto event 2's number and re-sealed, so only the duplicate shows. */
const duplicateSequence = [
  chain001,
  chain002,
  sealEvent({ ...structuredClone(chain003), sequence: 2 }),
];

/** Event 2 loses its sequence and is re-sealed, so the chain can no longer be ordered. */
const missingSequence = (() => {
  const second = structuredClone(chain002);
  delete second["sequence"];
  const resealed = sealEvent(second);
  return [
    chain001,
    resealed,
    sealEvent({
      ...structuredClone(chain003),
      integrity: {
        ...(structuredClone(chain003)["integrity"] as Event),
        previousHash: declaredHash(resealed),
      },
    }),
  ];
})();

/**
 * Events 2 and 3 swap sequence numbers and are *not* re-sealed. Because
 * `sequence` is part of the digest input, reordering is visible in each event's
 * own digest as well as in the links.
 */
const reorderedChain = [
  chain001,
  { ...structuredClone(chain002), sequence: 3 },
  { ...structuredClone(chain003), sequence: 2 },
];

// ---------------------------------------------------------------------------

interface Fixture {
  readonly relativePath: string;
  readonly content: Event;
  /**
   * A fixture whose signature cannot be regenerated byte-for-byte is checked
   * by verifying the committed signature with the algorithm's test key. Every
   * other field is still compared exactly.
   */
  readonly checkedByVerifying?: SupportedSignatureAlgorithm;
}

function chainFixtures(directory: string, events: readonly Event[]): Fixture[] {
  return events.map((content, index) => ({
    relativePath: path.join(directory, `00${index + 1}.json`),
    content,
  }));
}

const FIXTURES: readonly Fixture[] = [
  { relativePath: path.join("valid", "single-event-sha256.json"), content: singleEvent },
  {
    relativePath: path.join("valid", "unicode-and-number-event.json"),
    content: unicodeAndNumberEvent,
  },
  { relativePath: path.join("valid", "signed-event-ed25519.json"), content: signedEvent },
  {
    relativePath: path.join("valid", "signed-event-ecdsa-p256.json"),
    content: signedEventEcdsa,
    checkedByVerifying: "ECDSA-P256-SHA256",
  },
  { relativePath: path.join("valid", "signed-event-rsa-pss.json"), content: signedEventRsaPss },
  ...chainFixtures(path.join("valid", "three-event-chain"), [chain001, chain002, chain003]),
  ...chainFixtures(path.join("valid", "chain-in-two-batches"), [
    batched001,
    batched002,
    batched003,
  ]),
  { relativePath: path.join("invalid", "tampered-event.json"), content: tamperedEvent },
  { relativePath: path.join("invalid", "wrong-declared-hash.json"), content: wrongDeclaredHash },
  {
    relativePath: path.join("invalid", "unsupported-algorithm.json"),
    content: unsupportedAlgorithm,
  },
  {
    relativePath: path.join("invalid", "tampered-signed-event.json"),
    content: tamperedSignedEvent,
  },
  {
    relativePath: path.join("invalid", "unsupported-signature-algorithm.json"),
    content: unsupportedSignatureAlgorithm,
  },
  ...chainFixtures(path.join("invalid", "broken-previous-hash"), brokenPreviousHash),
  ...chainFixtures(path.join("invalid", "duplicate-sequence"), duplicateSequence),
  ...chainFixtures(path.join("invalid", "missing-sequence"), missingSequence),
  ...chainFixtures(path.join("invalid", "reordered-chain"), reorderedChain),
  // The deleted tail: events 1 and 2 of the three, and nothing else wrong. It
  // passes `verify-chain`, because a truncated chain is internally consistent,
  // and fails `verify-checkpoint` against the checkpoint taken at sequence 3.
  ...chainFixtures(path.join("invalid", "truncated-chain"), [chain001, chain002]),
  {
    relativePath: path.join("checkpoints", "three-event-chain.checkpoint.json"),
    content: checkpoint,
  },
  {
    relativePath: path.join("checkpoints", "three-event-chain.stale.checkpoint.json"),
    content: staleCheckpoint,
  },
  {
    relativePath: path.join("checkpoints", "three-event-chain.wrong-head.checkpoint.json"),
    content: wrongHeadCheckpoint,
  },
  {
    relativePath: path.join("checkpoints", "three-event-chain.unanchored.checkpoint.json"),
    content: unanchoredCheckpoint,
  },
  { relativePath: path.join("checkpoints", "archive.checkpoint.json"), content: archiveCheckpoint },
];

/** Not JSON fixtures: the public halves of the TEST-ONLY signing keys, for
 * `--public-key` in docs, tests and manual verification. */
const PUBLIC_KEYS: readonly { readonly file: string; readonly pem: string }[] = [
  { file: path.join(fixtureRoot, "keys", "ed25519-test-public.pem"), pem: testPublicKeyPem },
  {
    file: path.join(fixtureRoot, "keys", "ecdsa-p256-test-public.pem"),
    pem: testEcdsaPublicKeyPem,
  },
  { file: path.join(fixtureRoot, "keys", "rsa-pss-test-public.pem"), pem: testRsaPublicKeyPem },
];

/** A copy of `event` with `integrity.signature.value` blanked, for comparing everything else. */
function withoutSignatureValue(event: Event): Event {
  const integrityRecord = { ...(event["integrity"] as Event) };
  const signature = integrityRecord["signature"] as Event | undefined;
  if (signature !== undefined) {
    integrityRecord["signature"] = { ...signature, value: "" };
  }
  return { ...event, integrity: integrityRecord };
}

/**
 * True when the committed copy of a verification-checked fixture is the
 * generated content in every field but the signature value, and that value
 * verifies under the algorithm's test key.
 */
function committedCopyVerifies(fixture: Fixture, onDisk: Event): boolean {
  const algorithm = fixture.checkedByVerifying;
  if (algorithm === undefined) {
    return false;
  }
  try {
    deepStrictEqual(withoutSignatureValue(onDisk), withoutSignatureValue(fixture.content));
  } catch {
    return false;
  }
  const signature = (onDisk["integrity"] as Event)["signature"] as Event;
  const publicKey = createPublicKey(
    algorithm === "ECDSA-P256-SHA256"
      ? testEcdsaKey
      : algorithm === "RSA-PSS-SHA256"
        ? testRsaKey
        : testPrivateKey,
  );
  return verifyEventSignature(onDisk, algorithm, signature["value"] as string, publicKey).ok;
}

/** Compares the generated fixtures with what is on disk. Returns the drifted paths. */
export function checkFixtures(): string[] {
  const drifted: string[] = [];

  for (const fixture of FIXTURES) {
    const absolute = path.join(fixtureRoot, fixture.relativePath);
    if (!existsSync(absolute)) {
      drifted.push(`${fixture.relativePath} (missing)`);
      continue;
    }
    const onDisk = JSON.parse(readFileSync(absolute, "utf8")) as Event;
    if (fixture.checkedByVerifying !== undefined) {
      if (!committedCopyVerifies(fixture, onDisk)) {
        drifted.push(fixture.relativePath);
      }
      continue;
    }
    try {
      deepStrictEqual(onDisk, fixture.content);
    } catch {
      drifted.push(fixture.relativePath);
    }
  }

  for (const key of PUBLIC_KEYS) {
    if (!existsSync(key.file)) {
      drifted.push(`${path.relative(fixtureRoot, key.file)} (missing)`);
    } else if (readFileSync(key.file, "utf8") !== key.pem) {
      drifted.push(path.relative(fixtureRoot, key.file));
    }
  }

  return drifted;
}

function writeFixtures(): void {
  for (const fixture of FIXTURES) {
    const absolute = path.join(fixtureRoot, fixture.relativePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    // A verification-checked fixture that already verifies is left alone:
    // rewriting it would replace a good signature with a different good one
    // and churn the repository for nothing.
    if (fixture.checkedByVerifying !== undefined && existsSync(absolute)) {
      const onDisk = JSON.parse(readFileSync(absolute, "utf8")) as Event;
      if (committedCopyVerifies(fixture, onDisk)) {
        process.stdout.write(`kept  ${fixture.relativePath} (committed signature verifies)\n`);
        continue;
      }
    }
    writeFileSync(absolute, `${JSON.stringify(fixture.content, null, 2)}\n`, "utf8");
    process.stdout.write(`wrote ${fixture.relativePath}\n`);
  }

  for (const key of PUBLIC_KEYS) {
    mkdirSync(path.dirname(key.file), { recursive: true });
    writeFileSync(key.file, key.pem, "utf8");
    process.stdout.write(`wrote ${path.relative(fixtureRoot, key.file)}\n`);
  }

  process.stdout.write(
    `\n${FIXTURES.length} fixtures written. Run "npm run format" to normalise formatting.\n`,
  );
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { check: { type: "boolean", default: false } },
  });

  if (values.check === true) {
    const drifted = checkFixtures();
    if (drifted.length === 0) {
      process.stdout.write(`${FIXTURES.length} integrity fixtures match the generator\n`);
      return 0;
    }
    process.stderr.write("integrity fixtures differ from the generator:\n");
    for (const entry of drifted) {
      process.stderr.write(`  ${entry}\n`);
    }
    process.stderr.write('\nRun "npm run fixtures:integrity" to regenerate them.\n');
    return 1;
  }

  writeFixtures();
  return 0;
}

if (process.argv[1] !== undefined && process.argv[1].includes("generate-integrity-fixtures")) {
  process.exitCode = main();
}
