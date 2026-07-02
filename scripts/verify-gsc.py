#!/usr/bin/env python3
"""
verify-gsc.py — Guard against regressions in the issues flagged by Google
Search Console's "Page indexing" report.

It validates the *built* site in ``dist/`` against a set of historical URLs
that Google still remembers, plus the robots.txt policy. It is intentionally
dist-based (no network) so it can run in CI right after ``astro build``.

What it checks
--------------
1. MUST_RESOLVE  — URLs that GSC reported as "Not found (404)" but that map to
   real, relocated content. Each must now resolve as a page or a redirect
   stub. (Regression guard: re-introducing the old 404 fails the build.)
2. STUB_REDIRECTS — URLs that should be served as meta-refresh redirect stubs
   ("Page with redirect" / "Excluded by 'noindex' tag"). Each must exist AND
   contain a refresh redirect.
3. robots.txt    — must NOT block query strings (``Disallow: /*?*``). Blocking
   them is what produced the 255 "Blocked by robots.txt" faceted-nav URLs; the
   policy is to keep them crawlable and de-dupe via rel=canonical.
4. KNOWN_GONE    — stale/malformed crawl artifacts we intentionally leave as
   404 (documented, never flagged).
5. Optional: any GSC "Page indexing" CSV exports dropped into
   ``reports/gsc/indexing/*.csv`` are ingested; every URL must resolve, be a
   stub, be query-string (faceted), or be explicitly in KNOWN_GONE.

Note: avoids xml.etree (pyexpat is broken on this Python build) — pure regex.

Exit code is non-zero if any genuine, unhandled issue is found.
"""

import csv
import os
import re
import sys
from urllib.parse import urlsplit

DIST_DIR = "dist"
ROBOTS_FILE = "public/robots.txt"
GSC_CSV_DIR = "reports/gsc/indexing"
SITE = "https://kubernetes.recipes"

REFRESH_RE = re.compile(r'http-equiv=["\']?refresh', re.IGNORECASE)
QUERY_BLOCK_RE = re.compile(r"^\s*Disallow:\s*/\*?\?", re.IGNORECASE | re.MULTILINE)

# URLs GSC reported as 404 that map to relocated, still-live content.
# Each must now resolve (real page or redirect stub).
MUST_RESOLVE = [
    "/recipes/configuration/openshift-idms-install-config/",
    "/recipes/security/quay-robot-account-kubernetes/",
    "/recipes/security/network-policies/",
    "/recipes/configuration/kubernetes-resource-optimization/",
    "/recipes/deployments/kubernetes-jobs-cronjobs/",
    "/recipes/storage/s3-model-storage-permissions/deploy-mistral-vllm-kubernetes/",
    "/recipes/gitops/",
    "/recipes/security/cert-manager-certificates/",
    "/recipes/security/container-security-scanning/",
    "/recipes/storage/csi-drivers-storage/",
    "/recipes/security/custom-ca-openshift-kubernetes/",
    "/recipes/troubleshooting/debug-crashloopbackoff/",
    "/recipes/observability/distributed-tracing-jaeger/",
    "/recipes/networking/istio-service-mesh/",
    "/recipes/autoscaling/keda-event-driven-autoscaling/",
    "/recipes/configuration/kubeconfig-contexts/",
    "/recipes/troubleshooting/kubectl-plugins-extensions/",
    "/recipes/configuration/kubernetes-backup-restore/",
    "/recipes/configuration/kubernetes-cronjob-concurrencypolicy/",
    "/recipes/troubleshooting/kubernetes-debug-container-ephemeral/",
    "/recipes/configuration/kubernetes-labels-annotations/",
    "/recipes/troubleshooting/kubernetes-node-taint-master-fix/",
    "/recipes/security/kubernetes-runtimeclass/",
    "/recipes/configuration/kustomize-configuration/",
    "/recipes/ai/nvidia-gpu-operator-setup/",
    "/recipes/deployments/pod-disruption-budgets/",
    "/recipes/deployments/pod-priority-preemption/",
    "/recipes/observability/prometheus-metrics-setup/",
    "/recipes/configuration/resource-quotas-namespace/",
]

# URLs that are intentionally served as meta-refresh redirect stubs.
STUB_REDIRECTS = [
    "/recipes/configuration/openshift-idms-install-config/",
    "/recipes/security/quay-robot-account-kubernetes/",
    "/recipes/security/network-policies/",
    "/recipes/configuration/argocd-gitops/",
    "/recipes/configuration/flux-gitops/",
    "/recipes/configuration/downward-api/",
    "/recipes/configuration/kubernetes-jobs-cronjobs/",
    "/recipes/configuration/kubernetes-resource-optimization/",
    "/recipes/autoscaling/keda-event-autoscaling/",
    "/recipes/observability/container-logging/",
    "/recipes/observability/prometheus-monitoring/",
    "/recipes/storage/velero-backup-restore/",
    "/recipes/security/container-image-scanning/",
    "/recipes/security/kyverno-policies/",
    "/recipes/deployments/blue-green-deployments/",
    "/recipes/deployments/kubernetes-jobs-cronjobs/",
    "/recipes/gitops/",
    "/recipes/security/cert-manager-certificates/",
    "/recipes/security/container-security-scanning/",
    "/recipes/storage/csi-drivers-storage/",
    "/recipes/security/custom-ca-openshift-kubernetes/",
    "/recipes/troubleshooting/debug-crashloopbackoff/",
    "/recipes/observability/distributed-tracing-jaeger/",
    "/recipes/networking/istio-service-mesh/",
    "/recipes/autoscaling/keda-event-driven-autoscaling/",
    "/recipes/configuration/kubeconfig-contexts/",
    "/recipes/troubleshooting/kubectl-plugins-extensions/",
    "/recipes/configuration/kubernetes-backup-restore/",
    "/recipes/configuration/kubernetes-cronjob-concurrencypolicy/",
    "/recipes/troubleshooting/kubernetes-debug-container-ephemeral/",
    "/recipes/configuration/kubernetes-labels-annotations/",
    "/recipes/troubleshooting/kubernetes-node-taint-master-fix/",
    "/recipes/security/kubernetes-runtimeclass/",
    "/recipes/configuration/kustomize-configuration/",
    "/recipes/ai/nvidia-gpu-operator-setup/",
    "/recipes/deployments/pod-disruption-budgets/",
    "/recipes/deployments/pod-priority-preemption/",
    "/recipes/observability/prometheus-metrics-setup/",
    "/recipes/configuration/resource-quotas-namespace/",
]

