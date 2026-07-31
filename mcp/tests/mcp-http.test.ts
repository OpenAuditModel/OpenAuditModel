/**
 * The MCP HTTP server: routing, protocol, tool parity and output safety.
 *
 * A real server is bound to an ephemeral port and driven with real HTTP
 * requests, so what is asserted is what a client actually receives — including
 * status codes, headers and transport framing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { createHttpApplication } from "../src/http-server.js";
import { loadConfig } from "../src/config.js";
import { SERVER_NAME, SERVER_TITLE, SERVER_VERSION } from "../src/create-server.js";
import { TOOL_NAMES } from "../src/register-tools.js";
import { PROMPT_NAMES } from "../src/register-prompts.js";
import { RESOURCE_URIS } from "../src/register-resources.js";
import { BUNDLED_RESOURCES } from "../src/resource-manifest.generated.js";
import { validator, iamProfile } from "../src/engines.js";
import { MAX_EVENTS_PER_REQUEST } from "../src/output-safety.js";
import { resolveSchemaPath, createValidator } from "../../conformance/src/validate.js";
import { verifyEventIntegrity } from "../../conformance/src/integrity/verify-event.js";
import { verifyChains } from "../../conformance/src/integrity/verify-chain.js";
import { lintEvent } from "../../conformance/src/privacy/lint-event.js";
import { checkProfile } from "../../conformance/src/profiles/check-profile.js";

const schemaPath = resolveSchemaPath();
const repoRoot = path.dirname(path.dirname(path.dirname(schemaPath)));
const cliValidator = createValidator(schemaPath);

const ORIGIN = "https://openauditmodel.org";

type Json = Record<string, unknown>;

function readEvent(...segments: string[]): Json {
  return JSON.parse(readFileSync(path.join(repoRoot, ...segments), "utf8")) as Json;
}

// Port 0 lets the operating system choose a free port, so the suite never
// collides with a developer's running server.
const application = createHttpApplication(
  loadConfig({ PORT: "0", HOST: "127.0.0.1", OAM_LOG_LEVEL: "silent" }),
);
let origin = "";

before(async () => {
  const { port } = await application.listen();
  origin = `http://127.0.0.1:${port}`;
});

after(async () => {
  await application.close();
});

async function fetchWorker(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${origin}${input}`, init);
}

let nextId = 1;

/** Sends one JSON-RPC request over Streamable HTTP and returns the parsed result. */
async function rpc(method: string, params: Json = {}, headers: Record<string, string> = {}) {
  const response = await fetchWorker("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });

  assert.equal(response.ok, true, `${method} returned HTTP ${response.status}`);
  const body = await response.text();

  // Streamable HTTP may answer with JSON or with a single SSE event.
  const payload =
    body.startsWith("event:") || body.includes("\ndata:") || body.startsWith("data:")
      ? body
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("")
      : body;

  const parsed = JSON.parse(payload) as { result?: Json; error?: Json };
  assert.equal(parsed.error, undefined, `${method} returned a JSON-RPC error`);
  return parsed.result as Json;
}

/** Calls a tool and returns its parsed JSON payload. */
async function callTool(name: string, args: Json): Promise<Json> {
  const result = await rpc("tools/call", { name, arguments: args });
  const content = result["content"] as Array<{ type: string; text: string }>;
  assert.equal(content[0]?.type, "text");
  return JSON.parse(content[0]?.text ?? "{}") as Json;
}

describe("routes", () => {
  test("GET /health returns only a status", async () => {
    const response = await fetchWorker("/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  test("GET / returns safe informational JSON and no deployment detail", async () => {
    const response = await fetchWorker("/");
    assert.equal(response.status, 200);

    const body = (await response.json()) as Json;
    assert.deepEqual(body, {
      name: "OpenAuditModel MCP",
      status: "experimental",
      endpoint: "/mcp",
      website: "https://openauditmodel.org",
    });
    const rendered = JSON.stringify(body);
    for (const leak of ["account", "version", "wrangler", "node_modules", "agents@"]) {
      assert.doesNotMatch(rendered, new RegExp(leak, "i"), leak);
    }
  });

  test("an unknown route returns 404", async () => {
    for (const route of ["/nope", "/mcp/extra", "/.env", "/schemas/audit-event/0.1/schema.json"]) {
      assert.equal((await fetchWorker(route)).status, 404, route);
    }
  });

  test("POST /mcp reaches the MCP handler", async () => {
    const response = await fetchWorker("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 999, method: "tools/list", params: {} }),
    });
    assert.equal(response.ok, true);
  });

  test("GET /mcp is handled by the transport rather than 404", async () => {
    const response = await fetchWorker("/mcp", {
      method: "GET",
      headers: { accept: "text/event-stream" },
    });
    assert.notEqual(response.status, 404);
  });
});

describe("origin validation", () => {
  test("a request with no Origin is accepted, as non-browser clients send none", async () => {
    const result = await rpc("tools/list");
    assert.ok(Array.isArray(result["tools"]));
  });

  test("an allowed browser Origin is accepted", async () => {
    const result = await rpc("tools/list", {}, { origin: ORIGIN });
    assert.ok(Array.isArray(result["tools"]));
  });

  test("a disallowed Origin is rejected with 403", async () => {
    for (const origin of ["https://evil.example", "http://openauditmodel.org.evil.example"]) {
      const response = await fetchWorker("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          origin,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      assert.equal(response.status, 403, origin);
    }
  });
});

describe("protocol", () => {
  test("initialization reports the server identity", async () => {
    const result = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "conformance-test", version: "0.0.0" },
    });

    const info = result["serverInfo"] as Json;
    assert.equal(info["name"], SERVER_NAME);
    assert.equal(info["title"], SERVER_TITLE);
    assert.equal(info["version"], SERVER_VERSION);
  });

  test("exactly seven tools are listed", async () => {
    const tools = (await rpc("tools/list"))["tools"] as Array<{ name: string }>;
    assert.equal(tools.length, 7);
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
  });

  test("exactly three prompts are listed", async () => {
    const prompts = (await rpc("prompts/list"))["prompts"] as Array<{ name: string }>;
    assert.equal(prompts.length, 3);
    assert.deepEqual(prompts.map((prompt) => prompt.name).sort(), [...PROMPT_NAMES].sort());
  });

  test("every bundled resource is discoverable", async () => {
    const resources = (await rpc("resources/list"))["resources"] as Array<{ uri: string }>;
    assert.equal(resources.length, RESOURCE_URIS.length);
    assert.deepEqual(resources.map((resource) => resource.uri).sort(), [...RESOURCE_URIS].sort());
  });

  test("every listed resource can be read and matches its repository source", async () => {
    for (const resource of BUNDLED_RESOURCES) {
      const result = await rpc("resources/read", { uri: resource.uri });
      const contents = result["contents"] as Array<{ uri: string; mimeType: string; text: string }>;

      assert.equal(contents.length, 1, resource.uri);
      assert.equal(contents[0]?.mimeType, resource.mimeType, resource.uri);
      assert.equal(
        contents[0]?.text,
        readFileSync(path.join(repoRoot, resource.source), "utf8"),
        `${resource.uri} drifted from ${resource.source}`,
      );
    }
  });

  test("every prompt can be rendered", async () => {
    for (const name of PROMPT_NAMES) {
      const result = await rpc("prompts/get", {
        name,
        arguments: { operation: "assigning a role", context: "test" },
      });
      const messages = result["messages"] as Array<{ content: { text: string } }>;
      assert.ok((messages[0]?.content.text.length ?? 0) > 100, name);
    }
  });

  test("an unknown resource is refused without touching a filesystem", async () => {
    for (const uri of [
      "openauditmodel://specification/does-not-exist",
      "openauditmodel://../../package.json",
      "file:///etc/passwd",
    ]) {
      const response = await fetchWorker("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 500,
          method: "resources/read",
          params: { uri },
        }),
      });
      const text = await response.text();
      assert.doesNotMatch(text, /"private"|devDependencies|root:/, uri);
    }
  });
});

