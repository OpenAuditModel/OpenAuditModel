/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * These vectors are written for this project rather than copied from the RFC,
 * and they exercise the rules the RFC defines: property ordering by UTF-16 code
 * unit (§3.2.3), string serialisation (§3.2.2.2), the ECMAScript number-to-string
 * forms (§3.2.2.3), and array order preservation.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  assertJsonValue,
  canonicalBytes,
  canonicalize,
  CanonicalizationError,
  isSupportedCanonicalization,
  MAX_JSON_DEPTH,
} from "../src/integrity/canonicalize.js";

describe("property ordering", () => {
  test("members are ordered by key", () => {
    assert.equal(canonicalize({ b: 1, a: 2, c: 3 }), '{"a":2,"b":1,"c":3}');
  });

  test("ordering is by UTF-16 code unit, not by locale collation", () => {
    // "A" is U+0041 and "a" is U+0061, so upper case sorts first.
    assert.equal(canonicalize({ a: 1, A: 2 }), '{"A":2,"a":1}');
    // "z" is U+007A and "ä" is U+00E4, so the ASCII letter sorts first.
    assert.equal(canonicalize({ ä: 1, z: 2 }), '{"z":2,"ä":1}');
  });

  test("digit keys are ordered as strings, not as numbers", () => {
    assert.equal(canonicalize({ "9": 1, "10": 2 }), '{"10":2,"9":1}');
  });

  test("ordering is applied at every level", () => {
    const value = { outer: { z: { b: 1, a: 2 }, a: [{ y: 1, x: 2 }] } };
    assert.equal(canonicalize(value), '{"outer":{"a":[{"x":2,"y":1}],"z":{"a":2,"b":1}}}');
  });

  test("two objects differing only in key order canonicalize identically", () => {
    const left = JSON.parse('{"b":1,"a":{"d":2,"c":3}}') as unknown;
    const right = JSON.parse('{"a":{"c":3,"d":2},"b":1}') as unknown;
    assert.equal(canonicalize(left), canonicalize(right));
  });
});

describe("arrays", () => {
  test("array order is preserved", () => {
    assert.equal(canonicalize([3, 1, 2]), "[3,1,2]");
  });

  test("nested arrays and objects are canonicalized recursively", () => {
    assert.equal(
      canonicalize([1, [2, [3, { b: null, a: true }]]]),
      '[1,[2,[3,{"a":true,"b":null}]]]',
    );
  });

  test("empty containers are preserved", () => {
    assert.equal(canonicalize({ b: [], a: {} }), '{"a":{},"b":[]}');
  });
});

describe("numbers", () => {
  const vectors: ReadonlyArray<readonly [number, string]> = [
    [0, "0"],
    [-0, "0"],
    [1, "1"],
    [1.0, "1"],
    [-17, "-17"],
    [3.14159, "3.14159"],
    [0.000001, "0.000001"],
    [1e-7, "1e-7"],
    [1e21, "1e+21"],
    [1e30, "1e+30"],
    [9007199254740991, "9007199254740991"],
    [-1.5e-9, "-1.5e-9"],
  ];

  for (const [value, expected] of vectors) {
    test(`${String(value)} serializes as ${expected}`, () => {
      assert.equal(canonicalize(value), expected);
    });
  }

  test("negative zero and positive zero are indistinguishable after canonicalization", () => {
    assert.equal(canonicalize({ a: -0 }), canonicalize({ a: 0 }));
  });

  test("non-finite numbers are rejected", () => {
    assert.throws(() => canonicalize(Number.NaN), CanonicalizationError);
    assert.throws(() => canonicalize(Number.POSITIVE_INFINITY), CanonicalizationError);
    assert.throws(() => canonicalize({ a: Number.NEGATIVE_INFINITY }), CanonicalizationError);
  });
});

