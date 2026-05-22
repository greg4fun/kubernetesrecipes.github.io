---
title: "OpenShift Cluster Update Process Explained"
description: "Complete guide to OpenShift Container Platform cluster updates. CVO workflow, Runlevels, Machine Config Operator node updates, update channels (fast/stable/EUS/candidate), conditional updates, duration estimation, and troubleshooting."
tags:
  - "openshift"
  - "cluster-update"
  - "cvo"
  - "machine-config-operator"
  - "lifecycle"
category: "configuration"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "openshift-mcp-update-failure-troubleshooting"
  - "openshift-machine-config-operator-guide"
  - "openshift-lifecycle-management"
  - "kubernetes-cluster-upgrade-guide"
---

> 💡 **Quick Answer:** OpenShift updates are orchestrated by the Cluster Version Operator (CVO), which applies release manifests in ordered Runlevels. The CVO updates all control plane Operators first (60-120 min), then the Machine Config Operator (MCO) rolls out OS and config changes to nodes one-by-one (5+ min per node). Use `oc adm upgrade` to check available versions and `oc adm upgrade --to=<version>` to initiate.

## The Problem

- Cluster updates are complex — multiple Operators must update in sequence
- Wrong update channel selection can delay access to critical patches
- Node updates drain workloads — poor planning causes application downtime
- Conditional updates with known risks need informed decision-making
- Estimating update duration is difficult without understanding the phases

## The Solution

### OpenShift Update Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│ OpenShift Update Service (OSUS)                                   │
│ • Hosts update graph of all release versions                      │
│ • Evaluates conditional risks per cluster                         │
│ • Recommends safe update paths based on channel + version         │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Query: "What can I update to?"
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Cluster Version Operator (CVO)                                    │
│ • Manages ClusterVersion resource                                 │
│ • Downloads + validates release image                             │
│ • Applies manifests in Runlevel order                             │
│ • Monitors Operator health between Runlevels                      │
└────────────────────────────┬─────────────────────────────────────┘
                             │ After control plane complete
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Machine Config Operator (MCO)                                     │
│ • Updates OS + system config on each node                         │
│ • Cordon → Drain → Update → Reboot → Uncordon                    │
│ • Respects maxUnavailable (default: 1)                            │
│ • Control plane + compute pools updated in parallel               │
└──────────────────────────────────────────────────────────────────┘
```

### Check Available Updates

```bash
# View recommended updates
oc adm upgrade

# Include updates with known issues (conditional updates)
oc adm upgrade --include-not-recommended

# Check current cluster version
oc get clusterversion
# NAME      VERSION   AVAILABLE   PROGRESSING   SINCE   STATUS
# version   4.19.12   True        False         3d      Cluster version is 4.19.12

# View available updates as JSON
oc get clusterversion version -o json | jq '.status.availableUpdates[] | .version'

# Check conditional updates (with known risks)
oc get clusterversion version -o json | jq '.status.conditionalUpdates[] |
  {version: .release.version, recommended: .conditions[0].status, reason: .conditions[0].reason}'
```

### Initiate an Update

```bash
# Update to specific version
oc adm upgrade --to=4.20.3

# Update to latest in channel
oc adm upgrade --to-latest=true

# Force update (bypass conditional risk warnings)
oc adm upgrade --to=4.20.3 --force
# ⚠️ Use only when you've evaluated the risk and accept it

# Switch channel first if needed
oc adm upgrade channel stable-4.20
```

### Understanding Update Channels

```text
Channel        Description                              When to Use
───────────────────────────────────────────────────────────────────────────
candidate-4.20 Unsupported early access (pre-GA)        Testing only
fast-4.20      GA releases immediately on publish       Need fixes ASAP
stable-4.20    GA releases after promotion delay        Most production clusters
eus-4.y        Extended Update Support (even versions)  EUS-to-EUS jumps
───────────────────────────────────────────────────────────────────────────

