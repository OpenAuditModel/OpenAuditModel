/**
 * The seven OpenAuditModel MCP tools.
 *
 * Every tool is deterministic, read-only, stateless and offline. None calls a
 * model, opens a socket, touches a filesystem or keeps anything between
 * requests. Each is a thin adapter over an existing conformance engine: the
 * analysis a caller gets here is the analysis the command line tool performs.
 */
import { z } from "zod";
import type { KeyObject } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { verifyEventIntegrity } from "../../conformance/src/integrity/verify-event.js";
import { verifyChains } from "../../conformance/src/integrity/verify-chain.js";
import { loadPublicKey } from "../../conformance/src/integrity/signature.js";
import { lintEvent } from "../../conformance/src/privacy/lint-event.js";
import { checkProfile } from "../../conformance/src/profiles/check-profile.js";
import { selectRules } from "../../conformance/src/profiles/select-rules.js";
import type { ProfileRule } from "../../conformance/src/profiles/types.js";
import {
  ENFORCEABLE_PROFILES,
  IAM_PROFILE_NAME,
  iamProfile,
  profileByName,
  SPEC_VERSION,
  validator,
} from "./engines.js";
import {
  assertEventsWithinLimits,
  assertEventWithinLimits,
  DEFAULT_EVENT_LIMITS,
  InputLimitError,
  type EventLimits,
} from "./output-safety.js";
import { runTool } from "./tool-results.js";

/** Events are opaque JSON objects; the canonical schema is what judges them. */
const eventSchema = z.record(z.string(), z.unknown());

/** The label passed to the engines. Never a caller-supplied value. */
const LABEL = "event";

const PRIVACY_NOTE =
  "A clean result does not mean the event is safe. The linter reports values shaped like secrets; a password that is a dictionary word, and most personal data, match nothing. See openauditmodel://specification/privacy.";

const MATCHED_RULES_NOTE =
  "matchedRules lists rules selected by the event-name selector. A conditional rule appears here when it governs the event even if its condition did not hold, in which case it contributed no requirements.";

/** Event name grammar, mirroring the canonical schema's eventName definition. */
const EVENT_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$/;

/**
 * The profile names the tools accept, as a Zod enum.
 *
 * Built from the profiles discovered in the bundled manifest, so publishing a
 * profile resource is what makes it selectable — there is no second list here to
 * fall out of step with the first.
 */
const profileName = z.enum(ENFORCEABLE_PROFILES as unknown as [string, ...string[]]);

function requireProfile(name: string) {
  const profile = profileByName(name);
  if (profile === undefined) {
    throw new InputLimitError(
      "unknown-profile",
      `no enforceable profile named "${name}"; available: ${ENFORCEABLE_PROFILES.join(", ")}`,
    );
  }
  return profile;
}

/**
 * Parses `publicKeyPem` into a key to verify `integrity.signature` against, or
 * `undefined` when the caller supplied none — in which case a declared
 * signature in an implemented algorithm is reported as declared but not
 * checked, and an unimplemented algorithm fails verification either way,
 * exactly as the CLI behaves without `--public-key`. The value is a PEM
 * string, not a path: this server touches no filesystem.
 *
 * On a parse failure the message is a fixed string, never `loadPublicKey`'s
 * own message: that message is Node's own OpenSSL decoder error, written by
 * neither this module nor `output-safety.ts`, and every other
 * {@link InputLimitError} in this file carries a message this module wrote
 * itself. Forwarding an external message here would be the one path where
 * that invariant is not enforced by construction.
 */
function resolvePublicKey(publicKeyPem: string | undefined): KeyObject | undefined {
  if (publicKeyPem === undefined) {
    return undefined;
  }
  try {
    return loadPublicKey(publicKeyPem);
  } catch {
    throw new InputLimitError(
      "invalid-public-key",
      "publicKeyPem could not be parsed as an Ed25519 public key",
    );
  }
}

