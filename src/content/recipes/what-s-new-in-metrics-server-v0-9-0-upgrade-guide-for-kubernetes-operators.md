---
title: "What's New in Metrics Server v0.9.0: Upgrade Guide for Kubernetes Operators"
description: "Metrics Server v0.9.0 brings a readiness bug fix, quieter node-scrape logging, and CVE patches. Upgrade steps and verification included."
publishDate: "2026-10-28"
author: "Luca Berton"
category: "observability"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "metrics-server"
  - "hpa"
  - "kubectl-top"
  - "observability"
  - "security"
  - "upgrade"
---
> 💡 **Quick Answer:** Metrics Server v0.9.0 is a maintenance release that fixes a storage-readiness bug (readiness now requires both node *and* pod metrics), quiets log noise from not-ready nodes, and patches two Go CVEs — upgrade is a straight image bump with no config changes required.

## The Problem

Metrics Server feeds `kubectl top` and the Horizontal Pod Autoscaler (HPA) with resource usage data. Prior to v0.9.0, the component could report itself as "ready" even when only node metrics (and not pod metrics) had been successfully scraped, which could lead to premature HPA decisions or misleading readiness probes. It also logged scrape failures from nodes that weren't yet `Ready` at a noisy log level, cluttering logs during normal node bootstrap/drain cycles. The underlying Go toolchain also carried two known CVEs.

## The Solution

Upgrade to Metrics Server v0.9.0, which bumps Kubernetes dependencies to v1.36.2, patches the Go runtime to v1.26.4 (fixing CVE-2025-47907 and CVE-2025-47906), and tightens the readiness check so the component only reports ready once both pod and node metrics are available. No manifest or flag changes are required for most installs.

## Whats New

- **Bug fix — stricter readiness (PR #1818):** storage readiness now requires both node *and* pod metrics to have been successfully collected at least once, closing a gap where HPA could consume partial/stale data.
- **Quieter node scrape logging (PR #1783):** log level for scrape failures against not-yet-ready nodes is downgraded, reducing noise during node startup/termination.
- **Logging fix (PR #1782):** `--stderrthreshold` is now correctly honored when `--logtostderr` is enabled.
- **Security:** Go bumped to v1.26.4, addressing CVE-2025-47907 and CVE-2025-47906; `golang.org/x/crypto` bumped 0.39.0 → 0.45.0.
- **Dependencies:** Kubernetes client/apimachinery/apiserver libs bumped to v1.36.2; numerous test/tooling dependency bumps (ginkgo, gomega, prometheus client, grpc, pflag) — no operator-facing impact.
- **Docs:** new diagram explaining how Metrics Server handles `kubectl top pod` requests (PR #1654).
- No deprecations or breaking changes are called out in the release notes for v0.9.0.

## Upgrade Steps

Via the upstream manifest:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.9.0/components.yaml
```

Via Helm (bitnami/metrics-server or the official chart, pin the app version):

```bash
helm repo update
helm upgrade metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --set image.tag=v0.9.0
```

If you maintain a custom Deployment manifest, just bump the image tag:

```bash
kubectl set image deployment/metrics-server \
  metrics-server=registry.k8s.io/metrics-server/metrics-server:v0.9.0 \
  -n kube-system
```

## Verify

```bash
kubectl get deployment metrics-server -n kube-system -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl rollout status deployment/metrics-server -n kube-system

# Confirm the component reports Ready
kubectl get apiservice v1beta1.metrics.k8s.io -o jsonpath='{.status.conditions[0].status}'

# Confirm metrics are flowing for both nodes and pods
kubectl top nodes
kubectl top pods -A
```

All commands should return the new image tag, a `True` APIService condition, and non-empty CPU/memory rows for `kubectl top`.

## Common Issues

- **APIService stays unavailable after upgrade:** with the new stricter readiness check (PR #1818), the deployment won't report ready until it has successfully scraped at least one node *and* one pod. If a node is unreachable (kubelet cert issues, firewall), readiness will now correctly stay false instead of silently reporting ready — check `kubectl logs -n kube-system deploy/metrics-server` for scrape errors.
- **Fewer scrape-failure log lines than before:** this is expected (PR #1783); failures against not-ready nodes are now logged at a lower level. Increase `-v` verbosity if you need the old level of detail during debugging.
- **No functional change expected for `--kubelet-insecure-tls`, `--metric-resolution`, or other existing flags** — this release does not touch flag behavior.

## Best Practices

- Pin the image tag explicitly in GitOps manifests rather than tracking `latest`.
- After upgrading, watch HPA behavior for a few scrape cycles (`kubectl describe hpa <name>`) since the stricter readiness gate can briefly delay the first "ready" signal on a fresh install or large cluster.
- Keep Metrics Server's Kubernetes client libs reasonably close to your control plane version — v0.9.0 tracks Kubernetes v1.36.2 dependencies.
- Review the full release notes before upgrading in regulated environments, since this release also closes two Go CVEs (CVE-2025-47907, CVE-2025-47906): https://github.com/kubernetes-sigs/metrics-server/releases/tag/v0.9.0
