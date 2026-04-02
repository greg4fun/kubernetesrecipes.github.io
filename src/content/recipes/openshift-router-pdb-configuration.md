---
title: "Configure PDBs for OpenShift Routers"
description: "Set PodDisruptionBudgets for OpenShift IngressController routers. Balance availability during maintenance with node drain ability."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - pdb
  - ingress
  - router
  - maintenance
relatedRecipes:
  - "pdb-allowed-disruptions-zero"
  - "mcp-drain-pdb-workaround"
  - "openshift-ingress-router-troubleshooting"
  - "node-drain-hostnetwork-ports"
---
> 💡 **Quick Answer:** OpenShift IngressController creates PDBs automatically. The default `minAvailable` can block drains. Override by setting `maxUnavailable: 1` on the IngressController spec, or reduce replicas to `nodes - 1` so there's always room for rescheduling.

## The Problem

OpenShift IngressControllers automatically create PDBs for their router deployments. With `minAvailable` equal to replica count and `hostNetwork` on all nodes, no router pod can be evicted — every MCP update gets stuck waiting for drains that never complete.

## The Solution

### Check Current PDB Configuration

```bash
# List router PDBs
oc get pdb -n openshift-ingress
# NAME                           MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# router-default                 N/A             1                 1                     30d
# router-custom                  3               N/A               0                     15d  ← Blocks drains!
```

### Option 1: Configure Via IngressController

```bash
# Set maxUnavailable on the IngressController (preferred)
oc patch ingresscontroller custom -n openshift-ingress-operator --type merge -p '{
  "spec": {
    "replicas": 5,
    "tuningOptions": {
      "maxUnavailable": 1
    }
  }
}'
```

### Option 2: Reduce Replicas for Headroom

```bash
WORKERS=$(oc get nodes -l node-role.kubernetes.io/worker= --no-headers | wc -l)
# If 6 workers, set 5 replicas — leaves 1 node free for rescheduling
oc patch ingresscontroller custom -n openshift-ingress-operator --type merge -p "{
  \"spec\": {\"replicas\": $((WORKERS - 1))}
}"
```

### Option 3: Replace PDB Directly (Temporary)

```bash
# Delete the auto-created PDB and create a better one
oc delete pdb router-custom -n openshift-ingress

cat << EOF | oc apply -f -
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: router-custom
  namespace: openshift-ingress
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      ingresscontroller.operator.openshift.io/deployment-ingresscontroller: custom
EOF
```

> ⚠️ The IngressController operator may recreate the original PDB. Option 1 (patching the IngressController) is the durable solution.

## Common Issues

### Operator Recreates PDB After Deletion

The ingress operator manages the PDB lifecycle. Patching the IngressController spec is the correct way to influence PDB settings.

### Multiple IngressControllers on Same Nodes

Each router deployment has its own PDB. If all block eviction, drains fail on every node.

## Best Practices

- **Use `maxUnavailable: 1`** instead of `minAvailable: N` for router PDBs
- **Set replicas to nodes - 1** for hostNetwork routers — guarantees rescheduling headroom
- **Configure via IngressController spec** — operator-managed PDBs override manual ones
- **Test drains after PDB changes** — verify with `--dry-run=client`
- **Document PDB expectations** per IngressController

## Key Takeaways

- IngressController operator auto-creates PDBs for router deployments
- `minAvailable` PDBs block drains when combined with hostNetwork port saturation
- Configure PDBs through IngressController spec, not by editing PDB directly
- `maxUnavailable: 1` always allows one disruption regardless of replica count
- Replicas ≤ nodes - 1 ensures rescheduling room during maintenance
