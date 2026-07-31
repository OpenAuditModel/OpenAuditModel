/**
 * Startup configuration.
 *
 * Parsed and validated once, at startup, so that a misconfigured deployment
 * fails immediately and visibly rather than on the first request that happens to
 * exercise the bad value. Nothing here is read again while the server runs.
 *
 * No configuration value is ever logged: an allowlist is not a secret, but a
 * habit of printing environment variables is how one eventually gets printed.
 */

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  /** Origins a browser may use. Empty means no browser origin is accepted. */
  readonly allowedOrigins: ReadonlySet<string>;
  /** Hostnames accepted in Host / X-Forwarded-Host. Empty disables the check. */
  readonly allowedHosts: ReadonlySet<string>;
  /** Whether X-Forwarded-Host may be believed. Only behind a trusted proxy. */
  readonly trustProxy: boolean;
  readonly maxRequestBytes: number;
  readonly maxEventBytes: number;
  readonly maxChainEvents: number;
  readonly logLevel: "debug" | "info" | "error" | "silent";
  readonly shutdownGraceMs: number;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const DEFAULT_ORIGINS = ["https://openauditmodel.org", "https://www.openauditmodel.org"];

const DEFAULTS = {
  port: 3000,
  host: "0.0.0.0",
  maxRequestBytes: 1_000_000,
  maxEventBytes: 256_000,
  maxChainEvents: 200,
  shutdownGraceMs: 10_000,
} as const;

type Env = Record<string, string | undefined>;

function readInteger(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    // The name is named; the value is not echoed.
    throw new ConfigurationError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Parses an origin list into a set of normalized origins.
 *
 * A wildcard is rejected outright rather than supported and discouraged: an
 * allowlist with `*` in it is not an allowlist, and the only way to be sure
 * nobody configures one by accident is for it to fail startup.
 */
function readOrigins(env: Env): Set<string> {
  const raw = env["OAM_ALLOWED_ORIGINS"];
  const entries = (raw === undefined || raw.trim() === "" ? DEFAULT_ORIGINS.join(",") : raw)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  const origins = new Set<string>();
  for (const entry of entries) {
    if (entry === "*") {
      throw new ConfigurationError(
        "OAM_ALLOWED_ORIGINS must not contain a wildcard; list the origins explicitly",
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new ConfigurationError(
        "OAM_ALLOWED_ORIGINS must contain absolute origins such as https://example.org",
      );
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ConfigurationError("OAM_ALLOWED_ORIGINS entries must use http or https");
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function readHosts(env: Env): Set<string> {
  const raw = env["OAM_ALLOWED_HOSTS"];
  if (raw === undefined || raw.trim() === "") {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== ""),
  );
}

function readLogLevel(env: Env): ServerConfig["logLevel"] {
  const raw = (env["OAM_LOG_LEVEL"] ?? "info").trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "error" || raw === "silent") {
    return raw;
  }
  throw new ConfigurationError("OAM_LOG_LEVEL must be one of debug, info, error, silent");
}

/** Builds the configuration, throwing {@link ConfigurationError} on bad input. */
export function loadConfig(env: Env = process.env): ServerConfig {
  // 0 is permitted and means "let the operating system choose a free port",
  // which is how the test suite binds without colliding with a running server.
  const port = readInteger(env, "PORT", DEFAULTS.port, 0, 65_535);
  const host = (env["HOST"] ?? DEFAULTS.host).trim() || DEFAULTS.host;

  const maxRequestBytes = readInteger(
    env,
    "OAM_MAX_REQUEST_BYTES",
    DEFAULTS.maxRequestBytes,
    1_024,
    64 * 1_024 * 1_024,
  );
  const maxEventBytes = readInteger(
    env,
    "OAM_MAX_EVENT_BYTES",
    DEFAULTS.maxEventBytes,
    1_024,
    maxRequestBytes,
  );

  return {
    host,
    port,
    allowedOrigins: readOrigins(env),
    allowedHosts: readHosts(env),
    trustProxy: (env["OAM_TRUST_PROXY"] ?? "").trim().toLowerCase() === "true",
    maxRequestBytes,
    maxEventBytes,
    maxChainEvents: readInteger(env, "OAM_MAX_CHAIN_EVENTS", DEFAULTS.maxChainEvents, 1, 10_000),
    logLevel: readLogLevel(env),
    shutdownGraceMs: readInteger(
      env,
      "OAM_SHUTDOWN_GRACE_MS",
      DEFAULTS.shutdownGraceMs,
      0,
      120_000,
    ),
  };
}
