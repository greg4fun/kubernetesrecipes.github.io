#!/usr/bin/env node
/**
 * check-offers.mjs: validates the paid links (affiliate, referral, products)
 * on a site, live or in a local build.
 *
 * The engine is identical in every repo (edit it in lucaberton.com and copy
 * it unchanged); each repo's scripts/check-offers.config.json holds the
 * programmes and the pages to check.
 *
 * On every checked page:
 *   - every link to a known programme carries the right partner ID
 *     (a wrong or missing ID earns nothing and fails);
 *   - every programme link is rel="sponsored" (fails on configured offers,
 *     warns elsewhere, since old content links predate the rule);
 *   - a page with programme links shows the site's disclosure text;
 *   - each configured offer is present (min/max count, target URL fragment,
 *     tracking attribute), or absent where max is 0.
 * Then, unless --no-follow, every distinct programme URL found is fetched
 * (following redirects) and must not end in an error.
 *
 * Usage:
 *   node scripts/check-offers.mjs                    # live site
 *   node scripts/check-offers.mjs --dir dist         # local build (base URL mapped to the folder)
 *   node scripts/check-offers.mjs --no-follow --json
 *   node scripts/check-offers.mjs --config path/to/config.json
 * Exits 1 when any check fails. Only reads; never posts anything.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = option("--config") ?? path.join(here, "check-offers.config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const dir = option("--dir");
const follow = !flag("--no-follow") && !dir;
const asJson = flag("--json");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 check-offers";

const results = [];
const record = (level, page, message) => results.push({ level, page, message });

// ---------- HTML helpers (no dependencies; Astro may emit unquoted attributes) ----------

const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", "#39": "'", "#x27": "'", "#x2F": "/" };
const decode = (s) => s.replace(/&(#?[a-zA-Z0-9]+);/g, (m, e) => ENTITIES[e] ?? m);

function parseAttrs(raw) {
  const attrs = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

function links(html, base) {
  const out = [];
  const re = /<a\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = parseAttrs(m[1]);
    if (!attrs.href) continue;
    let url;
    try {
      url = new URL(attrs.href, base);
    } catch {
      continue;
    }
    out.push({ url, attrs });
  }
  return out;
}

function visibleText(html) {
  return decode(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
}

// ---------- programmes ----------

const programmes = Object.entries(config.programmes ?? {}).map(([name, p]) => ({ name, ...p }));

function hostMatches(host, p) {
  const h = host.toLowerCase().replace(/^www\./, "");
  return (p.hosts ?? []).some((x) => h === x || h.endsWith(`.${x}`));
}

/** The programme a link belongs to, or null. A programme can require a query parameter to count. */
function programmeOf(url) {
  return (
    programmes.find((p) => hostMatches(url.hostname, p) && (!p.requireParam || url.searchParams.has(p.requireParam))) ?? null
  );
}

/** Partner ID check: one of `idParams` must equal `id`. */
function idProblem(url, p) {
  if (!p.id) return null;
  const params = p.idParams ?? [];
  const found = params.map((k) => url.searchParams.get(k)).filter((v) => v !== null);
  if (found.includes(p.id)) return null;
  return found.length
    ? `wrong ${p.name} ID ${found.join("/")} (expected ${p.id})`
    : `${p.name} link without a partner ID (${params.join(" or ")})`;
}

const relOf = (attrs) => (attrs.rel ?? "").toLowerCase().split(/\s+/);

// ---------- page loading ----------

async function load(pagePath, base) {
  if (dir) {
    const rel = decodeURIComponent(pagePath).replace(/^\/+/, "");
    const candidates = rel.endsWith(".html")
      ? [rel]
      : [path.join(rel, "index.html"), `${rel.replace(/\/$/, "")}.html`];
    for (const c of candidates) {
      const file = path.join(dir, c);
      try {
        if ((await stat(file)).isFile()) return { status: 200, html: await readFile(file, "utf8") };
      } catch {}
    }
    return { status: 404, html: "" };
  }
  const res = await fetch(new URL(pagePath, base), { headers: { "user-agent": UA }, redirect: "follow" });
  return { status: res.status, html: res.ok ? await res.text() : "" };
}

// ---------- checks ----------

const seenProgrammeUrls = new Map(); // href -> first page it was seen on

