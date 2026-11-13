---
title: "What's New in Helm v4.3.2: Patch Release Upgrade Guide"
description: "Helm v4.3.2 patch notes: OCI registry transport fix (#32684), CLI help text fix (#32807), dependency bumps, and upgrade steps."
publishDate: "2026-11-13"
author: "Luca Berton"
category: "helm"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "helm"
  - "package-manager"
  - "oci-registry"
  - "patch-release"
  - "upgrade"
  - "cli"
---
> 💡 **Quick Answer:** Helm v4.3.2 is a small patch release that fixes a bug where custom OCI registry transports weren't being honored, corrects CLI help text for `list --max`/`HELM_COLOR`, and bumps several dependencies (golang.org/x/net, klauspost/compress, distribution/distribution/v3, k8s.io group). No breaking changes — upgrade is low-risk and recommended for anyone using custom OCI registry configurations.

## The Problem

In Helm v4.3.1 (and earlier v4.x), the OCI registry client could fail to return a properly configured transport, which affected users relying on custom transport settings (e.g., custom TLS config, proxies, or auth wrappers) when pulling/pushing charts to/from OCI registries. There was also a minor documentation bug where `helm list --max` and the `HELM_COLOR` env var help text was incorrect, which could confuse scripting/automation around chart listing and colored output.

## The Solution

Upgrade to v4.3.2, which contains two notable fixes plus routine dependency hardening. The release notes for this version are intentionally thin — it's a patch release with no feature work, so this recipe sticks strictly to what's documented rather than padding it out. For full details see the [release page](https://github.com/helm/helm/releases/tag/v4.3.2).

## What's New

- **fix(registry): always return a transport Helm can configure** (#32684, @ump45nose) — fixes OCI registry client transport handling so custom transport configuration is actually applied.
- **docs(cmd): correct `list --max` and `HELM_COLOR` help text** (#32807, @ZainnQureshii) — CLI help text accuracy fix, no behavior change.
- Dependency bumps: `golang.org/x/net` → v0.62.0 (#32876), `klauspost/compress` → v1.20.3 (#32878), `distribution/distribution/v3` (#32698), and a k8s.io group bump across 7 modules — these are security/stability maintenance bumps, not user-facing features.
- No deprecations, no CLI flag removals, no breaking changes in this release.
- Helm project roadmap note: the next minor (4.4.0) is scheduled for January 13, 2027; there will be no further Helm 3 minor releases (Helm 3 is approaching [end of life](https://helm.sh/blog/helm-v3-end-of-life)) — plan Helm 3 → 4 migrations accordingly.

## Upgrade Steps

### Linux/macOS via install script

```bash
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4
chmod 700 get_helm.sh
./get_helm.sh
```

### Manual binary download (Linux amd64 example)

```bash
curl -LO https://get.helm.sh/helm-v4.3.2-linux-amd64.tar.gz
curl -LO https://get.helm.sh/helm-v4.3.2-linux-amd64.tar.gz.sha256sum
sha256sum -c helm-v4.3.2-linux-amd64.tar.gz.sha256sum

tar -zxvf helm-v4.3.2-linux-amd64.tar.gz
sudo mv linux-amd64/helm /usr/local/bin/helm
```

### macOS via Homebrew

```bash
brew upgrade helm
```

### Optional: verify GPG signature

This release is signed with key `208D D36E D5BB 3745 A167 43A4 C7C6 FBB5 B91C 1155` (keybase: r6by):

```bash
gpg --keyserver keyserver.ubuntu.com --recv-keys 208DD36ED5BB3745A16743A4C7C6FBB5B91C1155
gpg --verify helm-v4.3.2-linux-amd64.tar.gz.asc helm-v4.3.2-linux-amd64.tar.gz
```

This is a client-side binary — no Kubernetes CRDs, Helm server component, or cluster-side manifests to apply/upgrade.

## Verify

```bash
helm version --short
# expected: v4.3.2+...

helm env

# sanity check an OCI pull still works if you use OCI registries
helm pull oci://<your-registry>/<chart> --version <x.y.z>
```

## Common Issues

- **Custom OCI transport silently ignored pre-4.3.2**: if you configure custom transports (proxies, custom TLS, auth middleware) for OCI registry access, upgrade to pick up #32684 — earlier v4.3.x builds could use a default transport instead of your configured one.
- **Scripts parsing `helm list --max` or `HELM_COLOR` docs**: only the help text changed, not the flag/env var behavior itself; no script changes are required.
- **Mixed client versions in CI**: pin the exact version (`v4.3.2`) in CI images/Dockerfiles rather than tracking `latest`, since Helm 4 is still receiving frequent patch releases on a roughly monthly cadence.

## Best Practices

- Always verify the SHA256 checksum (and GPG signature where possible) before deploying a new Helm binary into CI/CD pipelines.
- Track the Helm release page for patch cadence — this project ships monthly-ish patches; subscribe to releases rather than polling manually.
- If still on Helm 3, start planning migration to Helm 4 now given the stated Helm 3 end-of-life and the 4.4.0 minor release landing January 2027.
- Keep Helm client versions consistent across developer laptops and CI runners to avoid OCI/registry behavior drift like the one fixed in #32684.
