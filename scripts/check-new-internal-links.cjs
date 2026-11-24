#!/usr/bin/env node
/**
 * Internal links added to existing posts must follow the internal-linking rules.
 * Checks only links that are new in this change (BASE..working tree); new posts are skipped.
 *
 *   R2  at most --max new internal links per post (default 5)
 *   R3  no link from a post to itself
 *   R4  each target at most once per post (a new link to an already linked target fails)
 *   R5  not in frontmatter, headings, code, tables, HTML/JSX lines or the intro paragraph
 *   R6  the target is an existing post
 *   R7  anchor text not empty or padded with spaces
 *
 * R3, R6, R7 always fail. R2, R4, R5 are warnings, and fail only with --strict
 * (set by CI for internal-linking passes: branch internal-links/* or "[internal-links]" in the commit message),
 * because hand-written posts legitimately repeat a link in a "Related" section or link from the intro.
 *
 * Usage: node scripts/check-new-internal-links.cjs --content <dir> --url '<pattern>' [--base <ref>] [--max 5] [--strict]
 *   pattern placeholders: {stem} {stem_lower} {slug_stem} {slug_strip} {fm_slug} {fm_category}; {a|b} = first non-empty,
 *   (slug_strip deletes non-alphanumerics instead of turning them into '-'),
 *   e.g. '/blog/{stem_lower}/' or '/articles/{fm_slug|slug_stem}'
 *   base: --base, else $BASE_SHA (CI), else HEAD (uncommitted changes). Exit 1 on any violation.
 * The same file lives in every site repo; keep the copies identical.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict') || /^(1|true)$/i.test(process.env.STRICT_INTERNAL_LINKS || '');
const args = Object.fromEntries(
  argv.reduce((a, v, i, all) => (v.startsWith('--') && v !== '--strict' ? a.concat([[v.slice(2), all[i + 1]]]) : a), []),
);
if (!args.content || !args.url) {
  console.error('usage: --content <dir> --url <pattern> [--base <ref>] [--max 5]');
  process.exit(2);
}
const MAX = Number(args.max || 5);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const ROOT = git('rev-parse', '--show-toplevel').trim();
const CONTENT = path.resolve(args.content);
const contentRel = path.relative(ROOT, CONTENT);

let base = args.base || process.env.BASE_SHA || 'HEAD';
if (/^0+$/.test(base)) {
  console.log('No base commit (new branch): nothing to compare, skipped.');
  process.exit(0);
}
try {
  git('cat-file', '-e', `${base}^{commit}`);
} catch {
  try {
    git('fetch', '--no-tags', '--depth=1', 'origin', base); // shallow CI checkouts
  } catch {
    console.log(`::warning::Base ${base} not available (force-push?): internal-link check skipped.`);
    process.exit(0);
  }
}

const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const splitFm = (text) => {
  if (!text.startsWith('---')) return ['', text];
  const m = /\n---[^\n]*(\n|$)/.exec(text.slice(3));
  if (!m) return ['', text];
  const end = 3 + m.index + m[0].length;
  return [text.slice(0, end), text.slice(end)];
};
const fmField = (fm, k) => (new RegExp(`^${k}:[ \\t]*["']?(.*?)["']?[ \\t]*$`, 'm').exec(fm) || [])[1] || '';
const norm = (u) => u.split('#')[0].split('?')[0].replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '').toLowerCase();

// URL of every post
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.mdx?$/.test(e.name)) files.push(p);
  }
})(CONTENT);
const urlOf = new Map(); // file -> normalized url
const fileOf = new Map(); // normalized url -> file
const prefix = norm(args.url.split('{')[0]) + '/';
for (const f of files) {
  const stem = path.basename(f).replace(/\.mdx?$/, '');
  const fm = splitFm(fs.readFileSync(f, 'utf8'))[0];
  const v = { stem, stem_lower: stem.toLowerCase(), slug_stem: slugify(stem), slug_strip: stem.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, ''), fm_slug: fmField(fm, 'slug'), fm_category: fmField(fm, 'category') };
  const u = norm(args.url.replace(/\{([\w|]+)\}/g, (_, k) => k.split('|').map((x) => v[x]).find(Boolean) || ''));
  urlOf.set(f, u);
  fileOf.set(u, f);
}

const LINK = /(?<!!)\[([^\[\]\n]+)\]\(([^()\s]+)\)/g;
const SKIP = /^(#|<|import\s|export\s|\||>|\{|!\[|---|\*\*\*|<!--|:::)/;
const isInternal = (u) => (u.startsWith('/') || new RegExp(`^https?://(www\\.)?${process.env.SITE_HOST || '$^'}`).test(u)) && (norm(u) + '/').startsWith(prefix);

/** line number -> paragraph number for linkable prose (paragraph 1 = intro); other lines absent */
function proseLines(text) {
  const [fm, body] = splitFm(text);
  const out = new Map();
  const baseLine = fm.split('\n').length - 1;
  let code = false, para = 0, blank = true, jsx = 0, esm = 0;
  body.split('\n').forEach((ln, i) => {
    const st = ln.trim();
    if (esm || (!code && /^(import|export)\s/.test(st))) { // MDX import/export, possibly multi-line
      esm = Math.max(0, esm + (ln.match(/[[{(]/g) || []).length - (ln.match(/[\]})]/g) || []).length);
      blank = false; return;
    }
    if (/^(```|~~~)/.test(st)) { code = !code; blank = false; return; }
    if (code) return;
    if (!st) { blank = true; return; }
    const opens = (st.match(/<[A-Za-z][^>]*[^/]>|<[A-Za-z]>/g) || []).length;
    const closes = (st.match(/<\/[A-Za-z][^>]*>/g) || []).length;
    const isJsx = jsx > 0 || SKIP.test(st) || st.endsWith('>');
    if (st.startsWith('<') || jsx) jsx = Math.max(0, jsx + opens - closes);
    if (isJsx) { blank = false; return; }
    if (blank) para++;
    blank = false;
    out.set(baseLine + i + 1, para);
  });
  return out;
}

function linksOf(text) {
  const res = [];
  text.split('\n').forEach((ln, i) => {
    for (const m of ln.matchAll(LINK)) res.push({ anchor: m[1], url: m[2], line: i + 1 });
  });
  return res;
}

const changed = git('diff', '-z', '--name-only', '--diff-filter=M', base, '--', contentRel).split('\0').filter((f) => /\.mdx?$/.test(f));
const errors = [];
let added = 0;
for (const rel of changed) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) continue;
  const oldText = git('show', `${base}:${rel}`);
  const newText = fs.readFileSync(f, 'utf8');
  const before = new Map();
  for (const l of linksOf(oldText)) before.set(`${l.anchor}\0${l.url}`, (before.get(`${l.anchor}\0${l.url}`) || 0) + 1);
  const oldTargets = new Set(linksOf(oldText).filter((l) => isInternal(l.url)).map((l) => norm(l.url)));
  const prose = proseLines(newText);
  const newLinks = linksOf(newText);
  const count = new Map();
  for (const l of newLinks) if (isInternal(l.url)) count.set(norm(l.url), (count.get(norm(l.url)) || 0) + 1);
  let n = 0;
  for (const l of newLinks) {
    const key = `${l.anchor}\0${l.url}`;
    if (before.get(key) > 0) { before.set(key, before.get(key) - 1); continue; }
    if (!isInternal(l.url)) continue;
    n++; added++;
    const t = norm(l.url);
    const where = `${rel}:${l.line}: [${l.anchor}](${l.url})`;
    if (!l.anchor.trim() || l.anchor !== l.anchor.trim()) errors.push(`${where} R7 anchor empty or padded with spaces`);
    if (!prose.has(l.line)) errors.push(`${where} R5 not in body prose (frontmatter, heading, code, table, HTML/JSX)`);
    else if (prose.get(l.line) <= 1) errors.push(`${where} R5 in the intro paragraph`);
    if (t === urlOf.get(f)) errors.push(`${where} R3 links the post to itself`);
    if (!fileOf.has(t)) errors.push(`${where} R6 target is not an existing post`);
    if (oldTargets.has(t)) errors.push(`${where} R4 post already linked to this target`);
    else if (count.get(t) > 1) errors.push(`${where} R4 target linked ${count.get(t)} times in this post`);
  }
  if (n > MAX) errors.push(`${rel}: R2 ${n} new internal links (max ${MAX})`);
}

const ALWAYS = / R[367] /;
const fatal = errors.filter((e) => STRICT || ALWAYS.test(e));
const warn = errors.filter((e) => !fatal.includes(e));
console.log(`New internal links: ${added} in ${changed.length} changed post(s) (base ${base.slice(0, 12)}, ${STRICT ? 'strict' : 'normal'} mode).`);
for (const e of warn) console.log(`::warning::${e}`);
for (const e of fatal) console.log(`::error::${e}`);
if (fatal.length) process.exit(1);
console.log(warn.length ? `OK with ${warn.length} warning(s).` : 'OK: all new internal links follow the rules.');
