/**
 * The Node HTTP boundary.
 *
 * Plain `node:http`. No framework: the surface is four routes, and a framework
 * would add dependencies and middleware behaviour to a service whose whole
 * security argument is that very little happens between the socket and the
 * deterministic engines.
 *
 * MCP itself is handled by the official packages: `createMcpHandler` from
 * `@modelcontextprotocol/server` produces a fetch-shaped handler, and
 * `toNodeHandler` from `@modelcontextprotocol/node` adapts it to Node's
 * request and response objects. Statelessness is the SDK's default: each
 * request is served by a fresh server instance from the factory.
 *
 * Everything specific to this deployment — origin policy, host policy, request
 * size, logging, shutdown — lives here, deliberately separate from tool
 * registration, so that authentication can later wrap this boundary without
 * touching a tool.
 */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createServer as createMcpServer } from "./create-server.js";
import { createLogger, type Logger } from "./logging.js";
import type { ServerConfig } from "./config.js";

const JSON_TYPE = "application/json; charset=utf-8";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": JSON_TYPE,
    "content-length": Buffer.byteLength(payload).toString(),
    // The service serves JSON to programs; nothing here should ever be
    // interpreted as a document by a browser.
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

/**
 * Decides whether a browser Origin is acceptable.
 *
 * A request with **no** Origin is allowed: every non-browser MCP client omits
 * it, and rejecting those would reject essentially all legitimate traffic. A
 * present but unlisted Origin is refused, which is what stops a page on another
 * site from driving this endpoint with a user's browser.
 *
 * Comparison is on the parsed origin, not on the raw string, so
 * `https://openauditmodel.org.evil.example` cannot pass by prefix.
 */
