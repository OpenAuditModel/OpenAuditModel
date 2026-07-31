/**
 * The three OpenAuditModel prompts.
 *
 * A prompt is guidance handed to the connected agent. This server runs no
 * model: it returns text, and the agent decides what to do with it. Nothing
 * here inspects a repository, and the server never sees the caller's source
 * code — step 1 of `instrument_operation` is explicitly the *host's* job.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";

function message(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

const SAFETY = `Throughout: never put a password, token, API key, connection string, private key, authorization header or session cookie into an audit event, and never paste one into this conversation. Do not capture full request or response bodies, message payloads or query strings. Prefer changed field names over changed values, references over embedded content, and stable opaque identifiers over email addresses.`;

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "design_audit_event",
    {
      title: "Design an audit event",
      description:
        "Work through designing a conforming OpenAuditModel event for an operation, then validate, privacy-lint and profile-check it.",
      argsSchema: z.object({
        operation: z.string().describe("The operation to be audited, in plain language."),
        domain: z.string().optional().describe("The application domain, if known."),
      }),
    },
    ({ operation, domain }) =>
      message(
        `Design an OpenAuditModel audit event for this operation: ${operation}${domain === undefined ? "" : ` (domain: ${domain})`}.

Work in this order.

1. Read the relevant resources before deciding anything:
   - openauditmodel://specification/event-model
   - openauditmodel://specification/actor-model
   - openauditmodel://semantic-conventions/event-naming
   Read openauditmodel://specification/privacy before choosing what to record.

2. Choose an event name of the form domain.resource.action, lower-case and dotted. Success and
   failure share one name and differ by outcome — do not invent a separate "-failed" name. Call
   get_event_guidance with the name to see what it requires.

3. Separate the three participants deliberately, because this is the most common modelling mistake:
   - actor: who technically performed the operation.
   - subject: whose authority was borrowed, and only then. An administrator acting ON a user has
     no subject; the user is the resource.
   - resource: what was acted upon.

4. Decide which context the audit purpose actually needs: authentication (how the actor proved
   identity), authorization (the policy decision), approval (a human decision), reason (why the
   operation was performed). Omit what is not needed — completeness is not the goal.

5. ${SAFETY}

6. Draft the event. Consider calling generate_event_template first for a skeleton with placeholders.

7. Call validate_event and fix every error.

8. Call lint_privacy. Treat findings as suspicions to investigate, and remember that a clean result
   does not prove the event is safe.

9. If the event is an identity or access operation, call check_profile with
   identity-and-access-management. If the profile reports not-applicable, that means no rule governs
   the event — it is not a conformance claim.`,
      ),
  );

  server.registerPrompt(
    "review_audit_event",
    {
      title: "Review an audit event",
      description:
        "Review an existing event for core conformance, privacy exposure, profile conformance and integrity, and explain the findings without reproducing sensitive values.",
      argsSchema: z.object({
        context: z.string().optional().describe("What the event is meant to record, if known."),
      }),
    },
    ({ context }) =>
      message(
        `Review an OpenAuditModel audit event.${context === undefined ? "" : ` Context: ${context}.`}

1. Call validate_event. Core conformance comes first: nothing else is meaningful for an event that
   is not well formed.

2. Call lint_privacy. Report each finding by rule identifier, severity, confidence and JSON Pointer.
   Do not quote, preview, prefix or reconstruct the value that produced a finding, and do not decode
   anything a finding points at. State plainly that a clean result is not proof the event is safe.

3. Call check_profile where the event belongs to a governed domain. Distinguish three outcomes:
   conforming, violations, and not-applicable. Not-applicable means no rule governs the event; it is
   not conformance and must not be reported as a pass.

4. If the event carries an integrity object, call verify_integrity. Describe the outcome as
   tamper-evidence: a valid digest means the event has not been altered since it was sealed. It does
   not prove the event was ever stored, is still stored, or belongs to a complete chain. For a set of
   chained events, call verify_chain.

5. Explain what each finding means for the audit purpose — what question the trail can no longer
   answer — rather than only restating the rule.

6. Recommend conceptual corrections. Do not rewrite the event automatically, and do not propose
   redacting a value in place: the fix for a secret in an audit record is to change the
   instrumentation that produced it and rotate the credential.

${SAFETY}`,
      ),
  );

  server.registerPrompt(
    "instrument_operation",
    {
      title: "Instrument an operation with audit events",
      description:
        "Add OpenAuditModel audit instrumentation to an application operation, using the host agent's own repository tools.",
      argsSchema: z.object({
        operation: z.string().describe("The operation to instrument."),
        language: z.string().optional().describe("Implementation language or framework, if known."),
      }),
    },
    ({ operation, language }) =>
      message(
        `Add OpenAuditModel audit instrumentation for: ${operation}${language === undefined ? "" : ` (${language})`}.

This MCP server has no access to your repository and will never see your source code. Use your own
file and search tools for every step that touches code.

1. Inspect the relevant code yourself: find where the operation is performed, and where it succeeds
   and fails.

2. Identify the actor and the request context available at that point — the authenticated principal,
   the request or correlation identifier, and the trace context if one exists.

3. Identify the primary resource the operation acts upon, and any genuinely affected related
   resources. The target of the operation is a resource, not a subject.

4. Instrument both paths. An audit trail that records only successes cannot answer the questions
   failures raise. A failure must carry a sanitized error code.

5. ${SAFETY} Map application data to audit fields explicitly, field by field — never by serializing
   whatever object was at hand.

6. Preserve application behaviour. Decide deliberately whether a failure to emit an audit event
   should fail the operation, and document the choice; both answers are defensible and the data
   cannot tell a reader which one you picked.

7. Add tests that assert the events are emitted for both paths, with the fields the audit purpose
   requires.

8. Call validate_event on a representative event from your tests, and fix every error.

9. Call lint_privacy on the same event.

10. Call check_profile where a profile governs the domain.

Read openauditmodel://specification/event-model and openauditmodel://specification/privacy before
writing the instrumentation.`,
      ),
  );
}

/** The prompt names this server exposes, in registration order. */
export const PROMPT_NAMES: readonly string[] = [
  "design_audit_event",
  "review_audit_event",
  "instrument_operation",
];
