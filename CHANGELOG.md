# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses a
specification version (`0.1`) and a repository version, tracked in `package.json`. The repository
version moves with the tooling; the specification version changes only when the schema or a
normative document changes meaning, and the two are stated separately in every release note.

While the project is **Experimental**, breaking changes are possible in any release and are labelled
as such. A change that alters the meaning of an existing field or event name is never acceptable — a
new name is introduced instead.

## 0.2.1 - 2026-08-12

Specification `0.1`, unchanged. Repository `0.2.1`. Documentation only; no behaviour changes.

### Added — prior art

The README gained a prior-art section, and the description of CADF was corrected in the README and
both CADF mappings documents: DSP0262 is a full event model with schema definitions, taxonomies and
federation interfaces, not only a conceptual reference. Merged after 0.2.0 was tagged; recorded
here.

### Fixed — documentation

- `specification/integrity.md` §2 still said signature verification is not part of v0.1,
  contradicting §6.1 and §9 of the same document after 0.2.0 shipped Ed25519 verification. It now
  states what the tooling does. The MCP resource manifest, which embeds the document, is
  regenerated to match.
- `SECURITY.md` described the public MCP endpoint as not yet deployed. It is deployed and
  answering, as the README already said; the two documents now agree.
- The README's v0.1 inventory counted "127 rules" without qualification. 113 are error-severity;
  14 are advisory warnings, which cannot fail conformance.
- This changelog's preamble claimed the specification and repository versions are aligned. They
  have differed since 0.2.0; the preamble now states the actual policy.
- The supported-versions table in `SECURITY.md` names the current 0.2.x release line. Added after
  the 0.2.0 tag; recorded here.

## 0.2.0 - 2026-08-05

### Added — Ed25519 signature verification

`integrity.signature` has been part of the schema since v0.1, but v0.1's `verify-integrity` and
`verify-chain` never checked it: the field could record a signature, and the tooling would say nothing
about whether it was genuine. Both commands now accept `--public-key <path>`, a PEM-encoded Ed25519
public key; when it is supplied and an event declares a signature, the signature is verified over the
same canonicalized digest input as `integrity.hash`, so a signed chain is exactly as tamper-evident as
a hashed one. Without `--public-key`, a declared signature is neither checked nor mentioned — every
existing invocation of either command behaves exactly as before.

The MCP server's `verify_integrity` and `verify_chain` tools gained the same capability, through an
optional `publicKeyPem` argument (a PEM string, since the server touches no filesystem) rather than a
path. A public key carries no confidentiality concern by definition, so this raises nothing the
server's existing per-call input model does not already handle.

A signature currently requires an accompanying `hash` to be checked: `verify-integrity` still reports
`hash-missing` for a signature-only event, before any signature logic runs. Signature-only events are
possible future work, not a defect in this one.

ECDSA-P256-SHA256 and RSA-PSS-SHA256 remain unimplemented, as recommended-but-optional identifiers the
schema already names; an event declaring either is reported `unsupported-signature-algorithm`, the
same way an unimplemented hash algorithm always has been.

See [ADR 0012](decisions/0012-ed25519-signature-verification.md) for why Ed25519 first, why a CLI flag
rather than a key registry, and why this needed no schema change.

- New fixtures: `examples/integrity/valid/signed-event-ed25519.json`,
  `examples/integrity/invalid/tampered-signed-event.json`,
  `examples/integrity/invalid/unsupported-signature-algorithm.json`, and the TEST-ONLY public key they
  verify against at `examples/integrity/keys/ed25519-test-public.pem`.

## 0.1.1 - 2026-08-04

### Fixed — the published package's own README said it was not published

`0.1.0`'s bundled `README.md` told a reader the CLI was "not yet published to a package registry" —
accurate when that sentence was written, false from the moment `npm publish` succeeded, and
uncorrectable in place: a published npm version's contents cannot be edited after the fact, only
superseded. `README.md` and the mirrored Quick Start section of the generated site now drive the CLI
through `npx @openauditmodel/cli` again, and `conformance/tests/readme-quick-start.test.ts` asserts
it, so the stale wording cannot silently come back. `0.1.0` is left exactly as published,
contradiction included — that is what an immutable version is for.

## 0.1.0 - 2026-08-04

First bootstrap of the OpenAuditModel v0.1 Experimental Specification, followed by the
tamper-evidence verification toolchain.

### Changed — the CLI is installable, and a scan that did not run no longer looks clean

**The package could not be consumed.** It was `private: true`, named `open-audit-model`, and its
`files` allowlist omitted `profiles/` — so even after publishing, `check-profile` would have failed
for every consumer with no profile to load. No test caught it, because every test reads the
repository. The package is now `@openauditmodel/cli`, publishable, with `auditmodel` as the canonical
binary and `openauditmodel` as an alias, and it ships the canonical schema, all ten profile
definitions, the semantic conventions and the specification.

- `scripts/verify-package.mjs` runs from `prepack` and refuses to build a tarball that omits the
  schema or the profiles, or that includes tests, fixtures, the MCP server or the privacy fixtures.
