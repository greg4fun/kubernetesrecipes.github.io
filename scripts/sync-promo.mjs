#!/usr/bin/env node
/**
 * Sponsored banner sync — shared by all of Luca's sites
 * -----------------------------------------------------
 * One config lists the sponsored campaigns and which sites show them:
 * static/promo/promos.json in the lucaberton.com repo, served at
 * https://lucaberton.com/promo/promos.json. Every site runs this script at the
 * start of its build: it picks the campaign for this site (the first enabled,
 * unexpired one whose "sites" lists the site or "*") and writes it, resolved,
 * to src/generated/promo.json (or null), which the site's PromoBanner renders.
 *
 * Keep this file identical in every repo: edit it in lucaberton.com and copy it.
 *
 * Usage: node scripts/sync-promo.mjs <site> [--local <promos.json>] [--self-host <public dir>] [--out <file>]
 *   <site>         this site's id in "sites", e.g. ansiblepilot.com
 *   --local        read the config from a file (lucaberton.com, the source)
 *   --self-host    download the images into <dir>/promo/<id>/ and point the
 *                  banner at them (udienza.com allows no third-party images)
 *   --out          output file, default src/generated/promo.json
 *
 * With --local an invalid config fails the build, so a bad edit never deploys.
 * Otherwise the script never fails the build: if the config cannot be fetched
 * or read, it keeps the last synced campaign (dropped once it has ended).
 */
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_URL = 'https://lucaberton.com/promo/promos.json';
const IMAGE_FILES = ['wide.webp', 'wide.jpg', 'card-800.webp', 'card-1200.webp', 'card.jpg'];

const opts = {};
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) opts[a.slice(2)] = process.argv[++i];
  else positional.push(a);
}
const site = positional[0];
const local = opts.local;
const selfHost = opts['self-host'];
const out = opts.out ?? 'src/generated/promo.json';
if (!site) {
  console.error('usage: node scripts/sync-promo.mjs <site> [--local <promos.json>] [--self-host <public dir>] [--out <file>]');
  process.exit(2);
}

const write = (promo) => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(promo, null, 2) + '\n');
};

/** Throws with every problem found, so one run lists them all. */
function validate(cfg) {
  const problems = [];
  if (!cfg || !Array.isArray(cfg.campaigns)) problems.push('"campaigns" must be an array');
  for (const [i, c] of (cfg?.campaigns ?? []).entries()) {
    const at = `campaigns[${i}]${c?.id ? ` (${c.id})` : ''}`;
    for (const k of ['id', 'href', 'alt', 'caption', 'start', 'end']) if (typeof c?.[k] !== 'string' || !c[k]) problems.push(`${at}: "${k}" is required`);
    if (c?.id && !/^[a-z0-9-]+$/.test(c.id)) problems.push(`${at}: "id" must be lowercase letters, digits and dashes`);
    if (!Array.isArray(c?.sites) || c.sites.length === 0) problems.push(`${at}: "sites" must list site ids or "*"`);
    if (c?.start && !/^\d{4}-\d{2}-\d{2}$/.test(c.start)) problems.push(`${at}: "start" must be a date, YYYY-MM-DD (local midnight for each visitor)`);
    if (c?.end && Number.isNaN(Date.parse(c.end))) problems.push(`${at}: "end" must be an ISO instant, e.g. 2026-10-30T00:00:00Z`);
    if (c?.href && !/^https:\/\//.test(c.href)) problems.push(`${at}: "href" must be an https URL`);
    const img = c?.image;
    if (!img || typeof img.base !== 'string' || !/^https:\/\//.test(img.base)) problems.push(`${at}: "image.base" must be an https URL`);
    for (const k of ['wide', 'card']) if (!(img?.[k]?.width > 0 && img?.[k]?.height > 0)) problems.push(`${at}: "image.${k}" needs width and height`);
  }
  if (problems.length) throw new Error(`invalid promo config:\n  - ${problems.join('\n  - ')}`);
}

/** The campaign as the banner needs it, with the date gate prepared. */
function resolve(c, base) {
  const [y, m, d] = c.start.split('-').map(Number);
  const endMs = Date.parse(c.end);
  return {
    id: c.id,
    start: c.start,
    end: new Date(endMs).toISOString(),
    href: c.href,
    code: c.code ?? null,
    alt: c.alt,
    caption: c.caption,
    disclosure: c.disclosure ?? null,
    image: { base, wide: c.image.wide, card: c.image.card },
    tracking: {
      campaign: c.tracking?.campaign ?? c.id,
      company: c.tracking?.company ?? null,
      offerId: c.tracking?.offerId ?? c.id.replace(/-/g, '_'),
    },
    // Inlined right before the banner: flags <html> from the visitor's local
    // midnight on `start` until `end` (an instant) while the page is parsed,
    // so the banner is laid out visible from the start and never shifts it.
    script: `(function(){var n=Date.now();if(n>=new Date(${y},${m - 1},${d}).getTime()&&n<${endMs})document.documentElement.setAttribute("data-promo-on","")})()`,
    css: 'html:not([data-promo-on]) [data-promo]{display:none}',
  };
}

async function load() {
  if (local) return JSON.parse(fs.readFileSync(local, 'utf8'));
  const res = await fetch(CONFIG_URL, { signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`${CONFIG_URL} answered ${res.status}`);
  return res.json();
}

async function download(base, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of IMAGE_FILES) {
    const res = await fetch(`${base}/${f}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${base}/${f} answered ${res.status}`);
    fs.writeFileSync(path.join(dir, f), Buffer.from(await res.arrayBuffer()));
  }
}

const now = Date.now();
try {
  const cfg = await load();
  validate(cfg);
  const c = cfg.campaigns.find((x) => x.enabled !== false && (x.sites.includes('*') || x.sites.includes(site)) && Date.parse(x.end) > now);
  if (!c) {
    write(null);
    console.log(`[sync-promo] ${site}: no active campaign`);
  } else {
    let base = c.image.base.replace(/\/$/, '');
    if (site === 'lucaberton.com') base = new URL(base).pathname; // served by this site
    if (selfHost) {
      const rel = `/promo/${c.id}`;
      await download(base, path.join(selfHost, rel));
      base = rel;
    }
    write(resolve(c, base));
    console.log(`[sync-promo] ${site}: ${c.id} (${c.start} to ${c.end}), images ${base}`);
  }
} catch (err) {
  if (local) {
    console.error(`[sync-promo] ${err.message}`);
    process.exit(1);
  }
  let last = null;
  try {
    last = JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch {}
  if (last && Date.parse(last.end) <= now) last = null;
  write(last);
  console.warn(`[sync-promo] ${site}: ${err.message}; kept ${last ? last.id : 'no campaign'} from the last sync`);
}