Promotion flow:
  candidate → fast (GA + errata) → stable (after delay)

Delay between fast and stable:
  • z-stream updates: ~1-2 weeks
  • Minor version initial: ~45-90 days

Key facts:
  • fast and stable are BOTH fully supported
  • The only difference is time-to-availability
  • If a regression is found on fast, it's handled same as stable
  • Newly installed clusters default to stable
```

```bash
# Switch channels
oc adm upgrade channel fast-4.20    # Get patches sooner
oc adm upgrade channel stable-4.20  # Wait for broader validation
oc adm upgrade channel eus-4.20     # For EUS-to-EUS updates

# Empty channel (disconnect from OSUS — air-gapped)
oc adm upgrade channel ""
```

### Update Process Workflow (Detailed)

```text
Step 1: Admin sets target version
        └─► spec.desiredUpdate.version in ClusterVersion CR

Step 2: CVO resolves version → release image pull spec
        └─► Uses OSUS graph data

Step 3: CVO validates release image integrity
        └─► Cryptographic signature verification (built-in public keys)

Step 4: CVO creates extraction Job
        └─► openshift-cluster-version/version-$version-$hash
        └─► Downloads release image, extracts manifests

Step 5: CVO validates extracted manifests + metadata

Step 6: CVO checks preconditions
        └─► Operators report Upgradeable=True/False
        └─► Blocks if critical precondition fails

Step 7: CVO records in status.desired + status.history

Step 8: CVO applies manifests in Runlevel order
        ├─► Runlevel 03: CRDs
        ├─► Runlevel 10: Core Operators
        ├─► Runlevel 15: CVO itself updates (pod restarts)
        ├─► Runlevel 20: kube-apiserver, kube-controller-manager
        ├─► Runlevel 25: Other Operators
        ├─► ...
        └─► Runlevel 90: MCO manifests (last)

        Between each Runlevel, CVO waits for ALL Operators to report:
        • Available=True
        • Degraded=False
        • Achieved desired version

Step 9: MCO updates nodes
        └─► Cordon → Drain → OS update → Reboot → Uncordon
        └─► maxUnavailable=1 (default, recommended)

Step 10: Cluster reports Updated
         └─► Control plane done; nodes may still be rolling
```

### Monitor Update Progress

```bash
# Overall progress
oc adm upgrade
# or
oc get clusterversion version

# Watch Operator status during update
oc get clusteroperators
# NAME                  VERSION   AVAILABLE   PROGRESSING   DEGRADED
# kube-apiserver        4.20.3    True        True          False     ← updating
# network               4.19.12   True        True          False     ← updating
# machine-config        4.19.12   True        False         False     ← waiting

# Detailed CVO status
oc get clusterversion version -o json | jq '.status.conditions[] |
  {type: .type, status: .status, message: .message}'

# Watch node updates (MCO phase)
oc get mcp
# NAME     CONFIG                          UPDATED   UPDATING   DEGRADED   MACHINECOUNT   READYMACHINECOUNT
# master   rendered-master-abc123          True      False      False      3              3
# worker   rendered-worker-def456          False     True       False      6              4

# Watch specific node progress
oc get nodes -o custom-columns=NAME:.metadata.name,STATUS:.status.conditions[-1].type,READY:.status.conditions[-1].status
```

### Runlevel Manifest Ordering

```bash
# Release image manifests are named:
# 0000_<runlevel>_<component>_<manifest-name>.yaml

# Extract and inspect release contents
oc adm release extract quay.io/openshift-release-dev/ocp-release:4.20.3-x86_64

# View ordering
ls | head -20
# 0000_03_authorization-openshift_01_rolebindingrestriction.crd.yaml
# 0000_03_config-operator_01_proxy.crd.yaml
# 0000_10_cluster-openshift-controller-manager_00_namespace.yaml
# 0000_20_kube-apiserver-operator_00_namespace.yaml
# 0000_25_kube-scheduler-operator_00_namespace.yaml
# 0000_50_cluster-ingress-operator_00_namespace.yaml
# 0000_90_machine-config_01_namespace.yaml

