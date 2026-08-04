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
import { createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { resolveSchemaPath } from "../src/validate.js";
import { buildDigestInput, calculateDigest, sealEvent } from "../src/integrity/digest.js";
import { canonicalBytes } from "../src/integrity/canonicalize.js";
import { CANONICALIZATION_RFC8785 } from "../src/integrity/types.js";

type Event = Record<string, unknown>;

const repoRoot = path.dirname(path.dirname(path.dirname(resolveSchemaPath())));
const fixtureRoot = path.join(repoRoot, "examples", "integrity");

const CHAIN_ID = "chain-platform-control-service-instance-7c1a";

// ---------------------------------------------------------------------------
// Signature fixtures
//
// TEST-ONLY Ed25519 key pair. The private key is committed and public,
// deliberately: it exists only to make the signed fixtures below
// reproducible by this generator, the same way their hashes are. Anyone can
// therefore forge a "validly signed" event under this key, which is exactly
// why a real key must never be generated this way or checked into a
// repository — see the caution note in examples/integrity/README.md.
// ---------------------------------------------------------------------------

const TEST_SIGNING_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEINSFExEuYKx62r0fQ6EQuZZunDj34W2McAZ3OAf8qz9S
-----END PRIVATE KEY-----
`;

const TEST_SIGNING_KEY_ID = "example-fixture-key-2026";

const testPrivateKey = createPrivateKey(TEST_SIGNING_KEY_PEM);
const testPublicKeyPem = createPublicKey(testPrivateKey).export({
  type: "spki",
  format: "pem",
}) as string;

/**
 * Returns a copy of `event` with `integrity.signature` set to an Ed25519
 * signature over the same canonicalized input `sealEvent` hashes — computed
 * with the same `buildDigestInput`/canonicalization code the verifier uses,
 * so a fixture cannot encode a signing procedure the implementation does not
 * follow.
 */
function signEvent<T>(event: T): T {
  const data = canonicalBytes(buildDigestInput(event));
  const signature = cryptoSign(null, data, testPrivateKey).toString("base64");
  const record = event as Record<string, unknown>;
  const integrityRecord = record["integrity"] as Record<string, unknown>;
  return {
    ...record,
    integrity: {
      ...integrityRecord,
      signature: { algorithm: "Ed25519", value: signature, keyId: TEST_SIGNING_KEY_ID },
    },
  } as T;
}

/** An unsealed integrity object. `hash` is a placeholder so that key order is stable. */
function integrity(options: { previousHash?: string; chainId?: string } = {}): Event {
  return {
    canonicalization: CANONICALIZATION_RFC8785,
    hashAlgorithm: "SHA-256",
    hash: "",
    ...(options.previousHash === undefined ? {} : { previousHash: options.previousHash }),
    ...(options.chainId === undefined ? {} : { chainId: options.chainId }),
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
      algorithm: "ECDSA-P256-SHA256",
    },
  },
};

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
  ...chainFixtures(path.join("valid", "three-event-chain"), [chain001, chain002, chain003]),
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
];

/** Not a JSON fixture: the public half of the TEST-ONLY signing key, for
 * `--public-key` in docs, tests and manual verification. */
const PUBLIC_KEY_PATH = path.join(fixtureRoot, "keys", "ed25519-test-public.pem");

/** Compares the generated fixtures with what is on disk. Returns the drifted paths. */
export function checkFixtures(): string[] {
  const drifted: string[] = [];

  for (const fixture of FIXTURES) {
    const absolute = path.join(fixtureRoot, fixture.relativePath);
    if (!existsSync(absolute)) {
      drifted.push(`${fixture.relativePath} (missing)`);
      continue;
    }
    try {
      deepStrictEqual(JSON.parse(readFileSync(absolute, "utf8")), fixture.content);
    } catch {
      drifted.push(fixture.relativePath);
    }
  }

  if (!existsSync(PUBLIC_KEY_PATH)) {
    drifted.push(`${path.relative(fixtureRoot, PUBLIC_KEY_PATH)} (missing)`);
  } else if (readFileSync(PUBLIC_KEY_PATH, "utf8") !== testPublicKeyPem) {
    drifted.push(path.relative(fixtureRoot, PUBLIC_KEY_PATH));
  }

  return drifted;
}

function writeFixtures(): void {
  for (const fixture of FIXTURES) {
    const absolute = path.join(fixtureRoot, fixture.relativePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(fixture.content, null, 2)}\n`, "utf8");
    process.stdout.write(`wrote ${fixture.relativePath}\n`);
  }

  mkdirSync(path.dirname(PUBLIC_KEY_PATH), { recursive: true });
  writeFileSync(PUBLIC_KEY_PATH, testPublicKeyPem, "utf8");
  process.stdout.write(`wrote ${path.relative(fixtureRoot, PUBLIC_KEY_PATH)}\n`);

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
