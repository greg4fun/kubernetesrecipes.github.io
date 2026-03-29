---
title: "Automate MCP Updates with Drain Script"
description: "Bash script to automate OpenShift MachineConfigPool updates when drains are blocked by PDB violations. Auto-detects blockers, scales down, drains, and restores."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - machineconfig
  - automation
  - bash
  - mcp
  - drain
relatedRecipes:
  - "mcp-blocked-stale-update"
  - "mcp-drain-pdb-workaround"
  - "node-drain-hostnetwork-ports"
  - "openshift-mcp-itms-rollout"
---

> 💡 **Quick Answer:** Use this script to automate MCP rollouts on clusters where PDB violations block node drains. It detects the blocking pod, resolves its owning Deployment, scales it to 0, drains the node, waits for the MCD reboot, restores replicas, and repeats until the MCP reports `UPDATED=True`.

## The Problem

In OpenShift clusters with custom ingress routers, strict PDBs, or hostNetwork workloads, MCP updates stall because the MachineConfigDaemon can't drain nodes. Manually identifying and scaling down blocking deployments for each of 6+ worker nodes is tedious and error-prone.

## The Solution

### The Automation Script

```bash
#!/usr/bin/env bash
set -euo pipefail

# Configuration (override via environment variables)
MCP_NAME="${MCP_NAME:-worker}"
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-1800}"          # 30 minutes
NODE_READY_TIMEOUT="${NODE_READY_TIMEOUT:-2700}" # 45 minutes
DEFAULT_REPLICAS="${DEFAULT_REPLICAS:-6}"

# Track scaled-down deployments for cleanup
declare -A SCALED_DEPLOYS

log()  { printf "\033[1;34m[%s INFO]\033[0m %s\n" "$(date +%H:%M:%S)" "$*"; }
warn() { printf "\033[1;33m[%s WARN]\033[0m %s\n" "$(date +%H:%M:%S)" "$*"; }
err()  { printf "\033[1;31m[%s ERR ]\033[0m %s\n" "$(date +%H:%M:%S)" "$*" >&2; }

# Cleanup trap: restore any deployments that were scaled down
cleanup() {
  if (( ${#SCALED_DEPLOYS[@]} > 0 )); then
    warn "Restoring scaled-down deployments on exit..."
    for key in "${!SCALED_DEPLOYS[@]}"; do
      IFS='|' read -r ns deploy replicas <<< "${SCALED_DEPLOYS[$key]}"
      log "Restoring $ns/$deploy to replicas=$replicas"
      oc -n "$ns" scale deploy/"$deploy" --replicas="$replicas" 2>/dev/null || true
    done
  fi
}
trap cleanup EXIT

# Check if MCP is fully updated
mcp_updated() {
  oc get mcp "$MCP_NAME" -o json | \
    jq -e '.status.conditions[] | select(.type=="Updated" and .status=="True")' >/dev/null 2>&1
}

# Find nodes that still need the update
find_pending_nodes() {
  for node in $(oc get nodes -l "node-role.kubernetes.io/$MCP_NAME=" -o name); do
    local desired current
    desired=$(oc get "$node" -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/desiredConfig}')
    current=$(oc get "$node" -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/currentConfig}')
    if [[ "$desired" != "$current" ]]; then
      echo "${node#node/}"
    fi
  done
}

# Dry-run drain to find blocking pods
find_blockers() {
  local node="$1"
  oc adm drain "$node" --ignore-daemonsets --delete-emptydir-data \
    --force --dry-run=client 2>&1 | \
    grep -B1 "Cannot evict pod" | grep "evicting pod" | \
    awk '{print $3}' | sed 's/"//g' | sort -u
}

# Resolve pod → Deployment name
resolve_deployment() {
  local ns="$1" pod="$2"
  local rs deploy
  rs=$(oc -n "$ns" get pod "$pod" -o jsonpath='{.metadata.ownerReferences[?(@.kind=="ReplicaSet")].name}' 2>/dev/null)
  if [[ -n "$rs" ]]; then
    deploy=$(oc -n "$ns" get rs "$rs" -o jsonpath='{.metadata.ownerReferences[?(@.kind=="Deployment")].name}' 2>/dev/null)
    echo "$deploy"
  fi
}

# Scale down a blocking deployment and record it
scale_down_blocker() {
  local ns="$1" deploy="$2"
  local replicas
  replicas=$(oc -n "$ns" get deploy "$deploy" -o jsonpath='{.spec.replicas}')
  [[ -z "$replicas" ]] && replicas=$DEFAULT_REPLICAS
  
  log "Scaling $ns/$deploy from $replicas → 0"
  SCALED_DEPLOYS["$ns/$deploy"]="$ns|$deploy|$replicas"
  oc -n "$ns" scale deploy/"$deploy" --replicas=0
}

# Restore all scaled deployments
restore_all() {
  for key in "${!SCALED_DEPLOYS[@]}"; do
    IFS='|' read -r ns deploy replicas <<< "${SCALED_DEPLOYS[$key]}"
    log "Restoring $ns/$deploy to replicas=$replicas"
    oc -n "$ns" scale deploy/"$deploy" --replicas="$replicas"
    unset "SCALED_DEPLOYS[$key]"
  done
}

# Wait for node to be Ready with correct config
wait_node_ready() {
  local node="$1" start elapsed
  start=$(date +%s)
  log "Waiting for $node to become Ready with updated config..."
  
  while true; do
    local ready desired current
    ready=$(oc get node "$node" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
    desired=$(oc get node "$node" -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/desiredConfig}')
    current=$(oc get node "$node" -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/currentConfig}')
    
    if [[ "$ready" == "True" && "$desired" == "$current" ]]; then
      log "Node $node is Ready and updated"
      return 0
    fi
    
    elapsed=$(( $(date +%s) - start ))
    if (( elapsed > NODE_READY_TIMEOUT )); then
      err "Timeout waiting for $node (${elapsed}s). Check MCD logs."
      return 1
    fi
    sleep 15
  done
}

# Process a single node
process_node() {
  local node="$1"
  log "===== Processing node: $node ====="
  
  # Find and resolve blockers
  local blockers
  blockers=$(find_blockers "$node")
  
  if [[ -n "$blockers" ]]; then
    log "Found blocking pods:"
    echo "$blockers" | while read -r ns_pod; do
      local ns pod deploy
      ns=$(echo "$ns_pod" | cut -d/ -f1)
      pod=$(echo "$ns_pod" | cut -d/ -f2)
      deploy=$(resolve_deployment "$ns" "$pod")
      if [[ -n "$deploy" ]]; then
        echo "  $ns/$pod → deploy/$deploy"
        scale_down_blocker "$ns" "$deploy"
      else
        warn "  $ns/$pod → could not resolve Deployment (manual action needed)"
      fi
    done
    sleep 3
  fi
  
  # Drain
  log "Draining $node..."
  oc adm drain "$node" --ignore-daemonsets --delete-emptydir-data \
    --force --timeout="${DRAIN_TIMEOUT}s"
  
  # Wait for MCD to reboot and apply config
  wait_node_ready "$node"
  
  # Uncordon
  oc adm uncordon "$node" 2>/dev/null || true
  log "Uncordoned $node"
  
  # Restore scaled deployments
  restore_all
  
  log "===== Completed: $node ====="
}

# ========== MAIN ==========
log "Starting MCP update automation for pool '$MCP_NAME'"

while ! mcp_updated; do
  mapfile -t pending < <(find_pending_nodes)
  
  if (( ${#pending[@]} == 0 )); then
    log "No pending nodes found. Waiting for MCP to reconcile..."
    sleep 30
    continue
  fi
  
  log "${#pending[@]} node(s) pending update: ${pending[*]}"
  process_node "${pending[0]}"
done

log "✅ MCP '$MCP_NAME' is fully updated!"
```

