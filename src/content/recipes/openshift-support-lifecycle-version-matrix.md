---
title: "OpenShift Support Lifecycle and Version Matrix"
description: "OpenShift Container Platform support lifecycle, version EOL dates, Kubernetes version mapping, upgrade paths, and Extended Update Support (EUS). Plan upgrades"
tags:
  - "openshift"
  - "lifecycle"
  - "support"
  - "upgrades"
  - "versioning"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "openshift-cluster-update-process-explained"
  - "kubernetes-api-deprecation-migration"
  - "mirror-openshift-releases-disconnected-registry"
---

> 💡 **Quick Answer:** OpenShift versions receive ~18 months of full support from GA. EUS (Extended Update Support) releases (even minor versions: 4.12, 4.14, 4.16, 4.18) get extended to ~24 months. Each OCP version maps to a specific Kubernetes version (e.g., OCP 4.16 = K8s 1.29, OCP 4.17 = K8s 1.30). Upgrade only between adjacent minor versions unless using EUS-to-EUS.

## The Problem

- OpenShift versions go end-of-life — running unsupported versions means no security patches
- Kubernetes API deprecations require planning before upgrading
- EUS vs non-EUS versions have different support timelines
- Upgrade path between versions must be sequential (can't skip versions)
- Mapping OpenShift versions to Kubernetes versions is not obvious

## The Solution

### OpenShift ↔ Kubernetes Version Mapping

```text
OpenShift  │ Kubernetes │ GA Date     │ End of Life  │ EUS
───────────┼────────────┼─────────────┼──────────────┼─────
4.18       │ 1.31       │ 2025-06     │ ~2027-06     │ Yes
4.17       │ 1.30       │ 2024-11     │ ~2026-05     │ No
4.16       │ 1.29       │ 2024-06     │ ~2026-06     │ Yes
4.15       │ 1.28       │ 2024-02     │ ~2025-08     │ No
4.14       │ 1.27       │ 2023-10     │ ~2025-10     │ Yes
4.13       │ 1.26       │ 2023-05     │ ~2024-11     │ No
4.12       │ 1.25       │ 2023-01     │ ~2025-01     │ Yes
───────────┴────────────┴─────────────┴──────────────┴─────

Pattern:
• Even minor versions (4.12, 4.14, 4.16, 4.18) = EUS
• Odd minor versions (4.13, 4.15, 4.17) = Standard support only
• Each OCP minor = K8s minor + 3 offset (OCP 4.x ≈ K8s 1.(x-3))
```

### Support Phases

```text
┌─────────────────────────────────────────────────────────────────┐
│ Full Support (~12-14 months from GA)                             │
│ • Security fixes, bug fixes, feature backports                  │
│ • New z-stream releases (4.16.1, 4.16.2, ...)                  │
├─────────────────────────────────────────────────────────────────┤
│ Maintenance Support (~6 months after Full Support ends)          │
│ • Critical security fixes only                                   │
│ • No new features, limited bug fixes                            │
├─────────────────────────────────────────────────────────────────┤
│ Extended Update Support (EUS versions only, +6 months)           │
│ • Extends lifecycle to ~24 months total                          │
│ • Enables EUS-to-EUS upgrade path (skip odd versions)           │
├─────────────────────────────────────────────────────────────────┤
│ End of Life                                                      │
│ • No patches, no support                                         │
│ • Must upgrade to supported version                             │
└─────────────────────────────────────────────────────────────────┘
```

### Upgrade Paths

```text
Standard upgrade path (sequential):
  4.14 → 4.15 → 4.16 → 4.17 → 4.18

EUS-to-EUS upgrade path (skip odd versions):
  4.14 → 4.16 → 4.18
  (Requires EUS subscription; runs through intermediate version internally)

Within minor version (z-stream):
  4.16.0 → 4.16.5 → 4.16.12 (any z-stream to any higher z-stream)
```

```bash
# Check available upgrade paths
oc adm upgrade
# Cluster version is 4.16.12
# Recommended updates:
#   VERSION    IMAGE
#   4.16.15    quay.io/openshift-release-dev/ocp-release@sha256:...
#   4.17.3     quay.io/openshift-release-dev/ocp-release@sha256:...

# Check current version and channel
oc get clusterversion
# NAME      VERSION   AVAILABLE   PROGRESSING   SINCE   STATUS
# version   4.16.12   True        False         10d     Cluster version is 4.16.12

# Set update channel
oc adm upgrade channel eus-4.18

# View upgrade graph
oc adm upgrade --include-not-recommended
```

### Check Version and Support Status

```bash
# Current cluster version details
oc get clusterversion version -o yaml | grep -A5 "status:"

# Kubernetes version running
oc version
# Client Version: 4.16.12
# Kube Version: v1.29.8
# Server Version: 4.16.12

# Check if running EUS version
oc get clusterversion -o jsonpath='{.items[0].spec.channel}'
# eus-4.16
```

### Planning Upgrades

```text
Upgrade planning checklist:
1. Check current version EOL date (Red Hat lifecycle page)
2. Review deprecated APIs in target version (oc adm upgrade)
3. Check operator compatibility matrix
4. Test in non-production first
5. Review release notes for breaking changes
6. Ensure enough time before EOL (~3 months buffer)
7. For EUS-to-EUS: both source and target must be EUS

Timeline recommendation:
• Start planning upgrade 6 months before EOL
• Test in dev/staging 3 months before
• Production upgrade 1-2 months before EOL
```

## Common Issues

### "Version not found in channel" when trying to upgrade
- **Cause**: Wrong channel selected (stable vs eus vs candidate)
- **Fix**: `oc adm upgrade channel stable-4.17` or `eus-4.18`

### Upgrade blocked by deprecated API usage
- **Cause**: Workloads using APIs removed in target version
- **Fix**: Run `oc get apirequestcounts` to find deprecated API usage; migrate before upgrading

### Cluster stuck on unsupported version
- **Cause**: Missed upgrade window, version went EOL
- **Fix**: Must upgrade through each intermediate version sequentially; contact Red Hat support

## Best Practices

1. **Use EUS versions in production** — longer support, cleaner upgrade paths
2. **Subscribe to errata notifications** — early warning for security patches
3. **Test upgrades in non-prod first** — catch operator/workload incompatibilities
4. **Monitor deprecated API usage** — `oc get apirequestcounts` shows which APIs will break
5. **Upgrade at least every 12 months** — don't let versions go EOL under you
6. **Use EUS-to-EUS for minimal disruption** — skip intermediate versions

## Key Takeaways

- OpenShift versions get ~18 months full support (24 months for EUS)
- EUS = even minor versions (4.12, 4.14, 4.16, 4.18)
- Each OCP version maps to a specific Kubernetes version (OCP 4.16 = K8s 1.29)
- Upgrades must be sequential (4.14→4.15→4.16) unless EUS-to-EUS
- Check lifecycle status at access.redhat.com/support/policy/updates/openshift
- Plan upgrades 6 months ahead; test 3 months before production