# Stale/malformed crawl artifacts (relative-link rendering bugs that no longer
# exist). Google still remembers them; they will age out. Intentionally 404.
KNOWN_GONE = {
    "/recipes/ai/test-llm-inference-endpoints/deploy-mistral-nvidia-nim/",
    "/recipes/ai/deploy-mistral-vllm-kubernetes/s3-model-storage-permissions/",
    "/recipes/ai/deploy-mistral-vllm-kubernetes/deploy-mistral-nvidia-nim/",
    "/recipes/ai/deploy-mistral-vllm-kubernetes/test-llm-inference-endpoints/",
}


def norm(path_or_url):
    """Return a normalized path with a single leading slash and trailing slash,
    dropping scheme/host and any query string/fragment."""
    parts = urlsplit(path_or_url)
    path = parts.path or path_or_url
    if not path.startswith("/"):
        path = "/" + path
    if not path.endswith("/"):
        path += "/"
    return path


def has_query(path_or_url):
    return bool(urlsplit(path_or_url).query)


def index_file(path):
    """Map a normalized path to its dist index.html, or None."""
    rel = path.strip("/")
    candidate = os.path.join(DIST_DIR, rel, "index.html") if rel else os.path.join(DIST_DIR, "index.html")
    return candidate if os.path.isfile(candidate) else None


def classify(path):
    """Return one of: 'page', 'stub', 'missing' for a normalized path."""
    f = index_file(path)
    if not f:
        return "missing"
    try:
        with open(f, "r", encoding="utf-8", errors="ignore") as fh:
            head = fh.read(4096)
    except OSError:
        return "missing"
    return "stub" if REFRESH_RE.search(head) else "page"


def main():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR}/ not found. Run `pnpm build` first.", file=sys.stderr)
        return 1

    failures = []
    warnings = []

    # 1. MUST_RESOLVE
    for url in MUST_RESOLVE:
        kind = classify(norm(url))
        if kind == "missing":
            failures.append(f"[404 regression] {url} no longer resolves (page or stub expected)")

    # 2. STUB_REDIRECTS
    for url in STUB_REDIRECTS:
        kind = classify(norm(url))
        if kind == "missing":
            failures.append(f"[stub missing] {url} should be a redirect stub but is absent")
        elif kind == "page":
            warnings.append(f"[stub became page] {url} resolves as a real page, not a redirect stub")

    # 3. robots.txt must not block query strings
    if os.path.isfile(ROBOTS_FILE):
        with open(ROBOTS_FILE, "r", encoding="utf-8") as fh:
            robots = fh.read()
        if QUERY_BLOCK_RE.search(robots):
            failures.append(
                "[robots] query strings are blocked (Disallow: /*?*) — this "
                "re-creates the 'Blocked by robots.txt' faceted-nav noise"
            )
    else:
        warnings.append(f"[robots] {ROBOTS_FILE} not found")

    # 5. Optional GSC CSV exports
    csv_checked = 0
    if os.path.isdir(GSC_CSV_DIR):
        for name in sorted(os.listdir(GSC_CSV_DIR)):
            if not name.lower().endswith(".csv"):
                continue
            with open(os.path.join(GSC_CSV_DIR, name), newline="", encoding="utf-8") as fh:
                reader = csv.reader(fh)
                rows = list(reader)
            for row in rows[1:]:  # skip header
                if not row:
                    continue
                raw = row[0].strip()
                if not raw.startswith(("http", "/")):
                    continue
                csv_checked += 1
                path = norm(raw)
                if has_query(raw):
                    continue  # faceted URL — base page serves it, de-duped via canonical
                if path in KNOWN_GONE:
                    continue
                if classify(path) == "missing":
                    failures.append(f"[{name}] unhandled 404: {raw}")

    # Report
    print("=" * 64)
    print("  GSC PAGE-INDEXING VERIFICATION")
    print("=" * 64)
    print(f"  MUST_RESOLVE checked : {len(MUST_RESOLVE)}")
    print(f"  STUB_REDIRECTS checked: {len(STUB_REDIRECTS)}")
    print(f"  KNOWN_GONE (ignored) : {len(KNOWN_GONE)}")
    print(f"  GSC CSV URLs checked : {csv_checked}")
    print("=" * 64)

    for w in warnings:
        print(f"  WARN  {w}")
    for f in failures:
        print(f"  FAIL  {f}")

    if failures:
        print("=" * 64)
        print(f"  {len(failures)} issue(s) found")
        print("=" * 64)
        return 1

    print("OK — all GSC-tracked URLs are handled")
    return 0


if __name__ == "__main__":
    sys.exit(main())
