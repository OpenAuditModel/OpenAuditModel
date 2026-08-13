/**
 * The deterministic privacy rules: property names, credential-shaped values,
 * known token formats, URLs, connection strings, entropy and size.
 *
 * These tests are as much about what the linter must **not** report as about
 * what it must. A privacy linter that cries wolf is switched off, and a switched
 * off linter finds nothing.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  isProhibitedCredentialFieldName,
  isRawPayloadFieldName,
  isSuspiciousFieldName,
  normalizeFieldName,
} from "../src/privacy/field-names.js";
import {
  containsPrivateKeyMaterial,
  isJwtStructured,
  matchKnownTokenFormat,
  matchesAuthorizationHeader,
} from "../src/privacy/token-patterns.js";
import {
  analyzeConnectionString,
  analyzeKeyValueConnectionString,
  analyzeUrl,
} from "../src/privacy/url-analysis.js";
import {
  characterClassCount,
  ENTROPY_THRESHOLD,
  isHighEntropyTokenCandidate,
  MIN_ENTROPY_LENGTH,
  shannonEntropy,
} from "../src/privacy/entropy.js";
import {
  isKnownSafeFormat,
  isRedactionPlaceholder,
  isUlid,
  isUuid,
} from "../src/privacy/safe-formats.js";
import { exceededSignals, profileValue, SIZE_THRESHOLDS } from "../src/privacy/size-analysis.js";
import { joinPointer, pointerSegment, traverse } from "../src/privacy/traverse.js";
import { ALL_RULES, RULES } from "../src/privacy/rules.js";

const SYNTHETIC_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzeW50aGV0aWMtZml4dHVyZSIsIm5vdGUiOiJub24tZnVuY3Rpb25hbCBleGFtcGxlIiwiaWF0IjoxNzgwMDAwMDAwfQ.c3ludGhldGljLXNpZ25hdHVyZS1ub3QtdmFsaWQ";

describe("rule catalogue", () => {
  test("every rule identifier is unique and well formed", () => {
    const ids = ALL_RULES.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
      assert.match(id, /^OAM-PRIV-\d{3}$/);
    }
  });

  test("every rule carries a message and a recommendation", () => {
    for (const rule of ALL_RULES) {
      assert.ok(rule.message.length > 0, rule.id);
      assert.ok(rule.recommendation.length > 0, rule.id);
    }
  });

  test("severity and confidence are independent", () => {
    assert.equal(RULES.PROHIBITED_CREDENTIAL_FIELD.severity, "critical");
    assert.equal(RULES.PROHIBITED_CREDENTIAL_FIELD.confidence, "high");
    assert.equal(RULES.HIGH_ENTROPY_TOKEN_CANDIDATE.severity, "medium");
    assert.equal(RULES.HIGH_ENTROPY_TOKEN_CANDIDATE.confidence, "low");
  });

  test("an access key identifier is not reported as a complete credential", () => {
    assert.equal(RULES.AWS_ACCESS_KEY_ID.severity, "high");
    assert.match(RULES.AWS_ACCESS_KEY_ID.message, /not a complete credential/);
  });
});

describe("property-name normalization", () => {
  test("case and separators are removed", () => {
    for (const name of ["clientSecret", "client_secret", "client-secret", "Client.Secret"]) {
      assert.equal(normalizeFieldName(name), "clientsecret", name);
    }
  });

  const credentialNames = [
    "password",
    "passwd",
    "pwd",
    "secret",
    "clientSecret",
    "client_secret",
    "accessToken",
    "access_token",
    "refreshToken",
    "idToken",
    "apiKey",
    "api_key",
    "apikey",
    "privateKey",
    "connectionString",
    "authorization",
    "proxyAuthorization",
    "sessionCookie",
    "cookie",
    "setCookie",
    "credential",
    "credentials",
  ];

  for (const name of credentialNames) {
    test(`"${name}" is a credential field name`, () => {
      assert.equal(isProhibitedCredentialFieldName(name), true);
    });
  }

  const legitimateNames = [
    "passwordPolicy",
    "passwordRotationDays",
    "secretRotationEnabled",
    "secretsManagerName",
    "tokenCount",
    "authorizationDecision",
    "cookieConsent",
    "apiKeyId",
    "privateKeyFingerprint",
    "credentialType",
  ];

  for (const name of legitimateNames) {
    test(`"${name}" is not treated as a credential field name`, () => {
      assert.equal(isProhibitedCredentialFieldName(name), false);
    });
  }

  test("raw payload names are matched exactly", () => {
    for (const name of ["requestBody", "response_body", "rawRequest", "messagePayload"]) {
      assert.equal(isRawPayloadFieldName(name), true, name);
    }
    for (const name of ["requestBodyHash", "responseBodySize", "messagePayloadReference"]) {
      assert.equal(isRawPayloadFieldName(name), false, name);
    }
  });

  test("suspicious hints raise entropy confidence but are not credential names", () => {
    assert.equal(isSuspiciousFieldName("token"), true);
    assert.equal(isProhibitedCredentialFieldName("token"), false);
  });
});

describe("authorization header values", () => {
  test("scheme-prefixed credentials are detected", () => {
    for (const value of [
      "Bearer SYNTHETICFIXTUREVALUE0000000000NOTAREAL",
      "basic c3ludGhldGljLXVzZXI6c3ludGhldGlj",
      "Digest c3ludGhldGljLWRpZ2VzdC12YWx1ZQ==",
      "ApiKey SYNTHETIC0000000000000000",
      "Token SYNTHETIC0000000000000000",
    ]) {
      assert.equal(matchesAuthorizationHeader(value), true, value.slice(0, 10));
    }
  });

  test("prose containing a scheme word is not detected", () => {
    for (const value of [
      "Bearer of bad news",
      "The bearer token was rotated",
      "Basic authentication was disabled for this tenant",
      "Token count exceeded the configured limit",
    ]) {
      assert.equal(matchesAuthorizationHeader(value), false, value);
    }
  });

  test("a scheme with a short value is not detected", () => {
    assert.equal(matchesAuthorizationHeader("Bearer abc"), false);
  });
});

describe("private key material", () => {
  test("private key markers are detected", () => {
    for (const marker of [
      "BEGIN PRIVATE KEY",
      "BEGIN RSA PRIVATE KEY",
      "BEGIN EC PRIVATE KEY",
      "BEGIN OPENSSH PRIVATE KEY",
      "BEGIN PGP PRIVATE KEY BLOCK",
    ]) {
      assert.equal(containsPrivateKeyMaterial(`-----${marker}-----\nsynthetic\n`), true, marker);
    }
  });

  test("public material is not reported by the private key rule", () => {
    for (const marker of [
      "BEGIN CERTIFICATE",
      "BEGIN PUBLIC KEY",
      "BEGIN RSA PUBLIC KEY",
      "BEGIN PGP PUBLIC KEY BLOCK",
      "BEGIN CERTIFICATE REQUEST",
    ]) {
      assert.equal(containsPrivateKeyMaterial(`-----${marker}-----\nsynthetic\n`), false, marker);
    }
  });
});

describe("JSON Web Tokens", () => {
  test("a structurally valid synthetic token is detected", () => {
    assert.equal(isJwtStructured(SYNTHETIC_JWT), true);
    assert.equal(matchKnownTokenFormat(SYNTHETIC_JWT), RULES.JWT_TOKEN.id);
  });

  test("three arbitrary dot-separated values are not detected", () => {
    for (const value of ["a.b.c", "one.two.three", "payments.settlement.completed"]) {
      assert.equal(isJwtStructured(value), false, value);
    }
  });

  test("a value with the wrong number of segments is not detected", () => {
    const [header, payload] = SYNTHETIC_JWT.split(".");
    assert.equal(isJwtStructured(`${header}.${payload}`), false);
    assert.equal(isJwtStructured(`${SYNTHETIC_JWT}.extra`), false);
  });

  test("invalid base64url is not detected", () => {
    assert.equal(isJwtStructured("eyJhbGciOiJIUzI1NiJ9!!!.eyJzdWIiOiJhIn0.sig"), false);
  });

  test("segments that decode to something other than a JSON object are not detected", () => {
    const notJson = Buffer.from("plain text").toString("base64url");
    const jsonArray = Buffer.from("[1,2,3]").toString("base64url");
    const jsonObject = Buffer.from('{"sub":"a"}').toString("base64url");

    assert.equal(isJwtStructured(`${notJson}.${jsonObject}.sig`), false);
    assert.equal(isJwtStructured(`${jsonArray}.${jsonObject}.sig`), false);
    assert.equal(isJwtStructured(`${jsonObject}.${notJson}.sig`), false);
  });

  test("a header without an algorithm is not detected", () => {
    const header = Buffer.from('{"typ":"JWT"}').toString("base64url");
    const payload = Buffer.from('{"sub":"a"}').toString("base64url");
    assert.equal(isJwtStructured(`${header}.${payload}.sig`), false);
  });

  test("a segment with a dangling character decodes the way Buffer decodes it", () => {
    // Buffer.from(segment, "base64url") silently drops a dangling character
    // when the length is ≡ 1 (mod 4); the atob-based decoder compensates to
    // match, so a JWT the Node path flags is flagged identically in a browser
    // bundle. The compensation branch must not go dead again.
    const [header, payload, signature] = SYNTHETIC_JWT.split(".") as [string, string, string];
    const dangling = `${header}A`;
    assert.equal(dangling.length % 4, 1, "the mutated segment must exercise the mod-4 branch");
    assert.equal(
      Buffer.from(dangling, "base64url").toString("utf8"),
      Buffer.from(header, "base64url").toString("utf8"),
      "Buffer must treat the dangling character as droppable for this fixture",
    );
    assert.equal(isJwtStructured(`${dangling}.${payload}.${signature}`), true);
  });
});

describe("published credential formats", () => {
  const positives: ReadonlyArray<readonly [string, string]> = [
    // Four-character prefix plus sixteen characters, as published.
    ["AKIASYNTHETIC0000000", RULES.AWS_ACCESS_KEY_ID.id],
    ["ASIASYNTHETIC0000000", RULES.AWS_ACCESS_KEY_ID.id],
    [`ghp_${"S".repeat(36)}`, RULES.GITHUB_TOKEN.id],
    [`github_pat_${"S".repeat(30)}`, RULES.GITHUB_TOKEN.id],
    [`glpat-${"S".repeat(20)}`, RULES.GITLAB_TOKEN.id],
    [`xoxb-${"1".repeat(12)}`, RULES.SLACK_TOKEN.id],
    [`sk_live_${"S".repeat(24)}`, RULES.PAYMENT_SECRET_KEY.id],
    [`AIza${"S".repeat(35)}`, RULES.CLOUD_API_KEY.id],
  ];

  for (const [value, ruleId] of positives) {
    test(`a synthetic ${ruleId} value is recognised`, () => {
      assert.equal(matchKnownTokenFormat(value), ruleId);
    });
  }

  const negatives = [
    "AKIA-NOT-A-KEY",
    "AKIASYNTHETIC000",
    "AKIASYNTHETIC00000000",
    "ghp_short",
    "glpat_underscore_not_hyphen",
    "xoxz-1234567890123",
    `pk_live_${"S".repeat(24)}`,
    `AIza${"S".repeat(10)}`,
    "record-4471",
    "payments.settlement.completed",
  ];

  for (const value of negatives) {
    test(`"${value.slice(0, 24)}" is not recognised as a published format`, () => {
      assert.equal(matchKnownTokenFormat(value), undefined);
    });
  }
});

describe("URL analysis", () => {
  test("embedded user information is detected", () => {
    const analysis = analyzeUrl("https://synthetic-user:synthetic-password@example.com/a");
    assert.equal(analysis?.hasUserinfo, true);
    assert.equal(analysis?.hasPassword, true);
  });

  test("a user name without a password still counts as user information", () => {
    const analysis = analyzeUrl("https://synthetic-user@example.com/a");
    assert.equal(analysis?.hasUserinfo, true);
    assert.equal(analysis?.hasPassword, false);
  });

  test("an ordinary URL carries neither user information nor a query", () => {
    const analysis = analyzeUrl("https://records.example.com/evidence/rca-2026-0418");
    assert.equal(analysis?.hasUserinfo, false);
    assert.equal(analysis?.hasQuery, false);
    assert.equal(analysis?.hasFragment, false);
  });

  test("query strings and fragments are distinguished", () => {
    assert.equal(analyzeUrl("https://example.com/a?b=c")?.hasQuery, true);
    assert.equal(analyzeUrl("https://example.com/a#section")?.hasFragment, true);
  });

  test("a malformed value is handled without throwing", () => {
    for (const value of ["not a url", "http://", "://missing-scheme", "", "  "]) {
      assert.doesNotThrow(() => analyzeUrl(value));
      assert.equal(analyzeUrl(value), undefined, value);
    }
  });
});

describe("connection strings", () => {
  test("credentialed database URLs are detected", () => {
    for (const value of [
      "postgresql://synthetic_user:synthetic_password@db.example.com:5432/records",
      "mysql://synthetic_user:synthetic_password@db.example.com/records",
      "mongodb://synthetic_user:synthetic_password@db.example.com/records",
      "redis://synthetic_user:synthetic_password@cache.example.com",
      "amqp://synthetic_user:synthetic_password@broker.example.com",
    ]) {
      assert.equal(analyzeConnectionString(value), "credentialed", value.slice(0, 12));
    }
  });

  test("a host-only database URL is not labelled a credential", () => {
    assert.equal(
      analyzeConnectionString("postgresql://db.example.com:5432/records"),
      "uncredentialed",
    );
    assert.equal(RULES.CONNECTION_STRING_WITHOUT_CREDENTIALS.severity, "low");
    assert.match(RULES.CONNECTION_STRING_WITHOUT_CREDENTIALS.message, /No credential was detected/);
  });

  test("key-value connection strings with a password are detected", () => {
    assert.equal(
      analyzeKeyValueConnectionString(
        "Server=db.example.com;Database=records;User Id=synthetic;Password=synthetic",
      ),
      "credentialed",
    );
    assert.equal(
      analyzeKeyValueConnectionString("Host=db.example.com;Username=synthetic;Password=synthetic"),
      "credentialed",
    );
  });

  test("a key-value connection string without a password is not a credential", () => {
    assert.equal(
      analyzeKeyValueConnectionString("Server=db.example.com;Database=records;Encrypt=true"),
      "uncredentialed",
    );
  });

  test("an empty password value is not treated as a credential", () => {
    assert.equal(
      analyzeKeyValueConnectionString("Server=db.example.com;Database=records;Password="),
      "uncredentialed",
    );
  });

  test("arbitrary semicolon-separated text is not a connection string", () => {
    assert.equal(analyzeKeyValueConnectionString("a=1;b=2"), undefined);
    assert.equal(analyzeKeyValueConnectionString("first; second; third"), undefined);
    assert.equal(analyzeConnectionString("https://example.com/a"), undefined);
  });
});

describe("entropy heuristic", () => {
  test("entropy is measured in bits per character", () => {
    assert.equal(shannonEntropy(""), 0);
    assert.equal(shannonEntropy("aaaa"), 0);
    assert.equal(shannonEntropy("ab"), 1);
    assert.ok(shannonEntropy("abcd") === 2);
  });

  test("character classes are counted", () => {
    assert.equal(characterClassCount("abcdef"), 1);
    assert.equal(characterClassCount("abcDEF"), 2);
    assert.equal(characterClassCount("abcDEF123"), 3);
    assert.equal(characterClassCount("abcDEF123-"), 4);
  });

  test("a conservative token candidate is detected", () => {
    assert.equal(isHighEntropyTokenCandidate("Zq7Z9dK2mR4xT6vB8nH1jL3pW5sY0cF2gJ4kM6"), true);
  });

  const excluded: ReadonlyArray<readonly [string, string]> = [
    ["018f1b5c-6d2a-7c3e-9a1b-4f5e6d7c8b9a", "a UUID"],
    ["01JAV3M5S4K9QF7N2W8XG6ZTQD", "a ULID"],
    ["4bf92f3577b34da6a3ce929d0e0e4736", "a trace identifier"],
    ["00f067aa0ba902b7", "a span identifier"],
    ["9f2a4c1d5e6b7a8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e", "a SHA-256 digest"],
    [`${"a".repeat(96)}`, "a SHA-384 length digest"],
    [`${"b".repeat(128)}`, "a SHA-512 length digest"],
    ["2026-05-04T09:03:17.004Z", "an RFC 3339 timestamp"],
    ["payments.settlement.completed", "a dotted identifier"],
    ["records/root-cause-analysis/rca-2026-0418", "a reference path"],
    ["chain-platform-control-service-instance-7c1a", "a hyphenated identifier"],
    ["https://records.example.com/evidence/rca-2026-0418", "a URL"],
    ["918273645918273645", "a numeric identifier"],
    ["short-value", "a short value"],
    ["The quick brown fox jumps over the lazy dog again", "prose"],
    ["Corrective action verified in production for seven days.", "a sentence"],
    ["[REDACTED]", "a redaction placeholder"],
  ];

  for (const [value, description] of excluded) {
    test(`${description} is excluded from entropy detection`, () => {
      assert.equal(isHighEntropyTokenCandidate(value), false);
    });
  }

  test("a value shorter than the minimum length is never a candidate", () => {
    assert.equal("Zq7Z9dK2mR4xT6vB".length < MIN_ENTROPY_LENGTH, true);
    assert.equal(isHighEntropyTokenCandidate("Zq7Z9dK2mR4xT6vB"), false);
  });

  test("the documented threshold is the one applied", () => {
    assert.equal(ENTROPY_THRESHOLD, 4.0);
    assert.equal(MIN_ENTROPY_LENGTH, 24);
  });

  test("a long single-case run is excluded by character-class diversity", () => {
    assert.equal(isHighEntropyTokenCandidate("abcdefghijklmnopqrstuvwxyz"), false);
  });
});

describe("safe formats", () => {
  test("identifiers are recognised", () => {
    assert.equal(isUuid("018f1b5c-6d2a-7c3e-9a1b-4f5e6d7c8b9a"), true);
    assert.equal(isUlid("01JAV3M5S4K9QF7N2W8XG6ZTQD"), true);
    assert.equal(isUlid("01JAV3M5S4K9QF7N2W8XG6ZTQI"), false, "I is not in Crockford base32");
  });

  test("redaction placeholders are recognised", () => {
    for (const value of ["[REDACTED]", "<redacted>", "***", "********", "n/a", "-", ""]) {
      assert.equal(isRedactionPlaceholder(value), true, value);
    }
    assert.equal(isRedactionPlaceholder("synthetic-value"), false);
  });

  test("an unbroken mixed-case run is not treated as a safe identifier", () => {
    assert.equal(isKnownSafeFormat("Zq7Z9dK2mR4xT6vB8nH1jL3pW5sY0cF2gJ4kM6"), false);
  });
});

describe("size analysis", () => {
  test("a small sanitized object is within every threshold", () => {
    const profile = profileValue({ status: "closed", version: 8 });
    assert.deepEqual(exceededSignals(profile), []);
  });

  test("an object with too many properties is reported", () => {
    const large: Record<string, string> = {};
    for (let index = 0; index < SIZE_THRESHOLDS.totalProperties + 5; index += 1) {
      large[`field${index}`] = "value";
    }
    const signals = exceededSignals(profileValue(large));
    assert.ok(signals.some((signal) => signal.includes("properties exceeds")));
  });

  test("a large array is reported", () => {
    const signals = exceededSignals(
      profileValue({ items: Array.from({ length: SIZE_THRESHOLDS.maxArrayLength + 1 }, () => 1) }),
    );
    assert.ok(signals.some((signal) => signal.includes("array of")));
  });

  test("a long string body is reported", () => {
    const signals = exceededSignals(
      profileValue({ body: "x".repeat(SIZE_THRESHOLDS.longestString + 1) }),
    );
    assert.ok(signals.some((signal) => signal.includes("characters exceeds")));
  });

  test("deep nesting is measured without exhausting the stack", () => {
    let deep: unknown = "leaf";
    for (let index = 0; index < 500; index += 1) {
      deep = { nested: deep };
    }
    assert.doesNotThrow(() => profileValue(deep));
    const signals = exceededSignals(profileValue(deep));
    assert.ok(signals.some((signal) => signal.includes("nesting depth")));
  });

  test("signals describe measurements, never content", () => {
    const signals = exceededSignals(profileValue({ body: "SYNTHETIC-SECRET".repeat(200) }));
    for (const signal of signals) {
      assert.doesNotMatch(signal, /SYNTHETIC/);
    }
  });
});

describe("traversal", () => {
  test("JSON Pointer reference tokens are escaped", () => {
    assert.equal(pointerSegment("a/b"), "a~1b");
    assert.equal(pointerSegment("a~b"), "a~0b");
    assert.equal(pointerSegment("a~/b"), "a~0~1b");
    assert.equal(joinPointer("/metadata", "field/name"), "/metadata/field~1name");
    assert.equal(joinPointer("/metadata", 2), "/metadata/2");
  });

  test("arrays are traversed with numeric indices", () => {
    const paths: string[] = [];
    traverse({ items: ["a", "b"] }, "/metadata", ({ path }) => paths.push(path));
    assert.deepEqual(paths, [
      "/metadata",
      "/metadata/items",
      "/metadata/items/0",
      "/metadata/items/1",
    ]);
  });

  test("property names are reported with their values", () => {
    const seen: Array<string | undefined> = [];
    traverse({ outer: { inner: 1 } }, "", ({ key }) => seen.push(key));
    assert.deepEqual(seen, [undefined, "outer", "inner"]);
  });

  test("traversal of a deeply nested structure terminates", () => {
    let deep: unknown = "leaf";
    for (let index = 0; index < 500; index += 1) {
      deep = { nested: deep };
    }
    let visits = 0;
    assert.doesNotThrow(() => traverse(deep, "", () => (visits += 1)));
    assert.ok(visits < 500, "traversal must stop at the depth limit");
  });
});
