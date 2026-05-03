---
title: "Kubernetes 1.36 SELinux Mount-Time Labeling"
description: "Configure SELinux mount-time volume labeling in Kubernetes 1.36 to eliminate slow recursive relabeling and speed up Pod startup times dramatically."
tags:
  - "kubernetes-1.36"
  - "selinux"
  - "security"
  - "volumes"
  - "performance"
category: "security"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-1-36-user-namespaces"
  - "kubernetes-1-36-oci-volume-source"
  - "kubernetes-pod-security-admission"
  - "kubernetes-security-context-guide"
  - "kubernetes-fsgroupchangepolicy"
---

> 💡 **Quick Answer:** Kubernetes 1.36 graduates SELinux mount-time labeling to **Stable**. Volume labels are now applied at mount time instead of recursively walking every file, dramatically reducing Pod startup times for secure environments.

## The Problem

In SELinux-enforced environments, Kubernetes previously had to **recursively relabel every file** in a volume when a Pod started. For volumes with millions of files, this could take **minutes or even hours**, causing:

- Extremely slow Pod startup times
- Timeouts during deployments
- Rolling updates taking 10-100x longer than necessary
- Pressure to disable SELinux entirely (bad security practice)

## The Solution

With Kubernetes 1.36, SELinux labels are applied **at mount time** using the kernel's native mount option support. No more recursive file walks.

### Enable SELinux Mount Labeling

This feature is now **GA and enabled by default** in 1.36. No feature gates needed.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: fast-selinux-pod
spec:
  securityContext:
    seLinuxOptions:
      level: "s0:c123,c456"
    seLinuxChangePolicy: MountOption
  containers:
    - name: app
      image: registry.example.com/app:v2.1
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: app-data
```

### Key Field: `seLinuxChangePolicy`

```yaml
securityContext:
  seLinuxChangePolicy: MountOption    # NEW: mount-time labeling (fast)
  # seLinuxChangePolicy: Recursive   # OLD: walk every file (slow)
```

- **`MountOption`** — Labels applied via mount options. Instant, regardless of file count.
- **`Recursive`** — Legacy behavior. Walks every file and relabels. Still available if needed.

### Verify Mount-Time Labeling

```bash
# Check that the volume is mounted with SELinux context
kubectl exec fast-selinux-pod -- mount | grep /data
# Output should show: context="system_u:object_r:container_file_t:s0:c123,c456"

# Verify SELinux labels on files
kubectl exec fast-selinux-pod -- ls -Z /data
```

### Performance Comparison

```bash
# Before (Recursive) - 1 million files
# Pod startup: ~4 minutes

# After (MountOption) - 1 million files
# Pod startup: ~2 seconds
```

### CSI Driver Requirements

Your CSI driver must support SELinux mount options. Check compatibility:

```bash
# Verify CSI driver supports SELinux
kubectl get csidriver <driver-name> -o jsonpath='{.spec.seLinuxMount}'
# Should return: true
```

Most major CSI drivers (EBS, GCE PD, Azure Disk, Ceph, NFS) support this in their latest versions.

## Common Issues

### Mount option not applied
- **Cause**: CSI driver doesn't support `seLinuxMount`
- **Fix**: Update your CSI driver or fall back to `Recursive` policy

### Permission denied after enabling MountOption
- **Cause**: Existing files have wrong labels from previous Recursive runs
- **Fix**: One-time relabel with `Recursive`, then switch to `MountOption`

### Pod stuck in ContainerCreating
- **Cause**: Incompatible SELinux level format
- **Fix**: Verify `level` follows `s0:cXXX,cYYY` format

## Best Practices

1. **Use `MountOption` for all new workloads** — it's the default in 1.36
2. **Update CSI drivers first** before relying on mount-time labeling
3. **Test with existing volumes** — one-time Recursive relabel may be needed
4. **Monitor Pod startup times** — you should see immediate improvements
5. **Don't disable SELinux** — with mount-time labeling, there's no performance excuse

## Key Takeaways

- SELinux mount-time labeling is **GA in Kubernetes 1.36**
- Pod startup goes from **minutes to seconds** for large volumes
- Set `seLinuxChangePolicy: MountOption` in your Pod security context
- CSI drivers must support `seLinuxMount` capability
- No more choosing between security and performance
