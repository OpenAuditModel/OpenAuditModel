/**
 * Input limits and output safety for the remote MCP server.
 *
 * This server is remote. Callers submit audit event content over the network,
 * and that content may — despite every warning — contain a real secret. Two
 * rules follow, and everything in this module implements one of them:
 *
 *   1. Nothing a caller submits is echoed back beyond what a finding needs.
 *   2. Nothing a caller submits reaches a log, an error message or a stack
 *      trace that leaves the server.
 *
 * The conformance engines already guarantee that their findings carry JSON
 * Pointers and rule identifiers rather than values. This module guards the
 * boundary around them: the size of what comes in, and the shape of what an
 * unexpected failure sends out.
 */

/** Largest single event, measured as serialized JSON. */
export const MAX_EVENT_BYTES = 256_000;

/** Largest number of events accepted by `verify_chain` in one request. */
export const MAX_EVENTS_PER_REQUEST = 200;

/**
 * The input limits a registered tool enforces.
 *
 * Passed in rather than read from module constants so that the values an
 * operator configures are the values actually applied. The constants above
 * remain the defaults, so a caller that supplies nothing behaves exactly as
 * before.
 */
export interface EventLimits {
  readonly maxEventBytes: number;
  readonly maxEventsPerRequest: number;
}

export const DEFAULT_EVENT_LIMITS: EventLimits = {
  maxEventBytes: MAX_EVENT_BYTES,
  maxEventsPerRequest: MAX_EVENTS_PER_REQUEST,
};

/**
 * Deepest JSON structure accepted. Matches the conformance canonicalizer's
 * bound, so an event that passes here cannot fail deeper in an engine.
 */
export const MAX_JSON_DEPTH = 200;

/** Largest serialized tool result returned to a caller. */
export const MAX_OUTPUT_BYTES = 512_000;

/** A limit was exceeded. Carries no caller content. */
export class InputLimitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InputLimitError";
    this.code = code;
  }
}

/** Serialized byte length of a JSON value, or `undefined` if it cannot be serialized. */
export function serializedBytes(value: unknown): number | undefined {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : new TextEncoder().encode(text).length;
  } catch {
    return undefined;
  }
}

/** Depth of a JSON value, stopping as soon as the limit is exceeded. */
export function exceedsDepth(value: unknown, limit: number = MAX_JSON_DEPTH): boolean {
  const walk = (node: unknown, depth: number): boolean => {
    if (depth > limit) {
      return true;
    }
    if (Array.isArray(node)) {
      return node.some((item) => walk(item, depth + 1));
    }
    if (node !== null && typeof node === "object") {
      return Object.values(node as Record<string, unknown>).some((item) => walk(item, depth + 1));
    }
    return false;
  };
  return walk(value, 0);
}

/**
 * Checks one event against the input limits.
 *
 * Oversized input is refused, never truncated: silently validating part of an
 * event and reporting the result as a verdict on the whole would be worse than
 * refusing it.
 */
export function assertEventWithinLimits(
  event: unknown,
  label = "event",
  limits: EventLimits = DEFAULT_EVENT_LIMITS,
): void {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new InputLimitError("invalid-event", `${label} must be a JSON object`);
  }

  const bytes = serializedBytes(event);
  if (bytes === undefined) {
    throw new InputLimitError("unserializable-event", `${label} is not serializable JSON`);
  }
  if (bytes > limits.maxEventBytes) {
    throw new InputLimitError(
      "event-too-large",
      `${label} is ${bytes} bytes, above the ${limits.maxEventBytes} byte limit`,
    );
  }
  if (exceedsDepth(event)) {
    throw new InputLimitError(
      "event-too-deep",
      `${label} is nested more than ${MAX_JSON_DEPTH} levels deep`,
    );
  }
}

/** Checks an array of events against the per-request limits. */
export function assertEventsWithinLimits(
  events: unknown,
  limits: EventLimits = DEFAULT_EVENT_LIMITS,
): asserts events is unknown[] {
  if (!Array.isArray(events)) {
    throw new InputLimitError("invalid-events", "events must be a JSON array");
  }
  if (events.length === 0) {
    throw new InputLimitError("no-events", "events must contain at least one event");
  }
  if (events.length > limits.maxEventsPerRequest) {
    throw new InputLimitError(
      "too-many-events",
      `${events.length} events exceeds the limit of ${limits.maxEventsPerRequest} per request`,
    );
  }
  for (const [index, event] of events.entries()) {
    assertEventWithinLimits(event, `events[${index}]`, limits);
  }
}

/**
 * Converts any thrown value into a safe category.
 *
 * An {@link InputLimitError} message is written by this module and describes
 * sizes, never content, so it is returned. Anything else is replaced: an
 * unexpected error's message may quote the value that caused it, and a stack
 * trace names internal paths. Neither leaves the server.
 */
export function toSafeError(cause: unknown): { code: string; message: string } {
  if (cause instanceof InputLimitError) {
    return { code: cause.code, message: cause.message };
  }
  return {
    code: "internal-error",
    message:
      "the request could not be processed; details are withheld because an error message may quote the input",
  };
}

/**
 * Serializes a tool result, refusing to return an oversized body.
 *
 * The cap is a backstop: findings are bounded by the engines, but a
 * pathological event could still produce a very large finding list, and a
 * truncated JSON document would be worse than an explicit refusal.
 */
export function serializeResult(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) {
    throw new InputLimitError("unserializable-result", "the result could not be serialized");
  }
  if (new TextEncoder().encode(text).length > MAX_OUTPUT_BYTES) {
    throw new InputLimitError(
      "result-too-large",
      `the result exceeds the ${MAX_OUTPUT_BYTES} byte output limit`,
    );
  }
  return text;
}
