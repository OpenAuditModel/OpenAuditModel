#!/usr/bin/env node
/**
 * Bundles the public OpenAuditModel documents the MCP server exposes.
 *
 * The container ships without the source repository, and the server is
 * forbidden from fetching anything at runtime. Resource content is therefore compiled into
 * a generated TypeScript module at build time.
 *
 * The catalogue below is an **allowlist**. Nothing is discovered by walking a
 * directory: a resource is exposed because it is named here. That is what keeps
 * test sources, synthetic secret fixtures, CI configuration and development
 * scripts out of a public endpoint, and it is why adding a resource is a
 * reviewable change rather than a side effect of adding a file.
 *
 * Usage:
 *   node scripts/generate-resource-manifest.mjs           write
 *   node scripts/generate-resource-manifest.mjs --check   fail if stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(here);
const repoRoot = path.dirname(packageRoot);

const OUTPUT_PATH = path.join(packageRoot, "src", "resource-manifest.generated.ts");

const MARKDOWN = "text/markdown";
const SCHEMA_JSON = "application/schema+json";
const JSON_MIME = "application/json";

/** The complete set of documents this server exposes. Nothing else is readable. */
const CATALOGUE = [
  // Specification
  [
    "openauditmodel://specification/overview",
    "specification/overview.md",
    MARKDOWN,
    "Specification: Overview",
    "Scope, conformance, document status labels and versioning.",
  ],
  [
    "openauditmodel://specification/event-model",
    "specification/event-model.md",
    MARKDOWN,
    "Specification: Event Model",
    "Top-level structure, identity, time, event descriptor, outcomes and naming.",
  ],
  [
    "openauditmodel://specification/actor-model",
    "specification/actor-model.md",
    MARKDOWN,
    "Specification: Actor Model",
    "Actor, subject and resource, and the distinction between them.",
  ],
  [
    "openauditmodel://specification/resource-model",
    "specification/resource-model.md",
    MARKDOWN,
    "Specification: Resource Model",
    "Resources, open-ended resource types, classification and related resources.",
  ],
  [
    "openauditmodel://specification/privacy",
    "specification/privacy.md",
    MARKDOWN,
    "Specification: Privacy",
    "Values that must never be recorded, the allowlist capture model and lint limits.",
  ],
  [
    "openauditmodel://specification/integrity",
    "specification/integrity.md",
    MARKDOWN,
    "Specification: Integrity",
    "Tamper-evidence, the normative digest procedure and what it does not prove.",
  ],
  [
    "openauditmodel://specification/extension-model",
    "specification/extension-model.md",
    MARKDOWN,
    "Specification: Extension Model",
    "metadata versus extensions, and reverse-domain namespaces.",
  ],

  // Canonical schemas
  [
    "openauditmodel://schema/audit-event/0.1",
    "schemas/v0.1/audit-event.schema.json",
    SCHEMA_JSON,
    "Canonical Audit Event Schema 0.1",
    "The canonical JSON Schema Draft 2020-12 definition of an audit event.",
  ],
  [
    "openauditmodel://schema/profile-definition/0.1",
    "profiles/profile-definition.schema.json",
    SCHEMA_JSON,
    "Profile Definition Schema 0.1",
    "Schema for profile documents. Never constrains an audit event.",
  ],

  // Semantic conventions
  [
    "openauditmodel://semantic-conventions/index",
    "semantic-conventions/README.md",
    MARKDOWN,
    "Semantic Conventions: Index",
    "How conventions relate to the core model and to profiles.",
  ],
  [
    "openauditmodel://semantic-conventions/event-naming",
    "semantic-conventions/event-naming.md",
    MARKDOWN,
    "Semantic Conventions: Event Naming",
    "The naming rule, recommended categories and activity types.",
  ],
  [
    "openauditmodel://semantic-conventions/identity-and-access",
    "semantic-conventions/identity-and-access.md",
    MARKDOWN,
    "Semantic Conventions: Identity and Access",
    "Accounts, roles, permissions and machine identities.",
  ],
  [
    "openauditmodel://semantic-conventions/data-access",
    "semantic-conventions/data-access.md",
    MARKDOWN,
    "Semantic Conventions: Data Access",
    "Reading, exporting, sharing and modifying data.",
  ],
  [
    "openauditmodel://semantic-conventions/configuration-and-change",
    "semantic-conventions/configuration-and-change.md",
    MARKDOWN,
    "Semantic Conventions: Configuration and Change",
    "Settings, secrets, deployments and change management.",
  ],
  [
    "openauditmodel://semantic-conventions/workflow-and-approval",
    "semantic-conventions/workflow-and-approval.md",
    MARKDOWN,
    "Semantic Conventions: Workflow and Approval",
    "Requests, approvals, workflow state and incident lifecycle.",
  ],
  [
    "openauditmodel://semantic-conventions/privileged-operations",
    "semantic-conventions/privileged-operations.md",
    MARKDOWN,
    "Semantic Conventions: Privileged Operations",
    "Administrative and break-glass operations.",
  ],
  [
    "openauditmodel://semantic-conventions/correlation-and-tracing",
    "semantic-conventions/correlation-and-tracing.md",
    MARKDOWN,
    "Semantic Conventions: Correlation and Tracing",
    "Choosing between request, trace, span and correlation identifiers across services and messages.",
  ],

  // Profiles
  [
    "openauditmodel://profiles/index",
    "profiles/README.md",
    MARKDOWN,
    "Profiles: Index",
    "What a profile may and may not do, and the profile definition format.",
  ],
  [
    "openauditmodel://profiles/identity-and-access-management/0.1",
    "profiles/identity-and-access-management/profile.json",
    JSON_MIME,
    "Identity and Access Management Profile 0.1",
    "The enforceable IAM profile definition: eleven declarative rules.",
  ],
  [
    "openauditmodel://profiles/document-management/0.1",
    "profiles/document-management/profile.json",
    JSON_MIME,
    "Document Management Profile 0.1",
    "The enforceable document-management profile definition: eleven declarative rules covering sharing, versioning, retention and legal hold.",
  ],
  [
    "openauditmodel://profiles/incident-management/0.1",
    "profiles/incident-management/profile.json",
    JSON_MIME,
    "Incident Management Profile 0.1",
    "The enforceable incident-management profile definition: incident, problem and corrective-action lifecycle.",
  ],
  [
    "openauditmodel://profiles/message-broker-management/0.1",
    "profiles/message-broker-management/profile.json",
    JSON_MIME,
    "Message Broker Management Profile 0.1",
    "The enforceable message-broker profile definition: broker control-plane and administrative operations.",
  ],
  [
    "openauditmodel://profiles/deployment-and-change-management/0.1",
    "profiles/deployment-and-change-management/profile.json",
    JSON_MIME,
    "Deployment and Change Management Profile 0.1",
    "The enforceable deployment profile definition: deployment, release, rollback and configuration change.",
  ],
  [
    "openauditmodel://profiles/financial-transaction-management/0.1",
    "profiles/financial-transaction-management/profile.json",
    JSON_MIME,
    "Financial Transaction Management Profile 0.1",
    "The enforceable financial profile definition: transfers, payments, reversals, settlement and limits.",
  ],
  [
    "openauditmodel://profiles/secrets-and-key-management/0.1",
    "profiles/secrets-and-key-management/profile.json",
    JSON_MIME,
    "Secrets and Key Management Profile 0.1",
    "The enforceable secrets profile definition: secret, key and certificate lifecycle and high-risk access.",
  ],
  [
    "openauditmodel://profiles/customer-and-account-management/0.1",
    "profiles/customer-and-account-management/profile.json",
    JSON_MIME,
    "Customer and Account Management Profile 0.1",
    "The enforceable customer profile definition: customer and business account lifecycle.",
  ],
  [
    "openauditmodel://profiles/backup-and-recovery/0.1",
    "profiles/backup-and-recovery/profile.json",
    JSON_MIME,
    "Backup and Recovery Profile 0.1",
    "The enforceable backup profile definition: backup, restore, recovery and failover operations.",
  ],
  [
    "openauditmodel://profiles/api-and-integration-management/0.1",
    "profiles/api-and-integration-management/profile.json",
    JSON_MIME,
    "API and Integration Management Profile 0.1",
    "The enforceable integration profile definition: API credential, webhook and integration lifecycle.",
  ],

  // Examples
  [
    "openauditmodel://examples/index",
    "examples/README.md",
    MARKDOWN,
    "Examples: Index",
    "The published example sets and what each demonstrates.",
  ],
];

