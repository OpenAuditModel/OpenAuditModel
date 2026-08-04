/**
 * Builds the OpenAuditModel MCP server.
 *
 * Registration is deliberately separate from transport. Nothing here knows it
 * is running in a server, which is what lets the protocol tests drive the same
 * server over an in-memory transport, and what will let authentication wrap the
 * HTTP boundary later without touching a single tool.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { registerTools } from "./register-tools.js";
import { registerResources } from "./register-resources.js";
import { registerPrompts } from "./register-prompts.js";
import { DEFAULT_EVENT_LIMITS, type EventLimits } from "./output-safety.js";

/** Server identity, as advertised during MCP initialization. */
export const SERVER_NAME = "openauditmodel";
export const SERVER_TITLE = "OpenAuditModel";

/** Repository version. Kept in step with the root package manifest. */
export const SERVER_VERSION = "0.2.0";

const INSTRUCTIONS = `OpenAuditModel: a common, verifiable and backend-independent audit event model for business applications.

This server performs deterministic, read-only analysis of audit events: schema validation, integrity and chain verification, privacy linting and profile conformance. No model runs inside it, nothing is persisted, and no tool has a side effect.

Data handling: MCP tool inputs are processed ephemerally by the OpenAuditModel MCP service. The service does not intentionally persist audit event content or include tool arguments in application logs. Users should review their organization's data-handling requirements before submitting production audit events to a remote MCP service.

Experimental. No compliance guarantee: conformance is a statement about the shape and semantics of data, never about compliance with any law, regulation, standard or contract.`;

/**
 * Creates a fully registered MCP server. Called once per request by the
 * stateless handler.
 *
 * `limits` comes from the startup configuration, so the values an operator sets
 * are the values enforced. It defaults to the built-in limits, which is what
 * keeps a bare `createServer()` — as the protocol tests call it — unchanged.
 */
export function createServer(limits: EventLimits = DEFAULT_EVENT_LIMITS): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerTools(server, limits);
  registerResources(server);
  registerPrompts(server);

  return server;
}