- `scripts/package-smoke-test.mjs` packs, installs into a throwaway directory outside the working
  tree and drives the installed binary. A new CI job runs it. It is the only check that can catch a
  path which resolves in the checkout and nowhere else.

**Exit code 3 now means "no verdict" across the whole CLI**, not just `check-profile`.
`lint-privacy` previously returned 1 for an input it could not evaluate, which was safe but
indistinguishable from a real finding. It now returns 3 and says plainly that the input is not an
OpenAuditModel event and was **not scanned**, so it can never be read as clean. A real finding still
outranks an unevaluated sibling in a mixed batch, because a finding is the actionable signal.

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | A verdict was produced and it passed.                                |
| `1`  | A verdict was produced and it failed.                                |
| `2`  | The tool could not run.                                              |
| `3`  | No verdict was produced. `check-profile`: no rule governs the event. |
|      | `lint-privacy`: the input is not an audit event and was not scanned. |

`EXIT_NOT_APPLICABLE` is retained as an alias of the new `EXIT_NO_VERDICT`, so nothing that imported
it changes.

**The README quick start now works, and is tested.** It previously showed a package name that was
never published, a positional profile argument the CLI rejects, and — once written out — an event
that fails schema validation, because `resource.type` may not contain a dot.
`conformance/tests/readme-quick-start.test.ts` extracts the event and the commands from `README.md`
itself and asserts every documented outcome, including that the event is deliberately
non-conforming to the financial profile and not-applicable to an unrelated one. Documentation that
drifts from behaviour now fails the build.

The quick start also states what `not-applicable` is not: the profile said nothing about the event,
which is not the same as approving it.

### Added — eight enforceable domain profiles

Eight profiles join `identity-and-access-management` and `document-management`, taking v0.1 from two
enforceable profiles to **ten** and from 22 rules to **127**. Every profile uses only the existing
declarative rule language: no engine change, no profile-schema change, no new `when` operator, no
array predicate, no regex or numeric rule.

| Profile                            | Rules | Valid | Invalid | Not applicable |
| ---------------------------------- | ----- | ----- | ------- | -------------- |
| `incident-management`              | 15    | 13    | 14      | 3              |
| `message-broker-management`        | 12    | 12    | 12      | 3              |
| `deployment-and-change-management` | 13    | 12    | 14      | 3              |
| `financial-transaction-management` | 12    | 12    | 12      | 3              |
| `secrets-and-key-management`       | 14    | 12    | 12      | 3              |
| `customer-and-account-management`  | 13    | 12    | 12      | 3              |
| `backup-and-recovery`              | 13    | 15    | 12      | 3              |
| `api-and-integration-management`   | 13    | 13    | 12      | 3              |

Each profile ships `profile.json`, a profile README, a fixture README, valid/invalid/not-applicable
fixtures and a conformance test file. All 100 new invalid fixtures fail with **exactly one** error at
the documented rule and pointer, and every enforceable rule has at least one negative fixture — both
verified across the whole set rather than asserted.

The four former placeholder profiles are now implemented. **There are no placeholder profiles left
in v0.1.**

**Design decisions carried across all eight**

- **High-volume data-plane events stay ungoverned, structurally.** Ordinary message publish and
  consume, routine API requests, webhook deliveries, automated secret retrieval, backup chunk writes,
  pipeline polling, balance views and customer searches match no rule, because no selector uses a
  prefix broad enough to sweep them in. Each profile carries not-applicable fixtures that would start
  conforming if a selector were widened.
- **Approval is never universally required.** It is required only on events that _are_ approvals, and
  otherwise gated on a producer-declared `/metadata/<domain>/approvalRequired` boolean. Continuous
  deployment, automatic key rotation, scheduled settlement and routine backups remain conforming
  without a human approval record. The profiles do not say when an organization must set that flag.
- **Metadata is namespaced per domain** (`/metadata/incident/…`, `/metadata/broker/…`,
  `/metadata/financial/…`), so an event governed by two profiles cannot have two meanings for one key.
- **No trace identifier is required**, because tracing may not exist. `/request/correlationId` is
  recommended for multi-stage workflows.
- **`/request/protocol` is never required**, so operations from HTTP, gRPC, Kafka, AMQP, RESP, SFTP,
  CLI, scheduled jobs and internal automation are equally conforming.
- **Broker ACL administration belongs to the broker profile, not `identity.*`** — it is a
  control-plane operation on a broker, not an identity change.
- **`/integrity/batchId` is not a backup identifier.** The backup profile uses
  `/metadata/backup/backupId`; `batchId` remains exclusively an integrity sealing or verification
  batch.

**Rule-language limitations, recorded rather than worked around**

- Array contents cannot be inspected, so no rule can require that `/evidence` contains an entry of a
  particular type. The incident profile _recommends_ `/evidence` instead of pretending to verify it.
- Numeric ranges cannot be checked. `/metadata/financial/amount` is required to be a number; no rule
  can assert a threshold.
- There is no cross-field comparison, so separation of duties, `resolvedAt > detectedAt` and
  agreement between a status field and `/change/after` are documented guidance, not enforced rules.