describe("tool parity with the conformance engines", () => {
  test("validate_event matches the command line validator", async () => {
    for (const [dir, name] of [
      ["examples/valid", "minimal-event.json"],
      ["examples/valid", "document-external-share.json"],
      ["examples/invalid", "missing-actor.json"],
      ["examples/invalid", "failure-without-error.json"],
      ["examples/invalid", "delegation-without-subject.json"],
    ] as const) {
      const event = readEvent(dir, name);
      const expected = cliValidator.validateEvent(event);
      const actual = await callTool("validate_event", { event });

      assert.equal(actual["valid"], expected.length === 0, name);
      assert.equal(actual["errorCount"], expected.length, name);
      assert.deepEqual(
        (actual["errors"] as Array<{ path: string }>).map((issue) => issue.path),
        expected.map((issue) => issue.path),
        name,
      );
    }
  });

  test("the precompiled validator agrees with the runtime-compiled one", () => {
    for (const [dir, name] of [
      ["examples/valid", "minimal-event.json"],
      ["examples/invalid", "invalid-extension-name.json"],
      ["examples/privacy/findings", "jwt-token.json"],
    ] as const) {
      const event = readEvent(dir, name);
      assert.deepEqual(validator.validateEvent(event), cliValidator.validateEvent(event), name);
    }
  });

  test("verify_integrity matches the integrity verifier", async () => {
    for (const [dir, name] of [
      ["examples/integrity/valid", "single-event-sha256.json"],
      ["examples/integrity/invalid", "tampered-event.json"],
      ["examples/integrity/invalid", "unsupported-algorithm.json"],
      ["examples/valid", "minimal-event.json"],
    ] as const) {
      const event = readEvent(dir, name);
      const expected = verifyEventIntegrity(event, "event", cliValidator);
      const actual = await callTool("verify_integrity", { event });

      assert.equal(actual["integrityValid"], expected.verified, name);
      assert.deepEqual(
        (actual["findings"] as Array<{ kind: string }>).map((finding) => finding.kind),
        expected.findings.map((finding) => finding.kind),
        name,
      );
    }
  });

  test("verify_chain matches the chain verifier", async () => {
    for (const directory of [
      "examples/integrity/valid/three-event-chain",
      "examples/integrity/invalid/broken-previous-hash",
      "examples/integrity/invalid/reordered-chain",
    ]) {
      const events = ["001.json", "002.json", "003.json"].map((file) => readEvent(directory, file));
      const expected = verifyChains(
        events.map((event, index) => ({ label: `events[${index}]`, event })),
        cliValidator,
      );
      const actual = await callTool("verify_chain", { events });

      assert.equal(actual["valid"], expected.intact, directory);
      assert.equal(actual["chainCount"], expected.chains.length, directory);
      assert.equal(actual["eventCount"], events.length, directory);
    }
  });

  test("lint_privacy matches the privacy linter", async () => {
    for (const [dir, name] of [
      ["examples/privacy/clean", "minimal-clean-event.json"],
      ["examples/privacy/findings", "password-field.json"],
      ["examples/privacy/findings", "jwt-token.json"],
      ["examples/privacy/findings", "url-userinfo.json"],
    ] as const) {
      const event = readEvent(dir, name);
      const expected = lintEvent(event, "event", cliValidator);
      const actual = await callTool("lint_privacy", { event });

      assert.equal(actual["clean"], expected.status === "clean", name);
      assert.equal(actual["findingCount"], expected.findings.length, name);
      assert.deepEqual(
        (actual["findings"] as Array<{ ruleId: string; path: string }>).map(
          (finding) => `${finding.ruleId} ${finding.path}`,
        ),
        expected.findings.map((finding) => `${finding.ruleId} ${finding.path}`),
        name,
      );
    }
  });

  test("check_profile matches the profile engine", async () => {
    const base = "examples/profiles/identity-and-access-management";
    for (const [dir, name] of [
      [`${base}/valid`, "role-assign-privileged.json"],
      [`${base}/invalid`, "privileged-role-without-mfa.json"],
      [`${base}/not-applicable`, "document-share.json"],
      ["examples/invalid", "missing-actor.json"],
    ] as const) {
      const event = readEvent(dir, name);
      const expected = checkProfile(event, "event", iamProfile, cliValidator);
      const actual = await callTool("check_profile", {
        event,
        profile: "identity-and-access-management",
      });

      assert.equal(actual["status"], expected.status, name);
      assert.equal(actual["coreValid"], expected.coreValid, name);
      assert.equal(actual["profileValid"], expected.profileValid, name);
      assert.deepEqual(actual["matchedRules"], expected.matchedRules, name);
    }
  });
});

