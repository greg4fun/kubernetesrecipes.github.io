#!/usr/bin/env python3
"""Verify all internal links in kubernetes.recipes articles.

Checks:
1. relatedRecipes — slugs that don't match any .md file
2. Orphan articles — files with 0 incoming relatedRecipes links
3. Duplicate relatedRecipes entries within the same file
4. Self-references in relatedRecipes
5. Body links — inline [text](/recipes/<category>/<slug>/) links that 404
   (e.g. a link using the wrong category for a recipe that has moved).

Usage:
  python3 scripts/verify-links.py
  python3 scripts/verify-links.py --fix   # Auto-remove broken relatedRecipes
"""

import os
import re
import sys
import glob
from collections import defaultdict

RECIPES_DIR = "src/content/recipes"
PAGES_DIR = "src/pages"
FIX_MODE = "--fix" in sys.argv

# Matches inline markdown links to internal /recipes/... paths, with or without
# the absolute https://kubernetes.recipes host prefix.
BODY_LINK_RE = re.compile(
    r'\]\((?:https?://kubernetes\.recipes)?(/recipes/[^)\s]+)\)'
)


def slug_category_map(files):
    """Map each recipe slug (filename) to its frontmatter category."""
    mapping = {}
    for f in files:
        slug = os.path.basename(f).replace(".md", "")
        with open(f, "r") as fh:
            content = fh.read()
        m = re.search(r'^category:\s*"?([a-z]+)"?', content, re.MULTILINE)
        if m:
            mapping[slug] = m.group(1)
    return mapping


def build_valid_paths(slug_to_cat):
    """Set of every trailing-slash path that resolves (won't 404).

    Sources: canonical recipe pages, category index pages, every static/
    redirect-stub .astro page under src/pages, and known top-level pages.
    """
    valid = set()
    for slug, cat in slug_to_cat.items():
        valid.add(f"/recipes/{cat}/{slug}/")
    for cat in set(slug_to_cat.values()):
        valid.add(f"/recipes/{cat}/")
    for f in glob.glob(f"{PAGES_DIR}/**/*.astro", recursive=True):
        rel = os.path.relpath(f, PAGES_DIR)
        if "[" in rel:  # dynamic route — can't resolve statically
            continue
        path = "/" + rel[: -len(".astro")]
        if path.endswith("/index"):
            path = path[: -len("index")]
        if not path.endswith("/"):
            path += "/"
        valid.add(path)
    valid.update({"/", "/recipes/"})
    return valid


def check_body_links(files, valid_paths):
    """Return [(slug, raw_link)] for inline /recipes/... links that 404."""
    broken = []
    for f in files:
        slug = os.path.basename(f).replace(".md", "")
        with open(f, "r") as fh:
            content = fh.read()
        for m in BODY_LINK_RE.finditer(content):
            raw = m.group(1)
            norm = raw.split("#")[0].split("?")[0]
            if not norm.endswith("/"):
                norm += "/"
            if norm not in valid_paths:
                broken.append((slug, raw))
    return broken