- One equality condition per rule, so compound policy is expressed through a single producer-derived
  boolean rather than several overlapping rules that would approximate an AND incorrectly.

**MCP**

All ten profiles are discoverable and checkable through the MCP server; `check_profile` derives its
profile list from the bundled manifest, so no code changed. The resource catalogue goes from
**21 to 29**. `npm run check:profile`, `npm run lint:privacy` and the CI profile job cover all ten.

### Fixed

- The CI profile loop was rewritten with real line continuations. An intermediate edit had left
  backslash-n as two literal characters in the `for PROFILE in …` list, which `bash -e` would have
  word-split into a bogus `n` profile name — aborting the job on its first iteration and silently
  checking **no** profile at all. Caught by adversarial review before it ever ran.
- The root README listed `document-management` as a placeholder after it had been implemented.

### Added — document management profile

- **A second implemented profile**, `document-management`, with 11 declarative rules covering
  document creation, deletion, download, versioning, sharing, access policy, retention and legal
  hold. It uses only the existing rule language — no engine change, no profile-schema change, and no
  rule that inspects array contents.
- **High-volume read events are deliberately ungoverned.** No selector uses a bare `document.`
  prefix, so `document.file.view` matches no rule and is reported as not applicable. Requiring an
  authorization decision and a justification on every document view would be switched off rather than
  met. A test asserts the exclusion, because widening one prefix later would silently govern every
  read in a deployment.
- 22 fixtures: 10 valid, 11 invalid, 1 not-applicable. Every valid fixture is core-conforming and
  privacy-clean; every invalid fixture is core-**valid** and fails **exactly one** rule, which a test
  enforces so that a negative fixture cannot pass for the wrong reason.
- `openauditmodel://profiles/document-management/0.1` is exposed as an MCP resource, taking the
  catalogue from **20 to 21 resources**. `npm run check:profile`, `npm run lint:privacy` and the CI
  profile job now cover both implemented profiles.

Design notes: metadata requirements are namespaced (`/metadata/share/...`) to match the IAM profile
and to keep two profiles from assigning different meanings to the same `/metadata` key. Approval is
recommended and never required, because many document systems legitimately let an owner delete their
own draft. Retention and legal-hold rules record **state and justification only** — they assert
nothing about how long anything must be kept, and conformance with them is not compliance with any
legal duty.

### Added — correlation and tracing guidance

- `semantic-conventions/correlation-and-tracing.md` — how to choose between `/id`,
  `/request/requestId`, `/request/traceId`, `/request/spanId` and `/request/correlationId` across
  HTTP, messaging, background jobs and workflows, including correlation for systems with no tracing
  at all. Informative. Exposed as MCP resource
  `openauditmodel://semantic-conventions/correlation-and-tracing`, taking the catalogue from
  **19 to 20 resources**.
- Four examples covering an HTTP entry point, a consumer that starts a new trace while keeping the
  business correlation, a scheduled job with no request context, and an approval workflow where
  `/request/requestId` and `/approval/requestId` legitimately coexist.
- An **experimental** extension for messaging causation, `org.openauditmodel.correlation.causes`. It
  is an array because a scalar cannot express fan-in, and it stays an extension because there is not
  enough production adoption evidence to freeze its shape in the core schema.

### Changed — normative correlation rules

**No change was made to the core JSON Schema**, the generated Ajv validator, CLI behaviour, privacy
rules, integrity rules, profiles, MCP tools or MCP prompts.

- `specification/event-model.md` §10 gains normative rules: correlation identifiers are observational
  metadata and MUST NOT be used as proof of identity, authorization, authenticity, integrity or
  tenant isolation; audit event generation MUST NOT depend on trace sampling; producers SHOULD take
  trace and span identifiers from the active trace context rather than generating them; `spanId`
  SHOULD be recorded only with `traceId`; raw `traceparent` and `tracestate` SHOULD NOT be stored;
  and sensitive values SHOULD NOT be used as correlation identifiers.
- **Corrected: trace context does not establish causality.** `specification/delivery.md` previously
  said to use trace context "for causality" and to establish ordering from it. A shared `traceId`
  groups events that belong to one execution; it says nothing about which caused which, or in what
  order. Ordering comes from `sequence`.
- **Corrected: the CloudEvents `correlationId` → `subject` mapping.** `subject` describes the event's
  subject within its `source`, so `resource` is the correct source for it where one applies. Carrying
  a correlation identifier there made `subject` unusable for the routing and filtering CloudEvents
  defines it for, and was not reversible for a consumer. `correlationId` is now left unmapped, with a
  documented custom extension attribute as the alternative.
- **Clarified: `/integrity/batchId` is a sealing or verification batch.** It does not identify a job
  run, processing batch, import batch or business operation; `/request/correlationId` is the field
  for those.
- Corrected the section cross-references in `specification/event-model.md` §1.2, which pointed one
  section low from `organization` onward.

### Fixed

