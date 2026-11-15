#!/usr/bin/env node
// Vendored from https://github.com/lucab85/site-og-check (validate-og.cjs). Runs after
// every build (npm postbuild) so share tags WhatsApp cannot read fail the deploy.
/*
 * Framework-agnostic Open Graph / social-card validator.
 *
 * Modes:
 *   node validate-og.cjs --url https://example.com[/path]   (validate a LIVE page)
 *   node validate-og.cjs --dir ./public [--home-only]        (validate built HTML in a dir)
 *   node validate-og.cjs --dir ./public --all                (audit every *.html in dir)
 *
 * Options:
 *   --site https://example.com   (dir mode) og:image URLs on this origin are
 *                                checked as files in --dir, without network;
 *   --quiet                      print only FAIL / WARN lines and the summary;
 *   --wait-for-image <substring> (url mode) poll until og:image contains it;
 *   --poll-timeout <seconds>     (url mode) max wait, default 480.
 *
 * What it enforces (the link-preview contract WhatsApp / iMessage / LinkedIn /
 * Slack need):
 *   - og:title, og:image present (og:description, og:type recommended);
 *   - the social tags are in <head> and written the way WhatsApp's parser
 *     reads them: <meta property="og:image" content="https://...">, with
 *     quoted values. Minifiers that drop the quotes
 *     (<meta content=https://... property=og:image>) pass Facebook's debugger
 *     but the preview on WhatsApp shows no image;
 *   - og:image is an absolute https:// URL, reachable (HTTP 200) also for the
 *     WhatsApp user agent, a JPEG, PNG or WebP (no SVG), at least 200x200
 *     (warn below 600x315), under 600 KB (warn above 300 KB), and matching
 *     og:image:width / og:image:height when those are declared;
 *   - twitter:card == "summary_large_image" and twitter:image present.
 *
 * Exit code 1 = at least one FAIL (so it can gate a deploy pipeline).
 * Exit code 0 = all checks passed (or only warnings).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const hasFlag = (name) => argv.includes(name);

const URL_MODE = hasFlag('--url');
const DIR_MODE = hasFlag('--dir');
const urlArg = getArg('--url');
const dirArg = getArg('--dir');
const siteArg = getArg('--site');
const HOME_ONLY = hasFlag('--home-only');
const ALL = hasFlag('--all');
const QUIET = hasFlag('--quiet');
const WAIT_FOR_IMAGE = getArg('--wait-for-image'); // substring the og:image must contain
const POLL_TIMEOUT = parseInt(getArg('--poll-timeout') || '480', 10);

const WHATSAPP_UA = 'WhatsApp/2.23.20.0 A';
const DEFAULT_UA = 'og-check/1.1';
const MAX_IMAGE_BYTES = 600 * 1024;
const WARN_IMAGE_BYTES = 300 * 1024;
const REQUIRED_FORM = ['og:title', 'og:image', 'og:description', 'og:url', 'og:type', 'twitter:card', 'twitter:image'];

function decodeEntities(s) {
  if (s == null) return s;
  return s
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/*
 * Every <meta> tag in <head>, with its attributes in source order and whether
 * each value was quoted. A tag after </head> (or with no <head> at all) is
 * returned with inHead=false.
 */
