#!/usr/bin/env python3
"""Verify the generated sitemap against the built site (dist/).

Catches the SEO regressions flagged by the Ahrefs site audit:
  - "Indexable page not in sitemap"     -> a real page missing from sitemap
  - "Pages removed from sitemaps"        -> same, after a slug/category move
  - "Indexable page became non-indexable" / 404 -> a sitemap URL with no page
  - redirect stub pages leaking into the sitemap (must be excluded)

How it works
  After `astro build`, every route is emitted as dist/<path>/index.html.
  Redirect stubs are detected by their `http-equiv="refresh"` meta tag; those
  MUST NOT appear in the sitemap. Every other indexable HTML page MUST appear,
  and every <loc> in the sitemap MUST map to a real file on disk.

Usage
  python3 scripts/verify-sitemap.py            # build must have run first
  python3 scripts/verify-sitemap.py --build    # run `astro build` first

Exit code is non-zero when any mismatch is found.
"""

from __future__ import annotations

import glob
import os
import re
import subprocess
import sys

DIST_DIR = "dist"
SITE = "https://kubernetes.recipes"
SITEMAP_GLOB = f"{DIST_DIR}/sitemap-*.xml"

# Pages that are intentionally absent from the sitemap even though they render
# as real (non-redirect) HTML. Keep in sync with astro.config.mjs filters.
INTENTIONAL_NOINDEX = {
    "/404/",
}

# Path prefixes excluded from the sitemap by astro.config.mjs (demo/template).
EXCLUDED_PREFIXES = ("/blog/", "/pricing/")

REFRESH_RE = re.compile(r'http-equiv=["\']?refresh', re.IGNORECASE)
LOC_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")


def is_redirect_stub(html_path: str) -> bool:
    """A stub page contains a <meta http-equiv="refresh"> tag."""
    try:
        with open(html_path, "r", encoding="utf-8", errors="ignore") as fh:
            head = fh.read(4096)
    except OSError:
        return False
    return bool(REFRESH_RE.search(head))


def path_from_html(html_path: str) -> str:
    """dist/recipes/ai/foo/index.html -> /recipes/ai/foo/"""
    rel = os.path.relpath(html_path, DIST_DIR)
    if rel.endswith("index.html"):
        rel = rel[: -len("index.html")]
    else:
        rel = rel[: -len(".html")]
    path = "/" + rel
    if not path.endswith("/"):
        path += "/"
    return path.replace("//", "/")


def load_sitemap_paths() -> set[str]:
    files = sorted(glob.glob(SITEMAP_GLOB))
    files = [f for f in files if "index" not in os.path.basename(f)]
    if not files:
        print(f"❌ No sitemap found ({SITEMAP_GLOB}). Run `astro build` first.")
        sys.exit(1)
    paths: set[str] = set()
    for f in files:
        with open(f, "r", encoding="utf-8", errors="ignore") as fh:
            data = fh.read()
        for url in LOC_RE.findall(data):
            url = url.strip()
            if url.startswith(SITE):
                paths.add(url[len(SITE):] or "/")
    return paths


def collect_pages() -> tuple[set[str], set[str]]:
    """Return (indexable_paths, stub_paths) discovered in dist/."""
    indexable: set[str] = set()
    stubs: set[str] = set()
    for html in glob.glob(f"{DIST_DIR}/**/index.html", recursive=True):
        path = path_from_html(html)
        if path in INTENTIONAL_NOINDEX:
            continue
        if any(path.startswith(p) for p in EXCLUDED_PREFIXES):
            continue
        if is_redirect_stub(html):
            stubs.add(path)
        else:
            indexable.add(path)
    return indexable, stubs


def main() -> None:
    if "--build" in sys.argv:
        print("🏗️  Running astro build...")
        subprocess.run(["pnpm", "build"], check=True)

    if not os.path.isdir(DIST_DIR):
        print(f"❌ {DIST_DIR}/ not found. Run `astro build` (or use --build).")
        sys.exit(1)

    sitemap_paths = load_sitemap_paths()
    indexable, stubs = collect_pages()

    # 1. Indexable pages missing from the sitemap.
    missing = sorted(indexable - sitemap_paths)
    # 2. Redirect stubs that leaked into the sitemap.
    stub_in_sitemap = sorted(stubs & sitemap_paths)
    # 3. Sitemap URLs that have no corresponding page on disk (404).
    all_real = indexable | stubs
    dangling = sorted(sitemap_paths - all_real)

    print("=" * 60)
    print("  SITEMAP VERIFICATION REPORT")
    print("=" * 60)
    print(f"  Indexable pages built:   {len(indexable)}")
    print(f"  Redirect stub pages:     {len(stubs)}")
    print(f"  URLs in sitemap:         {len(sitemap_paths)}")

    if missing:
        print(f"\n🔴 INDEXABLE PAGES MISSING FROM SITEMAP: {len(missing)}")
        print("-" * 40)
        for p in missing:
            print(f"  {p}")
    else:
        print(f"\n✅ INDEXABLE PAGES MISSING FROM SITEMAP: 0")

    if stub_in_sitemap:
        print(f"\n🔴 REDIRECT STUBS WRONGLY IN SITEMAP: {len(stub_in_sitemap)}")
        print("-" * 40)
        for p in stub_in_sitemap:
            print(f"  {p}")
    else:
        print(f"\n✅ REDIRECT STUBS IN SITEMAP: 0")

    if dangling:
        print(f"\n🔴 SITEMAP URLS WITH NO PAGE (404): {len(dangling)}")
        print("-" * 40)
        for p in dangling:
            print(f"  {p}")
    else:
        print(f"\n✅ SITEMAP URLS WITH NO PAGE: 0")

    total = len(missing) + len(stub_in_sitemap) + len(dangling)
    print(f"\n{'=' * 60}")
    if total == 0:
        print("🎉 SITEMAP CLEAN — 0 issues found!")
        sys.exit(0)
    print(f"⚠️  {total} sitemap issue(s) found")
    sys.exit(1)


if __name__ == "__main__":
    main()