- **`OAM_MAX_EVENT_BYTES` and `OAM_MAX_CHAIN_EVENTS` had no effect.** Both were parsed,
  range-checked, cross-validated against the request limit and documented as operator controls,
  while the tools enforced hardcoded constants instead. The configured values are now the values
  enforced, and `verify_chain` reports the configured limit rather than the built-in one. Default
  behaviour is unchanged, because the defaults on both sides were already identical — which is
  also why no existing test caught it. A test now runs a server on a non-default configuration,
  the only way the difference is observable.

### Changed — self-hosted Docker MCP server

- **The MCP server is no longer deployed to Cloudflare Workers.** It is now a stateless Node.js
  Streamable HTTP server distributed as a container image, self-hosted behind a reverse proxy that
  terminates TLS. The Worker was implemented and tested but never deployed, so nothing operational
  was lost. See `decisions/0011-self-hosted-docker-mcp-server.md`; ADR 0009 is marked superseded and
  retained as historical context.
- `workers/mcp/` moved to `mcp/`. The tools, prompts, resources, engines, output-safety rules and
  both generated artifacts are reused unchanged — the same seven tools, three prompts and nineteen
  resources, with the same names, URIs and result shapes. A connected client cannot tell the platform
  changed.
- MCP is now handled by the official packages: `createMcpHandler` from
  `@modelcontextprotocol/server` and `toNodeHandler` from `@modelcontextprotocol/node`, over plain
  `node:http`. No framework, and no vendor SDK between the project and MCP.
- The standalone Ajv validator is kept even though Node permits runtime compilation: it is Ajv’s own
  compiled logic, so the server’s verdict is identical to the CLI’s by construction, and the schema
  stays a build artifact rather than a runtime input.

**Added**

- `mcp/src/config.ts` — startup configuration, parsed and validated once, failing startup with a
  message that names the offending variable and never its value. Wildcard origins are rejected.
- `mcp/src/logging.ts` — structured logs with an allowlisted field set. There is no parameter
  through which a request body, event identifier, actor, resource, digest or finding could be logged.
- `mcp/src/http-server.ts` — routing, origin and host policy, request limits enforced while reading
  the body, and safe errors. `X-Forwarded-Host` is believed only behind a declared trusted proxy.
- Graceful shutdown on SIGTERM and SIGINT with a bounded grace period.
- `Dockerfile` — multi-stage, Debian slim, non-root, read-only-filesystem compatible, OCI labels,
  health check, exec-form entrypoint. `.dockerignore` excludes git metadata, tests and the synthetic
  privacy fixtures. The runtime image carries no package manager and no declarations or source maps:
  every Node-level CVE reported against the image came from npm’s own vendored tree rather than from
  a production dependency, and a production container has no reason to be able to install anything.
- `mcp/tests/logging.test.ts` — holds the log allowlist to the code, including that a property
  smuggled past the type system does not reach a log line.
- `deploy/docker-compose.yml` and `deploy/README.md` — hardened example plus an Nginx reverse-proxy
  configuration, DNS, environment, upgrade and rollback documentation.
- No image registry. The image is built locally with `docker build --tag openauditmodel-mcp:local`
  on whichever Docker daemon runs it, and started with Docker Compose. Nothing is pushed or pulled,
  and there is no registry account, login or credential anywhere in the repository. A release is a
  versioned local tag such as `openauditmodel-mcp:0.1.0-alpha.1`; `latest` is never used.
- `deploy/smoke-test.mjs` — dependency-free verification of a running deployment: `initialize`, the
  three catalogues, a real tool call, and the origin policy. CI runs the same script against a
  freshly built container, so a release gate and an operator’s check cannot drift apart.
- A CI job that builds the image and tests the container itself — health, non-root, read-only
  filesystem, absence of any package manager, absence of source and fixtures, MCP over Streamable
  HTTP, log content, and a clean SIGTERM exit. `npm run mcp:check-generated` and the MCP test suite
  now also run on every pull request rather than only at publish time.

**Removed**

- `workers/mcp/wrangler.jsonc`, `.github/workflows/deploy-mcp.yml`, the Cloudflare Worker entry
  point, and the `agents`, `wrangler` and `@cloudflare/workers-types` dependencies. Only one
  production MCP implementation exists.

### Added — remote MCP server

- `workers/mcp/` — a stateless Cloudflare Worker exposing the conformance engines over MCP
  Streamable HTTP at `/mcp`, built with `createMcpHandler` from `agents@0.20.1`. No Durable
  Objects, no SSE, no session state, no storage binding of any kind.
- Seven deterministic, read-only tools: `validate_event`, `verify_integrity`, `verify_chain`,
  `lint_privacy`, `check_profile`, `generate_event_template`, `get_event_guidance`. Each
  delegates to the existing engine rather than reimplementing it; parity is asserted by test.
- Three prompts: `design_audit_event`, `review_audit_event`, `instrument_operation`. The Worker
  runs no model and never sees a caller’s source repository.
- Nineteen read-only resources under `openauditmodel://`, compiled into the Worker from a build-time
  allowlist. The Worker reads no file and fetches nothing.
- `src/schema-validator.generated.ts` — Ajv standalone output for the canonical schema, because
  Workers forbid `new Function`. Because it is Ajv’s own compiled logic, Worker validation is
  identical to the CLI’s rather than an approximation. CI fails when either generated file is stale.
