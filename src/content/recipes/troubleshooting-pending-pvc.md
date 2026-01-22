---
title: "Troubleshooting Pending PersistentVolumeClaims"
description: "Diagnose and fix PVCs stuck in Pending status. Learn common causes including StorageClass issues, capacity problems, and node affinity conflicts with step-by-step solutions."
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.25+"
prerequisites:
  - "kubectl access to your cluster"
  - "Basic understanding of Kubernetes storage"
relatedRecipes:
  - "pvc-storageclass-examples"
tags:
  - troubleshooting
  - pvc
  - storage
  - pending
  - debugging
publishDate: "2026-01-20"
author: "Luca Berton"
---

## The Problem

Your PersistentVolumeClaim is stuck in `Pending` status and your pods can't start because they're waiting for storage.

## Quick Diagnosis

```bash
# Check PVC status
kubectl get pvc

# Get detailed info including events
kubectl describe pvc <pvc-name>
```

Look at the **Events** section for clues about why it's pending.

## Common Causes and Fixes

### 1. No Default StorageClass

**Symptoms:**
```
Events:
  Warning  ProvisioningFailed  no persistent volumes available for this claim and no storage class is set
```

**Diagnosis:**

```bash
# Check if any StorageClass exists and which is default
kubectl get storageclass

# Output shows no (default) marker:
# NAME        PROVISIONER          RECLAIMPOLICY
# standard    kubernetes.io/gce-pd Delete
```

**Fix:** Set a default StorageClass:

```bash
kubectl patch storageclass standard -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

Or specify the StorageClass in your PVC:

```yaml
spec:
  storageClassName: standard
```

### 2. StorageClass Doesn't Exist

**Symptoms:**
```
Events:
  Warning  ProvisioningFailed  storageclass.storage.k8s.io "fast-ssd" not found
```

**Fix:** List available StorageClasses and use one that exists:

```bash
kubectl get storageclass
```

### 3. Volume Binding Mode: WaitForFirstConsumer

**Symptoms:**
```
Status:        Pending
Events:        <none>
```

No events, PVC just sits in Pending.

**Diagnosis:**

```bash
kubectl get storageclass <storageclass-name> -o yaml | grep volumeBindingMode
# volumeBindingMode: WaitForFirstConsumer
```

**Explanation:** This is actually normal! The PVC won't provision until a Pod references it. The volume will be provisioned in the same zone as the Pod.

**Fix:** Create a Pod that uses the PVC, then it will provision.

### 4. Insufficient Storage Capacity

**Symptoms:**
```
Events:
  Warning  ProvisioningFailed  failed to provision volume: googleapi: Error 403: Quota 'SSD_TOTAL_GB' exceeded
```

**Diagnosis:**

```bash
# Check current storage usage (cloud provider specific)
# For GCP:
gcloud compute disks list --format="table(name,sizeGb,zone)"
```

**Fix:** 
- Request less storage
- Delete unused PVCs/PVs
- Request quota increase from cloud provider

### 5. No Available Persistent Volumes (Static Provisioning)

**Symptoms:**
```
Events:
  Warning  ProvisioningFailed  no persistent volumes available for this claim
```

**Diagnosis:** You're using static provisioning but no matching PV exists.

```bash
# Check available PVs
kubectl get pv

# Check if any PV matches your PVC requirements
kubectl get pv -o custom-columns=NAME:.metadata.name,CAPACITY:.spec.capacity.storage,ACCESS:.spec.accessModes,STATUS:.status.phase,CLAIM:.spec.claimRef.name
```

**Fix:** Create a matching PV:

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: ""  # Empty for static provisioning
  hostPath:
    path: /data/my-pv
```

### 6. Access Mode Mismatch

**Symptoms:**
```
Warning  ProvisioningFailed  no persistent volumes available for this claim
```

**Diagnosis:** Your PVC requests an access mode the storage doesn't support.

```bash
# Check what access modes your StorageClass supports
kubectl get storageclass <name> -o yaml
```

**Example:** EBS volumes only support `ReadWriteOnce`, not `ReadWriteMany`.

**Fix:** Use a supported access mode:

```yaml
spec:
  accessModes:
    - ReadWriteOnce  # Instead of ReadWriteMany
```

### 7. Node Affinity Conflict

**Symptoms:**
```
Warning  ProvisioningFailed  node(s) didn't match node selector
```

**Diagnosis:** Zonal storage can't be attached to pods in different zones.

```bash
# Check which zone the PV was created in
kubectl get pv <pv-name> -o yaml | grep -A5 nodeAffinity
```

**Fix:** 
- Use `volumeBindingMode: WaitForFirstConsumer` to provision in the pod's zone
- Use regional storage if available (GKE regional PD, etc.)

### 8. CSI Driver Not Installed

**Symptoms:**
```
Warning  ProvisioningFailed  driver name ebs.csi.aws.com not found
```

**Diagnosis:**

```bash
# Check installed CSI drivers
kubectl get csidrivers
```

**Fix:** Install the required CSI driver:

```bash
# Example: AWS EBS CSI Driver
kubectl apply -k "github.com/kubernetes-sigs/aws-ebs-csi-driver/deploy/kubernetes/overlays/stable/?ref=release-1.24"
```

## Debugging Workflow

### Step 1: Get PVC Details

```bash
kubectl describe pvc <pvc-name>
```

### Step 2: Check Events

```bash
kubectl get events --field-selector involvedObject.name=<pvc-name>
```

### Step 3: Check StorageClass

```bash
kubectl get storageclass
kubectl describe storageclass <class-name>
```

### Step 4: Check Provisioner Pods

```bash
# For CSI drivers, check the controller pods
kubectl get pods -n kube-system | grep csi

# Check logs
kubectl logs -n kube-system <csi-controller-pod> -c csi-provisioner
```

### Step 5: Check Cluster Capacity

```bash
# Check node storage
kubectl describe nodes | grep -A5 "Allocatable"
```

## Quick Reference Table

| Error Message | Likely Cause | Quick Fix |
|---------------|--------------|-----------|
| no storage class | No default SC | Set default or specify SC |
| storageclass not found | Wrong SC name | List SCs, use existing one |
| quota exceeded | Disk quota | Reduce size or request quota |
| no PV available | Static provisioning | Create matching PV |
| access mode | Incompatible mode | Use ReadWriteOnce |
| driver not found | CSI not installed | Install CSI driver |
| no events | WaitForFirstConsumer | Create pod that uses PVC |

## Summary

When debugging Pending PVCs:

1. Always start with `kubectl describe pvc`
2. Check the Events section for error messages
3. Verify StorageClass exists and is correctly configured
4. Check for capacity/quota issues
5. Verify CSI drivers are installed
6. Consider volumeBindingMode behavior

## References

- [Kubernetes Storage Troubleshooting](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#troubleshooting)
- [Debug Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/)