/** Sets a value at a JSON Pointer inside a plain object, creating containers as needed. */
function setPointer(target: Record<string, unknown>, pointer: string, value: unknown): void {
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));

  let current: Record<string, unknown> = target;
  for (const [index, token] of tokens.entries()) {
    if (index === tokens.length - 1) {
      if (current[token] === undefined) {
        current[token] = value;
      }
      return;
    }
    const next = current[token];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      current[token] = {};
    }
    current = current[token] as Record<string, unknown>;
  }
}

const PLACEHOLDER_BY_TYPE: Readonly<Record<string, unknown>> = {
  string: "<PLACEHOLDER>",
  number: 0,
  integer: 0,
  boolean: false,
  object: {},
  array: [],
};

export function registerTools(server: McpServer, limits: EventLimits = DEFAULT_EVENT_LIMITS): void {
  server.registerTool(
    "validate_event",
    {
      title: "Validate an audit event",
      description:
        "Validates an audit event against the canonical OpenAuditModel schema and returns the failures with their JSON Pointers. The event itself is never returned.",
      inputSchema: z.object({ event: eventSchema }),
    },
    ({ event }) =>
      runTool(() => {
        assertEventWithinLimits(event, LABEL, limits);
        const issues = validator.validateEvent(event);
        const declared = (event as Record<string, unknown>)["specVersion"];

        return {
          valid: issues.length === 0,
          specVersion: typeof declared === "string" ? declared : null,
          expectedSpecVersion: SPEC_VERSION,
          schemaId: validator.schemaId,
          errorCount: issues.length,
          errors: issues.map((issue) => ({
            path: issue.path,
            keyword: issue.keyword,
            message: issue.message,
            ...(issue.detail === undefined ? {} : { detail: issue.detail }),
          })),
        };
      }),
  );

  server.registerTool(
    "verify_integrity",
    {
      title: "Verify an event's own digest",
      description:
        "Recalculates an event's integrity digest and compares it with the declared hash. Tamper-evident, not tamper-proof: it detects modification of the event supplied, and proves nothing about deletion. Canonicalized content and digest input are never returned. Optionally accepts publicKeyPem, a PEM-encoded Ed25519 public key, to additionally verify integrity.signature over the same digest input. Without it, a declared Ed25519 signature is reported as declared but not checked; a declared signature in an algorithm this verifier does not implement (such as ECDSA-P256-SHA256 or RSA-PSS-SHA256) fails verification whether or not a key is supplied.",
      inputSchema: z.object({ event: eventSchema, publicKeyPem: z.string().optional() }),
    },
    ({ event, publicKeyPem }) =>
      runTool(() => {
        assertEventWithinLimits(event, LABEL, limits);
        const publicKey = resolvePublicKey(publicKeyPem);
        const schemaValid = validator.validateEvent(event).length === 0;
        const result = verifyEventIntegrity(event, LABEL, validator, { publicKey });

        return {
          schemaValid,
          integrityValid: result.verified,
          algorithm: result.hashAlgorithm ?? null,
          canonicalization: result.canonicalization ?? null,
          checks: result.checks.map((check) => check.message),
          findings: result.findings.map((finding) => ({
            kind: finding.kind,
            message: finding.message,
          })),
          note: "Verification covers this event only. It does not prove the event was stored, is still stored, or belongs to a complete chain.",
        };
      }),
  );

  server.registerTool(
    "verify_chain",
    {
      title: "Verify previous-hash chains",
      description:
        "Groups events by chain identifier, orders them by sequence and verifies every digest and link. Proves consistency of the supplied set only: an attacker who removes the end of a chain leaves something internally consistent. Optionally accepts publicKeyPem, a PEM-encoded Ed25519 public key, applied to every event's integrity.signature the same way verify_integrity applies it; a declared signature in an unimplemented algorithm fails the event whether or not a key is supplied.",
      inputSchema: z.object({ events: z.array(eventSchema), publicKeyPem: z.string().optional() }),
    },
    ({ events, publicKeyPem }) =>
      runTool(() => {
        assertEventsWithinLimits(events, limits);
        const publicKey = resolvePublicKey(publicKeyPem);
        const report = verifyChains(
          events.map((event, index) => ({ label: `events[${index}]`, event })),
          validator,
          publicKey,
        );

        const validChains = report.chains.filter((chain) => chain.intact).length;
        return {
          valid: report.intact,
          eventCount: report.eventCount,
          chainCount: report.chains.length,
          validChainCount: validChains,
          invalidChainCount: report.chains.length - validChains,
          chains: report.chains.map((chain) => ({
            chainId: chain.chainId,
            eventCount: chain.eventCount,
            firstSequence: chain.firstSequence ?? null,
            lastSequence: chain.lastSequence ?? null,
            intact: chain.intact,
            findings: chain.findings.map((finding) => ({
              kind: finding.kind,
              label: finding.label ?? null,
              message: finding.message,
            })),
            notes: chain.notes.map((note) => note.message),
          })),
          unassigned: report.unassigned.map((finding) => ({
            kind: finding.kind,
            label: finding.label ?? null,
            message: finding.message,
          })),
          limits: { maxEventsPerRequest: limits.maxEventsPerRequest },
        };
      }),
  );

  server.registerTool(
    "lint_privacy",
    {
      title: "Report suspected privacy and secret exposure",
      description:
        "Deterministic static analysis reporting values shaped like credentials or unminimized payloads. Findings carry a rule, a severity, a confidence and a JSON Pointer, and never the value that produced them.",
      inputSchema: z.object({ event: eventSchema }),
    },
    ({ event }) =>
      runTool(() => {
        assertEventWithinLimits(event, LABEL, limits);
        const result = lintEvent(event, LABEL, validator);

        return {
          clean: result.status === "clean",
          status: result.status,
          findingCount: result.findings.length,
          findings: result.findings.map((finding) => ({
            ruleId: finding.ruleId,
            severity: finding.severity,
            confidence: finding.confidence,
            category: finding.category ?? null,
            path: finding.path,
            message: finding.message,
            recommendation: finding.recommendation ?? null,
          })),
          schemaIssues: result.schemaIssues,
          note: PRIVACY_NOTE,
        };
      }),
  );

  server.registerTool(
    "check_profile",
    {
      title: "Check an event against a domain profile",
      description:
        "Checks an event against a bundled, trusted profile. A profile only adds requirements: core validation runs first, and an event failing the core schema is reported as core-invalid with its profile rules not evaluated. Caller-supplied profile documents are not accepted.",
      inputSchema: z.object({
        event: eventSchema,
        profile: profileName.default(IAM_PROFILE_NAME),
      }),
    },
    ({ event, profile }) =>
      runTool(() => {
        assertEventWithinLimits(event, LABEL, limits);
        const definition = requireProfile(profile);
        const result = checkProfile(event, LABEL, definition, validator);

        return {
          status: result.status,
          coreValid: result.coreValid,
          profileValid: result.profileValid,
          profile: { name: result.profile.name, version: result.profile.version },
          matchedRules: result.matchedRules,
          matchedRulesMeaning: MATCHED_RULES_NOTE,
          errors: result.errors.map((finding) => ({
            ruleId: finding.ruleId,
            path: finding.path,
            severity: finding.severity,
            message: finding.message,
          })),
          warnings: result.warnings.map((finding) => ({
            ruleId: finding.ruleId,
            path: finding.path,
            severity: finding.severity,
            message: finding.message,
          })),
          coreIssues: result.coreIssues,
          notApplicableMeaning:
            "not-applicable means no rule in this profile governs the event. It is not conformance.",
        };
      }),
  );

  server.registerTool(
    "generate_event_template",
    {
      title: "Generate an audit event template",
      description:
        "Produces a vendor-neutral event skeleton with explicit placeholders, derived from the canonical schema and the bundled profile. The result is a template, not an audit event: it carries no real identity, no credential, no digest and no signature.",
      inputSchema: z.object({
        eventName: z.string(),
        profile: profileName.optional(),
        outcome: z.enum(["success", "failure", "partial", "unknown"]).default("success"),
        environment: z.string().default("production"),
        includeRecommendedFields: z.boolean().default(true),
      }),
    },
    ({ eventName, profile, outcome, environment, includeRecommendedFields }) =>
      runTool(() => {
        if (!EVENT_NAME.test(eventName)) {
          throw new InputLimitError(
            "invalid-event-name",
            "eventName must be a lower-case dotted name of at least two segments, such as identity.role.assign",
          );
        }

        const template: Record<string, unknown> = {
          specVersion: SPEC_VERSION,
          id: "<PLACEHOLDER:event-id>",
          time: "<PLACEHOLDER:rfc3339-timestamp>",
          event: {
            name: eventName,
            category: "<PLACEHOLDER:event-category>",
            outcome,
            ...(outcome === "failure" ? { error: { code: "<PLACEHOLDER:error-code>" } } : {}),
          },
          actor: { type: "<PLACEHOLDER:actor-type>", id: "<PLACEHOLDER:actor-id>" },
          resource: { type: "<PLACEHOLDER:resource-type>", id: "<PLACEHOLDER:resource-id>" },
          application: { name: "<PLACEHOLDER:application-name>", environment },
        };

        const notes: string[] = [
          "Every <PLACEHOLDER:...> value must be replaced before this is emitted as an audit event.",
          "This template is not an audit event and must not be recorded as one.",
          "No integrity hash or signature is generated: a digest must be calculated by the producer over its own final event.",
          "No identity, hostname, account or jurisdiction is inferred.",
        ];

        const appliedRules: string[] = [];
        if (profile !== undefined) {
          const definition = requireProfile(profile);
          const rules = selectRules(definition, eventName);

          for (const rule of rules) {
            appliedRules.push(rule.id);
            for (const pointer of rule.requiredPaths ?? []) {
              setPointer(template, pointer, "<PLACEHOLDER:required-by-profile>");
            }
            for (const requirement of rule.requiredMetadata ?? []) {
              setPointer(
                template,
                `/metadata${requirement.path}`,
                PLACEHOLDER_BY_TYPE[requirement.type] ?? "<PLACEHOLDER>",
              );
            }
            for (const requirement of rule.requiredValues ?? []) {
              setPointer(template, requirement.path, requirement.equals);
            }
            if (includeRecommendedFields) {
              for (const pointer of rule.recommendedPaths ?? []) {
                setPointer(template, pointer, "<PLACEHOLDER:recommended-by-profile>");
              }
            }
          }

          if (rules.length === 0) {
            notes.push(
              `No rule in the ${profile} profile governs "${eventName}", so no profile field was added.`,
            );
          } else {
            notes.push(
              "Fields required by a conditional rule are included; the condition may not apply to your event.",
            );
          }
        }

        return {
          eventName,
          profile: profile ?? null,
          appliedRules,
          template,
          placeholders: [
            {
              placeholder: "<PLACEHOLDER:event-id>",
              meaning: "A globally unique, idempotent identifier such as a UUIDv7 or ULID.",
            },
            {
              placeholder: "<PLACEHOLDER:rfc3339-timestamp>",
              meaning: "When the operation occurred, RFC 3339, UTC recommended.",
            },
            {
              placeholder: "<PLACEHOLDER:event-category>",
              meaning: "A coarse grouping; see openauditmodel://semantic-conventions/event-naming.",
            },
            {
              placeholder: "<PLACEHOLDER:actor-type>",
              meaning: "One of user, service, system, admin, external, unknown.",
            },
            {
              placeholder: "<PLACEHOLDER:actor-id>",
              meaning: "A stable opaque identifier, not an email address.",
            },
            {
              placeholder: "<PLACEHOLDER:resource-type>",
              meaning: "The kind of thing acted upon; an open vocabulary.",
            },
            {
              placeholder: "<PLACEHOLDER:resource-id>",
              meaning: "A stable identifier for the resource.",
            },
            {
              placeholder: "<PLACEHOLDER:application-name>",
              meaning: "The producing application, never a collector or store.",
            },
            {
              placeholder: "<PLACEHOLDER:required-by-profile>",
              meaning: "A value the selected profile requires at this path.",
            },
            {
              placeholder: "<PLACEHOLDER:recommended-by-profile>",
              meaning: "A value the selected profile recommends at this path.",
            },
          ],
          notes,
        };
      }),
  );

  server.registerTool(
    "get_event_guidance",
    {
      title: "Explain what an event name requires",
      description:
        "Derives guidance for an event name from the canonical schema, the bundled profile and the published conventions. For a name no profile governs, returns core-only guidance and says so.",
      inputSchema: z.object({
        eventName: z.string(),
        profile: profileName.optional(),
      }),
    },
    ({ eventName, profile }) =>
      runTool(() => {
        const nameValid = EVENT_NAME.test(eventName);
        const definition = profile === undefined ? undefined : requireProfile(profile);
        const rules: ProfileRule[] =
          definition === undefined || !nameValid ? [] : selectRules(definition, eventName);

        const requiredPaths = new Set<string>();
        const recommendedPaths = new Set<string>();
        const conditional: unknown[] = [];

        for (const rule of rules) {
          const target = rule.when === undefined ? requiredPaths : undefined;
          for (const pointer of rule.requiredPaths ?? []) {
            target?.add(pointer);
          }
          for (const requirement of rule.requiredMetadata ?? []) {
            target?.add(`/metadata${requirement.path}`);
          }
          for (const pointer of rule.recommendedPaths ?? []) {
            recommendedPaths.add(pointer);
          }
          if (rule.when !== undefined) {
            conditional.push({
              ruleId: rule.id,
              description: rule.description,
              condition: { path: rule.when.path, equals: rule.when.equals },
              thenRequires: [
                ...(rule.requiredPaths ?? []),
                ...(rule.requiredMetadata ?? []).map((entry) => `/metadata${entry.path}`),
              ],
              thenRequiresValues: (rule.requiredValues ?? []).map((entry) => ({
                path: entry.path,
                equals: entry.equals,
              })),
            });
          }
        }

        return {
          eventName,
          eventNameValid: nameValid,
          eventNameRule:
            "Lower-case, dot-separated, at least two segments, of the form domain.resource.action. Success and failure share one name and differ by outcome.",
          coreRequiredPaths: [
            "/specVersion",
            "/id",
            "/time",
            "/event/name",
            "/event/category",
            "/event/outcome",
            "/actor/type",
            "/actor/id",
            "/resource/type",
            "/resource/id",
            "/application/name",
            "/application/environment",
          ],
          coreConditionalRequirements: [
            "When /event/outcome is failure, /event/error is required.",
            "When /delegation/type is impersonation, on-behalf-of or delegated, /subject is required.",
            "When /integrity/hash is present, /integrity/hashAlgorithm and /integrity/canonicalization are required.",
          ],
          profile: profile ?? null,
          profileApplies: rules.length > 0,
          profileGovernance:
            rules.length > 0
              ? `${rules.length} rule(s) in the ${profile} profile govern this event name.`
              : profile === undefined
                ? "No profile was requested, so only core requirements are described."
                : `No rule in the ${profile} profile governs this event name, and no built-in semantic convention defines it. Core requirements still apply.`,
          matchedRules: rules.map((rule) => ({
            id: rule.id,
            description: rule.description,
            severity: rule.severity ?? "error",
            conditional: rule.when !== undefined,
          })),
          profileRequiredPaths: [...requiredPaths].sort(),
          profileRecommendedPaths: [...recommendedPaths].sort(),
          conditionalRequirements: conditional,
          privacyGuidance: [
            "Never record passwords, tokens, API keys, connection strings, private keys, authorization headers or session cookies.",
            "Do not capture full request or response bodies, message payloads or query strings.",
            "Prefer changed field names over changed values, and references over embedded content.",
            "Prefer stable opaque identifiers over email addresses and other direct personal identifiers.",
          ],
          resources: [
            "openauditmodel://specification/event-model",
            "openauditmodel://specification/actor-model",
            "openauditmodel://specification/privacy",
            "openauditmodel://semantic-conventions/event-naming",
          ],
        };
      }),
  );
}

/** The tool names this server exposes, in registration order. */
export const TOOL_NAMES: readonly string[] = [
  "validate_event",
  "verify_integrity",
  "verify_chain",
  "lint_privacy",
  "check_profile",
  "generate_event_template",
  "get_event_guidance",
];

export { iamProfile };