### Usage

```bash
chmod +x mcp-update-automator.sh

# Run with defaults (worker MCP, 30min drain timeout)
./mcp-update-automator.sh

# Override settings
MCP_NAME=gpu-worker DRAIN_TIMEOUT=3600 ./mcp-update-automator.sh
```

### What It Does

1. Finds the next worker node that needs the new MachineConfig
2. Runs a dry-run drain to discover PDB-blocking pods
3. Resolves each blocking pod to its owning Deployment
4. Scales the Deployment to 0 (records original count)
5. Drains the node for real
6. Waits for MCD to reboot, apply config, and report Ready
7. Uncordons the node and restores all scaled Deployments
8. Repeats until MCP shows `UPDATED=True`

## Common Issues

### Script Interrupted Mid-Drain

The `trap cleanup EXIT` ensures scaled-down deployments are restored even on Ctrl+C or errors.

### Non-Deployment Pods Blocking

StatefulSets, bare pods, or DaemonSets may also block. The script warns when it can't resolve the Deployment owner — handle those manually.

## Best Practices

- **Run during a maintenance window** — temporary scaling affects availability
- **Test with `--dry-run=client` first** to see what will happen
- **Monitor the script output** — don't leave it fully unattended
- **Review PDB policies** after — if the same deployments block every time, fix the PDBs

## Key Takeaways

- Automates the detect → scale → drain → wait → restore cycle
- Handles multiple blocking pods per node
- Cleanup trap restores replicas on script exit or interruption
- Works with any MCP name (worker, gpu-worker, infra)
- Configurable timeouts for different cluster sizes