- Input limits with structured refusals: request body, event size, event count, JSON depth and output
  size. Input is never silently truncated.
- `decisions/0009-remote-cloudflare-mcp-server.md`; remote MCP threat model in `SECURITY.md`;
  `.github/workflows/deploy-mcp.yml`, which never deploys from a pull request.
- 36 Worker tests covering routing, Origin policy, MCP protocol, tool parity against the engines,
  output safety over the synthetic privacy fixtures, and the generated build artifacts.

### Changed — remote MCP server

- `conformance/src/validator-interface.ts` splits the compiled-validator seam away from Ajv, so a
  bundle that only validates carries no code generator. Verified: the Worker bundle contains no
  `new Function` and no `node:fs`.
- The conformance engines accept `EventValidator` rather than the filesystem-flavoured `Validator`.
- Package metadata now declares the official homepage and repository.

### Added — declarative profile conformance

**Profile definition format**

- `profiles/profile-definition.schema.json` — a Draft 2020-12 schema, identified by
  `https://openauditmodel.org/schemas/profile-definition/0.1/schema.json`, that validates **profile documents**. It is not
  part of the canonical audit event schema and never constrains an audit event.
- Six rule capabilities and nothing else: `events` and `eventPrefixes` selectors; `requiredPaths`,
  `requiredMetadata` and `requiredValues` requirements; `recommendedPaths` recommendations; and one
  `when` conditional comparing a single path for equality against a single scalar.
- The vocabulary has **no keyword that could relax a core requirement**. There is no `optionalPaths`,
  no `exemptPaths`, no `overrides`; a test reads the rule schema's property names and fails if any
  relaxation-shaped name appears.
- Profiles are versioned independently of the core and declare the `coreVersions` they apply to.

**Tooling**

- `auditmodel check-profile <path...> --profile <name>` — validates against the core schema, selects
  matching rules, evaluates them and reports per-rule, per-pointer findings. `--format json` produces
  a machine-readable report.
- `conformance/src/profiles/` — `types`, `resolve-pointer`, `validate-profile-definition`,
  `load-profile`, `select-rules`, `evaluate-rule` and `check-profile`, all usable independently of
  the CLI.
- Exit code `3` for `check-profile`: no checked event was governed by the profile. Distinct from `0`
  so that a pipeline cannot read "the profile said nothing" as "the profile was satisfied".

**Identity and access management profile**

- `profiles/identity-and-access-management/profile.json` — eleven rules covering user lifecycle, role
  assignment and revocation, permission grant and revoke, service account lifecycle and credential
  rotation. Expressed **entirely declaratively**, with no TypeScript.
- `IAM-ROLE-002` and `IAM-PERM-002` use the conditional mechanism: when the privileged flag is `true`,
  approval, authentication and `authentication.mfa` equal to `true` are required.
- Normative profile requirements that no tool can check — that the primary resource identifies the
  target, and that actor and target are not represented ambiguously — are documented as such rather
  than approximated by a rule that would be wrong.

**Fixtures**

- `examples/profiles/identity-and-access-management/` — seven conforming events, seven violating
  exactly one rule, and one event the profile does not govern. Every fixture is core-conforming: the
  invalid ones fail the profile, not the schema.

**Tests**

- 133 new tests. Profile definition validation including unknown properties, unsupported selectors,
  invalid pointers, invalid metadata types and invalid conditional operators; rule selection including
  prefix over-matching; JSON Pointer resolution including prototype unreachability; presence semantics
  including `false` and `0`; conditional evaluation including strict equality and absent predicates;
  and the documented CLI exit codes through child processes.
- **Core invariant tests**: a core-invalid event can never be profile-valid, profile rules are not
  evaluated for one, a profile cannot introduce a top-level property, and profile checking never
  mutates the input event.
- **Cross-command tests**: every valid profile fixture passes `validate`, `lint-privacy` and
  `check-profile`; credential and service-account fixtures are additionally checked field by field for
  secret-shaped members.

**Decisions**

- `decisions/0008-declarative-profile-conformance.md`, including security and compatibility
  considerations.

### Changed — declarative profile conformance

- `check-profile` is removed from the CLI's planned-command list.
- **Privacy rule refinement.** `OAM-PRIV-001` now reports a credential-named property holding a
  **scalar**; a container under such a name is treated as a descriptor and its members are inspected
  individually. The identity profile requires `/metadata/credential/type` for rotation events, and the
  previous rule reported every conforming rotation event as a critical finding. The accepted cost is a
  secret stored under a harmless member name inside such a container, documented in
  `specification/privacy.md` §6.9 and ADR 0007.
- No change to the canonical audit event schema was required.

### Added — privacy and secret-exposure linting

**Tooling**

- `auditmodel lint-privacy <path...>` — deterministic, local, read-only static analysis reporting
  suspected violations of `specification/privacy.md` §1 and §2. It sends nothing anywhere, resolves
  no reference, fetches no URL, opens no referenced file, uses no model or remote service, and never
  modifies or redacts an event.