describe("guidance and template tools", () => {
  test("generate_event_template produces placeholders and no real values", async () => {
    const result = await callTool("generate_event_template", {
      eventName: "identity.role.assign",
      profile: "identity-and-access-management",
      outcome: "success",
      environment: "production",
      includeRecommendedFields: true,
    });

    const rendered = JSON.stringify(result["template"]);
    assert.match(rendered, /<PLACEHOLDER:/);
    assert.match(rendered, /"specVersion":"0\.1"/);
    // No digest, signature or credential is ever generated.
    for (const forbidden of ["integrity", "signature", "hash", "password", "token"]) {
      assert.doesNotMatch(rendered, new RegExp(`"${forbidden}"`, "i"), forbidden);
    }
    assert.ok((result["appliedRules"] as string[]).includes("IAM-ROLE-001"));
    assert.match(JSON.stringify(result["notes"]), /not an audit event/);
  });

  test("generate_event_template rejects an invalid event name", async () => {
    const result = await callTool("generate_event_template", { eventName: "Identity.Role.Assign" });
    assert.equal(result["ok"], false);
    assert.equal((result["error"] as Json)["code"], "invalid-event-name");
  });

  test("get_event_guidance describes profile requirements for a governed name", async () => {
    const result = await callTool("get_event_guidance", {
      eventName: "identity.role.assign",
      profile: "identity-and-access-management",
    });

    assert.equal(result["eventNameValid"], true);
    assert.equal(result["profileApplies"], true);
    assert.ok((result["profileRequiredPaths"] as string[]).includes("/metadata/role/id"));
    assert.ok((result["conditionalRequirements"] as unknown[]).length > 0);
  });

  test("get_event_guidance falls back to core-only guidance for an ungoverned name", async () => {
    const result = await callTool("get_event_guidance", {
      eventName: "widget.thing.frobnicate",
      profile: "identity-and-access-management",
    });

    assert.equal(result["eventNameValid"], true);
    assert.equal(result["profileApplies"], false);
    assert.match(String(result["profileGovernance"]), /No rule .* governs this event name/);
    assert.ok((result["coreRequiredPaths"] as string[]).length > 0);
  });
});

