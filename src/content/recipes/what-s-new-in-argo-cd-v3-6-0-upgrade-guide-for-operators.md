---
title: "What's New in Argo CD v3.6.0: Upgrade Guide for Operators"
description: "Argo CD v3.6.0 adds AppSet progressive sync metrics, Dex TLS hardening, new health checks, and more. Upgrade steps included."
publishDate: "2026-11-04"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "argocd"
  - "gitops"
  - "continuous-delivery"
  - "applicationset"
  - "dex"
  - "health-checks"
  - "upgrade"
---
> 💡 **Quick Answer:** Argo CD v3.6.0 adds ApplicationSet progressive-sync metrics and reconciliation controls, Dex TLS hardening (cipher suites, curve preferences, min version), a wave of new resource health checks (CNPG, cert-manager, Velero, Tekton, Prometheus Operator, Kyverno, AWS ACK, Kro, and more), and an alpha hydrator commit-signing feature. Upgrade with the standard server-side `kubectl apply` against the v3.6.0 manifests after reviewing the official upgrade docs.

## The Problem

Operators running Argo CD v3.5.x need to know whether v3.6.0 introduces breaking changes, new CRD health checks they can rely on instead of custom Lua scripts, and new config knobs (Dex TLS, ApplicationSet rate limits) worth adopting — without digging through 30+ changelog entries.

## The Solution

Review the curated feature list below, apply the official v3.6.0 manifests with `--server-side --force-conflicts` (required for Argo CD's large CRDs), and verify the control plane components roll out cleanly before adopting any new optional config.

## What's New

**ApplicationSet (progressive sync):**
- Progressive sync metrics for AppSet (#29202)
- Annotation to force reconciliation before proceeding with progressive sync (#27467)
- Metrics for app refresh count triggered by AppSet during progressive sync (#29244)
- Progressive sync scenario surfaced as condition reasons/messages (#27820)
- Workqueue rate limiter flags exposed on `applicationset-controller` (#28286)

**Dex / SSO:**
- Configurable Dex TLS cipher suites and curve preferences (#29658/#30217)
- Configurable TLS min version for Dex web (#28712)
- Dex storage type and config configurable from `argocd-cm` (#28624)

**New built-in health checks** (reduces need for custom `resource.customizations` Lua scripts): CloudNativePG Backup/Database (#28468, #29511) with hibernate/rehydrate actions (#28478), Kyverno (#27354), AWS ACK resources (#29016), Kro (#28743), Velero Backup/Restore/Schedule (#28464), Tekton PipelineRun/TaskRun (#28467), Prometheus Operator Alertmanager/ThanosRuler (#28446, #28463), cert-manager CertificateRequest/ACME Order/Challenge/trust-manager Bundle (#28465, #28466, #28615), TLSRoute and Gateway API ListenerSet (#26596, #28388), Flink SessionJob (#26626), Medusa Backup/Task (#28008, #28006), and support for custom deletion messages (#27596).

**Controller / impersonation / observability:**
- Metrics label/condition flags configurable via `argocd-cmd-params-cm` (#28287)
- Option to disable strict impersonation enforcement (#27573)
- OTel spans with configurable sampling (#28396)
- Hydrator: metrics added to app info (#29514), alpha support for **signing hydrated commits** (#28271)

**CLI:**
- `argocd admin export` gains a flag to exclude the status field, producing smaller/cleaner exports (#29219)

The release notes for v3.6.0 do not call out explicit breaking changes or removed flags; if migrating across a minor version, still read the official [upgrading overview](https://argo-cd.readthedocs.io/en/stable/operator-manual/upgrading/overview/) before rolling out to production. All images and CLI binaries are cosign-signed with SLSA Level 3 provenance — verify per the [signed release assets doc](https://argo-cd.readthedocs.io/en/stable/operator-manual/signed-release-assets) if your org enforces supply-chain checks.

## Upgrade Steps

Back up current manifests/config before upgrading:

```bash
kubectl get configmap argocd-cm argocd-rbac-cm argocd-cmd-params-cm -n argocd -o yaml > argocd-config-backup.yaml
```

**Non-HA install:**

```bash
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.6.0/manifests/install.yaml
```

**HA install:**

```bash
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.6.0/manifests/ha/install.yaml
```

**Helm users:** check the `argo/argo-cd` chart's `Chart.yaml` `appVersion` for the chart release that bundles v3.6.0 (the chart version number differs from the app version), then run:

```bash
helm repo update argo
helm upgrade argocd argo/argo-cd -n argocd --reuse-values
```

Watch the rollout of each component (controller, repo-server, server, applicationset-controller, dex if enabled):

```bash
kubectl rollout status deployment/argocd-server -n argocd
kubectl rollout status deployment/argocd-repo-server -n argocd
kubectl rollout status deployment/argocd-applicationset-controller -n argocd
kubectl rollout status statefulset/argocd-application-controller -n argocd
```

## Verify

```bash
kubectl get pods -n argocd
kubectl -n argocd get deployment argocd-server -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
argocd version --client
```

Confirm the server image tag reports `v3.6.0`, all pods are `Running`/`Ready`, and existing Applications still show `Synced`/`Healthy`:

```bash
kubectl get applications -n argocd -o wide
```

If adopting new health checks, spot-check one resource of each new type (e.g., a Velero `Backup`) to confirm Argo CD now reports a native health status instead of `Unknown`.

## Common Issues

- **CRD apply conflicts without `--server-side --force-conflicts`**: Argo CD's `applications.argoproj.io` and `applicationsets.argoproj.io` CRDs are large; client-side apply or plain server-side apply without `--force-conflicts` can fail with field-manager conflicts.
- **Custom health checks overriding new built-ins**: if you previously added Lua `resource.customizations.health` entries for CRDs now covered natively (e.g., Velero, cert-manager, Tekton), remove the redundant overrides in `argocd-cm` to avoid shadowing the improved built-in checks.
- **Dex restart required**: Dex TLS cipher suite/min-version/storage changes in `argocd-cm` only take effect after the `dex-server` pod restarts; bounce it manually if it doesn't pick up config changes automatically.
- **AppSet progressive sync annotation misuse**: the new force-reconciliation annotation (#27467) only affects Applications managed by an ApplicationSet using progressive sync strategy — it has no effect on standalone Applications.

## Best Practices

- Always diff `argocd-cm`, `argocd-rbac-cm`, and `argocd-cmd-params-cm` against your backup after applying the new manifests to catch unintended resets.
- Enable `argocd admin export --exclude-status` (#29219) for lighter, diff-friendly backups going forward.
- If running multi-tenant impersonation, review whether disabling strict enforcement (#27573) is appropriate for your security posture before flipping it.
- Treat the alpha hydrator commit-signing feature (#28271) as experimental; pilot it in a non-production Argo CD instance first.
- Pin to the exact v3.6.0 manifest URL (not `stable`) in GitOps-managed bootstrap repos so re-applies are reproducible.
