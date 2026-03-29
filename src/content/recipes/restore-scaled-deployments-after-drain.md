---
title: "Restore Scaled Deployments After Node Drain"
description: "Safely restore deployments that were scaled down for maintenance. Verify node health, check pod scheduling, and confirm service availability after restoring replicas."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - scaling
  - restore
  - maintenance
  - deployments
  - post-drain
relatedRecipes:
  - "scale-deploy-unblock-drain"
  - "openshift-node-cordon-uncordon"
  - "mcp-update-automation-script"
---
> 💡 **Quick Answer:** After the drained node returns to `Ready`, uncordon it (`oc adm uncordon <node>`), then restore each deployment to its original replica count (`oc scale deploy/<name> --replicas=<original>`). Verify pods are Running and Services have endpoints.

## The Problem

You scaled down deployments to unblock a node drain. The node is back and Ready. Now you need to restore everything to its original state without missing any deployments or creating service disruptions.

## The Solution

### Step 1: Verify Node Is Ready

```bash
# Check node status
oc get node worker-3
# NAME       STATUS   ROLES    AGE   VERSION
# worker-3   Ready    worker   30d   v1.28.6   ← Ready, good

# Uncordon if still cordoned
oc adm uncordon worker-3
```

### Step 2: Restore from Record

```bash
# If you saved to a file:
cat /tmp/drain-restore.txt
# openshift-ingress/router-custom=6
# monitoring/alertmanager=3

# Restore each
while IFS='=' read -r ns_deploy replicas; do
  ns=$(echo "$ns_deploy" | cut -d/ -f1)
  deploy=$(echo "$ns_deploy" | cut -d/ -f2)
  echo "Restoring $ns/$deploy → $replicas replicas"
  oc scale deploy "$deploy" -n "$ns" --replicas="$replicas"
done < /tmp/drain-restore.txt
```

### Step 3: Verify Pods Are Running

```bash
# Wait for all pods to be ready
for ns_deploy in $(cut -d= -f1 /tmp/drain-restore.txt); do
  ns=$(echo "$ns_deploy" | cut -d/ -f1)
  deploy=$(echo "$ns_deploy" | cut -d/ -f2)
  echo "Checking $ns/$deploy..."
  oc rollout status deploy "$deploy" -n "$ns" --timeout=120s
done
```

### Step 4: Verify Services Have Endpoints

```bash
# Check endpoints for critical services
oc get endpoints -n openshift-ingress | grep router
# router-custom   10.128.2.15:80,10.128.3.22:80,...   ← Endpoints populated
```

### Step 5: Clean Up

```bash
# Remove the restore file after successful restoration
rm /tmp/drain-restore.txt
```

## Common Issues

### Pods Pending After Restore

Not enough resources on remaining nodes. Check `oc describe pod <pending>` for scheduling failures.

### Pods Schedule But Fail Readiness

The node may not have all required resources yet (e.g., GPU drivers still initializing). Wait for node-level operators to finish.

### Missing Restore File

```bash
# Find deployments at 0 replicas that shouldn't be
oc get deploy -A --field-selector spec.replicas=0 | grep -v "^NAMESPACE"
# Cross-reference with what should be running
```

## Best Practices

- **Automate the restore** — use the MCP update automation script
- **Keep restore records** until all deployments are verified
- **Set deployment readiness timeouts** — don't wait forever
- **Check MCP status after restoring** — ensure the next node can proceed
- **Notify the team** after maintenance is complete

## Key Takeaways

- Always uncordon before restoring replicas — pods need scheduling room
- Restore from the recorded file to avoid missing deployments
- Verify with `oc rollout status` and endpoint checks
- Clean up restore records after successful verification