# Rules:
# 1. Lower Runlevel applied before higher
# 2. Within Runlevel: different components in parallel
# 3. Within component: lexicographic order
# 4. CVO waits for stability before next Runlevel
```

### Estimate Update Duration

```text
Formula:
  Update time = CVO phase + (node iterations × time per node)

CVO phase: 60-120 minutes (control plane Operators)

Node update time per node:
  • Cloud instances: 5-10 minutes (fast reboot)
  • Bare metal: 15-30 minutes (slow reboot + BIOS POST)

Node iterations = ceil(total_nodes / maxUnavailable)

Examples:
─────────────────────────────────────────────────────────────────
Cluster: 3 control + 6 compute, cloud, maxUnavailable=1
  = 60 min + (6 iterations × 5 min) = 90 minutes

Cluster: 3 control + 6 compute, cloud, maxUnavailable=2
  = 60 min + (3 iterations × 5 min) = 75 minutes

Cluster: 3 control + 20 compute, bare metal, maxUnavailable=1
  = 90 min + (20 iterations × 20 min) = 490 minutes (~8 hours)

Cluster: 3 control + 20 compute, bare metal, maxUnavailable=5
  = 90 min + (4 iterations × 20 min) = 170 minutes (~3 hours)
─────────────────────────────────────────────────────────────────
```

### MCO Node Update Sequence

```text
For each MachineConfigPool (master, worker):

  While nodes remain to update:
    1. Select up to maxUnavailable nodes
    2. Cordon selected nodes (no new workloads scheduled)
    3. Drain pods (respecting PodDisruptionBudgets)
    4. Apply new MachineConfig (OS + systemd + kubelet + CRI-O)
    5. Reboot node
    6. Node comes back Ready
    7. Uncordon node (workloads can schedule again)
    8. Repeat with next batch

  Node selection order:
    • Alphabetical by topology.kubernetes.io/zone
    • Within zone: oldest nodes first
    • No zones: oldest first
```

```bash
# Check MCP status during update
oc get mcp worker -o yaml | yq '.status'
# machineCount: 6
# readyMachineCount: 4
# updatedMachineCount: 4
# unavailableMachineCount: 1
# degradedMachineCount: 0

# See which node is currently updating
oc get nodes -l node-role.kubernetes.io/worker \
  -o custom-columns=NAME:.metadata.name,READY:.status.conditions[-1].status,SCHEDULABLE:.spec.unschedulable
```

### Conditional Updates (Known Risks)

```bash
# View conditional updates with risk details
oc get clusterversion version -o json | jq '.status.conditionalUpdates[] | {
  version: .release.version,
  recommended: .conditions[0].status,
  reason: .conditions[0].reason,
  message: .conditions[0].message
}'

# Example output:
# {
#   "version": "4.20.2",
#   "recommended": "False",
#   "reason": "MultipleReasons",
#   "message": "In Azure clusters with user-provisioned registry storage..."
# }

# Risk evaluation: CVO continuously checks if YOUR cluster matches risk criteria
# If no match → appears in availableUpdates (recommended)
# If matches → appears in conditionalUpdates (known issues)
# You can still update — it's informational, not blocking (unless Upgradeable=False)
```

### ClusterOperator Condition Types

```bash
# Check all operator conditions
oc get co -o json | jq '.items[] | {
  name: .metadata.name,
  available: (.status.conditions[] | select(.type=="Available") | .status),
  progressing: (.status.conditions[] | select(.type=="Progressing") | .status),
  degraded: (.status.conditions[] | select(.type=="Degraded") | .status),
  upgradeable: (.status.conditions[] | select(.type=="Upgradeable") | .status)
}'
```

```text
Condition Types:
───────────────────────────────────────────────────────────────────
Available=True    Operator is functional (False = admin intervention needed)
Progressing=True  Operator is rolling out changes (normal during update)
Degraded=True     Persistent issue requiring attention (not transient)
Upgradeable=False Operator says cluster shouldn't update (blocks minor updates)
───────────────────────────────────────────────────────────────────

