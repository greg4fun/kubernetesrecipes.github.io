#!/usr/bin/env python3
"""Generate public/llms.txt and public/llms-full.txt from recipe frontmatter.

These files expose the recipe catalog to AI search engines (ChatGPT, Perplexity,
Claude, etc.) per the llmstxt.org convention. They were previously hand-generated
once and went stale (1148/1373 recipes), making ~16% of the catalog invisible to
AI crawlers. Run this after adding/renaming recipes to keep them in sync.

Usage:
  python3 scripts/generate-llms.py            # write both files
  python3 scripts/generate-llms.py --check    # exit 1 if files are out of date
"""

from __future__ import annotations

import glob
import os
import re
import sys

RECIPES_DIR = "src/content/recipes"
SITE = "https://kubernetes.recipes"
LLMS = "public/llms.txt"
LLMS_FULL = "public/llms-full.txt"

CATEGORY_LABELS = {
    "ai": "AI & GPU",
    "autoscaling": "Autoscaling",
    "configuration": "Configuration",
    "deployments": "Deployments",
    "helm": "Helm",
    "networking": "Networking",
    "observability": "Observability",
    "security": "Security",
    "storage": "Storage",
    "troubleshooting": "Troubleshooting",
}
CATEGORY_ORDER = list(CATEGORY_LABELS.keys())


def parse_frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    fm = text[3:end]
    data = {}
    for key in ("title", "description", "category", "draft"):
        m = re.search(rf'^{key}:\s*"?(.*?)"?\s*$', fm, re.M)
        if m:
            data[key] = m.group(1).strip().strip('"').strip("'")
    return data


def load_recipes() -> list[dict]:
    recipes = []
    for path in sorted(glob.glob(f"{RECIPES_DIR}/*.md")):
        slug = os.path.basename(path)[:-3]
        fm = parse_frontmatter(open(path, encoding="utf-8").read())
        if not fm.get("title") or not fm.get("category"):
            continue
        if str(fm.get("draft", "")).lower() == "true":
            continue
        recipes.append({
            "slug": slug,
            "title": fm["title"],
            "description": fm.get("description", ""),
            "category": fm["category"],
            "url": f"{SITE}/recipes/{fm['category']}/{slug}/",
        })
    return recipes


def render_llms(recipes: list[dict]) -> str:
    lines = [
        "# kubernetes.recipes",
        "",
        f"> Kubernetes recipes and guides — {len(recipes)} articles covering "
        "deployments, networking, security, AI/GPU, troubleshooting, and more.",
        "",
        "## Recipes",
        "",
    ]
    for r in sorted(recipes, key=lambda x: x["slug"]):
        desc = f": {r['description']}" if r["description"] else ""
        lines.append(f"- [{r['title']}]({r['url']}){desc}")
    return "\n".join(lines) + "\n"


def render_llms_full(recipes: list[dict]) -> str:
    by_cat: dict[str, list[dict]] = {}
    for r in recipes:
        by_cat.setdefault(r["category"], []).append(r)

    lines = [
        "# kubernetes.recipes — Complete Recipe Index",
        "",
        f"> {len(recipes)} Kubernetes recipes and guides",
        "",
    ]
    # Known categories first (in canonical order), then any extras alphabetically.
    ordered = [c for c in CATEGORY_ORDER if c in by_cat]
    ordered += sorted(c for c in by_cat if c not in CATEGORY_ORDER)
    for cat in ordered:
        items = sorted(by_cat[cat], key=lambda x: x["slug"])
        label = CATEGORY_LABELS.get(cat, cat.capitalize())
        lines.append(f"## {label} ({len(items)} recipes)")
        lines.append("")
        for r in items:
            desc = f": {r['description']}" if r["description"] else ""
            lines.append(f"- [{r['title']}]({r['url']}){desc}")
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def main() -> int:
    recipes = load_recipes()
    if not recipes:
        print("No recipes found.")
        return 1

    outputs = {LLMS: render_llms(recipes), LLMS_FULL: render_llms_full(recipes)}

    if "--check" in sys.argv:
        stale = []
        for path, content in outputs.items():
            current = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
            if current != content:
                stale.append(path)
        if stale:
            print("OUT OF DATE — run scripts/generate-llms.py:")
            for p in stale:
                print(f"  {p}")
            return 1
        print(f"llms files up to date ({len(recipes)} recipes)")
        return 0

    for path, content in outputs.items():
        open(path, "w", encoding="utf-8").write(content)
    print(f"Wrote {LLMS} and {LLMS_FULL} with {len(recipes)} recipes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
