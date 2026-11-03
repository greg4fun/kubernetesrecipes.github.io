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
 * Config keys: site, base, role, sitemaps, articlePrefix, articleExclude, articleType,
 * identity {person, org}, social {siteHandles}, analytics {gaId, inHtml}, llms
 * {mustInclude, forbid}, redirects [{from,to,status}], pages [{path,titleIncludes,
 * mustInclude,article}], home {titleIncludes}, allowBlockedBots, forbid,
 * allowForeignCanonical, titleMax, sample.
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
 */
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

// Shared across the group — change here, then copy this file to every repo.
const PERSON_ID = 'https://lucaberton.com/#person';
const ORG_ID = 'https://www.openempower.com/#organization';
const JOB_TITLE = 'Founder and CEO';
const PERSON_SAMEAS_REQUIRED = ['https://x.com/TheLucaBerton', 'https://www.youtube.com/@BertonLuca'];
const FORBIDDEN = [
  'x.com/lucaborton', 'twitter.com/lucaborton', 'twitter.com/lucab85', 'x.com/lucab85', 'x.com/lberton',
  '@yourlinuxsa', 'twitter.com/yourlinuxsa', 'youtube.com/@LucaBerton', 'bsky.app/profile/lucaberton.com',
  'Principal Consultant', 'day job is at Red Hat',
];
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];
const SISTERS = ['lucaberton.com', 'openempower.com', 'ansiblebyexample.com', 'ansiblepilot.com',
  'terraformpilot.com', 'kubernetes.recipes', 'udienza.com', 'copypastelearn.com'];
const GROUP_GA_IDS = ['G-M9Q5F672JT', 'G-77NY6462EC', 'G-YFX4FP055Q', 'G-Q0V9R2ZHZM', 'G-5NMM6ZT4E4',
  'G-CCC31PP3QS', 'G-YJKMKH633R', 'G-YN94VH0TPN'];

const results = [];
const utmLinks = [];
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