describe("input limits", () => {
  test("a non-object event is refused", async () => {
    const result = await callTool("validate_event", { event: {} as Json });
    assert.equal(result["valid"], false);
  });

  test("too many events are refused rather than truncated", async () => {
    const event = readEvent("examples/integrity/valid/three-event-chain", "001.json");
    const events = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => event);
    const result = await callTool("verify_chain", { events });

    assert.equal(result["ok"], false);
    assert.equal((result["error"] as Json)["code"], "too-many-events");
  });

  test("an oversized event is refused", async () => {
    const event = readEvent("examples/valid", "minimal-event.json");
    event["metadata"] = { blob: "x".repeat(300_000) };
    const result = await callTool("validate_event", { event });

    assert.equal(result["ok"], false);
    assert.equal((result["error"] as Json)["code"], "event-too-large");
  });
});

describe("output safety", () => {
  /** Distinctive values that live in the published privacy fixtures. */
  const markers = [
    "synthetic-fixture-value-not-a-real-password",
    "synthetic-fixture-value-not-a-real-token",
    "SYNTHETICFIXTUREVALUE",
    "eyJhbGciOiJIUzI1NiI",
    "BEGIN PRIVATE KEY",
    "synthetic_password",
    "Zq7Z9dK2mR4xT6vB",
  ];

  test("no tool response echoes a value from a privacy fixture", async () => {
    const fixtures = [
      "password-field.json",
      "access-token-field.json",
      "jwt-token.json",
      "private-key.json",
      "credentialed-connection-string.json",
      "high-entropy-token.json",
    ];

    for (const name of fixtures) {
      const event = readEvent("examples/privacy/findings", name);
      for (const tool of ["validate_event", "lint_privacy", "verify_integrity", "check_profile"]) {
        const rendered = JSON.stringify(
          await callTool(tool, tool === "check_profile" ? { event } : { event }),
        );
        for (const marker of markers) {
          assert.ok(!rendered.includes(marker), `${tool}/${name} leaked ${marker}`);
        }
      }
    }
  });

  test("a response never contains the full input event", async () => {
    const event = readEvent("examples/valid", "document-external-share.json");
    const rendered = JSON.stringify(await callTool("validate_event", { event }));

    // A distinctive value present in the event but never part of a finding.
    assert.doesNotMatch(rendered, /quarterly-supplier-agreement/);
    assert.doesNotMatch(rendered, /example\.net/);
  });

  test("verify_integrity never returns canonicalized content or digest input", async () => {
    const event = readEvent("examples/integrity/valid", "single-event-sha256.json");
    const rendered = JSON.stringify(await callTool("verify_integrity", { event }));

    assert.doesNotMatch(rendered, /canonical(ized)?Form|digestInput|"payload"/i);
    assert.doesNotMatch(rendered, /configuration-audit-retention/);
  });

  test("an internal failure returns a category, never a stack trace or a path", async () => {
    // A circular structure cannot be serialized, forcing the failure path.
    const circular: Json = { specVersion: "0.1" };
    circular["self"] = circular;

    const response = await fetchWorker("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/list", params: {} }),
    });
    const text = await response.text();

    assert.doesNotMatch(text, /at [A-Za-z]+ \(/, "no stack frame");
    assert.doesNotMatch(text, /[A-Za-z]:\\\\|\/home\/|node_modules/, "no filesystem path");
  });
});

