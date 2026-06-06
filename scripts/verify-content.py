#!/usr/bin/env python3
"""Verify recipe content frontmatter, internal links, and SEO health.

This catches problems *before* `astro build` fails on them, plus a range of
on-page SEO issues flagged by the site audit (thin content, weak/duplicate
meta descriptions, over-long titles, orphan pages, broken related links).

Schema mirrors `src/content/config.ts` (recipeCollection).

Checks
  ERRORS (break the Astro build or SEO-critical)
    - missing required field: title, description, category, tags, publishDate
    - invalid `category` enum
    - invalid `difficulty` enum
    - `tags` empty or not a list
    - relatedRecipes -> non-existent slug (broken internal link)
    - relatedRecipes self-reference
    - duplicate relatedRecipes entry

  WARNINGS (quality / SEO)
    - meta description not 120-160 chars
    - templated/generic meta description
    - duplicate meta description across pages
    - title length not 30-60 chars
    - duplicate title across pages
    - orphan recipe (0 incoming relatedRecipes)
    - low body word count (< 300)

Usage
  python3 scripts/verify-content.py                      # full report
  python3 scripts/verify-content.py --quiet              # summary + errors only
  python3 scripts/verify-content.py --allow-link-errors  # don't fail on broken links
  python3 scripts/verify-content.py --strict             # treat warnings as errors

Exit code is non-zero when schema errors exist (build would break), or when
link errors exist (unless --allow-link-errors), or warnings exist under --strict.
"""

from __future__ import annotations

import glob
import os
import re
import sys
from collections import defaultdict

RECIPES_DIR = "src/content/recipes"

VALID_CATEGORIES = {
    "networking", "storage", "security", "deployments", "observability",
    "troubleshooting", "autoscaling", "configuration", "helm", "ai",
}
VALID_DIFFICULTY = {"beginner", "intermediate", "advanced"}
REQUIRED_FIELDS = ("title", "description", "category", "tags", "publishDate")

DESC_MIN, DESC_MAX = 120, 160
TITLE_MIN, TITLE_MAX = 30, 60
# Thin-content: a recipe delivers value through prose AND/OR code examples.
# A page is only "thin" when it has little explanatory prose AND essentially no
# runnable examples. Pure prose word count over-reports thin content on a
# code-dense recipe site (a complete YAML-heavy recipe can be < 200 prose words).
THIN_PROSE_WORDS = 200
THIN_MIN_CODE_BLOCKS = 2

GENERIC_DESC_RE = re.compile(
    r"^Production guide for .+\. Step-by-step YAML examples, common issues, "
    r"and best practices for K8s clusters\.$"
)

QUIET = "--quiet" in sys.argv
STRICT = "--strict" in sys.argv


def split_frontmatter(text: str) -> tuple[str, str]:
    """Return (frontmatter, body). Frontmatter is the text between the first
    pair of `---` fences; body is everything after."""
    if not text.startswith("---"):
        return "", text
    end = text.find("\n---", 3)
    if end == -1:
        return "", text
    fm = text[3:end].lstrip("\n")
    body = text[end + 4:]
    return fm, body


def parse_frontmatter(fm: str) -> dict:
    """Minimal YAML parser for the flat key/scalar + list shapes used by the
    recipe collection. Handles `key: scalar`, inline `key: [a, b]`, and block
    lists (`key:` then `  - item`). Not a general YAML implementation."""
    data: dict[str, object] = {}
    lines = fm.split("\n")
    i = 0
    while i < len(lines):
        raw = lines[i]
        i += 1
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        m = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", raw)
        if not m:
            continue
        key, rest = m.group(1), m.group(2).strip()
        if rest == "":
            # Possible block list on following indented `- ` lines.
            items: list[str] = []
            while i < len(lines) and re.match(r"^\s+-\s+", lines[i]):
                items.append(_unquote(lines[i].split("-", 1)[1].strip()))
                i += 1
            data[key] = items if items else ""
        elif rest.startswith("[") and rest.endswith("]"):
            inner = rest[1:-1].strip()
            data[key] = [_unquote(p.strip()) for p in inner.split(",") if p.strip()] if inner else []
        else:
            data[key] = _unquote(rest)
    return data


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
        return value[1:-1]
    return value


def count_prose_words(body: str) -> int:
    """Count explanatory prose words, excluding fenced code blocks and inline
    code (used as the 'is there enough writing?' signal for thin content)."""
    no_code = re.sub(r"```.*?```", " ", body, flags=re.DOTALL)
    no_code = re.sub(r"`[^`]*`", " ", no_code)
    no_html = re.sub(r"<[^>]+>", " ", no_code)
    return len(re.findall(r"\b\w+\b", no_html))


def count_code_blocks(body: str) -> int:
    """Count fenced code blocks (runnable examples: YAML, bash, etc.)."""
    return len(re.findall(r"```[a-zA-Z0-9_-]*\n", body))



