---
title: "What's New in Helm v4.3.1: Patch Release Upgrade Guide"
description: "Helm v4.3.1 patch release notes: CRD wait fix for hooks, linter bump, and safe upgrade steps for operators."
publishDate: "2026-10-15"
author: "Luca Berton"
category: "helm"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "helm"
  - "helm4"
  - "package-manager"
  - "patch-release"
  - "upgrade"
  - "cli"
---
> 💡 **Quick Answer:** Helm v4.3.1 is a small patch release fixing a CRD-establishment race in hook-only installs and bumping the linter toolchain; there are no breaking changes, so operators can upgrade the CLI directly with no cluster-side action required.

## The Problem

Helm v4.3.0 users running charts that rely on `HookOnlyStrategy` for CRD installation could hit race conditions where Helm proceeded before the CRD was actually established in the API server, causing intermittent install failures.

## The Solution

Helm v4.3.1 patches the `action` package to wait for CRD establishment under `HookOnlyStrategy`, and refreshes the internal linter toolchain (golangci-lint) used in CI. Both fixes are safe, backward-compatible changes to the Helm CLI binary — no server-side Helm component exists to upgrade (Helm is client-only since v3).

## Whats New

- **fix(action):** wait for CRD establishment under `HookOnlyStrategy` (#32672, @pujitha24) — eliminates intermittent "CRD not found" errors right after install/upgrade for charts that install CRDs via hooks.
- **fix(linters):** update golangci-lint to v2.14.0 (#32744, @ruslan-shaydullin) — internal tooling only, no runtime impact.
- Routine dependency bumps: `golang.org/x/net` to v0.61.0 (#32758), `sigs.k8s.io/controller-runtime` 0.25.1→0.25.2, `sigs.k8s.io/kustomize/kyaml` 0.21.1→0.21.2, and several OpenTelemetry exporter/SDK bumps (tracing/logging dependencies).
- No new flags, no deprecations, no breaking changes called out in this release.
- Roadmap note: next patches (4.3.2 / 3.22.2) are scheduled for Nov 11, 2026; 4.4.0 is scheduled for Jan 13, 2027. No further Helm 3 minor releases will ship — see the [Helm 3 EOL announcement](https://helm.sh/blog/helm-v3-end-of-life).

## Upgrade Steps

Helm has no cluster component to upgrade — only the CLI binary changes. Pick the path matching your install method.

**Script install (Linux/macOS):**
```bash
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4
chmod 700 get_helm.sh
./get_helm.sh
```

**Manual binary (Linux amd64 example):**
```bash
curl -LO https://get.helm.sh/helm-v4.3.1-linux-amd64.tar.gz
curl -LO https://get.helm.sh/helm-v4.3.1-linux-amd64.tar.gz.sha256sum
sha256sum -c helm-v4.3.1-linux-amd64.tar.gz.sha256sum
tar -zxvf helm-v4.3.1-linux-amd64.tar.gz
sudo mv linux-amd64/helm /usr/local/bin/helm
```

**Homebrew (macOS/Linux):**
```bash
brew upgrade helm
```

**asdf/mise version managers:**
```bash
asdf install helm 4.3.1
asdf global helm 4.3.1
```

No chart, release, or Kubernetes object changes are required — this is a client-tool patch only.

## Verify

```bash
helm version --short
# expected: v4.3.1+g<short-sha>

# sanity-check hook-only CRD installs if you use them
helm install demo ./your-chart --dry-run --debug | grep -i crd
```

## Common Issues

- **`helm version` still shows v4.3.0`** — the binary in `PATH` wasn't replaced; check `which helm` and confirm it points to the newly installed path, or that your package manager actually updated the symlink.
- **GPG signature verification fails** — this release is signed with key `208D D36E D5BB 3745 A167 43A4 C7C6 FBB5 B91C 1155` (keybase: `r6by`); import that key before verifying `.tar.gz.sha256sum` signatures.
- **CI pipelines pinned to v4.3.0** — update pinned version strings in Dockerfiles, asdf `.tool-versions`, or CI cache keys to avoid silently staying on the older patch.

## Best Practices

- Pin Helm CLI versions explicitly in CI (`asdf`, Dockerfile `ARG HELM_VERSION`) rather than tracking `latest`, so patch bumps like this one are deliberate.
- If any charts you maintain install CRDs via hooks, re-test `helm install`/`helm upgrade` after bumping to v4.3.1 to confirm the CRD-establishment race is resolved for your case.
- Watch the [Helm releases page](https://github.com/helm/helm/releases) for the scheduled Nov 11, 2026 patch and the Jan 13, 2027 v4.4.0 minor, and start migration planning away from Helm 3 given its announced end of life.
