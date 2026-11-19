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
// With "video": true the campaign also has a muted MP4 loop per format. The
// images stay the still that shows first (and for reduced motion, data saver,
// or a site whose CSP blocks the video); the loop replaces it once it plays.
const VIDEO_FILES = ['wide.mp4', 'card.mp4'];

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
    if (c?.video !== undefined && typeof c.video !== 'boolean') problems.push(`${at}: "video" must be true or false`);
  }
  if (problems.length) throw new Error(`invalid promo config:\n  - ${problems.join('\n  - ')}`);
}

/**
 * Inlined after the date gate when the campaign has a video. After the page
 * has loaded it puts the muted loop (card.mp4 on phones, wide.mp4 otherwise)
 * over the banner image, fades it in once it plays, and adds a pause button
 * (WCAG 2.2.2: motion longer than 5 s must be stoppable). It does nothing with
 * reduced motion or data saver on, and removes the video again if it cannot
 * play (autoplay refused, CSP media-src), so the still image stays. Banners
 * rendered later (client-side navigation) are picked up by the observer.
 */
const VIDEO_SCRIPT = `(function(){if(window.__promoVideo)return;window.__promoVideo=1;var B=__BASE__;
function off(){var c=navigator.connection;return matchMedia("(prefers-reduced-motion: reduce)").matches||(c&&c.saveData)}
function place(box,a,btn){btn.style.top=(a.offsetTop+8)+"px";btn.style.right=(box.clientWidth-a.offsetLeft-a.offsetWidth+8)+"px"}
function enhance(box){if(box.hasAttribute("data-promo-video"))return;var a=box.querySelector("a"),img=box.querySelector("img");if(!a||!img)return;box.setAttribute("data-promo-video","");
var v=document.createElement("video"),btn=document.createElement("button");v.muted=true;v.loop=true;v.playsInline=true;v.autoplay=true;v.preload="auto";
v.setAttribute("muted","");v.setAttribute("playsinline","");v.setAttribute("aria-hidden","true");v.className="promo-video";
v.src=B+(matchMedia("(max-width: 640px)").matches?"/card.mp4":"/wide.mp4");
function drop(){v.remove();btn.remove()}
function label(){var p=v.paused;btn.setAttribute("aria-label",p?"Play the banner animation":"Pause the banner animation");btn.textContent=p?"\u25B6":"\u275A\u275A"}
v.addEventListener("playing",function(){v.style.opacity="1"});v.addEventListener("play",label);v.addEventListener("pause",label);v.addEventListener("error",drop);
btn.type="button";btn.className="promo-video-toggle";label();
btn.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();if(v.paused)v.play();else v.pause()});
if(getComputedStyle(a).position==="static")a.style.position="relative";if(getComputedStyle(box).position==="static")box.style.position="relative";
a.appendChild(v);box.appendChild(btn);place(box,a,btn);addEventListener("resize",function(){place(box,a,btn)});
var p=v.play();if(p&&p.catch)p.catch(drop)}
function run(){if(!document.documentElement.hasAttribute("data-promo-on")||off())return;document.querySelectorAll("[data-promo]").forEach(enhance)}
function start(){setTimeout(function(){run();if(window.MutationObserver)new MutationObserver(run).observe(document.body,{childList:true,subtree:true})},300)}
if(document.readyState==="complete")start();else addEventListener("load",start)})()`;
const VIDEO_CSS =
  '.promo-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s;pointer-events:none}' +
  '.promo-video-toggle{position:absolute;z-index:1;width:32px;height:32px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font:11px/32px system-ui,sans-serif;text-align:center;cursor:pointer}' +
  '.promo-video-toggle:focus-visible{outline:2px solid #fff;outline-offset:2px}';

/** The campaign as the banner needs it, with the date gate prepared. */
function resolve(c, base) {
  const [y, m, d] = c.start.split('-').map(Number);
  const endMs = Date.parse(c.end);
  const video = c.video === true;
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
    video,
    tracking: {
      campaign: c.tracking?.campaign ?? c.id,
      company: c.tracking?.company ?? null,
      offerId: c.tracking?.offerId ?? c.id.replace(/-/g, '_'),
    },
    // Inlined right before the banner: flags <html> from the visitor's local
    // midnight on `start` until `end` (an instant) while the page is parsed,
    // so the banner is laid out visible from the start and never shifts it.
    script:
      `(function(){var n=Date.now();if(n>=new Date(${y},${m - 1},${d}).getTime()&&n<${endMs})document.documentElement.setAttribute("data-promo-on","")})()` +
      (video ? ';' + VIDEO_SCRIPT.replace('__BASE__', JSON.stringify(base)) : ''),
    css: 'html:not([data-promo-on]) [data-promo]{display:none}' + (video ? VIDEO_CSS : ''),
  };
}

async function load() {
  if (local) return JSON.parse(fs.readFileSync(local, 'utf8'));
  const res = await fetch(CONFIG_URL, { signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`${CONFIG_URL} answered ${res.status}`);
  return res.json();
}

async function download(base, dir, video) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of video ? [...IMAGE_FILES, ...VIDEO_FILES] : IMAGE_FILES) {
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
      await download(base, path.join(selfHost, rel), c.video === true);
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
