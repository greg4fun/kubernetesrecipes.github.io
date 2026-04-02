---
title: "Use oc adm drain Dry-Run for Diagnostics"
description: "Preview node drain impact without evicting pods. Identify PDB violations, unmanaged pods, and local storage blockers before maintenance."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - drain
  - dry-run
  - maintenance
  - diagnostics
  - openshift
relatedRecipes:
  - "openshift-node-cordon-uncordon"
  - "mcp-drain-pdb-workaround"
  - "mcp-blocked-stale-update"
---
> 💡 **Quick Answer:** Run `oc adm drain <node> --dry-run=client --ignore-daemonsets --delete-emptydir-data --force` to see exactly which pods would be evicted and which would block the drain — without actually doing anything. Always dry-run before real maintenance.

## The Problem

You need to drain a node for maintenance but don't know what will happen. Will PDBs block it? Are there bare pods that will be permanently lost? Will local storage data be deleted? You need visibility before committing to the drain.

## The Solution

### Run the Dry-Run

```bash
oc adm drain worker-3 \
  --dry-run=client \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --force

# Output shows what WOULD happen:
# evicting pod myapp/frontend-7f8b9c6d4-abc12 (dry run)
# evicting pod myapp/backend-5d6e7f8a9-def34 (dry run)
# evicting pod monitoring/prometheus-0 (dry run)
# error: Cannot evict pod as it would violate the pod's disruption budget.
# pod: ingress/router-custom-7f8b9c6d4-x2k9p
```

### Interpret the Output

| Output | Meaning | Action |
|--------|---------|--------|
| `evicting pod ... (dry run)` | Pod will be evicted and rescheduled | Safe — has a controller |
| `Cannot evict pod ... disruption budget` | PDB blocks eviction | Scale down or adjust PDB first |
| `cannot delete Pods not managed by ...` | Bare pod, no controller | Add `--force` or it blocks drain |
| `cannot delete Pods with local storage` | Uses emptyDir — data will be lost | Add `--delete-emptydir-data` if acceptable |

### Script: Full Drain Assessment

```bash
#!/bin/bash
NODE="${1:?Usage: $0 <node-name>}"

echo "=== Drain Assessment for $NODE ==="
echo ""

echo "--- Pods on this node ---"
oc get pods -A -o wide --field-selector spec.nodeName="$NODE" --no-headers | \
  awk '{printf "%-30s %-40s %s\n", $1, $2, $4}'

echo ""
echo "--- Dry-run drain ---"
oc adm drain "$NODE" --dry-run=client --ignore-daemonsets --delete-emptydir-data --force 2>&1

echo ""
echo "--- PDBs that may block ---"
for ns in $(oc get pods -A --field-selector spec.nodeName="$NODE" -o jsonpath='{range .items[*]}{.metadata.namespace}{"\n"}{end}' | sort -u); do
  oc get pdb -n "$ns" 2>/dev/null | grep -v "^NAME" | while read -r line; do
    echo "  [$ns] $line"
  done
done
```

## Common Issues

### Dry-Run Doesn't Catch Everything

Dry-run checks PDBs at the current moment. If another node is being drained simultaneously, PDB conditions may change between dry-run and actual drain.

### DaemonSet Pods Always Remain

`--ignore-daemonsets` is required — DaemonSet pods can't be evicted (they'd just restart on the same node). Without this flag, drain refuses to proceed.

## Best Practices

- **Always dry-run before draining production nodes**
- **Run the assessment script** to get a complete picture
- **Check PDBs across all namespaces** — any namespace's PDB can block the drain
- **Schedule maintenance windows** based on dry-run findings
- **Document known blockers** for each node pool

## Key Takeaways

- `--dry-run=client` previews drain without evicting anything
- Output shows exactly which pods block and why
- Always combine with `--ignore-daemonsets --delete-emptydir-data --force` for realistic preview
- PDB violations are the most common blocker — identify them before starting
