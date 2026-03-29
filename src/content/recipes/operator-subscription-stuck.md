---
title: "Fix Stuck OLM Operator Subscriptions"
description: "Debug Operator Lifecycle Manager subscriptions stuck in pending or failed state. Resolve catalog source issues, approval policies, and CSV dependency conflicts."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - olm
  - operator
  - subscription
  - troubleshooting
relatedRecipes:
  - "openshift-acs-kubernetes"
  - "openshift-serverless-knativeserving"
---
> 💡 **Quick Answer:** Check `oc get sub -A` for subscription status and `oc get csv -A` for ClusterServiceVersion state. Common fixes: approve pending InstallPlans (`oc patch installplan <name> --type merge -p '{"spec":{"approved":true}}'`), fix CatalogSource connectivity, or delete stuck CSVs and resubscribe.

## The Problem

An operator subscription shows "UpgradePending" or the CSV is stuck in "Installing" or "Failed". The operator doesn't deploy, and dependent workloads can't be configured. The OLM isn't progressing the installation.

## The Solution

### Step 1: Check Subscription Status

```bash
# List all subscriptions
oc get sub -A
# NAMESPACE     NAME           PACKAGE        SOURCE             CHANNEL   CSV                   STATE
# my-ns         gpu-operator   gpu-operator   certified-ops      v23.9     gpu-operator.v23.9.1  UpgradePending

# Check subscription details
oc describe sub gpu-operator -n my-ns
```

### Step 2: Check InstallPlan

```bash
# List InstallPlans
oc get installplan -n my-ns
# NAME            CSV                    APPROVAL   APPROVED
# install-abc12   gpu-operator.v23.9.1   Manual     false  ← Needs approval!

# Approve it
oc patch installplan install-abc12 -n my-ns --type merge -p '{"spec":{"approved":true}}'
```

### Step 3: Check CSV Status

```bash
# List ClusterServiceVersions
oc get csv -n my-ns
# NAME                   DISPLAY        VERSION   PHASE
# gpu-operator.v23.9.1   GPU Operator   23.9.1    Installing  ← Stuck

# Check CSV details for the failure reason
oc describe csv gpu-operator.v23.9.1 -n my-ns | grep -A5 "Phase\|Reason\|Message"
```

### Step 4: Check CatalogSource

```bash
# Verify catalog source is healthy
oc get catalogsource -n openshift-marketplace
# NAME                  DISPLAY               TYPE   PUBLISHER   AGE     STATUS
# certified-operators   Certified Operators   grpc   Red Hat     30d     READY

# If not READY, check the catalog pod
oc get pods -n openshift-marketplace | grep certified
oc logs -n openshift-marketplace <catalog-pod>
```

### Step 5: Nuclear Option — Delete and Resubscribe

```bash
# Delete stuck CSV
oc delete csv gpu-operator.v23.9.1 -n my-ns

# Delete subscription
oc delete sub gpu-operator -n my-ns

# Delete failed InstallPlans
oc delete installplan -n my-ns --all

# Resubscribe
cat << EOF | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: gpu-operator
  namespace: my-ns
spec:
  channel: v23.9
  name: gpu-operator
  source: certified-operators
  sourceNamespace: openshift-marketplace
  installPlanApproval: Automatic
EOF
```

## Common Issues

### Dependency Resolution Failure

```bash
oc describe sub gpu-operator -n my-ns
# Message: constraints not satisfiable: requires operator X which is not available
```
Install the required dependency operator first.

### CatalogSource Pod CrashLooping

```bash
# In air-gapped environments, the catalog image may not be accessible
oc get catalogsource -n openshift-marketplace -o json | jq '.items[] | {name: .metadata.name, image: .spec.image}'
# Verify the catalog image is mirrored to your local registry
```

## Best Practices

- **Use `installPlanApproval: Automatic`** for non-critical operators in dev/staging
- **Use `Manual` approval** in production for controlled upgrades
- **Monitor CatalogSource health** — stale catalogs prevent updates
- **Pin operator channels** — don't use `latest` in production
- **Check operator compatibility matrix** before upgrading OpenShift

## Key Takeaways

- OLM lifecycle: Subscription → InstallPlan → CSV → Deployment
- Pending InstallPlans need manual approval if `installPlanApproval: Manual`
- CatalogSource must be READY for new subscriptions and updates
- Delete CSV + Subscription + InstallPlans for a clean restart
- In air-gapped environments, mirror both operator images and catalog indexes