async function checkPage(site, page) {
  const label = `${site.base.replace(/^https?:\/\//, "")}${page.path}`;
  let loaded;
  try {
    loaded = await load(page.path, site.base);
  } catch (err) {
    record("fail", label, `could not load: ${err.message}`);
    return;
  }
  if (loaded.status !== 200) {
    record("fail", label, `page returned ${loaded.status}`);
    return;
  }

  const all = links(loaded.html, site.base);
  const paid = all.map((l) => ({ ...l, programme: programmeOf(l.url) })).filter((l) => l.programme);
  const offerHrefs = new Set();

  for (const offer of page.offers ?? []) {
    const p = programmes.find((x) => x.name === offer.programme);
    if (!p) {
      record("fail", label, `config: unknown programme "${offer.programme}"`);
      continue;
    }
    const matching = paid.filter(
      (l) => l.programme === p && (!offer.target || decodeURIComponent(l.url.href).includes(offer.target)),
    );
    const what = `${p.name}${offer.target ? ` → ${offer.target}` : ""}`;
    const min = offer.min ?? 1;
    if (matching.length < min) record("fail", label, `expected at least ${min} ${what} link(s), found ${matching.length}`);
    if (offer.max !== undefined && matching.length > offer.max)
      record("fail", label, `expected at most ${offer.max} ${what} link(s), found ${matching.length}`);
    let noRel = 0;
    let noAttr = 0;
    for (const l of matching) {
      offerHrefs.add(l.url.href);
      if (!relOf(l.attrs).includes("sponsored")) noRel++;
      if (offer.attr) {
        const [k, v] = offer.attr.split("=");
        const actual = l.attrs[k.toLowerCase()];
        if (actual === undefined || (v !== undefined && actual !== v)) noAttr++;
      }
    }
    if (noRel) record("fail", label, `${noRel} of ${matching.length} ${what} link(s) not rel="sponsored"`);
    if (noAttr) record("fail", label, `${noAttr} of ${matching.length} ${what} link(s) lack tracking attribute ${offer.attr}`);
    if (matching.length >= min && (offer.max === undefined || matching.length <= offer.max))
      record("pass", label, `${what}: ${matching.length} link(s)`);
  }

  // Partner IDs and rel on every programme link, configured or not.
  const unsponsored = new Map();
  for (const l of paid) {
    const problem = idProblem(l.url, l.programme);
    if (problem) record("fail", label, `${problem}: ${l.url.href}`);
    if (!offerHrefs.has(l.url.href) && !relOf(l.attrs).includes("sponsored"))
      unsponsored.set(l.programme.name, (unsponsored.get(l.programme.name) ?? 0) + 1);
    if (!seenProgrammeUrls.has(l.url.href)) seenProgrammeUrls.set(l.url.href, label);
  }
  for (const [name, n] of unsponsored) record("warn", label, `${n} ${name} link(s) without rel="sponsored"`);

  if (paid.length && site.disclosure) {
    if (new RegExp(site.disclosure, "i").test(visibleText(loaded.html))) record("pass", label, "disclosure shown");
    else record("fail", label, `${paid.length} programme link(s) but no disclosure matching /${site.disclosure}/`);
  }
}

async function checkDestination(href, page) {
  try {
    const res = await fetch(href, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    // Bot walls answer 403/429 to scripts but work in a browser: warn, don't fail.
    if (res.status === 403 || res.status === 429) record("warn", page, `${href} → ${res.status} (bot wall? check by hand)`);
    else if (res.status >= 400) record("fail", page, `${href} → ${res.status} at ${res.url}`);
    else record("pass", page, `${href} → ${res.status}`);
  } catch (err) {
    record("fail", page, `${href} → ${err.name === "TimeoutError" ? "timeout" : err.message}`);
  }
}

// ---------- run ----------

for (const page of config.pages ?? []) await checkPage(config.site, page);
if (follow) {
  for (const [href, page] of seenProgrammeUrls) await checkDestination(href, page);
}

const counts = { pass: 0, warn: 0, fail: 0 };
for (const r of results) counts[r.level]++;

if (asJson) {
  console.log(JSON.stringify({ site: config.site.base, mode: dir ? `dir:${dir}` : "live", counts, results }, null, 2));
} else {
  const icon = { pass: "✓", warn: "!", fail: "✗" };
  for (const r of results) if (r.level !== "pass" || flag("--verbose")) console.log(`${icon[r.level]} ${r.page}  ${r.message}`);
  console.log(`\n${config.site.base} (${dir ? `build in ${dir}` : "live"}): ${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failed`);
}
process.exit(counts.fail ? 1 : 0);