function build() {
  const entries = CATALOGUE.map(([uri, source, mimeType, title, description]) => {
    const text = readFileSync(path.join(repoRoot, source), "utf8");
    return { uri, source, mimeType, title, description, text };
  });

  const body = entries
    .map(
      (entry) => `  {
    uri: ${JSON.stringify(entry.uri)},
    source: ${JSON.stringify(entry.source)},
    mimeType: ${JSON.stringify(entry.mimeType)},
    title: ${JSON.stringify(entry.title)},
    description: ${JSON.stringify(entry.description)},
    text: ${JSON.stringify(entry.text)},
  },`,
    )
    .join("\n");

  return `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by mcp/scripts/generate-resource-manifest.mjs from the
 * allowlist in that script. Regenerate with:
 *
 *   npm run generate --workspace mcp
 *
 * CI fails when this file is stale. Content is embedded so that the image ships
 * without the repository: the server reads no file and fetches nothing, and a
 * resource is exposed only because it is named in the allowlist.
 */

export interface BundledResource {
  readonly uri: string;
  /** Repository path the content came from, for the staleness check. */
  readonly source: string;
  readonly mimeType: string;
  readonly title: string;
  readonly description: string;
  readonly text: string;
}

export const BUNDLED_RESOURCES: readonly BundledResource[] = [
${body}
];
`;
}

const generated = build();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUTPUT_PATH, "utf8");
  } catch {
    process.stderr.write(`missing ${path.relative(repoRoot, OUTPUT_PATH)}\n`);
    process.exit(1);
  }
  if (current !== generated) {
    process.stderr.write(
      "the generated resource manifest is stale; run: npm run generate --workspace mcp\n",
    );
    process.exit(1);
  }
  process.stdout.write(`resource manifest is current (${CATALOGUE.length} resources)\n`);
} else {
  writeFileSync(OUTPUT_PATH, generated, "utf8");
  process.stdout.write(
    `wrote ${path.relative(repoRoot, OUTPUT_PATH)} (${CATALOGUE.length} resources, ${generated.length} bytes)\n`,
  );
}
