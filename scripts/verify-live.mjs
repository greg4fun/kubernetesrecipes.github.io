#!/usr/bin/env node
/**
 * verify-live.mjs — checks the LIVE site against what Luca's group of sites
 * has agreed on (Nov 2026). Identical in every repo; the site-specific part
 * lives in scripts/verify-live.config.json next to it. Edit this file in
 * lucaberton.com and copy it unchanged to the other repos.
 *
 * No dependencies (Node 18+ fetch), no build: it only reads production.
 *
 *   node scripts/verify-live.mjs                 # default config, 20 sitemap URLs
 *   node scripts/verify-live.mjs --sample 50     # bigger sitemap sample
 *   node scripts/verify-live.mjs --config path/to/config.json --json
 *
 *   node scripts/verify-live.mjs --repo ../site  # repo checks against another checkout
 *
 * Config keys: site, base, role, sitemaps, articlePrefix, articleExclude, articleType,
 * identity {person, org}, social {siteHandles}, analytics {gaId, inHtml}, llms
 * {mustInclude, forbid}, redirects [{from,to,status}], pages [{path,titleIncludes,
 * mustInclude,article}], home {titleIncludes}, allowBlockedBots, forbid,
 * allowForeignCanonical, titleMax, sample, redirectsFile, fresh [{dir, url (with
 * {slug} and {category}), date (key or keys), draft, newest, indexable}].
 *
 * Exit code 1 when any check FAILs; WARNs never fail the run.
 *
 * What it enforces, and why (each came from a real incident or decision):
 * - Titles never end in "…" (bulk SEO edits shipped cut-off titles to three sites).
 * - AI crawlers stay allowed (GPTBot was blocked on copypastelearn.com, keeping it
 *   out of ChatGPT); robots.txt declares a sitemap; llms.txt exists and points to
 *   the sister sites by role, without claims like "largest Ansible resource".
 * - One identity for Luca and Open Empower in JSON-LD: Person @id
 *   https://lucaberton.com/#person, Organization @id
 *   https://www.openempower.com/#organization, job title "Founder and CEO",
 *   X @TheLucaBerton, YouTube @BertonLuca. Known-wrong values (x.com/lucaborton,
 *   twitter.com/lucab85, x.com/lberton, @yourlinuxsa, youtube.com/@LucaBerton,
 *   bsky.app/profile/lucaberton.com, "Principal Consultant", "Red Hat" as a
 *   current job) must never come back.
 * - Each site's role pages and redirects (e.g. lucaberton.com assessment pages
 *   301 to openempower.com), its own GA4 measurement ID and no other site's ID.
 * - Links to sister sites carry no utm_* parameters (robots.txt blocks them).
 * - A sitemap sample answers 200 directly, with a title, a self-host canonical
 *   and a description of sane length.
 * - Share images: og:image exists on the home page and articles, loads, is at
 *   least 200x200 (1200x630 recommended) and is not smaller than its
 *   og:image:width/height claim (terraformpilot.com sent its 150x51 header logo
 *   as a "1200x630" card for months).
 * - Articles carry their real publish date: when half the sampled articles share
 *   one datePublished, it is a placeholder (ansiblebyexample.com dated 1,470
 *   articles 2024-01-01 because its generator ignored `date:`).
 * - Links to the sister sites resolve (no 404s between our own sites).
 *
 * Repo checks (run from the repo root, or pass --repo <dir>; skipped otherwise):
 * - Every explicit rule in static/_redirects (or cfg.redirectsFile) is live and
 *   lands on a 200 page in one hop: a renamed or deleted target turns a fixed
 *   404 back into a 404.
 * - Newest content is live (cfg.fresh): the newest dated posts in the repo answer
 *   200, so a merge whose deploy was skipped shows up (lucaberton.com #338 sat
 *   behind a failed build validator for six hours while its post returned 404).
 *   A post committed less than 2 h ago only warns: its deploy may be running.
 * - Workflows that deploy have a concurrency group (two kubernetes.recipes merges
 *   a minute apart deployed out of order and put the older build back live).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const here = path.dirname(new URL(import.meta.url).pathname);
const cfgPath = typeof args.config === 'string' ? args.config : path.join(here, 'verify-live.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const SAMPLE = Number(args.sample || cfg.sample || 20);
const REPO = path.resolve(typeof args.repo === 'string' ? args.repo : '.');

// Shared across the group — change here, then copy this file to every repo.
const PERSON_ID = 'https://lucaberton.com/#person';
const ORG_ID = 'https://www.openempower.com/#organization';
const JOB_TITLE = 'Founder and CEO';
const PERSON_SAMEAS_REQUIRED = ['https://x.com/TheLucaBerton', 'https://www.youtube.com/@BertonLuca'];
const FORBIDDEN = [
  'x.com/lucaborton', 'twitter.com/lucaborton', 'twitter.com/lucab85', 'x.com/lucab85', 'x.com/lberton',
  '@yourlinuxsa', 'twitter.com/yourlinuxsa', 'youtube.com/@LucaBerton', 'bsky.app/profile/lucaberton.com',
  'day job is at Red Hat',
];
// Luca's former title fails only when it is said about him: posts quote other
// people's titles too ("Rajveer Singh, Red Hat Associate Principal Consultant").
// His JSON-LD jobTitle is checked separately (Person jobTitle).
const FORMER_TITLE_ABOUT_LUCA = /Luca(?: Berton)?\b[^.<]{0,80}Principal Consultant|Principal Consultant[^.<]{0,20}Luca Berton/;
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];
const SISTERS = ['lucaberton.com', 'openempower.com', 'ansiblebyexample.com', 'ansiblepilot.com',
  'terraformpilot.com', 'kubernetes.recipes', 'udienza.com', 'copypastelearn.com'];
const GROUP_GA_IDS = ['G-M9Q5F672JT', 'G-77NY6462EC', 'G-YFX4FP055Q', 'G-Q0V9R2ZHZM', 'G-5NMM6ZT4E4',
  'G-CCC31PP3QS', 'G-YJKMKH633R', 'G-YN94VH0TPN'];

const results = [];
const utmLinks = [];
const ogImages = new Map(); // absolute image URL -> { pages, w, h } as declared by the tags
const articleDates = []; // { label, date } from article JSON-LD
const groupLinks = new Map(); // link to a sister site -> first page it was seen on
const rec = (level, check, detail = '', page = '') => results.push({ level, check, detail, page });
const base = cfg.base.replace(/\/$/, '');
const host = new URL(base).host;

async function get(url, { follow = true } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, {
      redirect: follow ? 'follow' : 'manual',
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; group-verify-live/1.0; +https://lucaberton.com)' },
    });
    const body = follow ? await r.text() : '';
    return { status: r.status, url: r.url, location: r.headers.get('location'), redirected: r.redirected, body };
  } catch (e) {
    return { status: 0, url, error: String(e.message || e), body: '' };
  } finally {
    clearTimeout(t);
  }
}

async function getBytes(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; group-verify-live/1.0; +https://lucaberton.com)' } });
    return { status: r.status, type: r.headers.get('content-type') || '', buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) {
    return { status: 0, type: '', buf: Buffer.alloc(0), error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// [width, height] of a PNG, GIF, WebP or JPEG; null for anything else (AVIF, SVG).
function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

// Follows redirects by hand so the number of hops is known.
async function follow(url, max = 5) {
  let u = url;
  for (let hops = 0; ; hops++) {
    const r = await get(u, { follow: false });
    if (r.status >= 300 && r.status < 400 && r.location && hops < max) { u = new URL(r.location, u).href; continue; }
    return { status: r.status, url: u, hops, error: r.error };
  }
}

// Top-level scalar keys of a Markdown file's YAML frontmatter (enough for dates, slugs, flags).
function frontmatter(text) {
  const fm = {};
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return fm;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/\s+#.*$/, '').trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return fm;
}

// The group's sites turn file names into URLs in different ways; try each.
function slugCandidates(fm, file) {
  const base = path.basename(file).replace(/\.mdx?$/i, '');
  const dashed = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); // ansiblepilot: "aap-2-7"
  const stripped = base.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); // ansiblebyexample: "2220"
  return [...new Set([fm.slug, base, dashed, stripped].filter(Boolean))];
}

function commitAgeHours(file) {
  try {
    const t = Number(execFileSync('git', ['log', '-1', '--format=%ct', '--', file], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    return t ? (Date.now() / 1000 - t) / 3600 : null;
  } catch {
    return null;
  }
}

const decode = (s) => s.replace(/&amp;|&#x26;|&#38;/gi, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const titleOf = (h) => { const m = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? decode(m[1]).trim() : null; };
function metaOf(h, key) {
  for (const tag of h.match(/<meta\b[^>]*>/gi) || []) {
    const name = tag.match(/\b(?:name|property)\s*=\s*["']?([^"'\s>]+)/i);
    if (name && name[1].toLowerCase() === key.toLowerCase()) {
      const c = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      return c ? decode(c[1] ?? c[2] ?? c[3] ?? '') : '';
    }
  }
  return null;
}
const canonicalOf = (h) => { for (const tag of h.match(/<link\b[^>]*>/gi) || []) if (/rel\s*=\s*["']?canonical/i.test(tag)) { const m = tag.match(/href\s*=\s*["']?([^"'\s>]+)/i); if (m) return m[1]; } return null; };
function jsonld(h) {
  const nodes = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { nodes.push(o); Object.values(o).forEach(walk); } };
  for (const m of h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* ignore broken blocks; the repo validators own syntax */ }
  }
  return nodes;
}
const types = (n) => [].concat(n['@type'] || []);

