/**
 * Structured application logging.
 *
 * The field list is an allowlist, and it is short on purpose. This service
 * receives audit event content from callers, and an audit event is precisely
 * the kind of document whose fields must not end up in an operator's log
 * aggregator. Nothing here accepts a request body, a tool argument, an event
 * name, an identifier, a digest or a finding — there is no parameter to pass
 * one through.
 */

export type LogLevel = "debug" | "info" | "error" | "silent";

/** The only fields an application log line may carry. */
export interface LogFields {
  readonly requestId?: string;
  readonly route?: string;
  readonly toolName?: string;
  readonly resultCategory?: string;
  /** An HTTP status code, and never anything else that happens to be a number. */
  readonly statusCode?: number;
  /** The bound listen port. Operator configuration, not caller data. */
  readonly port?: number;
  readonly durationMs?: number;
  readonly message?: string;
}

const ORDER: Record<Exclude<LogLevel, "silent">, number> = { debug: 10, info: 20, error: 30 };

export interface Logger {
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  error(fields: LogFields): void;
}

/**
 * Creates a logger that writes one JSON object per line.
 *
 * `toolName` is included because it is a fixed member of a published catalogue
 * of seven names — it identifies which analysis ran, and reveals nothing about
 * the caller's data. An *event* name is not included, because that would
 * describe the caller's business operations.
 */
export function createLogger(
  level: LogLevel,
  write: (line: string) => void = defaultWrite,
): Logger {
  const emit = (severity: Exclude<LogLevel, "silent">, fields: LogFields): void => {
    if (level === "silent" || ORDER[severity] < ORDER[level as Exclude<LogLevel, "silent">]) {
      return;
    }

    // Constructed field by field: no spread of a caller-supplied object, so an
    // unexpected property cannot ride along into the log.
    const line: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: severity,
    };
    if (fields.requestId !== undefined) line["requestId"] = fields.requestId;
    if (fields.route !== undefined) line["route"] = fields.route;
    if (fields.toolName !== undefined) line["toolName"] = fields.toolName;
    if (fields.resultCategory !== undefined) line["resultCategory"] = fields.resultCategory;
    if (fields.statusCode !== undefined) line["statusCode"] = fields.statusCode;
    if (fields.port !== undefined) line["port"] = fields.port;
    if (fields.durationMs !== undefined) line["durationMs"] = fields.durationMs;
    if (fields.message !== undefined) line["message"] = fields.message;

    write(JSON.stringify(line));
  };

  return {
    debug: (fields) => emit("debug", fields),
    info: (fields) => emit("info", fields),
    error: (fields) => emit("error", fields),
  };
}

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`);
}
