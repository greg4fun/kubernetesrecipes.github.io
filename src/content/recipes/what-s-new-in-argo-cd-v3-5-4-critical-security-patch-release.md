---
title: "What's New in Argo CD v3.5.4: Critical Security Patch Release"
description: "Argo CD v3.5.4 fixes multiple critical CVEs in repo-server (Kustomize, Jsonnet, OCI) plus upgrade steps and verification."
publishDate: "2026-10-12"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "argocd"
  - "gitops"
  - "security"
  - "cve"
  - "upgrade"
  - "repo-server"
  - "patch-release"
---
> 💡 **Quick Answer:** Argo CD v3.5.4 is a critical security patch release fixing four CRITICAL and two HIGH severity vulnerabilities in the repo-server (Kustomize remote refs, Kustomize Helm config home, Jsonnet imports, and AppProject hook bypass), plus a login rate-limit bypass and SSH proxy command injection. Upgrade immediately via `kubectl apply --server-side` or Helm.

## The Problem

Argo CD v3.5.4 addresses a cluster of security advisories affecting any instance that evaluates untrusted or semi-trusted Git/Helm/OCI sources through the repo-server. Several of these are remote-code-execution or arbitrary file-read issues reachable by anyone who can push an Application manifest, Kustomize overlay, or Jsonnet file into a tracked repo — a realistic threat model for multi-tenant GitOps setups.

## The Solution

Upgrade to v3.5.4. There are no new user-facing features beyond a login-attempt logging improvement; this release exists almost entirely to ship the coordinated security fix (#30038) and a handful of cherry-picked bug fixes from the 3.5 branch.

## What's New

### Security fixes (upgrade priority: immediate)

- **CRITICAL** — Kustomize remote ref can run commands in the repo-server ([GHSA-9v9p-x54c-58gc](https://github.com/argoproj/argo-cd/security/advisories/GHSA-9v9p-x54c-58gc))
- **CRITICAL** — Kustomize Helm `configHome` can run commands in the repo-server ([GHSA-fw5c-w8rc-j7fx](https://github.com/argoproj/argo-cd/security/advisories/GHSA-fw5c-w8rc-j7fx))
- **CRITICAL** — Jsonnet import can read files from the repo-server ([GHSA-m3vr-7329-44ww](https://github.com/argoproj/argo-cd/security/advisories/GHSA-m3vr-7329-44ww))
- **CRITICAL** — AppProject restrictions bypassed via PreDelete/PostDelete resource hooks ([GHSA-fmxq-cgp8-87wp](https://github.com/argoproj/argo-cd/security/advisories/GHSA-fmxq-cgp8-87wp), CVE-2026-77459)
- **HIGH** — Login failure rate limit bypassable via concurrent requests ([GHSA-4439-h7jw-5cjj](https://github.com/argoproj/argo-cd/security/advisories/GHSA-4439-h7jw-5cjj), CVE-2025-61560)
- **HIGH** — Command injection via repository proxy URL on SSH Git repos ([GHSA-j6cw-g6p4-7hch](https://github.com/argoproj/argo-cd/security/advisories/GHSA-j6cw-g6p4-7hch), CVE-2026-55797)
- **MODERATE** — Extension proxy RBAC ignores application namespace when `applications-in-any-namespace` is enabled ([GHSA-g3ff-q88g-chrj](https://github.com/argoproj/argo-cd/security/advisories/GHSA-g3ff-q88g-chrj))
- **MODERATE** — Oversized OCI manifest can exhaust repo-server memory ([GHSA-w996-f2wq-x9c6](https://github.com/argoproj/argo-cd/security/advisories/GHSA-w996-f2wq-x9c6))

### Breaking changes

- Kustomize builds that render Helm charts **no longer honor `helmGlobals.configHome`**. Ordinary `http`, `https`, and `oci` chart repos still work, but builds relying on a Helm plugin registered from that directory will break.
- OCI manifests **larger than 4 MiB are now rejected** outright.

### Other notable changes

- feat(server): username is now logged on login attempts (#29861) — useful for audit trails.
- fix(cmp): clean up tgz stream temp directories, preventing disk-space leaks (#29148/#29773).
- fix(ui): manifest viewer jumpiness resolved (#29691/#29725).
- fix(repo-server): health check timeout no longer causes CrashLoopBackOff (#29901).

No feature/deprecation changelog beyond the above was published for 3.5.4 — check the [release page](https://github.com/argoproj/argo-cd/releases/tag/v3.5.4) and the [v3.0 release blog post](https://blog.argoproj.io/argo-cd-v3-0-release-candidate-a0b933f4e58f) for broader architectural context if you're coming from a pre-3.x install.

## Upgrade Steps

### Option 1: kubectl (non-HA)

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.4/manifests/install.yaml
```

### Option 2: kubectl (HA)

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.4/manifests/ha/install.yaml
```

### Option 3: Helm

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
helm upgrade --install argocd argo/argo-cd \
  --namespace argocd --create-namespace \
  --set global.image.tag=v3.5.4
```

If you are jumping across minor versions, read the [upgrade overview](https://argo-cd.readthedocs.io/en/stable/operator-manual/upgrading/overview/) first.

### Verify container image signatures (optional but recommended for this security release)

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/argoproj/argo-cd/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  quay.io/argoproj/argocd:v3.5.4
```

## Verify

```bash
# Confirm rollout and version
kubectl -n argocd rollout status deploy/argocd-server
kubectl -n argocd exec deploy/argocd-server -- argocd version --short

# Confirm repo-server picked up the new image
kubectl -n argocd get pods -l app.kubernetes.io/name=argocd-repo-server \
  -o jsonpath='{.items[*].spec.containers[*].image}'

# Spot-check that AppProject hook restrictions are enforced (no PreDelete/PostDelete bypass)
kubectl -n argocd logs deploy/argocd-server --since=10m | grep -i 'login attempt'
```

## Common Issues

- **Kustomize+Helm build fails after upgrade**: if a build previously relied on `helmGlobals.configHome` pointing at a custom Helm plugin directory, it will now fail. Migrate to a standard `http`/`https`/`oci` chart repo reference instead.
- **OCI image/manifest sync errors**: Applications pulling OCI artifacts larger than 4 MiB will start failing sync with a size-limit error — this is the new hard cap from GHSA-w996-f2wq-x9c6, not a bug.
- **CrashLoopBackOff on repo-server before this release**: fixed by #29901; if you still see it after upgrading, check for unrelated resource limits.

## Best Practices

- Treat this as a mandatory, not optional, upgrade — four CRITICAL advisories affect the repo-server's handling of untrusted repo content.
- After upgrading, review AppProject configs that use PreDelete/PostDelete resource hooks to confirm they are now correctly scoped.
- Enable and monitor the new login-attempt username logging for brute-force/credential-stuffing detection.
- Verify image provenance/signatures with cosign for any security-driven patch release before rolling to production.
- Pin the exact patch tag (`v3.5.4`) in GitOps manifests/Helm values rather than tracking a floating minor tag, so security patches are applied deliberately.