function checkPage(label, page, { isArticle = false } = {}) {
  const h = page.body;
  const title = titleOf(h);
  if (!title) rec('FAIL', `<title>`, 'missing', label);
  else {
    if (/(…|\.\.\.)\s*(\||—|-|$)/.test(title)) rec('FAIL', `title cut off`, title, label);
    if (title.length > (cfg.titleMax || 70)) rec('WARN', `title length ${title.length}`, title, label);
  }
  const desc = metaOf(h, 'description');
  if (desc == null || desc === '') rec('WARN', `meta description`, 'missing', label);
  else if (desc.length > 165) rec('WARN', `description length ${desc.length}`, desc.slice(0, 80, label) + '…');
  const canon = canonicalOf(h);
  if (canon) { try { const ch = new URL(canon, page.url).host; if (ch !== host) rec(cfg.allowForeignCanonical ? 'WARN' : 'FAIL', `${label}: canonical host`, canon); } catch { rec('WARN', `canonical`, canon, label); } }
  for (const s of FORBIDDEN.concat(cfg.forbid || [])) if (h.includes(s)) rec('FAIL', `forbidden "${s}"`, '', label);
  if (FORMER_TITLE_ABOUT_LUCA.test(h)) rec('FAIL', `forbidden "Principal Consultant"`, 'as Luca\'s title', label);
  const creator = metaOf(h, 'twitter:creator');
  if (creator && creator !== '@TheLucaBerton') rec('FAIL', `twitter:creator`, creator, label);
  const site = metaOf(h, 'twitter:site');
  if (site && !(cfg.social?.siteHandles || ['@TheLucaBerton']).includes(site)) rec('FAIL', `twitter:site`, site, label);
  // Cross-site links must not carry utm_* (sister robots.txt files block them).
  for (const m of h.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let u; try { u = new URL(decode(m[1]), page.url); } catch { continue; }
    if (u.host !== host && SISTERS.some((d) => u.host === d || u.host.endsWith('.' + d)) && /[?&]utm_/.test(u.search)) {
      utmLinks.push({ target: u.host, href: u.href.slice(0, 120), page: label });
      break;
    }
  }
  // Links to the sister sites, checked once each after the sample.
  for (const m of h.matchAll(/href\s*=\s*["']([^"'#]+)/gi)) {
    let u; try { u = new URL(decode(m[1]), page.url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.host === host || !SISTERS.some((d) => u.host === d || u.host.endsWith('.' + d))) continue;
    if (!groupLinks.has(u.href) && groupLinks.size < 400) groupLinks.set(u.href, label);
  }
  // Share image, measured once per image after the sample.
  const og = metaOf(h, 'og:image');
  if (!og) { if (label === 'home' || isArticle) rec('FAIL', 'og:image', 'missing', label); }
  else {
    let abs; try { abs = new URL(og, page.url).href; } catch { abs = null; }
    if (!abs) rec('FAIL', 'og:image', `not a URL: ${og}`, label);
    else {
      if (!/^https?:\/\//i.test(og)) rec('WARN', 'og:image', `relative URL ${og} (crawlers expect an absolute one)`, label);
      const seen = ogImages.get(abs) || { pages: [], w: metaOf(h, 'og:image:width'), h: metaOf(h, 'og:image:height') };
      seen.pages.push(label);
      ogImages.set(abs, seen);
    }
  }
  // Analytics: own ID present (or the tag script for client-loaded GA), no other group site's ID.
  if (cfg.analytics?.gaId) {
    const own = cfg.analytics.gaId;
    if (cfg.analytics.inHtml !== false && !h.includes(own)) rec(isArticle ? 'FAIL' : 'WARN', `GA4 ${own}`, 'not in HTML', label);
    if (cfg.analytics.inHtml === false && !h.includes('googletagmanager')) rec('WARN', `GA4 loader`, 'no googletagmanager reference', label);
    for (const id of GROUP_GA_IDS) if (id !== own && h.includes(id)) rec('FAIL', `foreign GA4 ID`, id, label);
  }
  // Identity: one Person for Luca, shared Org, consistent values.
  const nodes = jsonld(h);
  if (nodes.length) {
    const ids = new Set(nodes.map((n) => n['@id']).filter(Boolean));
    const lucaNodes = nodes.filter((n) => types(n).includes('Person') && /Luca Berton/.test(n.name || ''));
    for (const p of lucaNodes) if (p['@id'] && p['@id'] !== PERSON_ID) rec('FAIL', `second Person id for Luca`, p['@id'], label);
    const full = lucaNodes.find((p) => p.sameAs);
    if (full) {
      for (const want of PERSON_SAMEAS_REQUIRED) if (!JSON.stringify(full.sameAs).includes(want)) rec('FAIL', `Person sameAs`, `missing ${want}`, label);
      if (full.jobTitle && full.jobTitle !== JOB_TITLE) rec('FAIL', `Person jobTitle`, full.jobTitle, label);
    }
    if (cfg.identity?.person && (isArticle || label === 'home') && !ids.has(PERSON_ID) && !h.includes(PERSON_ID)) rec('FAIL', `Person @id`, `no reference to ${PERSON_ID}`, label);
    if (cfg.identity?.org && label === 'home' && !h.includes(ORG_ID)) rec('FAIL', `Organization @id`, `no reference to ${ORG_ID}`, label);
    if (isArticle && cfg.articleType && !nodes.some((n) => types(n).includes(cfg.articleType))) rec('FAIL', `${cfg.articleType} markup`, 'missing', label);
    const art = isArticle && nodes.find((n) => n.datePublished && types(n).some((t) => /Article|BlogPosting|Posting/.test(t)));
    if (art) {
      const d = String(art.datePublished).slice(0, 10);
      articleDates.push({ label, date: d });
      if (Date.parse(d) > Date.now() + 36 * 3600 * 1000) rec('FAIL', 'datePublished in the future', d, label);
    }
  } else if (cfg.identity?.person && (isArticle || label === 'home')) rec('FAIL', `JSON-LD`, 'none found', label);
}

async function sitemapUrls() {
  const out = new Set();
  const queue = [...(cfg.sitemaps || [`${base}/sitemap.xml`])];
  let fetched = 0;
  while (queue.length && fetched < 12) {
    const sm = queue.shift(); fetched++;
    const r = await get(sm);
    if (r.status !== 200) { rec('WARN', 'sitemap', `${sm} -> ${r.status}`); continue; }
    for (const m of r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const u = decode(m[1]);
      if (/\.xml(\?|$)/.test(u)) queue.push(u); else out.add(u);
    }
  }
  return [...out];
}

async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

(async () => {
  // 1. Home page
  const home = await get(base + '/');
  if (home.status !== 200) rec('FAIL', 'home', `status ${home.status} ${home.error || ''}`);
  else {
    if (new URL(home.url).host !== host) rec('FAIL', 'home: canonical host', `${base} ends at ${home.url}`);
    checkPage('home', home);
    for (const s of cfg.home?.titleIncludes || []) if (!(titleOf(home.body) || '').includes(s)) rec('FAIL', 'home: title', `missing "${s}"`);
  }
  // 2. robots.txt
  const robots = await get(base + '/robots.txt');
  if (robots.status !== 200) rec('FAIL', 'robots.txt', `status ${robots.status}`);
  else {
    if (!/^\s*sitemap:/im.test(robots.body)) rec('FAIL', 'robots.txt', 'no Sitemap directive');
    const groups = robots.body.split(/\n(?=\s*user-agent:)/i);
    for (const bot of AI_BOTS) {
      const blocked = groups.some((g) => new RegExp(`^\\s*user-agent:\\s*${bot}\\s*$`, 'im').test(g) && /^\s*disallow:\s*\/\s*$/im.test(g));
      if (blocked && !(cfg.allowBlockedBots || []).includes(bot)) rec('FAIL', `robots.txt: ${bot} blocked`, 'AI search visibility needs it allowed');
    }
  }
  // 3. llms.txt
  const llms = await get(base + '/llms.txt');
  if (llms.status !== 200 || llms.body.length < 200 || /<html/i.test(llms.body.slice(0, 500))) rec('FAIL', 'llms.txt', `status ${llms.status}, ${llms.body.length} bytes`);
  else {
    for (const s of cfg.llms?.mustInclude || []) if (!llms.body.includes(s)) rec('FAIL', 'llms.txt', `missing "${s}"`);
    for (const s of (cfg.llms?.forbid || []).concat(['largest Ansible resource'])) if (llms.body.toLowerCase().includes(s.toLowerCase())) rec('FAIL', 'llms.txt', `contains "${s}"`);
  }
  // 4. Redirects decided by Luca
  for (const r of cfg.redirects || []) {
    const res = await get(base + r.from, { follow: false });
    const loc = res.location ? new URL(res.location, base + r.from).href : '';
    if (res.status !== (r.status || 301) || loc.replace(/\/$/, '') !== r.to.replace(/\/$/, '')) rec('FAIL', `redirect ${r.from}`, `got ${res.status} -> ${loc || '(none)'}, want ${r.status || 301} -> ${r.to}`);
  }
  // 5. Role pages
  for (const p of cfg.pages || []) {
    const res = await get(base + p.path);
    if (res.status !== 200) { rec('FAIL', `page ${p.path}`, `status ${res.status}`); continue; }
    if (p.titleIncludes && !(titleOf(res.body) || '').includes(p.titleIncludes)) rec('FAIL', `page ${p.path}: title`, `missing "${p.titleIncludes}" (got "${titleOf(res.body)}")`);
    for (const s of p.mustInclude || []) if (!res.body.includes(s)) rec('FAIL', `page ${p.path}`, `missing "${s}"`);
    checkPage(`page ${p.path}`, res, { isArticle: !!p.article });
  }
  // 6. Sitemap sample
  let urls = await sitemapUrls();
  if (!urls.length) rec('FAIL', 'sitemap', 'no URLs found');
  const prefix = cfg.articlePrefix;
  urls = urls.filter((u) => { try { return new URL(u).host === host; } catch { return false; } });
  const foreign = (await sitemapUrls()).length - urls.length;
  if (foreign > 0) rec('WARN', 'sitemap', `${foreign} URLs on another host`);
  const articles = prefix ? urls.filter((u) => { const p = new URL(u).pathname; return p.startsWith(prefix) && !(cfg.articleExclude || []).some((x) => p.startsWith(x)); }) : [];
  const pick = (arr, n) => arr.map((u) => [Math.random(), u]).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);
  const sample = [...new Set([...pick(articles, Math.ceil(SAMPLE * 0.7)), ...pick(urls, SAMPLE)])].slice(0, SAMPLE);
  let ok = 0;
  await pool(sample, 4, async (u) => {
    const res = await get(u);
    const label = new URL(u).pathname;
    if (res.status !== 200) { rec('FAIL', `sitemap URL ${label}`, `status ${res.status}`); return; }
    if (res.redirected && res.url.replace(/\/$/, '') !== u.replace(/\/$/, '')) rec('WARN', `sitemap URL ${label}`, `redirects to ${res.url}`);
    ok++;
    checkPage(label, res, { isArticle: !!prefix && label.startsWith(prefix) && !(cfg.articleExclude || []).some((x) => label.startsWith(x)) });
  });
  rec('INFO', 'sitemap sample', `${ok}/${sample.length} answered 200 (from ${urls.length} URLs)`);

  // Links to sister sites with utm_*: FAIL when the target's robots.txt blocks
  // utm URLs (Google cannot follow the link), otherwise WARN.
  const byTarget = {};
  for (const l of utmLinks) (byTarget[l.target] ||= []).push(l);
  for (const [t, ls] of Object.entries(byTarget)) {
    const rb = await get(`https://${t}/robots.txt`);
    const blocks = /^\s*disallow:[^\n]*utm_/im.test(rb.body);
    rec(blocks ? 'FAIL' : 'WARN', `utm links to ${t}`, `${ls.length} page(s), e.g. ${ls[0].href}${blocks ? ' — blocked by its robots.txt' : ''}`, ls[0].page);
  }

  // Share images: loadable, big enough, and the size the tags claim.
  await pool([...ogImages.entries()].slice(0, 20), 4, async ([url, info]) => {
    const where = info.pages[0];
    const r = await getBytes(url);
    if (r.status !== 200) { rec('FAIL', 'og:image unreachable', `${url} -> ${r.status || r.error}`, where); return; }
    if (!/^image\//i.test(r.type)) rec('WARN', 'og:image content-type', `${url}: ${r.type || 'none'}`, where);
    const size = imageSize(r.buf);
    if (!size) { rec('INFO', 'og:image size', `not measured (format): ${url}`, where); return; }
    const [w, hgt] = size;
    if (w < 200 || hgt < 200) rec('FAIL', 'og:image too small', `${url} is ${w}x${hgt}; share cards need 1200x630`, where);
    else if (w < 1200 || hgt < 627) rec('WARN', 'og:image under 1200x630', `${url} is ${w}x${hgt}`, where);
    // Tags may understate a bigger file of the same shape; they must not promise more than the file has.
    const tw = Number(info.w), th = Number(info.h);
    if (tw > 0 && th > 0) {
      if (w < tw - 2 || hgt < th - 2) rec('FAIL', 'og:image smaller than its tags', `${url}: tags say ${tw}x${th}, the file is ${w}x${hgt}`, where);
      else if (Math.abs(w / hgt - tw / th) / (tw / th) > 0.1) rec('WARN', 'og:image shape differs from its tags', `${url}: tags say ${tw}x${th}, the file is ${w}x${hgt}`, where);
    }
  });
  rec('INFO', 'og:image', `${Math.min(ogImages.size, 20)} image(s) measured`);

  // A shared datePublished across most sampled articles is a generator default, not a date.
  if (articleDates.length >= 4) {
    const counts = {};
    for (const d of articleDates) counts[d.date] = (counts[d.date] || 0) + 1;
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (n >= 3 && n / articleDates.length >= 0.5) rec('FAIL', 'datePublished placeholder', `${n} of ${articleDates.length} sampled articles say ${top}`, articleDates.find((d) => d.date === top).label);
  }

  // Links between our own sites.
  const links = [...groupLinks.entries()].map((e) => [Math.random(), e]).sort((a, b) => a[0] - b[0]).slice(0, 60).map((x) => x[1]);
  let linksOk = 0;
  await pool(links, 6, async ([url, where]) => {
    const r = await follow(url);
    if (r.status === 200) { linksOk++; if (r.hops > 1) rec('WARN', 'sister link redirects more than once', `${url} -> ${r.url} (${r.hops} hops)`, where); }
    else if (r.status === 404 || r.status === 410 || r.status >= 500) rec('FAIL', 'broken link to a sister site', `${url} -> ${r.status}`, where);
    else rec('WARN', 'sister link not checked', `${url} -> ${r.status || r.error}`, where);
  });
  rec('INFO', 'sister links', `${linksOk}/${links.length} answered 200 (of ${groupLinks.size} found)`);

  // Repo checks: only when run from (or pointed at) a checkout of this site.
  const isRepo = fs.existsSync(path.join(REPO, 'package.json')) || fs.existsSync(path.join(REPO, '.git'));
  if (!isRepo) rec('INFO', 'repo checks', `skipped: ${REPO} is not a checkout (run from the repo root or pass --repo)`);
  else {
    // Redirect rules from the repo are live and land on a real page in one hop.
    const rf = path.join(REPO, cfg.redirectsFile || 'static/_redirects');
    if (fs.existsSync(rf)) {
      const rules = [];
      const seen = new Set();
      for (const line of fs.readFileSync(rf, 'utf8').split('\n')) {
        const [from, to, code = '301'] = line.trim().split(/\s+/);
        if (!from || from.startsWith('#') || !to || /[*:]/.test(from) || !/^30[1278]!?$/.test(code)) continue; // wildcards, placeholders, rewrites
        const key = from.replace(/\/$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        rules.push({ from, to });
      }
      await pool(rules, 8, async (r) => {
        const res = await get(base + r.from, { follow: false });
        if (res.status === 200) return; // a real page answers there; build-vercel-config drops such rules on purpose
        if (!(res.status >= 300 && res.status < 400)) { rec('FAIL', 'redirect rule not live', `${r.from} -> ${res.status || res.error}`); return; }
        const loc = new URL(res.location, base + r.from).href;
        const want = new URL(r.to, base + '/').href;
        if (loc.replace(/\/$/, '') !== want.replace(/\/$/, '')) rec('WARN', 'redirect rule goes elsewhere', `${r.from} -> ${loc}, the file says ${r.to}`);
        const fin = await follow(loc);
        if (fin.status !== 200) rec('FAIL', 'redirect rule lands on an error', `${r.from} -> ${loc} -> ${fin.status || fin.error}`);
        else if (fin.hops > 0) rec('WARN', 'redirect chain', `${r.from} -> ${loc} -> ${fin.url}`);
      });
      rec('INFO', 'redirect rules', `${rules.length} explicit rule(s) in ${path.relative(REPO, rf)} checked`);
    }

    // The newest dated content in the repo is live.
    for (const src of cfg.fresh || []) {
      const dir = path.join(REPO, src.dir);
      if (!fs.existsSync(dir)) { rec('WARN', 'newest content', `${src.dir} not found`); continue; }
      const keys = [].concat(src.date || 'date');
      const items = [];
      for (const f of fs.readdirSync(dir)) {
        if (!/\.mdx?$/i.test(f)) continue;
        const fm = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 8000));
        if (String(fm[src.draft || 'draft']) === 'true') continue;
        const ds = keys.map((k) => fm[k]).find(Boolean);
        const t = ds ? Date.parse(ds) : NaN;
        if (Number.isFinite(t) && t <= Date.now()) items.push({ f, fm, ds, t });
      }
      items.sort((a, b) => b.t - a.t);
      const newest = items.slice(0, src.newest || 3);
      for (const it of newest) {
        const tried = [];
        let live = null;
        for (const s of slugCandidates(it.fm, it.f)) {
          const p = src.url.replace('{slug}', encodeURIComponent(s)).replace('{category}', encodeURIComponent(String(it.fm.category || '').toLowerCase()));
          tried.push(p);
          const r = await get(base + p);
          if (r.status === 200 && new URL(r.url).pathname !== '/') { live = { p, r }; break; }
        }
        const where = `${src.dir}/${it.f}`;
        if (!live) {
          const age = commitAgeHours(path.join(src.dir, it.f));
          const fresh = age != null && age < 2;
          rec(fresh ? 'WARN' : 'FAIL', 'newest content not live', `${it.f} (${it.ds}); tried ${tried.join(', ')}${fresh ? `; committed ${Math.round(age * 60)} min ago, the deploy may still be running` : ''}`, where);
        } else if (src.indexable && /noindex/i.test(metaOf(live.r.body, 'robots') || '')) {
          rec('FAIL', 'newest content still noindex', `${live.p} (${it.ds}) is due but still noindex: the site was not rebuilt`, where);
        }
      }
      rec('INFO', `newest content in ${src.dir}`, `${newest.length} newest checked`);
    }

    // Deploy workflows must deploy one at a time, in push order.
    const wf = path.join(REPO, '.github', 'workflows');
    if (fs.existsSync(wf)) {
      for (const f of fs.readdirSync(wf).filter((x) => /\.ya?ml$/.test(x))) {
        const y = fs.readFileSync(path.join(wf, f), 'utf8');
        // Case-sensitive on purpose: CLI commands, not step names like "Wait for Vercel deploy".
        const deploys = /actions\/deploy-pages|\bvercel\s+(?:deploy|--prod)\b|amondnet\/vercel-action|peaceiris\/actions-gh-pages|cloudflare\/pages-action|\bwrangler\s+(?:pages\s+)?deploy\b|\bnetlify\s+deploy\b/.test(y);
        if (deploys && !/^\s*concurrency:/m.test(y)) rec('FAIL', 'deploy workflow without concurrency', `${f}: two quick merges can deploy out of order`);
      }
    }
  }

  // Report
  const fails = results.filter((r) => r.level === 'FAIL');
  const failGroups = new Set(fails.map((r) => r.check)).size;
  if (args.json) { console.log(JSON.stringify({ site: cfg.site, fails: fails.length, results }, null, 2)); }
  else {
    console.log(`\nverify-live — ${cfg.site} (${base})`);
    for (const lvl of ['FAIL', 'WARN', 'INFO']) {
      const groups = new Map();
      for (const r of results.filter((x) => x.level === lvl)) { const k = r.check; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      for (const [k, rs] of groups) {
        const ex = rs[0];
        const where = rs.length > 1 ? ` (${rs.length} pages, e.g. ${ex.page})` : ex.page ? ` (${ex.page})` : '';
        console.log(`  ${lvl === 'FAIL' ? '✗' : lvl === 'WARN' ? '!' : '·'} [${lvl}] ${k}${ex.detail ? ' — ' + ex.detail : ''}${where}`);
      }
    }
    console.log(`\n  ${fails.length ? `FAILED: ${failGroups} check(s) on ${fails.length} page(s)` : 'PASSED'} · ${results.filter((r) => r.level === 'WARN').length} warning(s)`);
  }
  process.exit(fails.length ? 1 : 0);
})();