- `--format json` for a machine-readable report.
- `conformance/src/privacy/` — `types`, `rules`, `field-names`, `safe-formats`, `entropy`,
  `token-patterns`, `url-analysis`, `size-analysis`, `traverse` and `lint-event`, all usable
  independently of the CLI.

**Rules** — 17 rules across 10 categories, each with a fixed severity and a confidence reported
separately:

- `OAM-PRIV-001` credential property names, matched exactly after normalization, including the final
  segment of a reverse-domain extension key.
- `OAM-PRIV-002` authorization header values; `OAM-PRIV-003` private key markers.
- `OAM-PRIV-010` structurally valid JSON Web Tokens; `OAM-PRIV-011` to `OAM-PRIV-016` published
  credential prefixes for access key identifiers, source forges, messaging, payments and cloud APIs.
- `OAM-PRIV-030` URLs with embedded user information; `OAM-PRIV-031` evidence references carrying a
  query string or fragment.
- `OAM-PRIV-040` connection strings carrying a password; `OAM-PRIV-041` connection strings without
  one, reported separately at low severity and explicitly not called a credential.
- `OAM-PRIV-050` the entropy heuristic, at low confidence; `OAM-PRIV-060` oversized values;
  `OAM-PRIV-061` raw request, response and message body fields.

**Specification**

- `specification/privacy.md` §6 rewritten: the four kinds of rule, what the linter checks, what it
  cannot check, why a finding is a suspicion and a clean result is not a clearance, why output never
  contains matched values, inspected paths, known-safe exclusions, fixed thresholds, false-positive
  and false-negative risk, why schema validation is not secret scanning, and exit codes.

**Fixtures**

- `examples/privacy/clean/` — five events that must produce no findings, exercising UUIDs, ULIDs,
  trace and span identifiers, digests, timestamps, safe evidence references and a credential rotation
  recorded as changed field names.
- `examples/privacy/findings/` — eleven events, each raising one documented rule. Every value is
  synthetic and non-functional; `examples/privacy/README.md` documents how and why.

**Tests**

- 197 new tests. Property-name matching including the negative cases that make name-based linters
  unusable (`passwordPolicy`, `tokenCount`, `authorizationDecision`, `requestBodyHash`); JWT
  structure including segments that decode to non-objects; published token formats with positive and
  negative cases; URL and connection-string analysis; every entropy exclusion; size thresholds;
  JSON Pointer escaping and traversal depth; and the documented CLI exit codes.
- Output-safety tests assert that no synthetic fixture value appears in either output format, backed
  by a companion test asserting those values are still present in the fixtures, so the assertion
  cannot silently become vacuous.
- A dogfooding test requires every published example outside `examples/privacy` to be clean. It
  caught a real false positive during implementation: path-shaped evidence references were tripping
  the entropy rule.

**Decisions**

- `decisions/0007-deterministic-privacy-linting.md`, including false-positive and false-negative
  strategies and security considerations.

### Changed — privacy and secret-exposure linting

- `lint-privacy` is removed from the CLI's planned-command list.
- No schema change was required: every rule reads values the canonical schema already permits.

### Added — tamper-evidence verification

**Specification**

- `specification/integrity.md` §4 — a **normative digest procedure**. Deep-clone the event, remove
  exactly `/integrity/hash` and `/integrity/signature`, serialize with RFC 8785, encode as UTF-8,
  hash, encode as lower-case hexadecimal, compare as bytes. No empty container is pruned: an
  `integrity` object left with no members serializes as `{}`.
- §4.1 — the normative inclusion set. `sequence`, `integrity.previousHash`, `integrity.chainId`,
  `integrity.batchId`, `integrity.hashAlgorithm` and `integrity.canonicalization` are **inside** the
  digest, so chain metadata cannot be rewritten without invalidating the event that carries it.
- §4.2 — the consequence for collectors: `observedTime` is inside the digest, so adding it to a
  sealed event invalidates it.
- §5 — lower-case hexadecimal as the single digest encoding, and why one encoding is mandatory.
- §6 — `SHA-256`, `SHA-384` and `SHA-512` as the algorithms conforming v0.1 tooling implements, with
  case-sensitive matching and the rule that schema acceptance is not verifier support.
- §7 — chain rules: `chainId`, `hash` and `sequence` required for chain membership, one algorithm and
  canonicalization per chain, unique sequences, gaps permitted, and the first-event rule (the genesis
  event omits `previousHash`; no genesis constant is defined).
- §7.3 — links compare against the predecessor's declared hash, with every declared hash
  independently verified.
- §8 — eleven statements of what verification does **not** prove, including tail truncation.

**Tooling**

- `auditmodel verify-integrity <path...>` — validates against the schema, confirms the declared
  canonicalization and algorithm are implemented, recalculates the digest and compares it.
- `auditmodel verify-chain <path...>` — groups events by `chainId`, orders by `sequence`, verifies
  every event digest and every link. Detects broken links, modified events, reordering, duplicate
  sequences, missing sequences, mixed algorithms, unsupported algorithms and unassignable events.
- `conformance/src/integrity/` — `canonicalize`, `digest`, `verify-event`, `verify-chain` and
  `types`, all usable independently of the CLI.