describe("strings", () => {
  test("non-ASCII characters are emitted literally, not escaped", () => {
    assert.equal(canonicalize("日本語"), '"日本語"');
    assert.equal(canonicalize("äpfel"), '"äpfel"');
  });

  test("characters outside the basic multilingual plane survive intact", () => {
    const sealed = "\u{1f512}";
    assert.equal(canonicalize(sealed), `"${sealed}"`);
    assert.equal(canonicalize({ a: sealed }), `{"a":"${sealed}"}`);
  });

  test("combining sequences are not normalized", () => {
    // RFC 8785 does not apply Unicode normalization: these two strings are
    // different inputs and must stay different.
    const precomposed = "é";
    const decomposed = "é";
    assert.notEqual(canonicalize(precomposed), canonicalize(decomposed));
  });

  test("control characters and quoting use the shortest JSON escapes", () => {
    assert.equal(canonicalize('a"b\\c'), '"a\\"b\\\\c"');
    assert.equal(canonicalize("\t\n\r\b\f"), '"\\t\\n\\r\\b\\f"');
    assert.equal(canonicalize(""), '"\\u0007"');
    assert.equal(canonicalize(""), '"\\u001f"');
  });

  test("the empty string and empty keys are handled", () => {
    assert.equal(canonicalize({ "": "" }), '{"":""}');
  });
});

describe("scalars", () => {
  test("literals serialize as JSON literals", () => {
    assert.equal(canonicalize(null), "null");
    assert.equal(canonicalize(true), "true");
    assert.equal(canonicalize(false), "false");
  });
});

describe("UTF-8 encoding", () => {
  test("the canonical form is encoded as UTF-8", () => {
    // "é" is two UTF-8 bytes, so the byte length exceeds the character length.
    const bytes = canonicalBytes("é");
    assert.equal(bytes.length, 4); // quote, two bytes, quote
    assert.equal(new TextDecoder().decode(bytes), '"é"');
  });

  test("a four-byte character is encoded as four bytes", () => {
    const bytes = canonicalBytes("\u{1f512}");
    assert.equal(bytes.length, 6); // quote, four bytes, quote
  });
});

describe("input guard", () => {
  test("values JSON cannot represent are rejected rather than coerced", () => {
    assert.throws(() => canonicalize(undefined), CanonicalizationError);
    assert.throws(() => canonicalize({ a: undefined }), CanonicalizationError);
    assert.throws(() => canonicalize([undefined]), CanonicalizationError);
    assert.throws(() => canonicalize(() => 1), CanonicalizationError);
    assert.throws(() => canonicalize(Symbol("x")), CanonicalizationError);
    assert.throws(() => canonicalize(10n), CanonicalizationError);
  });

  test("objects that are not plain JSON objects are rejected", () => {
    assert.throws(() => canonicalize(new Date(0)), CanonicalizationError);
    assert.throws(() => canonicalize(new Map()), CanonicalizationError);
    assert.throws(() => canonicalize({ a: new Set() }), CanonicalizationError);
  });

  test("an error names the location but never the value", () => {
    try {
      canonicalize({ credentials: { token: Number.NaN } });
      assert.fail("expected canonicalization to be rejected");
    } catch (error) {
      const message = (error as Error).message;
      assert.match(message, /\/credentials\/token/);
      assert.doesNotMatch(message, /NaN is not allowed at the value/);
    }
  });

  test("excessively deep structures are rejected before the stack is exhausted", () => {
    let deep: unknown = 1;
    for (let index = 0; index < MAX_JSON_DEPTH + 5; index += 1) {
      deep = { nested: deep };
    }
    assert.throws(() => canonicalize(deep), CanonicalizationError);
  });

  test("a structure just inside the depth limit is accepted", () => {
    let deep: unknown = 1;
    for (let index = 0; index < MAX_JSON_DEPTH - 2; index += 1) {
      deep = { nested: deep };
    }
    assert.doesNotThrow(() => canonicalize(deep));
  });

  test("assertJsonValue accepts anything JSON.parse can produce", () => {
    const parsed = JSON.parse('{"a":[1,"two",null,true,{"b":1.5}]}') as unknown;
    assert.doesNotThrow(() => assertJsonValue(parsed));
  });
});

describe("canonicalization identifiers", () => {
  test("RFC8785 is the identifier this verifier implements", () => {
    assert.equal(isSupportedCanonicalization("RFC8785"), true);
  });

  test("other identifiers are not silently accepted", () => {
    for (const identifier of ["rfc8785", "RFC-8785", "JCS", "JCS-RFC8785", "none"]) {
      assert.equal(isSupportedCanonicalization(identifier), false, identifier);
    }
  });
});