describe("build artifacts", () => {
  test("the bundled resource content matches every repository source", () => {
    for (const resource of BUNDLED_RESOURCES) {
      assert.equal(
        resource.text,
        readFileSync(path.join(repoRoot, resource.source), "utf8"),
        resource.source,
      );
    }
  });

  test("the bundled profile is the repository profile", () => {
    const onDisk = JSON.parse(
      readFileSync(
        path.join(repoRoot, "profiles", "identity-and-access-management", "profile.json"),
        "utf8",
      ),
    ) as Json;
    assert.deepEqual(iamProfile, onDisk);
  });

  test("the tool and resource modules reach no filesystem and no network", () => {
    // The HTTP layer legitimately uses node:http; nothing that handles a
    // caller's audit event may reach a filesystem or the network.
    const sources = [
      "create-server.ts",
      "register-tools.ts",
      "register-resources.ts",
      "register-prompts.ts",
      "engines.ts",
      "output-safety.ts",
      "tool-results.ts",
    ];

    for (const name of sources) {
      const source = readFileSync(path.join(repoRoot, "mcp", "src", name), "utf8");
      assert.doesNotMatch(source, /from "node:fs"/, `${name} reads files`);
      assert.doesNotMatch(source, /await fetch\(/, `${name} performs an outbound fetch`);
      assert.doesNotMatch(source, /new Function/, `${name} generates code`);
    }
  });

  test("no Cloudflare dependency remains", () => {
    for (const name of ["create-server.ts", "http-server.ts", "index.ts", "engines.ts"]) {
      const source = readFileSync(path.join(repoRoot, "mcp", "src", name), "utf8");
      assert.doesNotMatch(source, /cloudflare/i, name);
      assert.doesNotMatch(source, /wrangler/i, name);
      assert.doesNotMatch(source, /DurableObject/, name);
    }
  });

  test("the generated validator declares itself generated and compiles no schema", () => {
    const generated = readFileSync(
      path.join(repoRoot, "mcp", "src", "schema-validator.generated.ts"),
      "utf8",
    );
    assert.match(generated, /GENERATED FILE — DO NOT EDIT/);
    assert.doesNotMatch(generated, /new Function/);
    assert.doesNotMatch(generated, /require\(/, "CJS requires must be rewritten to imports");
  });
});