- `conformance/src/sources.ts` — shared event loading with an 8 MiB document limit, used by every
  command so that read, parse and size behaviour is identical everywhere.
- `sealEvent`, exported so that producers, fixtures and tests calculate digests with the same code
  the verifier uses. It performs no signing and touches no key material.
- `conformance/tools/generate-integrity-fixtures.ts` — generates every integrity fixture, with a
  `--check` mode that fails the build on drift. Nothing writes fixtures during a normal test run.

**Fixtures**

- `examples/integrity/valid/` — a sealed single event, a three-event chain, and an event exercising
  RFC 8785 determinism over mixed scripts, escapes, number forms and nesting.
- `examples/integrity/invalid/` — tampered event, wrong declared hash, unsupported algorithm, broken
  previous hash, duplicate sequence, missing sequence and reordered chain. Every fixture is a
  schema-valid event that fails verification rather than validation.
- `examples/integrity/README.md` documenting each fixture and its expected finding.

**Tests**

- 137 new tests: RFC 8785 conformance vectors written for this project (ordering by UTF-16 code unit,
  non-BMP characters, combining sequences, escapes, ECMAScript number forms, array order, UTF-8
  encoding, input guards, depth bound); digest exclusion and inclusion for every field; SHA-256,
  SHA-384 and SHA-512 round trips; digest comparison including malformed encodings; every chain
  failure mode; every published fixture; and the CLI's documented exit codes through a child process.
- A test asserts that failure output never contains event content.
- A test asserts that every published example carrying an `integrity.hash` verifies.

**Decisions**

- `decisions/0006-event-digest-and-chain-verification.md`.

### Changed — tamper-evidence verification

- **Breaking.** `integrity.hash` and `integrity.previousHash` are narrowed from the shared `digest`
  definition to a new `hexDigest` definition: lower-case hexadecimal, even length. An event that
  encoded either in base64 or upper-case hexadecimal was valid and is no longer valid. A digest that
  might be hexadecimal or base64 cannot be compared without guessing, and no published example or
  fixture was affected. See ADR 0006.
- **Breaking.** `integrity.canonicalization` is now required whenever `integrity.hash` is present,
  through `dependentRequired`. An event that declared a hash without a canonicalization was valid and
  is no longer valid, because such an event can never be verified by anyone. No published example or
  fixture was affected. See ADR 0006.
- **Non-breaking.** `auditmodel validate` now accepts a JSON array of events, and `.jsonl` and
  `.ndjson` files, in addition to a single-event JSON file or a directory. Its summary line counts
  events rather than files.
- **Non-breaking.** All commands refuse a document larger than 8 MiB, and reject a JSON structure
  nested more than 200 levels deep, rather than attempting to parse or canonicalize it.
- `verify-integrity` and `verify-chain` are removed from the CLI's planned-command list.

### Fixed

- `examples/valid/privileged-configuration-change.json` carried an invented `integrity.hash` that no
  verifier could reproduce. It is now correctly sealed and verifies, and a test keeps it that way.

### Security — tamper-evidence verification

- Digests are compared as bytes with `timingSafeEqual`, after both values are checked against the
  accepted encoding. Validating the encoding first is what prevents `Buffer.from(value, "hex")`
  truncating a malformed value into a comparison.
- Malformed encodings, unimplemented algorithms and unimplemented canonicalizations are reported.
  Nothing is guessed, coerced, padded or truncated to make a comparison succeed.
- `hashAlgorithm` and `canonicalization` are inside the digest, so relabelling a sealed event with a
  weaker algorithm invalidates it rather than changing how it is checked.
- Failure output contains file paths, JSON Pointers, digests and finding kinds — never event content
  — so verifying an event that mistakenly contains a secret does not copy it into a CI log.
- Verification resolves no remote reference, fetches no evidence URL and evaluates nothing contained
  in an event. All tests remain offline.

### Dependencies

- Added `canonicalize@^3.0.0` — RFC 8785 JSON Canonicalization Scheme. Apache-2.0, the same licence
  as this project; no transitive dependencies; pure ESM with type declarations; authored by the
  author of RFC 8785. Reviewed in ADR 0006.
- Upgraded `eslint` and `@eslint/js` to v10 to clear a transitive advisory in `brace-expansion`.
  `npm audit` reports no vulnerabilities.

### Added — initial bootstrap

**Specification**

- `specification/overview.md` — scope, conformance, document status labels, versioning and
  compatibility, relationship to other standards.
- `specification/terminology.md` — RFC 2119 and RFC 8174 normative keywords, and the project
  vocabulary.
- `specification/design-principles.md` — the twelve principles every proposed change is evaluated
  against.
- `specification/event-model.md` — top-level structure, identity, time, sequence, event descriptor,
  outcomes, severity, errors, naming rules, application, organization, request correlation, reason,
  control categories and tags.
- `specification/actor-model.md` — principals, the actor / subject / resource distinction, principal
  types and identifier guidance.
- `specification/resource-model.md` — resources, open-ended resource types, classification and
  related resources.
