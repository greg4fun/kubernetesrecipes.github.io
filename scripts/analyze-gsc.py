#!/usr/bin/env python3
"""Turn a Google Search Console export into a prioritized growth action list.

GSC → Performance → Search results → Export → unzip into reports/gsc/ (the
default file names are kept: Queries.csv, Pages.csv, Chart.csv, Countries.csv,
Devices.csv). Then:

    python3 scripts/analyze-gsc.py [path-to-gsc-dir]   # default: reports/gsc

It reports the levers that actually move traffic for this site:
  - headline metrics + trend (is the site climbing?)
  - CTR by position band (is CTR systemically low → young-domain/SERP issue?)
  - CTR by country (spot a single-market anomaly)
  - click-winning queries (what content type actually converts → do more of it)
  - ranking striking distance (pos 11-20, high impressions → push to page 1)
  - high-impression / low-CTR pages (title/description review candidates)

No third-party dependencies. Read-only.
"""

from __future__ import annotations

import csv
import os
import sys


def load(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    rows = list(csv.reader(open(path, encoding="utf-8")))
    if not rows:
        return []
    head, data = rows[0], rows[1:]
    out = []
    for row in data:
        d = dict(zip(head, row))
        for k in ("Clicks", "Impressions"):
            if k in d:
                d[k] = int(d[k] or 0)
        for k in ("CTR", "Position"):
            if k in d:
                d[k] = float((d[k] or "0").replace("%", ""))
        out.append(d)
    return out


def bar(pct: float, width: int = 24) -> str:
    n = int(round(pct / 100 * width))
    return "█" * n + "·" * (width - n)


def section(title: str) -> None:
    print(f"\n{title}\n" + "-" * len(title))


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "reports/gsc"
    Q = load(os.path.join(base, "Queries.csv"))
    P = load(os.path.join(base, "Pages.csv"))
    C = load(os.path.join(base, "Chart.csv"))
    G = load(os.path.join(base, "Countries.csv"))
    if not Q and not P:
        print(f"No GSC CSVs found in {base}/ (expected Queries.csv, Pages.csv, ...).")
        return 1

    print("=" * 64)
    print("  GSC GROWTH ANALYSIS")
    print("=" * 64)

    # --- headline + trend ---
    if C:
        key = next((k for k in C[0] if k.lower().startswith("date")), None)
        C.sort(key=lambda r: r.get(key, ""))
        clk = sum(r["Clicks"] for r in C)
        imp = sum(r["Impressions"] for r in C)
        ctr = clk / imp * 100 if imp else 0
        first, last = C[0], C[-1]
        section("Headline (period total)")
        print(f"  clicks={clk}  impressions={imp}  CTR={ctr:.2f}%")
        print(f"  position trend: {first.get(key)} pos {first['Position']:.1f}  ->  "
              f"{last.get(key)} pos {last['Position']:.1f}"
              f"  ({'improving' if last['Position'] < first['Position'] else 'worsening'})")

    # --- CTR by position band (systemic diagnostic) ---
    if P:
        section("CTR by position band  (expected: 1-3 ~20-40%, 4-6 ~6-12%, 7-10 ~2-4%)")
        bands = [("1-3", 1, 3), ("4-6", 4, 6), ("7-10", 7, 10), ("11-20", 11, 20), ("21+", 21, 999)]
        for label, lo, hi in bands:
            ps = [p for p in P if lo <= p["Position"] <= hi]
            if not ps:
                continue
            imp = sum(p["Impressions"] for p in ps)
            clk = sum(p["Clicks"] for p in ps)
            c = clk / imp * 100 if imp else 0
            print(f"  {label:6s} {len(ps):4d} pages  imp={imp:7d}  CTR={c:5.2f}%  {bar(min(c, 100))}")

    # --- CTR by country (anomaly spotter) ---
    if G:
        section("Top markets by impressions (watch for a low-CTR outlier)")
        for r in sorted(G, key=lambda x: -x["Impressions"])[:6]:
            name = next(iter(r.values()))
            print(f"  {name:18.18s} imp={r['Impressions']:7d}  clicks={r['Clicks']:4d}  CTR={r['CTR']:5.2f}%  pos={r['Position']:.1f}")

    # --- click-winning queries (content strategy signal) ---
    if Q:
        won = sorted((q for q in Q if q["Clicks"] >= 1), key=lambda x: -x["Clicks"])
        section(f"What actually converts: {len(won)} of {len(Q)} queries win a click")
        for q in won[:20]:
            name = next(iter(q.values()))
            print(f"  clk={q['Clicks']:3d} pos={q['Position']:4.1f} CTR={q['CTR']:5.1f}%  {name[:50]}")

    # --- ranking striking distance (push to page 1) ---
    if P:
        rk = [p for p in P if 11 <= p["Position"] <= 20 and p["Impressions"] >= 800]
        rk.sort(key=lambda x: -x["Impressions"])
        section(f"Ranking striking distance: {len(rk)} pages on page 2 with traffic (push to page 1)")
        for p in rk[:15]:
            url = next(iter(p.values())).replace("https://kubernetes.recipes", "")
            print(f"  imp={p['Impressions']:6d} pos={p['Position']:5.1f} clk={p['Clicks']:3d}  {url[:52]}")

    # --- high-impression / low-CTR pages (title review) ---
    if P:
        lc = [p for p in P if p["Impressions"] >= 2000 and p["Position"] <= 10 and p["CTR"] < 1.0]
        lc.sort(key=lambda x: -x["Impressions"])
        section(f"High-impression / low-CTR ({len(lc)} pages: page 1 but <1% CTR — review title/intent)")
        for p in lc[:15]:
            url = next(iter(p.values())).replace("https://kubernetes.recipes", "")
            print(f"  imp={p['Impressions']:6d} pos={p['Position']:5.1f} CTR={p['CTR']:4.2f}%  {url[:52]}")

    print("\n" + "=" * 64)
    print("  Levers: 1) more content like the click-winners (long-tail/error/niche),")
    print("          2) push striking-distance pages to page 1, 3) authority over time.")
    print("=" * 64)
    return 0


if __name__ == "__main__":
    sys.exit(main())
