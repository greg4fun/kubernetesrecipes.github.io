---
title: "Fix Helm Upgrade Failed and Rollback"
description: "Debug failed Helm releases stuck in pending-upgrade or failed state. Covers atomic upgrades, manual rollback, secret storage cleanup, and history limits."
category: "helm"
difficulty: "intermediate"
publishDate: "2026-04-02"
tags: ["helm", "upgrade", "rollback", "failed", "troubleshooting"]
author: "Luca Berton"
relatedRecipes:
  - "helm-hooks"
  - "helm-before-hook-creation"
  - "helm-chart-dependencies-guide"
---

> 💡 **Quick Answer:** Debug failed Helm releases stuck in pending-upgrade or failed state. Covers atomic upgrades, manual rollback, secret storage cleanup, and history limits.

## The Problem

This is a common issue in Kubernetes helm that catches both beginners and experienced operators.

## The Solution

### Step 1: Check Release Status

```bash
helm list -a
# STATUS: failed, pending-upgrade, pending-install
```

### Step 2: Fix by Status

**Failed — rollback:**
```bash
# View history
helm history my-release

# Rollback to last working revision
helm rollback my-release 3

# Or uninstall and reinstall
helm uninstall my-release
helm install my-release ./my-chart
```

**Pending-upgrade — stuck release:**
```bash
# Helm stores state in secrets
kubectl get secrets -l owner=helm,status=pending-upgrade

# Delete the pending secret to unblock
kubectl delete secret sh.helm.release.v1.my-release.v5

# Then retry
helm upgrade my-release ./my-chart
```

**Prevent future failures:**
```bash
# Use --atomic for auto-rollback on failure
helm upgrade --install my-release ./my-chart --atomic --timeout 10m

# Limit history to prevent secret buildup
helm upgrade my-release ./my-chart --history-max 5
```

## Best Practices

- **Monitor proactively** with Prometheus alerts before issues become incidents
- **Document runbooks** for your team's most common failure scenarios
- **Use `kubectl describe` and events** as your first debugging tool
- **Automate recovery** where possible with operators or scripts

## Key Takeaways

- Always check events and logs first — Kubernetes tells you what's wrong
- Most issues have clear error messages pointing to the root cause
- Prevention through monitoring and proper configuration beats reactive debugging
- Keep this recipe bookmarked for quick reference during incidents
