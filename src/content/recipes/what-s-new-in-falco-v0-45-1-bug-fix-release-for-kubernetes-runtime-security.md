---
title: "What's New in Falco v0.45.1: Bug Fix Release for Kubernetes Runtime Security"
description: "Falco 0.45.1 patches eBPF packaging, file_output keep_alive, and a metrics race condition. Upgrade steps and verification included."
publishDate: "2026-10-29"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "falco"
  - "runtime-security"
  - "ebpf"
  - "helm"
  - "observability"
  - "bugfix"
---
> 💡 **Quick Answer:** Falco 0.45.1 is a bug-fix-only release: it fixes packages half-installing on kernels without modern eBPF support, repairs `file_output` with `keep_alive: true` silently stopping after write failures, closes a metrics-scrape race that could crash the process, and bumps bundled libs/driver and the container plugin. No new features, no breaking changes.

## The Problem

Operators running Falco on mixed-kernel fleets have hit a few operational papercuts prior to this release:

- deb/rpm packages could end up **half-configured** on hosts whose kernel can't run modern eBPF (e.g. Ubuntu 20.04 / kernel 5.4), breaking automated fleet installs.
- `file_output` with `keep_alive: true` would **permanently stop writing** alerts after a single failed write (such as a full disk), with no automatic recovery.
- Scraping Prometheus metrics while Falco was actively processing events could trigger a **race condition and crash**.
- A reload could cause Falco to **exit unexpectedly** if files in watched config directories disappeared mid-setup.

## The Solution

Upgrade to Falco **0.45.1**, a patch release containing only bug fixes and dependency bumps — safe to roll out to existing 0.44/0.45 fleets with no config migration required.

## Whats New

All changes are bug fixes; there are no new features, deprecations, or breaking changes in this release.

- **Packaging**: deb/rpm no longer get stuck half-configured on kernels that can't run modern eBPF, e.g. Ubuntu 20.04 with kernel 5.4 ([#4037](https://github.com/falcosecurity/falco/pull/4037)).
- **file_output reliability**: with `keep_alive: true`, a failed write (e.g. full filesystem) is now logged and the file is reopened on the next alert instead of silently stopping forever ([#4036](https://github.com/falcosecurity/falco/pull/4036)).
- **Metrics stability**: fixed a race that could crash Falco when Prometheus metrics are scraped concurrently with event processing ([#4022](https://github.com/falcosecurity/falco/pull/4022)).
- **Reload robustness**: Falco no longer exits if files in watched directories disappear during reload setup ([#4018](https://github.com/falcosecurity/falco/pull/4018)).
- **Dependency bumps**: libs updated to `0.26.1`, driver to `11.0.1+driver` ([#4032](https://github.com/falcosecurity/falco/pull/4032)).
- **Container plugin**: bundled and Helm chart default container plugin updated to `0.7.5`, including a listener shutdown fix on reloads ([#4024](https://github.com/falcosecurity/falco/pull/4024), [#4027](https://github.com/falcosecurity/falco/pull/4027)).

## Upgrade Steps

### Helm (recommended for Kubernetes)

```bash
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm repo update

helm upgrade falco falcosecurity/falco \
  --namespace falco \
  --reuse-values \
  --set image.tag=0.45.1
```

If you also want the chart's bumped default container plugin pin, drop `--reuse-values` and re-supply your custom `values.yaml` instead so the new chart defaults apply.

### Raw manifests / DaemonSet image bump

```bash
kubectl -n falco set image daemonset/falco falco=docker.io/falcosecurity/falco:0.45.1
kubectl -n falco rollout status daemonset/falco
```

### Driver note

If you use the kernel module or eBPF probe (not `modern_ebpf` built-in), refresh drivers via the driver-loader image to match `11.0.1+driver`:

```bash
docker pull docker.io/falcosecurity/falco-driver-loader:0.45.1
```

## Verify

```bash
# Confirm rollout picked up the new version
kubectl -n falco get pods -l app.kubernetes.io/name=falco -o jsonpath='{.items[*].spec.containers[*].image}'

# Check Falco's reported version and driver/libs versions
kubectl -n falco exec -it ds/falco -- falco --version

# Tail logs to confirm clean startup, no rule-load or driver errors
kubectl -n falco logs -l app.kubernetes.io/name=falco --tail=50
```

Expected output includes `Falco version: 0.45.1`, `Driver version: 11.0.1+driver`, and `Libs version: 0.26.1`.

## Common Issues

- **Stuck package install on old kernels**: if you were previously affected by the half-configured package bug, you may need to manually clean up the dpkg/rpm state (`dpkg --configure -a` or `rpm -Va`) before installing 0.45.1, since the broken state predates the fix.
- **file_output appears silent after upgrade**: check disk space on the alert output path — the new behavior logs the failure instead of hanging silently, so grep Falco's own logs for write errors.
- **Metrics scraping still unstable**: ensure your Prometheus scrape interval and Falco `metrics` config in `falco.yaml` are both current; this fix targets a specific race, not general metrics misconfiguration.

## Best Practices

- Pin the Falco image tag explicitly in Helm values (`image.tag: 0.45.1`) rather than tracking `latest`, to keep driver/libs/plugin versions in sync across nodes.
- Roll out to a canary node pool first when bumping driver versions (`11.0.1+driver`), since kernel/driver mismatches are the most common source of DaemonSet CrashLoopBackOff.
- Since this is a patch-only release, batch it with your regular maintenance window rather than treating it as urgent — unless you're hitting one of the four fixed bugs above.
