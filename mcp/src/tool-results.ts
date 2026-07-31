/**
 * Tool result shaping.
 *
 * Every tool returns a single JSON text block. One serialization point means
 * one place to audit for output safety, and a caller never has to reconcile a
 * prose summary with a structured payload that might disagree with it.
 */
import { serializeResult, toSafeError } from "./output-safety.js";

/**
 * A type alias rather than an interface: the SDK result type carries an index
 * signature, and TypeScript does not give an interface an implicit one.
 */
export type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function text(body: string, isError = false): ToolTextResult {
  return isError
    ? { content: [{ type: "text", text: body }], isError: true }
    : { content: [{ type: "text", text: body }] };
}

/**
 * Runs a tool body and converts the outcome into an MCP result.
 *
 * A thrown value never reaches the caller directly: {@link toSafeError} maps it
 * to a category, because an unexpected error's message may quote the input that
 * caused it and a stack trace names internal paths.
 */
export function runTool(body: () => unknown): ToolTextResult {
  try {
    return text(serializeResult(body()));
  } catch (cause) {
    const safe = toSafeError(cause);
    try {
      return text(serializeResult({ ok: false, error: safe }), true);
    } catch {
      return text(`{"ok":false,"error":{"code":"${safe.code}"}}`, true);
    }
  }
}
