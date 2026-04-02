---
title: "Fix PVC Resize Stuck or Failed"
description: "Debug PersistentVolumeClaim expansion failures. Covers allowVolumeExpansion, filesystem resize conditions, offline vs online expansion, and recovery from stuck resizes."
category: "storage"
difficulty: "intermediate"
publishDate: "2026-04-02"
tags: ["pvc", "resize", "expansion", "storage", "troubleshooting"]
author: "Luca Berton"
relatedRecipes:
  - "pvc-pending-troubleshooting"
  - "statefulset-management"
---

> 💡 **Quick Answer:** Debug PersistentVolumeClaim expansion failures. Covers allowVolumeExpansion, filesystem resize conditions, offline vs online expansion, and recovery from stuck resizes.

## The Problem

This is a common issue in Kubernetes storage that catches both beginners and experienced operators.

## The Solution

### Step 1: Check Resize Status

```bash
kubectl describe pvc my-claim | grep -A5 "Conditions"
# Type: FileSystemResizePending
# Message: "Waiting for user to (re-)start a pod to finish resize"
```

### Step 2: Enable Volume Expansion

```bash
# Check if StorageClass allows expansion
kubectl get storageclass standard -o jsonpath='{.allowVolumeExpansion}'
# Must be true

# Enable it
kubectl patch storageclass standard -p '{"allowVolumeExpansion": true}'
```

### Step 3: Resize the PVC

```bash
# Edit PVC to increase size
kubectl patch pvc my-claim -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'

# For offline-only resize (most block storage):
# 1. Scale down the pod
kubectl scale deployment myapp --replicas=0
# 2. Wait for resize to complete
kubectl get pvc my-claim -w
# 3. Scale back up
kubectl scale deployment myapp --replicas=1
```

### Step 4: Stuck Resize Recovery

```bash
# If resize is stuck, check PV status
kubectl describe pv <pv-name> | grep -A5 "Conditions"

# For cloud providers, check the volume in the cloud console
# AWS: EC2 > EBS > Volumes > check "modification" state

# Nuclear option: recreate PVC with snapshot
kubectl get volumesnapshot
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
