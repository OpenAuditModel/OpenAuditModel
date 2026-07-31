/**
 * Tests that the canonical schema document is itself well formed, strict, and
 * free of the concepts the specification excludes from the core model.
 */
import assert from "node:assert/strict";
import path from "node:path";
import test, { describe } from "node:test";
import {
  createAjv,
  createValidator,
  loadSchema,
  resolveSchemaPath,
  SCHEMA_ID,
  SPEC_VERSION,
  validateSchemaDocument,
} from "../src/validate.js";

const schemaPath = resolveSchemaPath();
const schema = loadSchema(schemaPath);

/** Collects every string that appears anywhere in the schema, as key or as value. */
function collectStrings(node: unknown, sink: string[] = []): string[] {
  if (typeof node === "string") {
    sink.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) {
      collectStrings(item, sink);
    }
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      sink.push(key);
      collectStrings(value, sink);
    }
  }
  return sink;
}

/** Collects the value of every `pattern` keyword in the schema. */
function collectPatterns(node: unknown, sink: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectPatterns(item, sink);
    }
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "pattern" && typeof value === "string") {
        sink.push(value);
      }
      collectPatterns(value, sink);
    }
  }
  return sink;
}

const allStrings = collectStrings(schema);
const haystack = allStrings.join("\n").toLowerCase();

function assertAbsent(terms: readonly string[], reason: string): void {
  const found = terms.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(haystack));
  assert.deepEqual(found, [], `${reason}: ${found.join(", ")}`);
}

describe("canonical schema document", () => {
  test("passes Draft 2020-12 meta-schema validation", () => {
    const issues = validateSchemaDocument(schema);
    assert.deepEqual(issues, [], "schema is not a valid Draft 2020-12 schema");
  });

  test("declares Draft 2020-12 as its dialect", () => {
    assert.equal(schema["$schema"], "https://json-schema.org/draft/2020-12/schema");
  });

  test("uses the canonical HTTPS identifier", () => {
    assert.equal(schema["$id"], SCHEMA_ID);
    assert.equal(
      schema["$id"],
      `https://openauditmodel.org/schemas/audit-event/${SPEC_VERSION}/schema.json`,
    );
  });

  test("compiles without strict-mode complaints", () => {
    const ajv = createAjv();
    assert.doesNotThrow(() => ajv.compile(schema));
  });

  test("is titled as the OpenAuditModel Audit Event Schema", () => {
    assert.equal(schema["title"], "OpenAuditModel Audit Event Schema");
  });
});

describe("core structure", () => {
  test("requires exactly the seven core fields", () => {
    assert.deepEqual(schema["required"], [
      "specVersion",
      "id",
      "time",
      "event",
      "actor",
      "resource",
      "application",
    ]);
  });

  test("pins specVersion to a constant in this experimental version", () => {
    const properties = schema["properties"] as Record<string, Record<string, unknown>>;
    assert.equal(properties["specVersion"]?.["const"], SPEC_VERSION);
  });

  test("rejects unknown top-level properties", () => {
    assert.equal(schema["additionalProperties"], false);
  });

  test("every core object definition rejects unknown properties", () => {
    const defs = schema["$defs"] as Record<string, Record<string, unknown>>;
    const offenders = Object.entries(defs)
      .filter(([, definition]) => definition["properties"] !== undefined)
      .filter(([, definition]) => definition["additionalProperties"] !== false)
      .map(([name]) => name);

    assert.deepEqual(offenders, [], "core object definitions must be closed");
  });

  test("free-form containers stay open on purpose", () => {
    const defs = schema["$defs"] as Record<string, Record<string, unknown>>;
    assert.ok(defs["jsonValue"], "jsonValue definition is missing");
    assert.ok(defs["jsonObject"], "jsonObject definition is missing");
    assert.equal(defs["jsonObject"]?.["properties"], undefined);
  });

  test("declares the top-level optional fields the specification defines", () => {
    const properties = schema["properties"] as Record<string, unknown>;
    const expected = [
      "observedTime",
      "sequence",
      "subject",
      "delegation",
      "relatedResources",
      "organization",
      "authentication",
      "authorization",
      "approval",
      "request",
      "change",
      "reason",
      "evidence",
      "integrity",
      "privacy",
      "controlCategories",
      "tags",
      "metadata",
      "extensions",
    ];
    for (const field of expected) {
      assert.ok(field in properties, `optional top-level field "${field}" is missing`);
    }
  });
});