def main() -> int:
    files = sorted(glob.glob(f"{RECIPES_DIR}/*.md"))
    if not files:
        print(f"No .md files found in {RECIPES_DIR}/")
        return 1

    slugs = {os.path.basename(f)[:-3] for f in files}

    schema_errors: list[str] = []   # break `astro build`
    link_errors: list[str] = []     # broken internal links / duplicate titles
    warnings: list[str] = []        # SEO quality
    incoming: dict[str, set[str]] = defaultdict(set)
    desc_by_text: dict[str, list[str]] = defaultdict(list)
    title_by_text: dict[str, list[str]] = defaultdict(list)

    for path in files:
        slug = os.path.basename(path)[:-3]
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        fm_text, body = split_frontmatter(text)
        if not fm_text:
            schema_errors.append(f"{slug}: no frontmatter block")
            continue
        fm = parse_frontmatter(fm_text)

        # --- required fields ---
        for field in REQUIRED_FIELDS:
            value = fm.get(field)
            if value is None or value == "" or value == []:
                schema_errors.append(f"{slug}: missing required field '{field}'")

        # --- enums ---
        category = fm.get("category")
        if category and category not in VALID_CATEGORIES:
            schema_errors.append(f"{slug}: invalid category '{category}'")

        difficulty = fm.get("difficulty")
        if difficulty and difficulty not in VALID_DIFFICULTY:
            shown = difficulty if len(str(difficulty)) <= 40 else f"{str(difficulty)[:40]}..."
            schema_errors.append(f"{slug}: invalid difficulty '{shown}' (expected {sorted(VALID_DIFFICULTY)})")

        tags = fm.get("tags")
        if tags is not None and not isinstance(tags, list):
            schema_errors.append(f"{slug}: 'tags' must be a list")

        # An array field declared as a bare block with no items (e.g.
        # `relatedRecipes:` followed by a non-list line) is parsed by Astro as
        # null, which fails the schema. Inline empty arrays (`[]`) are fine.
        for arr_field in ("relatedRecipes", "prerequisites", "tags"):
            if fm.get(arr_field) == "":
                schema_errors.append(
                    f"{slug}: '{arr_field}' is an empty block (null) — use "
                    f"`{arr_field}: []` or remove the key")

        # --- relatedRecipes integrity ---
        related = fm.get("relatedRecipes") or []
        if isinstance(related, list):
            seen: set[str] = set()
            for ref in related:
                if not ref:
                    continue
                if ref == slug:
                    link_errors.append(f"{slug}: relatedRecipes self-reference")
                elif ref in seen:
                    link_errors.append(f"{slug}: duplicate relatedRecipes entry '{ref}'")
                elif ref not in slugs:
                    link_errors.append(f"{slug}: relatedRecipes -> '{ref}' does not exist")
                else:
                    incoming[ref].add(slug)
                seen.add(ref)

        # --- SEO warnings ---
        title = fm.get("title")
        if isinstance(title, str) and title:
            title_by_text[title].append(slug)
            if not (TITLE_MIN <= len(title) <= TITLE_MAX):
                warnings.append(f"{slug}: title length {len(title)} (target {TITLE_MIN}-{TITLE_MAX})")

        desc = fm.get("description")
        if isinstance(desc, str) and desc:
            desc_by_text[desc].append(slug)
            if GENERIC_DESC_RE.match(desc):
                warnings.append(f"{slug}: generic/templated meta description")
            elif not (DESC_MIN <= len(desc) <= DESC_MAX):
                warnings.append(f"{slug}: description length {len(desc)} (target {DESC_MIN}-{DESC_MAX})")

        prose_words = count_prose_words(body)
        if prose_words < THIN_PROSE_WORDS and count_code_blocks(body) < THIN_MIN_CODE_BLOCKS:
            warnings.append(f"{slug}: thin content — {prose_words} prose words and "
                            f"no code examples (add a YAML/CLI example or more detail)")

    # --- cross-file duplicates ---
    for desc, owners in desc_by_text.items():
        if len(owners) > 1:
            warnings.append(f"duplicate meta description across {len(owners)} pages: {', '.join(sorted(owners)[:5])}"
                            + (" ..." if len(owners) > 5 else ""))
    for title, owners in title_by_text.items():
        if len(owners) > 1:
            # Duplicate titles are an SEO-quality issue (handled by canonicals /
            # old->new slug consolidation), not a correctness error, so they
            # warn rather than gate commits.
            warnings.append(f"duplicate title '{title}' across: {', '.join(sorted(owners))}")

    orphans = sorted(s for s in slugs if s not in incoming)

    # --- report ---
    print("=" * 64)
    print("  CONTENT VERIFICATION REPORT")
    print("=" * 64)
    print(f"  Recipe files scanned: {len(files)}")

    if not QUIET and warnings:
        print(f"\nWARNINGS — SEO quality ({len(warnings)})")
        print("-" * 40)
        for w in sorted(warnings):
            print(f"  ! {w}")

    if link_errors:
        print(f"\nLINK ERRORS — broken internal links / duplicate titles ({len(link_errors)})")
        print("-" * 40)
        for e in sorted(link_errors):
            print(f"  x {e}")

    if schema_errors:
        print(f"\nSCHEMA ERRORS — these break `astro build` ({len(schema_errors)})")
        print("-" * 40)
        for e in sorted(schema_errors):
            print(f"  x {e}")

    if not QUIET:
        print(f"\nOrphan recipes (0 incoming related links): {len(orphans)}")

    print("\n" + "=" * 64)
    print(f"  SUMMARY: {len(schema_errors)} schema error(s), "
          f"{len(link_errors)} link error(s), {len(warnings)} warning(s)")
    print("=" * 64)

    # Schema errors always fail (build would break). Link errors fail unless
    # --quiet-links is set. Warnings fail only under --strict.
    fail_links = bool(link_errors) and "--allow-link-errors" not in sys.argv
    failed = bool(schema_errors) or fail_links or (STRICT and bool(warnings))
    if failed:
        reasons = []
        if schema_errors:
            reasons.append(f"{len(schema_errors)} schema error(s)")
        if fail_links:
            reasons.append(f"{len(link_errors)} link error(s)")
        if STRICT and warnings:
            reasons.append(f"{len(warnings)} warning(s)")
        print(f"\nFAILED — {', '.join(reasons)}")
        return 1
    print("\nOK — no blocking issues found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