- `specification/authentication.md` — authentication context, and why absence differs from anonymous
  authentication.
- `specification/authorization.md` — authorization decisions, and why the model records decisions
  rather than evaluating policy.
- `specification/approval-and-delegation.md` — approval status, delegation types, and the subject
  requirement for delegated authority.
- `specification/change-model.md` — change types, and the four safe ways to describe a change.
- `specification/evidence-model.md` — evidence as references, never embedded payloads.
- `specification/privacy.md` — values that must never be recorded, the allowlist capture model, data
  minimization, and the limits of schema validation.
- `specification/integrity.md` — tamper-evidence, canonicalization, hash chaining, and seven
  guarantees integrity metadata does **not** provide.
- `specification/delivery.md` — transport independence, idempotency, ordering, gaps, and what
  pipeline components must not modify.
- `specification/extension-model.md` — `metadata` versus `extensions`, reverse-domain namespaces and
  promotion.

**Schema**

- `schemas/v0.1/audit-event.schema.json` — canonical JSON Schema Draft 2020-12, identified by
  `https://openauditmodel.org/schemas/audit-event/0.1/schema.json`.
- Seven required top-level fields: `specVersion`, `id`, `time`, `event`, `actor`, `resource`,
  `application`.
- Nineteen optional top-level fields covering observation time, sequence, subject, delegation,
  related resources, organization, authentication, authorization, approval, request correlation,
  change, reason, evidence, integrity, privacy, control categories, tags, metadata and extensions.
- `specVersion` pinned to `"0.1"` with `const`.
- All core objects reject unknown properties.
- Optional objects must carry at least one property when present.
- Conditional rule: `event.outcome` of `failure` requires `event.error`.
- Conditional rule: `delegation.type` of `impersonation`, `on-behalf-of` or `delegated` requires
  `subject`.
- Dependent rule: `integrity.hash` and `integrity.previousHash` require `integrity.hashAlgorithm`.
- Reverse-domain namespace enforcement for `extensions` keys, minimum three segments.
- W3C Trace Context compatible `traceId` and `spanId`, rejecting all-zero values.
- `request.route` rejects query strings and fragments.
- Recursive free-form JSON value definition for `metadata`, `extensions` and `attributes`.

**Semantic conventions**

- `semantic-conventions/` — README, event naming rules with recommended categories and activity
  types, plus conventions for authentication, identity and access, data access, configuration and
  change, workflow and approval, and privileged operations.

**Profiles**

- `profiles/` — README explaining what a profile may and may not do, and informative placeholders for
  document management, incident management, message broker management, identity and access
  management, and deployment and change management. No profile is implemented in v0.1.

**Mappings**

- `mappings/` — informative mappings and comparisons for CloudEvents, OpenTelemetry, ECS, OCSF and
  CADF, each stating what does not map.

**Examples**

- Seven valid conformance fixtures: minimal event, user role assignment, document external share,
  incident case close, privileged configuration change, message broker consumer offset reset, and
  service account data export.
- Seven invalid conformance fixtures, each failing for exactly one documented reason: missing actor,
  missing resource, invalid event name, failure without error, delegation without subject, invalid
  extension namespace and unknown core property.
- `examples/README.md` and `examples/invalid/README.md` documenting every fixture and its expected
  outcome.

**Conformance tooling**

- `auditmodel` CLI with the `validate` command, accepting files and directories.
- Exit codes: `0` valid, `1` schema validation failure, `2` usage, read or parse error.
- Validation errors reported with JSON Pointer paths, the failing keyword and contextual detail.
- Offline validation: no remote reference is resolved and no network access is required.
- 143 conformance tests covering meta-schema validation, every published fixture, conditional rules,
  extension namespaces, strict core objects, trace identifier formats, empty and required values,
  vocabulary tokens, regular expression portability, and the absence of product, country and
  regulation specific concepts in the core schema.

**Architecture decisions**

- `decisions/0001-specification-first.md`
- `decisions/0002-json-schema-2020-12.md`
- `decisions/0003-backend-and-transport-independence.md`
- `decisions/0004-reverse-domain-extension-namespaces.md`
- `decisions/0005-core-and-profile-separation.md`

**Project**

- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` and this changelog.
- Apache License 2.0 for all content, including specification text.
- GitHub issue templates for bug reports, specification changes and profile proposals.
- Continuous integration running formatting, linting, schema validation, the test suite, valid and
  invalid example validation, a build and a CLI smoke test on active Node.js LTS releases.

### Changed — initial bootstrap

- Nothing. This is the first version.

### Deprecated

- Nothing.

### Removed

- Nothing.

### Security — initial bootstrap

- Schema patterns avoid look-around and back-references, keeping behaviour identical across ECMA-262,
  RE2 and PCRE engines and avoiding catastrophic backtracking classes. Enforced by a test.
- String lengths and array sizes are bounded so that a validator is not asked to process an unbounded
  document as conforming.
- `privacy.md` states the values that must never be recorded, and states plainly that schema
  validation cannot detect them.
- `integrity.md` states what tamper-evidence does not provide, so that integrity metadata is not
  mistaken for storage immutability or evidentiary status.
