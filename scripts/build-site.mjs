#!/usr/bin/env node
/**
 * Builds the static site from the repository.
 *
 * The site's primary job is to serve the canonical schema identifiers at the
 * exact URLs recorded in `$id`, forever. Those URLs do **not** mirror the
 * repository layout:
 *
 *   /schemas/audit-event/0.1/schema.json        <- schemas/v0.1/audit-event.schema.json
 *   /schemas/profile-definition/0.1/schema.json <- profiles/profile-definition.schema.json
 *
 * The directory is `v0.1` but the URL segment is `0.1`, and the profile
 * definition schema does not live under `schemas/` at all. Copying directories
 * verbatim produces two 404s that nobody notices until a consumer tries to
 * dereference an identifier.
 *
 * Every published file is copied byte for byte from the repository. There is no
 * second, hand-edited copy to drift, and `--check` proves it.
 *
 *   node scripts/build-site.mjs           write site/
 *   node scripts/build-site.mjs --check   fail if site/ differs from the repository
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "site");
const check = process.argv.includes("--check");

const auditEvent = JSON.parse(
  readFileSync(path.join(root, "schemas", "v0.1", "audit-event.schema.json"), "utf8"),
);
const profileDefinition = JSON.parse(
  readFileSync(path.join(root, "profiles", "profile-definition.schema.json"), "utf8"),
);

/** Turns a canonical `$id` into the site-relative path it must be served from. */
function pathForId(id) {
  const url = new URL(id);
  if (url.origin !== "https://openauditmodel.org") {
    throw new Error(`$id is not on the canonical origin: ${id}`);
  }
  return url.pathname.replace(/^\//, "");
}

const files = new Map();
const copies = [];

/** Publishes a repository file at a site path, verbatim. */
function publish(sitePath, sourceRelative) {
  copies.push([sitePath, sourceRelative]);
}

// The two canonical schemas, at the URLs their own $id declares.
publish(pathForId(auditEvent.$id), "schemas/v0.1/audit-event.schema.json");
publish(pathForId(profileDefinition.$id), "profiles/profile-definition.schema.json");

publish("assets/logo.png", "assets/logo.png");

// Profile definitions. These are addresses, not identities: a profile document
// carries `name` and `version`, not an `$id`, so nothing should pin these URLs
// as canonical identifiers. The site says so in prose.
const profiles = readdirSync(path.join(root, "profiles"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(root, "profiles", e.name, "profile.json")))
  .map((e) => e.name)
  .sort();

for (const name of profiles) {
  const definition = JSON.parse(
    readFileSync(path.join(root, "profiles", name, "profile.json"), "utf8"),
  );
  publish(`profiles/${name}/${definition.version}/profile.json`, `profiles/${name}/profile.json`);
}

for (const [sitePath, sourceRelative] of copies) {
  files.set(sitePath, readFileSync(path.join(root, sourceRelative)));
}

const RULE_COUNT = profiles.reduce(
  (total, name) =>
    total +
    JSON.parse(readFileSync(path.join(root, "profiles", name, "profile.json"), "utf8")).rules
      .length,
  0,
);

const MINIMAL = readFileSync(
  path.join(root, "examples", "valid", "minimal-event.json"),
  "utf8",
).trim();

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenAuditModel — one audit model for every application</title>
    <meta
      name="description"
      content="A common, verifiable and backend-independent audit event model for business applications."
    />
    <style>
      :root { color-scheme: light; --fg: #16181d; --bg: #fff; --muted: #5b6270; --line: #e3e6ec; --code: #f6f7f9; --accent: #1f4fd8; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0 1.25rem 5rem; color: var(--fg); background: var(--bg);
             font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      main { max-width: 46rem; margin: 0 auto; }
      header { padding: 3.5rem 0 1rem; }
      h1 { font-size: 1.9rem; margin: 0 0 .35rem; letter-spacing: -0.01em; }
      .tagline { color: var(--muted); margin: 0 0 1.25rem; font-size: 1.05rem; }
      h2 { font-size: 1.15rem; margin: 2.5rem 0 .6rem; }
      p, li { color: var(--fg); }
      a { color: var(--accent); }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .875rem; }
      pre { background: var(--code); border: 1px solid var(--line); border-radius: 8px;
            padding: .9rem 1rem; overflow-x: auto; }
      code { background: var(--code); padding: .1rem .3rem; border-radius: 4px; }
      pre code { background: none; padding: 0; }
      .status { border: 1px solid var(--line); border-radius: 8px; padding: .85rem 1rem;
                margin: 1.5rem 0; color: var(--muted); font-size: .9rem; }
      table { border-collapse: collapse; width: 100%; font-size: .9rem; }
      th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--line); }
      th { color: var(--muted); font-weight: 600; }
      footer { margin-top: 3.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
               color: var(--muted); font-size: .875rem; }
      .grid { display: grid; gap: .35rem; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1><img src="/assets/logo.png" alt="OpenAuditModel" height="56" /></h1>
        <p class="tagline">One audit model for every application.</p>
        <p>
          A common, verifiable and backend-independent audit event model for business applications.
          It defines <strong>what an audit event is</strong> — not where it is stored, how it is
          transported, or which regulation it satisfies.
        </p>
      </header>

      <div class="status">
        <strong>Version 0.1 · Experimental · Not production-ready · No compliance guarantee.</strong>
        Field names, constraints and vocabularies may all change. Conformance to this specification
        is not compliance with any law, regulation, standard or contract.
      </div>

      <h2>Why</h2>
      <p>
        Almost every application records auditable operations, and almost every application invents
        its own shape for them. The result: records that cannot be validated until a defect is found
        years later in retained data; two systems' audit trails that cannot be read together without
        bespoke translation; the same questions — what is an actor, how is acting on behalf of someone
        recorded, where does an approval go — re-litigated on every new application; and audit data
        that quietly accumulates secrets and personal data because nobody decided what belongs in it.
        OpenAuditModel answers those questions once, in a shape a validator can check.
      </p>

      <h2>A minimal event</h2>
      <p>Seven required fields. Everything else is optional context.</p>
      <pre><code>${MINIMAL.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</code></pre>

      <h2>Check one</h2>
      <p>Not yet published to a package registry. Requires Node.js 22 or newer.</p>
      <pre><code>git clone https://github.com/OpenAuditModel/OpenAuditModel.git
cd OpenAuditModel && npm install && npm run build

npm run auditmodel -- validate audit-event.json
npm run auditmodel -- lint-privacy audit-event.json
npm run auditmodel -- check-profile audit-event.json --profile financial-transaction-management</code></pre>
      <p>
        Exit <code>0</code> means a verdict was produced and it passed. <code>1</code> means it
        failed. <code>2</code> means the tool could not run. <code>3</code> means
        <strong>no verdict was produced</strong> — the profile governs no rule for that event, or the
        input was not an audit event and was never scanned. <code>3</code> is never an approval.
      </p>

      <h2>Canonical schemas</h2>
      <p>
        These URLs are the identifiers recorded in each schema's <code>$id</code>. They are stable and
        the versioned documents are immutable. Nothing needs to fetch them: validation is offline, and
        an identifier is a name rather than a fetch instruction.
      </p>
      <div class="grid">
        <a href="/schemas/audit-event/0.1/schema.json"><code>/schemas/audit-event/0.1/schema.json</code></a>
        <a href="/schemas/profile-definition/0.1/schema.json"><code>/schemas/profile-definition/0.1/schema.json</code></a>
      </div>

      <h2>Domain profiles</h2>
      <p>
        ${profiles.length} enforceable profiles, ${RULE_COUNT} rules. A profile only ever
        <em>adds</em> requirements to the core model; none relaxes it. An event no rule governs is
        reported as not-applicable, never as conforming.
      </p>
      <p>
        The addresses below serve each profile document. They are <strong>addresses, not
        identities</strong>: a profile carries <code>name</code> and <code>version</code>, not an
        <code>$id</code>, so nothing should pin these URLs as canonical identifiers.
      </p>
      <table>
        <thead><tr><th>Profile</th><th>Rules</th><th>Document</th></tr></thead>
        <tbody>
${profiles
  .map((name) => {
    const definition = JSON.parse(
      readFileSync(path.join(root, "profiles", name, "profile.json"), "utf8"),
    );
    return `          <tr><td>${name}</td><td>${definition.rules.length}</td><td><a href="/profiles/${name}/${definition.version}/profile.json">profile.json</a></td></tr>`;
  })
  .join("\n")}
        </tbody>
      </table>

      <h2>Adopting it</h2>
      <p>
        Nothing here requires changing where you store anything. The lowest-friction path is an
        export mapper, which is also the shape enterprise customers ask for:
      </p>
      <pre><code>existing audit database → mapper → OpenAuditModel NDJSON → customer, archive or SIEM</code></pre>
      <p>
        After that: instrument one new service, validate fixtures in CI, and design events with an AI
        agent through the MCP server, which exposes the same deterministic engines over Streamable
        HTTP:
      </p>
      <pre><code>claude mcp add --transport http openauditmodel https://mcp.openauditmodel.org/mcp</code></pre>
      <p>
        It is a remote service: audit event content submitted to it leaves your machine. For
        regulated data, build and run the server from the source repository instead — it is stateless
        and persists nothing either way.
      </p>

      <h2>What it is not</h2>
      <p>
        Not a log storage backend, a database, a SIEM, a GRC platform, a policy engine or an
        authorization system. Not a replacement for OpenTelemetry, CloudEvents, ECS, OCSF, CADF or
        OSCAL. It composes with them.
      </p>

      <footer>
        <p>
          Source, specification and conformance tooling:
          <a href="https://github.com/OpenAuditModel/OpenAuditModel">github.com/OpenAuditModel/OpenAuditModel</a>
          · Apache License 2.0
        </p>
        <p>This site is generated from the repository. No analytics, no cookies, no tracking.</p>
      </footer>
    </main>
  </body>
</html>
`;

files.set("index.html", Buffer.from(INDEX, "utf8"));
files.set("robots.txt", Buffer.from("User-agent: *\nAllow: /\n", "utf8"));

if (check) {
  const problems = [];
  for (const [relative, expected] of files) {
    const actual = path.join(out, relative);
    if (!existsSync(actual)) {
      problems.push(`missing: site/${relative}`);
      continue;
    }
    if (!readFileSync(actual).equals(expected)) {
      problems.push(`stale: site/${relative}`);
    }
  }
  if (problems.length > 0) {
    console.error("the built site is stale; run: npm run site:build\n");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`site is current (${files.size} files, ${profiles.length} profiles)`);
  process.exit(0);
}

rmSync(out, { recursive: true, force: true });
for (const [relative, contents] of files) {
  const target = path.join(out, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

// Prove the canonical identifiers resolve to the documents that declare them.
for (const schema of [auditEvent, profileDefinition]) {
  const served = JSON.parse(readFileSync(path.join(out, pathForId(schema.$id)), "utf8"));
  if (served.$id !== schema.$id) {
    throw new Error(`served document at ${schema.$id} declares a different $id`);
  }
}

console.log(`wrote site/ (${files.size} files, ${profiles.length} profile documents)`);