export function isOriginAllowed(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (origin === undefined || origin === "") {
    return true;
  }
  if (origin.toLowerCase() === "null") {
    return false;
  }
  try {
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

/**
 * Host names a deployment answers on when `OAM_ALLOWED_HOSTS` is not set:
 * loopback only. A bare `docker run` or a local `npm run mcp:start` works
 * without configuration, and answering on a public name is something an
 * operator states rather than something the default hands out.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Decides whether the request's host is one this deployment answers on.
 *
 * With no `OAM_ALLOWED_HOSTS` configured, only loopback names are accepted.
 * `X-Forwarded-Host` is consulted **only** when the deployment declares itself
 * to be behind a trusted proxy. Believing a forwarded header by default would
 * let any client assert any host and defeat the check entirely; see the
 * reverse-proxy notes in deploy/README.md.
 */
export function isHostAllowed(
  headers: IncomingMessage["headers"],
  config: Pick<ServerConfig, "allowedHosts" | "trustProxy">,
): boolean {
  const allowed = config.allowedHosts.size === 0 ? LOCAL_HOSTS : config.allowedHosts;

  const forwarded = config.trustProxy
    ? String(headers["x-forwarded-host"] ?? "")
        .split(",")[0]
        ?.trim()
    : undefined;
  const host = (forwarded !== undefined && forwarded !== "" ? forwarded : (headers.host ?? ""))
    .toLowerCase()
    .trim();

  if (host === "") {
    return false;
  }
  // Compare without the port: a deployment is identified by its name.
  const withoutPort = host.startsWith("[")
    ? host.replace(/\]:\d+$/, "]")
    : (host.split(":")[0] ?? host);
  return allowed.has(withoutPort) || allowed.has(host);
}

/** Reads a request body, refusing anything above the configured limit. */
async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | "too-large"> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      return "too-large";
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export interface McpHttpServer {
  readonly server: Server;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

/** Builds the HTTP server. Nothing is bound until {@link McpHttpServer.listen}. */
export function createHttpApplication(
  config: ServerConfig,
  logger: Logger = createLogger(config.logLevel),
): McpHttpServer {
  // The configured limits, not the module defaults: OAM_MAX_EVENT_BYTES and
  // OAM_MAX_CHAIN_EVENTS are validated at startup and must be what the tools
  // actually enforce.
  const eventLimits = {
    maxEventBytes: config.maxEventBytes,
    maxEventsPerRequest: config.maxChainEvents,
  };

  // Stateless: the factory is invoked per request, so no session or transport
  // state is carried between callers.
  const mcpFetchHandler = createMcpHandler(() => createMcpServer(eventLimits), {
    // Reporting only. The callback receives SDK errors, never request content,
    // and the message is not forwarded to the client.
    onerror: (error) =>
      logger.error({ route: "/mcp", resultCategory: "mcp-error", message: error.name }),
  });
  const mcpNodeHandler = toNodeHandler(mcpFetchHandler);

  const server = createHttpServer((request, response) => {
    const started = Date.now();
    const requestId = randomUUID();
    const route = (request.url ?? "/").split("?")[0] ?? "/";

    const finish = (statusCode: number, resultCategory: string): void => {
      logger.info({
        requestId,
        route,
        statusCode,
        resultCategory,
        durationMs: Date.now() - started,
      });
    };

    void (async () => {
      try {
        if (!isHostAllowed(request.headers, config)) {
          sendJson(response, 403, { error: "forbidden" });
          finish(403, "host-rejected");
          return;
        }

        const origin = request.headers.origin;
        if (
          !isOriginAllowed(typeof origin === "string" ? origin : undefined, config.allowedOrigins)
        ) {
          sendJson(response, 403, { error: "forbidden" });
          finish(403, "origin-rejected");
          return;
        }

        if (route === "/health" && request.method === "GET") {
          sendJson(response, 200, { status: "ok" });
          finish(200, "ok");
          return;
        }

        if (route === "/" && request.method === "GET") {
          // Deliberately fixed: no version, no hostname, no container detail.
          sendJson(response, 200, {
            name: "OpenAuditModel MCP",
            status: "experimental",
            endpoint: "/mcp",
            website: "https://openauditmodel.org",
          });
          finish(200, "ok");
          return;
        }

        if (route === "/mcp") {
          let parsedBody: unknown;
          if (request.method === "POST") {
            const body = await readBody(request, config.maxRequestBytes);
            if (body === "too-large") {
              sendJson(response, 413, { error: "request body too large" });
              finish(413, "request-too-large");
              return;
            }
            if (body.length > 0) {
              try {
                parsedBody = JSON.parse(body.toString("utf8"));
              } catch {
                // The parser message can quote the body; it is not forwarded.
                sendJson(response, 400, { error: "invalid JSON" });
                finish(400, "invalid-json");
                return;
              }
            }
          }

          // The SDK adapter accepts a duck-typed request; Node's optional properties
          // differ only in strictness.
          await mcpNodeHandler(
            request as unknown as Parameters<typeof mcpNodeHandler>[0],
            response,
            parsedBody,
          );
          finish(response.statusCode, "mcp");
          return;
        }

        sendJson(response, 404, { error: "not found" });
        finish(404, "not-found");
      } catch (cause) {
        // An error message may quote the input that caused it, and a stack
        // trace names internal paths. Neither leaves the process.
        logger.error({
          requestId,
          route,
          resultCategory: "internal-error",
          message: cause instanceof Error ? cause.name : "unknown",
        });
        if (!response.headersSent) {
          sendJson(response, 500, { error: "internal error" });
        } else {
          response.end();
        }
        finish(500, "internal-error");
      }
    })();
  });

  // Bounded header and request timeouts, so a slow client cannot hold a
  // connection open indefinitely.
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.removeListener("error", reject);
          const address = server.address();
          resolve(
            typeof address === "object" && address !== null
              ? { host: config.host, port: address.port }
              : { host: config.host, port: config.port },
          );
        });
      }),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // Idle keep-alive sockets would otherwise hold the process open past
        // the grace period.
        server.closeIdleConnections();
      }),
  };
}