describe("neutrality of the core model", () => {
  test("contains no product, vendor or company specific concepts", () => {
    assertAbsent(
      [
        "aws",
        "azure",
        "gcp",
        "amazon",
        "google",
        "microsoft",
        "oracle",
        "salesforce",
        "servicenow",
        "workday",
        "splunk",
        "datadog",
        "elasticsearch",
        "kibana",
        "logstash",
        "snowflake",
        "databricks",
        "kafka",
        "rabbitmq",
        "redis",
        "mongodb",
        "postgresql",
        "mysql",
        "kubernetes",
        "openshift",
        "terraform",
        "github",
        "gitlab",
        "jira",
        "okta",
        "auth0",
        "keycloak",
        "cloudtrail",
      ],
      "core schema must not name products or vendors",
    );
  });

  test("contains no country or jurisdiction specific concepts", () => {
    assertAbsent(
      [
        "usa",
        "united states",
        "european union",
        "eea",
        "united kingdom",
        "germany",
        "france",
        "turkey",
        "india",
        "china",
        "japan",
        "brazil",
        "canada",
        "australia",
        "singapore",
        "switzerland",
      ],
      "core schema must not name countries or jurisdictions",
    );
  });

  test("contains no regulation or control framework specific concepts", () => {
    assertAbsent(
      [
        "gdpr",
        "hipaa",
        "sox",
        "pci",
        "pci-dss",
        "iso27001",
        "iso 27001",
        "soc2",
        "soc 2",
        "nist",
        "fedramp",
        "ccpa",
        "lgpd",
        "kvkk",
        "hitrust",
        "cobit",
        "fisma",
        "glba",
        "ferpa",
        "pipeda",
        "nis2",
        "dora",
        "oscal",
      ],
      "core schema must not name regulations or control frameworks",
    );
  });

  test("contains no http identifiers other than the meta-schema and the project's own", () => {
    // The only URLs permitted are the JSON Schema meta-schema and identifiers
    // under the project's own domain. A third-party URL in the core schema would
    // be a dependency on someone else's hosting; see ADR 0010.
    const urls = allStrings.filter((value) => /https?:\/\//i.test(value));
    const foreign = urls.filter(
      (url) =>
        url !== "https://json-schema.org/draft/2020-12/schema" &&
        !url.startsWith("https://openauditmodel.org/"),
    );
    assert.deepEqual(foreign, [], "the core schema must not reference third-party URLs");
    assert.ok(urls.includes(SCHEMA_ID), "the canonical identifier must appear in the schema");
  });

  test("does not enumerate resource types or event names in the core model", () => {
    const defs = schema["$defs"] as Record<string, Record<string, unknown>>;
    assert.equal(defs["eventName"]?.["enum"], undefined, "event names must stay open-ended");
    const resource = defs["resourceReference"] as Record<string, Record<string, unknown>>;
    const resourceProperties = resource["properties"] as Record<string, Record<string, unknown>>;
    assert.equal(
      resourceProperties["type"]?.["enum"],
      undefined,
      "resource types must stay open-ended",
    );
  });
});

describe("regular expression portability", () => {
  test("uses no look-around or back-references", () => {
    const patterns = collectPatterns(schema);
    assert.ok(patterns.length > 0, "expected the schema to constrain string values");

    const unportable = patterns.filter(
      (pattern) => /\(\?[=!<]/.test(pattern) || /\\[1-9]/.test(pattern),
    );
    assert.deepEqual(
      unportable,
      [],
      "patterns must remain portable across ECMA-262, RE2 and PCRE engines",
    );
  });

  test("every pattern is a compilable regular expression", () => {
    for (const pattern of collectPatterns(schema)) {
      assert.doesNotThrow(() => new RegExp(pattern), `pattern does not compile: ${pattern}`);
    }
  });
});

describe("schema discovery", () => {
  test("resolves from the compiled output directory", () => {
    assert.ok(schemaPath.endsWith(path.join("schemas", "v0.1", "audit-event.schema.json")));
  });

  test("the validator reports the canonical schema identifier", () => {
    const validator = createValidator();
    assert.equal(validator.schemaId, SCHEMA_ID);
  });
});