const META_RE = /<meta\b([^>]*?)\/?>/gi;
const ATTR_RE = /([^\s"'=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function parseMeta(html) {
  const headEnd = (() => {
    const i = html.search(/<\/head\s*>|<body\b/i);
    return i < 0 ? html.length : i;
  })();
  const tags = [];
  for (const m of html.matchAll(META_RE)) {
    const attrs = [];
    for (const a of m[1].matchAll(ATTR_RE)) {
      const quoted = a[2] !== undefined || a[3] !== undefined;
      const value = a[2] ?? a[3] ?? a[4];
      attrs.push({ name: a[1].toLowerCase(), value: value == null ? null : decodeEntities(value), quoted });
    }
    const get = (n) => attrs.find((a) => a.name === n);
    const keyAttr = get('property') || get('name');
    if (!keyAttr || keyAttr.value == null) continue;
    tags.push({
      raw: m[0],
      key: keyAttr.value.toLowerCase(),
      keyAttr,
      content: get('content'),
      attrs,
      inHead: m.index < headEnd,
    });
  }
  return tags;
}
const first = (tags, key) => tags.find((t) => t.key === key);
const contentOf = (tags, key) => {
  const t = first(tags, key);
  return t && t.content ? t.content.value : null;
};

function httpGet(url, ua = DEFAULT_UA, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': ua, Accept: '*/*' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return httpGet(new URL(res.headers.location, url).toString(), ua, redirects - 1).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        resolve({ status: res.statusCode, buffer: buf, body: /text|html|xml/.test(ct) ? buf.toString('utf8') : '', contentType: ct });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function imageInfo(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: 'jpeg', h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
      }
      i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
    }
    return { type: 'jpeg' };
  }
  if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
    const kind = buf.slice(12, 16).toString();
    if (kind === 'VP8X') return { type: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { type: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type: 'webp', w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    return { type: 'webp' };
  }
  if (buf.slice(0, 6).toString() === 'GIF89a' || buf.slice(0, 6).toString() === 'GIF87a') {
    return { type: 'gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  const head = buf.slice(0, 512).toString('utf8');
  if (/<svg\b/i.test(head)) return { type: 'svg' };
  return null;
}

const recs = [];
function record(level, msg, detail) {
  recs.push({ level, msg, detail });
  if (QUIET && level === 'OK') return;
  const icon = level === 'FAIL' ? '❌' : level === 'WARN' ? '⚠️' : '✅';
  console.log(`${icon} ${level}: ${msg}${detail ? ` — ${detail}` : ''}`);
}

/* Markup checks: the form WhatsApp's parser reads. No network. */
function checkMarkup(tags, label) {
  for (const key of REQUIRED_FORM) {
    const t = first(tags, key);
    if (!t) continue;
    const problems = [];
    if (!t.inHead) problems.push('outside <head>');
    if (!t.keyAttr.quoted) problems.push(`${t.keyAttr.name} value not quoted`);
    if (t.content && !t.content.quoted) problems.push('content value not quoted');
    if (!t.content) problems.push('no content attribute');
    if (problems.length) {
      record('FAIL', `[${label}] ${key} tag not in the form WhatsApp reads (${problems.join(', ')})`,
        `${t.raw.slice(0, 140)} — write <meta ${t.keyAttr.name}="${key}" content="...">`);
      continue;
    }
    const keyIndex = t.attrs.indexOf(t.keyAttr);
    const contentIndex = t.attrs.indexOf(t.content);
    if (contentIndex < keyIndex) {
      record('WARN', `[${label}] ${key}: content comes before ${t.keyAttr.name}`, 'some preview parsers expect the key first');
    }
  }
  const images = new Set(tags.filter((t) => t.key === 'og:image' && t.content).map((t) => t.content.value));
  if (images.size > 1) record('WARN', `[${label}] ${images.size} different og:image tags; most apps use the first`, [...images].slice(0, 3).join(' | '));
}

/* Fetch an og:image (or read it from --dir), cached by URL. */
const imageCache = new Map();
async function loadImage(abs, origin, dir) {
  if (imageCache.has(abs)) return imageCache.get(abs);
  let result;
  if (dir && siteArg && abs.startsWith(new URL(siteArg).origin + '/')) {
    const rel = decodeURIComponent(new URL(abs).pathname);
    const file = path.join(dir, rel);
    result = fs.existsSync(file) && fs.statSync(file).isFile()
      ? { status: 200, buffer: fs.readFileSync(file), contentType: '', local: file }
      : { status: 404, buffer: Buffer.alloc(0), contentType: '', local: file };
  } else {
    try {
      const wa = await httpGet(abs, WHATSAPP_UA);
      let other = null;
      if (wa.status !== 200) other = await httpGet(abs, DEFAULT_UA).catch(() => null);
      result = { ...wa, otherStatus: other && other.status };
    } catch (e) {
      result = { status: 0, buffer: Buffer.alloc(0), contentType: '', error: e.message };
    }
  }
  imageCache.set(abs, result);
  return result;
}

async function checkImage(tags, label, origin, dir) {
  const ogImage = contentOf(tags, 'og:image');
  if (!ogImage) {
    record('FAIL', `[${label}] og:image missing — no preview image (bare link)`, 'WhatsApp/iMessage/LinkedIn render nothing');
    return;
  }
  let abs = ogImage;
  if (ogImage.startsWith('//')) abs = 'https:' + ogImage;
  else if (!/^https?:\/\//i.test(ogImage)) {
    record('FAIL', `[${label}] og:image is relative; previews need an absolute https:// URL`, ogImage);
    if (!origin) return;
    abs = new URL(ogImage, origin + '/').toString();
  }
  if (!/^https:\/\//i.test(abs)) record('FAIL', `[${label}] og:image not https`, abs);

  if (dir && !siteArg && !/^https?:\/\//i.test(ogImage)) return;
  const img = await loadImage(abs, origin, dir);
  if (img.status !== 200) {
    const why = img.local ? `file ${img.local} not in the build` : img.error || `HTTP ${img.status}`;
    record('FAIL', `[${label}] og:image not reachable (${why})`, abs);
    return;
  }
  if (img.otherStatus === 200) {
    // reached with a generic agent but not with WhatsApp's: a bot rule or WAF.
    record('FAIL', `[${label}] og:image blocked for the WhatsApp user agent`, abs);
  }
  if (img.contentType && !/^image\//i.test(img.contentType)) {
    record('FAIL', `[${label}] og:image served as ${img.contentType}, not an image`, abs);
  }

  const size = img.buffer.length;
  const kb = Math.round(size / 1024);
  if (size > MAX_IMAGE_BYTES) record('FAIL', `[${label}] og:image is ${kb} KB; WhatsApp drops large images, keep it under 300 KB`, abs);
  else if (size > WARN_IMAGE_BYTES) record('WARN', `[${label}] og:image is ${kb} KB; WhatsApp is reliable under 300 KB`, abs);

  const info = imageInfo(img.buffer);
  if (!info) { record('WARN', `[${label}] og:image format unreadable`, abs); return; }
  if (info.type === 'svg') { record('FAIL', `[${label}] og:image is SVG; link previews need JPEG or PNG`, abs); return; }
  if (info.type === 'gif') record('WARN', `[${label}] og:image is GIF; use JPEG or PNG`, abs);
  if (info.type === 'webp') record('WARN', `[${label}] og:image is WebP; JPEG or PNG is safer for every preview client`, abs);
  if (!info.w || !info.h) { record('WARN', `[${label}] og:image dimensions unreadable`, abs); return; }
  if (info.w < 200 || info.h < 200) {
    record('FAIL', `[${label}] og:image too small (${info.w}x${info.h}, need >=200x200)`, abs);
    return;
  }
  const declaredW = parseInt(contentOf(tags, 'og:image:width') || '', 10);
  const declaredH = parseInt(contentOf(tags, 'og:image:height') || '', 10);
  if ((declaredW && declaredW !== info.w) || (declaredH && declaredH !== info.h)) {
    record('WARN', `[${label}] og:image:width/height say ${declaredW || '?'}x${declaredH || '?'} but the image is ${info.w}x${info.h}`, abs);
  }
  if (info.w < 600 || info.h < 315) record('WARN', `[${label}] og:image small (${info.w}x${info.h}, recommend >=600x315)`, abs);
  else record('OK', `[${label}] og:image ok (${info.w}x${info.h}, ${info.type}, ${kb} KB)`, abs);
}

async function validateHtml(html, label, origin, dir) {
  const tags = parseMeta(html);
  if (!contentOf(tags, 'og:title')) record('FAIL', `[${label}] og:title missing — share shows no title`, 'bare link');
  if (!contentOf(tags, 'og:description')) record('WARN', `[${label}] og:description missing`, '');
  if (!contentOf(tags, 'og:type')) record('WARN', `[${label}] og:type missing`, '');

  checkMarkup(tags, label);
  await checkImage(tags, label, origin, dir);

  const twCard = contentOf(tags, 'twitter:card');
  const twImage = contentOf(tags, 'twitter:image');
  if (!twCard) record('FAIL', `[${label}] twitter:card missing`, '');
  else if (twCard !== 'summary_large_image') record('FAIL', `[${label}] twitter:card != summary_large_image (${twCard})`, '');
  if (!twImage) record('FAIL', `[${label}] twitter:image missing`, '');
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

// Redirect stubs and noindex pages are not shared; skip them in --all audits.
const isStub = (html) => /http-equiv=["']?refresh/i.test(html.slice(0, 4000));

async function main() {
  if (URL_MODE && urlArg) {
    const u = urlArg;
    const origin = new URL(u).origin;
    console.log(`Validating live URL: ${u}\n`);

    // Deploy-aware wait: if we expect the deploy to flip og:image to a new
    // asset, poll until it appears (or timeout) so we validate the NEW build,
    // not the stale one still served right after `push` to main.
    if (WAIT_FOR_IMAGE) {
      const deadline = Date.now() + POLL_TIMEOUT * 1000;
      let ready = false;
      while (Date.now() < deadline) {
        const probe = await httpGet(u, WHATSAPP_UA).catch(() => ({ body: '' }));
        const img = contentOf(parseMeta(probe.body || ''), 'og:image');
        if (img && img.includes(WAIT_FOR_IMAGE)) { ready = true; break; }
        process.stdout.write('.');
        await new Promise((r) => setTimeout(r, 15000));
      }
      console.log(ready ? '\n[wait] expected og:image is live, validating now.' : `\n[wait] timed out after ${POLL_TIMEOUT}s waiting for og:image to contain "${WAIT_FOR_IMAGE}"; validating current state.`);
    }

    // Fetch as WhatsApp does; if that fails, tell a WAF/bot rule from an outage.
    const r = await httpGet(u, WHATSAPP_UA).catch((e) => ({ status: 0, body: '', error: e.message }));
    if (r.status !== 200) {
      const other = await httpGet(u, DEFAULT_UA).catch(() => ({ status: 0 }));
      const msg = other.status === 200
        ? `page blocked for the WhatsApp user agent (HTTP ${r.status}, ${other.status} otherwise)`
        : `page not reachable (${r.error || 'HTTP ' + r.status})`;
      record('FAIL', msg, u);
      process.exit(1);
    }
    await validateHtml(r.body, u, origin, null);
  } else if (DIR_MODE && dirArg) {
    const files = walk(dirArg);
    let targets = files;
    if (!ALL) {
      const home = files.find((f) => path.relative(dirArg, f) === 'index.html') || files.find((f) => /(^|\/)index\.html$/.test(f));
      targets = home ? [home] : files.slice(0, 1);
    }
    const origin = siteArg ? new URL(siteArg).origin : null;
    let skipped = 0;
    console.log(`Validating ${targets.length} page(s) in ${dirArg}${siteArg ? ` (site ${origin})` : ''}\n`);
    for (const f of targets) {
      const html = fs.readFileSync(f, 'utf8');
      if (ALL && isStub(html)) { skipped++; continue; }
      await validateHtml(html, path.relative(dirArg, f) || 'index.html', origin, dirArg);
    }
    if (skipped) console.log(`(skipped ${skipped} redirect stub(s))`);
  } else {
    console.error('Usage:\n  node validate-og.cjs --url https://example.com\n  node validate-og.cjs --dir ./public [--home-only|--all] [--site https://example.com] [--quiet]');
    process.exit(2);
  }

  const fails = recs.filter((r) => r.level === 'FAIL').length;
  const warns = recs.filter((r) => r.level === 'WARN').length;
  console.log(`\n${fails === 0 ? '✅ PASS' : '❌ FAIL'} — ${fails} failure(s), ${warns} warning(s).`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
