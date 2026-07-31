#!/usr/bin/env node
/**
 * Entry point for the OpenAuditModel MCP server.
 *
 * Starts the HTTP boundary and shuts it down cleanly on a signal, which is what
 * a container orchestrator expects: SIGTERM first, then a bounded wait, then
 * exit. A process that ignores SIGTERM gets SIGKILL, and in-flight requests are
 * dropped rather than finished.
 */
import { loadConfig, ConfigurationError } from "./config.js";
import { createHttpApplication } from "./http-server.js";
import { createLogger } from "./logging.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (cause) {
    // A configuration error names the variable, never its value.
    const message = cause instanceof ConfigurationError ? cause.message : "invalid configuration";
    process.stderr.write(`${JSON.stringify({ level: "error", message })}\n`);
    process.exitCode = 78; // EX_CONFIG
    return;
  }

  const logger = createLogger(config.logLevel);
  const application = createHttpApplication(config, logger);
  const { port } = await application.listen();

  logger.info({ resultCategory: "started", port, message: "listening" });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ resultCategory: "shutdown", message: signal });

    // Stop accepting connections, let in-flight requests finish, then exit.
    // The timer does not keep the event loop alive, so a quiet server exits at
    // once rather than waiting out the full grace period.
    const timer = setTimeout(() => {
      logger.error({ resultCategory: "shutdown", message: "grace period expired" });
      process.exit(0);
    }, config.shutdownGraceMs);
    timer.unref();

    void application.close().then(() => {
      clearTimeout(timer);
      logger.info({ resultCategory: "shutdown", message: "closed" });
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main();
