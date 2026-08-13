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
 * The landing page is generated per locale from one template and one strings
 * table. Translations are informative — the English page is authoritative, and
 * the specification, schemas and profiles are published in English only. A
 * change to the landing copy MUST update every locale in the same change;
 * `--check` treats a stale localized page exactly like any other stale file.
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

const definitions = new Map(
  profiles.map((name) => [
    name,
    JSON.parse(readFileSync(path.join(root, "profiles", name, "profile.json"), "utf8")),
  ]),
);

const RULE_COUNT = [...definitions.values()].reduce((total, d) => total + d.rules.length, 0);
// A rule's severity defaults to "error"; only error-severity rules can fail
// conformance. The distinction ships on the page so the number is not read as
// "127 enforced requirements".
const ENFORCED_COUNT = [...definitions.values()].reduce(
  (total, d) => total + d.rules.filter((rule) => (rule.severity ?? "error") === "error").length,
  0,
);
const ADVISORY_COUNT = RULE_COUNT - ENFORCED_COUNT;

const MINIMAL = readFileSync(
  path.join(root, "examples", "valid", "minimal-event.json"),
  "utf8",
).trim();

/**
 * Landing-page locales, one JSON file per language under scripts/site-locales/.
 * `en` is authoritative; every other locale is an informative translation and
 * says so in a banner. Code blocks, URLs, table contents and profile names are
 * locale-independent and live in the template, not in the strings.
 *
 * Every locale must define exactly the keys `en` defines — a copy change that
 * forgets a language fails the build here rather than shipping a page that
 * silently mixes languages.
 */
const LOCALE_ORDER = ["en", "tr", "de", "fr", "es"];
const LOCALES = new Map(
  LOCALE_ORDER.map((code) => [
    code,
    JSON.parse(readFileSync(path.join(root, "scripts", "site-locales", `${code}.json`), "utf8")),
  ]),
);

const referenceKeys = Object.keys(LOCALES.get("en")).sort();
for (const [code, strings] of LOCALES) {
  const keys = Object.keys(strings).sort();
  const missing = referenceKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !referenceKeys.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `locale ${code} does not match en: missing [${missing.join(", ")}] extra [${extra.join(", ")}]`,
    );
  }
}

/** Fills {name} placeholders from values; an unknown placeholder is an error. */
function interpolate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (!(key in values)) {
      throw new Error(`no value for placeholder ${match}`);
    }
    return String(values[key]);
  });
}

function renderIndex(locale) {
  const s = LOCALES.get(locale);
  const alternates = [...LOCALES.entries()]
    .map(
      ([code, entry]) =>
        `    <link rel="alternate" hreflang="${code}" href="https://openauditmodel.org${entry.href}" />`,
    )
    .concat('    <link rel="alternate" hreflang="x-default" href="https://openauditmodel.org/" />')
    .join("\n");
  const switcher = [...LOCALES.entries()]
    .map(([code, entry]) =>
      code === locale
        ? `<strong>${entry.label}</strong>`
        : `<a href="${entry.href}">${entry.label}</a>`,
    )
    .join(" · ");

  return `<!doctype html>
<html lang="${s.htmlLang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${s.title}</title>
    <meta
      name="description"
      content="${s.description}"
    />
${alternates}
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
      .lang { float: right; margin-top: .5rem; color: var(--muted); font-size: .875rem; }
      .lang strong { color: var(--fg); }
    </style>
  </head>
  <body>
    <main>
      <header>
        <nav class="lang">${switcher}</nav>
        <h1><img src="/assets/logo.png" alt="OpenAuditModel" height="56" /></h1>
        <p class="tagline">${s.tagline}</p>
        <p>
          ${s.intro}
        </p>
      </header>
${
  s.translationBanner == null
    ? ""
    : `
      <div class="status">
        ${s.translationBanner}
      </div>
`
}
      <div class="status">
        ${s.status}
      </div>

      <h2>${s.whyTitle}</h2>
      <p>
        ${s.why}
      </p>

      <h2>${s.minimalTitle}</h2>
      <p>${s.minimal}</p>
      <pre><code>${MINIMAL.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</code></pre>

      <h2>${s.checkTitle}</h2>
      <p>${s.check}</p>
      <pre><code>npx @openauditmodel/cli validate audit-event.json
npx @openauditmodel/cli lint-privacy audit-event.json
npx @openauditmodel/cli check-profile audit-event.json --profile financial-transaction-management</code></pre>
      <p>
        ${s.exitCodes}
      </p>

      <h2>${s.schemasTitle}</h2>
      <p>
        ${s.schemas}
      </p>
      <div class="grid">
        <a href="/schemas/audit-event/0.1/schema.json"><code>/schemas/audit-event/0.1/schema.json</code></a>
        <a href="/schemas/profile-definition/0.1/schema.json"><code>/schemas/profile-definition/0.1/schema.json</code></a>
      </div>

      <h2>${s.profilesTitle}</h2>
      <p>
        ${interpolate(s.profilesIntro, { count: profiles.length, rules: RULE_COUNT, enforced: ENFORCED_COUNT, advisory: ADVISORY_COUNT })}
      </p>
      <p>
        ${s.profilesAddresses}
      </p>
      <table>
        <thead><tr><th>${s.tableProfile}</th><th>${s.tableRules}</th><th>${s.tableDocument}</th></tr></thead>
        <tbody>
${profiles
  .map((name) => {
    const definition = definitions.get(name);
    return `          <tr><td>${name}</td><td>${definition.rules.length}</td><td><a href="/profiles/${name}/${definition.version}/profile.json">profile.json</a></td></tr>`;
  })
  .join("\n")}
        </tbody>
      </table>

      <h2>${s.adoptingTitle}</h2>
      <p>
        ${s.adopting}
      </p>
      <pre><code>existing audit database → mapper → OpenAuditModel NDJSON → customer, archive or SIEM</code></pre>
      <p>
        ${s.adoptingNext}
      </p>
      <pre><code>claude mcp add --transport http openauditmodel https://mcp.openauditmodel.org/mcp</code></pre>
      <p>
        ${s.remote}
      </p>

      <h2>${s.notTitle}</h2>
      <p>
        ${s.not}
      </p>

      <footer>
        <p>
          ${s.footerSource}
          <a href="https://github.com/OpenAuditModel/OpenAuditModel">github.com/OpenAuditModel/OpenAuditModel</a>
          · Apache License 2.0
        </p>
        <p>${s.footerGenerated}</p>
      </footer>
    </main>
  </body>
</html>
`;
}

for (const [code, entry] of LOCALES) {
  files.set(entry.path, Buffer.from(renderIndex(code), "utf8"));
}
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
