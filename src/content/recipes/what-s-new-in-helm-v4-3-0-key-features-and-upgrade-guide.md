---
title: "What's New in Helm v4.3.0: Key Features and Upgrade Guide"
description: "Helm v4.3.0 adds duration functions, rollback descriptions, ownership checks, and faster status computation. Upgrade steps and verification included."
publishDate: "2026-10-11"
author: "Luca Berton"
category: "helm"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "helm"
  - "helm4"
  - "package-manager"
  - "release-notes"
  - "charts"
  - "upgrade"
---
> 💡 **Quick Answer:** Helm v4.3.0 is a feature release adding new template duration functions, a `--description` flag for `helm rollback`, resource ownership verification before `helm uninstall`, reproducible chart archives via `SOURCE_DATE_EPOCH`, and a performance fix that prevents multi-minute delays during status computation. Upgrade is a straightforward binary/plugin swap with no breaking API changes called out in the notes.

## The Problem

Operators running Helm 4.x want to know whether v4.3.0 changes CLI behavior, chart packaging reproducibility, or release safety before rolling it out to CI pipelines and workstations.

## The Solution

Treat v4.3.0 as a standard minor upgrade: download/replace the binary (or bump the Helm plugin/image in CI), re-run your existing chart test suite, and review the ownership-verification and rollback changes since they touch destructive operations (`uninstall`, `rollback`).

## What's New

**Features**
- Duration functions added to the template engine (`#31695`) — useful for computing TTLs/expiry values directly in chart templates.
- Debug logging when `lookup` returns empty (`#32205`) — helps diagnose "why is my lookup empty" issues during `helm template`/`helm install --dry-run`.
- Ownership verification before deleting resources during uninstall (`#31584`) — adds a safety check so Helm confirms it owns a resource before removing it.
- `SOURCE_DATE_EPOCH` honored for chart archives (`#32162`) — enables reproducible `.tgz` builds for supply-chain/SBOM pipelines.
- `helm rollback --description` flag (`#31580`) — attach a human-readable reason to a rollback, visible in release history.

**Fixes**
- Values files ending exactly at a 4096-byte boundary are no longer silently dropped by the loader (`#32525`) — a real correctness bug fix, check any values files near that size.
- Chart `StampModTimes` normalized to UTC/truncated for reproducible `Chart.lock` tests (`#32485`).
- Provenance verification now supports GnuPG keybox (`pubring.kbx`) keyrings, not just legacy `pubring.gpg` (`#32281`) — relevant if you verify chart signatures.
- Regression fix: registry messages in `template`/`show` now correctly route to stderr instead of stdout (`#32217`) — avoids polluting piped YAML output.
- Zero-width spaces removed from plugin name comments (`#32134`).

**Performance**
- Informer resync period lowered from 1 hour to 3 minutes (`#31944`) — faster detection of out-of-band cluster changes.
- Concurrent status computation enabled, preventing multi-minute delays on releases with many resources (`#32043`).

**Dependencies**
- `k8s.io/*` client libraries bumped to 0.37.0 (`#32598`).

No deprecations or breaking changes are called out in the release notes. Helm 3 has no further minor releases planned (see the [Helm v3 end-of-life post](https://helm.sh/blog/helm-v3-end-of-life)); plan migration to Helm 4 if still on v3.

## Upgrade Steps

**Linux/macOS via install script:**
```bash
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4
chmod +x get_helm.sh
./get_helm.sh --version v4.3.0
```

**Manual binary (Linux amd64 example):**
```bash
curl -LO https://get.helm.sh/helm-v4.3.0-linux-amd64.tar.gz
curl -LO https://get.helm.sh/helm-v4.3.0-linux-amd64.tar.gz.sha256sum
sha256sum -c helm-v4.3.0-linux-amd64.tar.gz.sha256sum
tar -zxvf helm-v4.3.0-linux-amd64.tar.gz
sudo mv linux-amd64/helm /usr/local/bin/helm
```

**macOS via Homebrew:**
```bash
brew upgrade helm
```

**Verify GPG signature (optional, recommended for CI):**
```bash
gpg --keyserver keyserver.ubuntu.com --recv-keys 208DD36ED5BB3745A16743A4C7C6FBB5B91C1155
gpg --verify helm-v4.3.0-linux-amd64.tar.gz.asc helm-v4.3.0-linux-amd64.tar.gz
```

This release does not require any CRD, repository config, or storage-backend migration — it's a client binary upgrade.

## Verify

```bash
helm version --short
# expect: v4.3.0

helm rollback myrelease 1 --description "rollback to test fix" --dry-run
helm uninstall myrelease --dry-run
```

Run your existing chart lint/template/test pipeline against v4.3.0 before promoting it past CI:
```bash
helm lint ./mychart
helm template ./mychart | kubectl apply --dry-run=client -f -
```

## Common Issues

- **Values files near 4096 bytes behaving oddly on older versions**: upgrade resolves the dropped-file bug (`#32525`); re-test any charts with large inline `values.yaml`.
- **Scripts parsing `helm template` stdout that previously included registry log lines**: those now correctly go to stderr — update scripts that relied on the old (buggy) stdout behavior.
- **Chart signature verification failing with keybox-based GPG setups**: resolved by `#32281`; ensure you're on v4.3.0+ if using `pubring.kbx`.

## Best Practices

- Pin the Helm version in CI images and bump deliberately rather than tracking `latest`.
- If you build charts for reproducible/SBOM pipelines, set `SOURCE_DATE_EPOCH` and verify archive checksums are now deterministic.
- Review any automation that calls `helm uninstall` programmatically — the new ownership verification may reject deletions for resources Helm doesn't recognize as owned; test in a non-prod namespace first.
- Track the [v4.3.0 release page](https://github.com/helm/helm/releases/tag/v4.3.0) for the full changelog and plan for the next patch (4.3.1, scheduled Oct 14, 2026) and minor (4.4.0, scheduled Jan 13, 2027).