def main():
    files = sorted(glob.glob(f"{RECIPES_DIR}/*.md"))
    if not files:
        print(f"❌ No .md files found in {RECIPES_DIR}/")
        sys.exit(1)

    slugs = {os.path.basename(f).replace(".md", "") for f in files}
    print(f"📁 Found {len(slugs)} recipe files\n")

    # Body-link integrity (inline markdown links that would 404)
    slug_to_cat = slug_category_map(files)
    valid_paths = build_valid_paths(slug_to_cat)
    body_broken = check_body_links(files, valid_paths)

    broken_links = []       # (file, slug, bad_target)
    self_refs = []          # (file, slug)
    duplicates = []         # (file, slug, dup_target)
    incoming = defaultdict(set)  # slug → set of slugs linking to it
    total_links = 0
    files_with_issues = set()

    for f in files:
        slug = os.path.basename(f).replace(".md", "")
        with open(f, "r") as fh:
            content = fh.read()

        # Extract relatedRecipes block
        match = re.search(r'relatedRecipes:\n((?:  - .+\n)*)', content)
        if not match:
            continue

        refs = re.findall(r'  - "?([^"\n]+)"?', match.group(1))
        refs_clean = [r.strip().strip('"') for r in refs]
        total_links += len(refs_clean)

        seen = set()
        for ref in refs_clean:
            if not ref:
                continue

            # Broken link
            if ref not in slugs:
                broken_links.append((f, slug, ref))
                files_with_issues.add(slug)

            # Self-reference
            elif ref == slug:
                self_refs.append((f, slug))
                files_with_issues.add(slug)

            # Duplicate
            elif ref in seen:
                duplicates.append((f, slug, ref))
                files_with_issues.add(slug)

            else:
                incoming[ref].add(slug)

            seen.add(ref)

    # Orphans (no incoming links)
    orphans = sorted([s for s in slugs if s not in incoming])

    # === Report ===
    print("=" * 60)
    print("  LINK VERIFICATION REPORT")
    print("=" * 60)

    # Broken links
    if broken_links:
        print(f"\n🔴 BROKEN LINKS: {len(broken_links)}")
        print("-" * 40)
        for f, slug, target in sorted(broken_links, key=lambda x: x[1]):
            print(f"  {slug}")
            print(f"    → {target}  ❌ not found")
    else:
        print(f"\n✅ BROKEN LINKS: 0")

    # Self-references
    if self_refs:
        print(f"\n🟡 SELF-REFERENCES: {len(self_refs)}")
        print("-" * 40)
        for f, slug in sorted(self_refs):
            print(f"  {slug} → references itself")
    else:
        print(f"\n✅ SELF-REFERENCES: 0")

    # Duplicates
    if duplicates:
        print(f"\n🟡 DUPLICATE LINKS: {len(duplicates)}")
        print("-" * 40)
        for f, slug, target in sorted(duplicates, key=lambda x: x[1]):
            print(f"  {slug}")
            print(f"    → {target}  (duplicate)")
    else:
        print(f"\n✅ DUPLICATE LINKS: 0")

    # Orphans
    if orphans:
        print(f"\n🟠 ORPHAN ARTICLES (0 incoming links): {len(orphans)}")
        print("-" * 40)
        for slug in orphans:
            print(f"  {slug}")
    else:
        print(f"\n✅ ORPHAN ARTICLES: 0")

    # Broken body links (would return 404)
    if body_broken:
        print(f"\n🔴 BROKEN BODY LINKS (404): {len(body_broken)}")
        print("-" * 40)
        for slug, link in sorted(body_broken):
            print(f"  {slug}")
            print(f"    → {link}  ❌ 404")
    else:
        print(f"\n✅ BROKEN BODY LINKS: 0")

    # Summary
    print(f"\n{'=' * 60}")
    print(f"  SUMMARY")
    print(f"{'=' * 60}")
    print(f"  Total files:        {len(slugs)}")
    print(f"  Total links:        {total_links}")
    print(f"  Broken links:       {len(broken_links)}")
    print(f"  Self-references:    {len(self_refs)}")
    print(f"  Duplicate links:    {len(duplicates)}")
    print(f"  Orphan articles:    {len(orphans)}")
    print(f"  Broken body links:  {len(body_broken)}")
    print(f"  Files with issues:  {len(files_with_issues)}")

    total_issues = (len(broken_links) + len(self_refs) + len(duplicates)
                    + len(orphans) + len(body_broken))
    if total_issues == 0:
        print(f"\n🎉 ALL CLEAN — 0 issues found!")
    else:
        print(f"\n⚠️  {total_issues} total issues found")

    # === Fix mode ===
    if FIX_MODE and (broken_links or self_refs or duplicates):
        print(f"\n🔧 FIX MODE — removing broken links, self-refs, and duplicates...")
        fixed_count = 0

        for f in files:
            slug = os.path.basename(f).replace(".md", "")
            with open(f, "r") as fh:
                content = fh.read()
            original = content

            match = re.search(r'relatedRecipes:\n((?:  - .+\n)*)', content)
            if not match:
                continue

            refs = re.findall(r'  - "?([^"\n]+)"?', match.group(1))
            refs_clean = [r.strip().strip('"') for r in refs]

            seen = set()
            to_remove = []
            for ref in refs_clean:
                if not ref:
                    continue
                if ref not in slugs or ref == slug or ref in seen:
                    to_remove.append(ref)
                seen.add(ref)

            for ref in to_remove:
                content = content.replace(f'  - "{ref}"\n', '', 1)
                content = content.replace(f'  - {ref}\n', '', 1)
                fixed_count += 1

            if content != original:
                with open(f, "w") as fh:
                    fh.write(content)

        print(f"  Removed {fixed_count} entries from {len(files_with_issues)} files")
    elif FIX_MODE:
        print(f"\n✅ Nothing to fix")

    # Exit code — fail on anything that produces a 404
    if broken_links or body_broken:
        sys.exit(1)
    sys.exit(0)

if __name__ == "__main__":
    main()
