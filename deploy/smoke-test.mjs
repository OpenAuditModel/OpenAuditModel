/**
 * Smoke-tests a running OpenAuditModel MCP deployment over Streamable HTTP.
 *
 * Checks what an operator actually needs to know after a deploy or an upgrade:
 * that the service answers, that the published catalogues are complete, that a
 * tool really runs, and that the origin policy is enforced. It sends no audit
 * event content beyond a synthetic fixture built here.
 *
 *   node deploy/smoke-test.mjs https://mcp.openauditmodel.org
 *   node deploy/smoke-test.mjs http://127.0.0.1:3000
 *
 * Exits 0 when every check passes and 1 otherwise, so it can gate a deploy.
 *
 * Requires only Node 22 or newer. It is deliberately dependency-free: an
 * operator should be able to run it against a deployment without installing
 * this repository.
 */

const EXPECTED = { tools: 7, prompts: 3, resources: 29 };

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const allowedOrigin = process.argv[3] ?? "https://openauditmodel.org";

let failures = 0;

function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Sends one JSON-RPC request. Streamable HTTP may answer as a single JSON
 * document or as an SSE stream, so both framings are accepted.
 */
async function rpc(method, params = {}, headers = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  const text = await response.text();
  let payload = text;
  if (text.includes("data: ")) {
    const dataLines = text.split("\n").filter((line) => line.startsWith("data: "));
    if (dataLines.length > 0) payload = dataLines[dataLines.length - 1].slice(6);
  }

  let json = null;
  try {
    json = JSON.parse(payload);
  } catch {
    // Left null; the caller reports the unparsed body.
  }
  return { status: response.status, json, text };
}

console.log(`OpenAuditModel MCP smoke test against ${base}\n`);

console.log("service");
const health = await fetch(`${base}/health`).catch(() => null);
check(
  "health endpoint answers",
  health?.ok === true,
  health ? `status ${health.status}` : "no response",
);

const initialize = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "openauditmodel-smoke-test", version: "0.1.0" },
});
check("initialize succeeds", initialize.status === 200, `status ${initialize.status}`);
const serverInfo = initialize.json?.result?.serverInfo;
check("server identifies itself", Boolean(serverInfo?.name), initialize.text.slice(0, 200));
if (serverInfo) console.log(`        ${serverInfo.name} ${serverInfo.version ?? ""}`.trimEnd());

console.log("\ncatalogues");
// Counted from the parsed arrays: a published catalogue is a public interface,
// and a missing entry breaks every connected agent that relies on it.
const tools = await rpc("tools/list");
const toolNames = (tools.json?.result?.tools ?? []).map((tool) => tool.name).sort();
check(`${EXPECTED.tools} tools`, toolNames.length === EXPECTED.tools, `got ${toolNames.length}`);

const prompts = await rpc("prompts/list");
const promptNames = (prompts.json?.result?.prompts ?? []).map((prompt) => prompt.name).sort();
check(
  `${EXPECTED.prompts} prompts`,
  promptNames.length === EXPECTED.prompts,
  `got ${promptNames.length}`,
);

const resources = await rpc("resources/list");
const uris = (resources.json?.result?.resources ?? []).map((resource) => resource.uri);
check(`${EXPECTED.resources} resources`, uris.length === EXPECTED.resources, `got ${uris.length}`);

console.log("\ntools run");
// A synthetic event, so the smoke test never sends real audit data anywhere.
const event = {
  specVersion: "0.1",
  id: "01952d4e-0000-7000-8000-000000000000",
  time: "2026-01-01T00:00:00.000Z",
  name: "smoke.test.run",
  outcome: "success",
  actor: { type: "service", id: "openauditmodel-smoke-test" },
  resource: { type: "smoke-test", id: "smoke-test" },
  source: { service: "openauditmodel-smoke-test" },
};

const validate = await rpc("tools/call", { name: "validate_event", arguments: { event } });
const verdict = validate.json?.result?.content?.[0]?.text ?? "";
check("validate_event returns a verdict", verdict.length > 0, validate.text.slice(0, 200));
check("the event it was given is not echoed back", !verdict.includes("openauditmodel-smoke-test"));

const guidance = await rpc("tools/call", {
  name: "get_event_guidance",
  arguments: { eventName: "user.create" },
});
check(
  "get_event_guidance answers",
  (guidance.json?.result?.content?.[0]?.text ?? "").length > 0,
  guidance.text.slice(0, 200),
);

if (uris.length > 0) {
  const read = await rpc("resources/read", { uri: uris[0] });
  const contents = read.json?.result?.contents?.[0]?.text ?? "";
  check("a resource can be read", contents.length > 0, `got ${contents.length} characters`);
}

console.log("\norigin policy");
// The lookalike must be refused: prefix matching here would let any attacker
// register a domain that starts with the allowed one.
const lookalike = await rpc("tools/list", {}, { origin: `${allowedOrigin}.evil.example` });
check("a lookalike origin is refused", lookalike.status === 403, `status ${lookalike.status}`);
const allowed = await rpc("tools/list", {}, { origin: allowedOrigin });
check("the allowed origin is accepted", allowed.status === 200, `status ${allowed.status}`);
// Every non-browser MCP client omits Origin entirely, so this must be accepted.
const noOrigin = await rpc("tools/list");
check("a request with no origin is accepted", noOrigin.status === 200, `status ${noOrigin.status}`);

console.log(
  failures === 0
    ? "\nAll checks passed."
    : `\n${failures} check${failures === 1 ? "" : "s"} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