ClusterVersion Condition Types:
───────────────────────────────────────────────────────────────────
Failing           Cannot reach desired state (unhealthy)
Invalid           Error prevents CVO from taking action
RetrievedUpdates  Successfully fetched update graph from OSUS
ReleaseAccepted   Release payload loaded and verified successfully
───────────────────────────────────────────────────────────────────
```

### EUS-to-EUS Updates (Control Plane Only)

```bash
# EUS versions: 4.14, 4.16, 4.18, 4.20 (even minor versions)
# Skip intermediate minor for worker nodes

# 1. Pause worker MCP
oc patch mcp/worker --type merge --patch '{"spec":{"paused":true}}'

# 2. Update control plane through intermediate version
oc adm upgrade channel eus-4.20
oc adm upgrade --to=4.19.latest   # intermediate
# Wait for control plane...
oc adm upgrade --to=4.20.latest   # target EUS

# 3. Resume worker MCP (nodes update directly to 4.20)
oc patch mcp/worker --type merge --patch '{"spec":{"paused":false}}'

# Benefit: Workers reboot only ONCE (not twice)
```

## Common Issues

### Update stuck at "Progressing" for >2 hours
- **Cause**: An Operator can't reach stable state (often kube-apiserver graceful termination)
- **Fix**: Check `oc get co` for Progressing=True operators; inspect their logs

### Node stuck in "SchedulingDisabled" after update
- **Cause**: MCO drain stuck on pod with restrictive PDB
- **Fix**: Check `oc get pods --field-selector=status.phase=Pending`; review PDBs

### "Upgradeable=False" blocking update
- **Cause**: An Operator detected a condition preventing safe update
- **Fix**: Run `oc get co <operator> -o json | jq '.status.conditions[] | select(.type=="Upgradeable")'` to see message

### Update not available in channel
- **Cause**: Release not yet promoted to stable; or conditional risk blocks recommendation
- **Fix**: Switch to fast channel; or use `--include-not-recommended` to see all options

### MCO Degraded after node reboot
- **Cause**: Node failed to apply new machine config (disk full, kernel panic, etc.)
- **Fix**: SSH to node; check `journalctl -u machine-config-daemon`; may need to `oc debug node/`

## Best Practices

1. **Use stable channel for production** — fast only when you need specific fixes immediately
2. **Never change maxUnavailable for control plane** — keep at 1 (sequential)
3. **Check Upgradeable conditions before starting** — `oc adm upgrade` shows blockers
4. **Monitor PDBs before update** — restrictive PDBs cause drain timeouts
5. **Ensure all nodes are Ready** — unavailable nodes delay the entire update
6. **EUS-to-EUS for large clusters** — saves one full reboot cycle for all workers
7. **Test in non-production first** — use fast channel in staging, stable in production
8. **Plan maintenance windows** — estimate with formula: CVO time + (iterations × node time)

## Key Takeaways

- OpenShift updates = CVO phase (Operators in Runlevels) + MCO phase (node OS/config)
- CVO applies manifests in dependency order (Runlevel 03 → 90); waits for stability between levels
- MCO updates nodes one-by-one: cordon → drain → update → reboot → uncordon
- Four channels: candidate (testing), fast (GA immediate), stable (GA delayed), eus (skip minors)
- Conditional updates: OSUS evaluates cluster-specific risks and flags known issues
- Duration estimate: 60-120 min CVO + (nodes/maxUnavailable × reboot time)
- Default maxUnavailable=1 for both pools — increase compute only, never control plane
- EUS-to-EUS: pause workers, update control plane through intermediate, resume = one reboot
- ClusterOperator conditions (Available/Progressing/Degraded/Upgradeable) drive update flow
