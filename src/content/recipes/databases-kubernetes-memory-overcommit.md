---
title: "Databases on K8s: Memory Overcommit"
description: "Why vm.overcommit_memory must be disabled for production databases on Kubernetes. Configure guaranteed QoS, disable swap."
publishDate: "2026-04-22"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "18 minutes"
kubernetesVersion: "1.28+"
tags:
  - databases
  - memory
  - overcommit
  - oom
  - postgresql
  - redis
  - production
relatedRecipes:
  - "mariadb-scc-openshift-deployment"
  - "kubernetes-resource-limits-cpu-memory-format"
  - "kubernetes-limit-range-defaults"
  - "kubernetes-pod-disruption-budget-guide"
  - "openshift-machineconfig-mcp-guide"
---

> 💡 **Quick Answer:** Set `vm.overcommit_memory=2` on database nodes so the kernel never promises more memory than is physically available. Combine with Guaranteed QoS (requests = limits), disabled swap, and HugePages to prevent OOM kills that corrupt data.

## The Problem

Linux defaults to `vm.overcommit_memory=0` (heuristic overcommit), meaning the kernel can promise more memory than exists. This works for general workloads but is catastrophic for databases:

- **PostgreSQL** forks a process per connection — each fork inherits the parent's memory map. With overcommit, the kernel promises memory it can't back, then OOM-kills the postmaster when pages are actually touched.
- **Redis** uses `fork()` for background saves (RDB/AOF rewrite). With overcommit, the fork succeeds but the COW pages trigger OOM during the save — killing Redis mid-persistence.
- **MySQL/MariaDB InnoDB** pre-allocates buffer pool at startup. Overcommit lets it "succeed" even when memory is insufficient — then OOM kills during peak query load.

On Kubernetes, this is amplified because:
- Multiple pods share node memory — overcommit lets them collectively exceed physical RAM
- Burstable QoS (requests < limits) actively relies on overcommit
- The OOM killer picks victims by score — your database may not be the biggest consumer but gets killed anyway
- Database OOM during writes can corrupt WAL, crash-recovery fails, data loss

## The Solution

### Step 1: Disable Memory Overcommit on Database Nodes

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-worker-db-no-overcommit
  labels:
    machineconfiguration.openshift.io/role: db-worker
spec:
  config:
    ignition:
      version: 3.2.0
    storage:
      files:
        - path: /etc/sysctl.d/99-no-overcommit.conf
          mode: 0644
          overwrite: true
          contents:
            source: data:text/plain;charset=utf-8,vm.overcommit_memory%3D2%0Avm.overcommit_ratio%3D80%0Avm.swappiness%3D0%0A
```

The sysctl values:

```ini
# /etc/sysctl.d/99-no-overcommit.conf
vm.overcommit_memory=2    # Never overcommit: allocations fail if CommitLimit exceeded
vm.overcommit_ratio=80    # CommitLimit = RAM * 80% + swap (set ratio to leave room for OS)
vm.swappiness=0           # Don't swap — databases should never touch swap
```

For non-OpenShift clusters, use a DaemonSet:

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: sysctl-db-nodes
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: sysctl-db-nodes
  template:
    metadata:
      labels:
        app: sysctl-db-nodes
    spec:
      nodeSelector:
        node-role.kubernetes.io/database: "true"
      hostPID: true
      initContainers:
        - name: sysctl
          image: busybox:1.36
          securityContext:
            privileged: true
          command:
            - sh
            - -c
            - |
              sysctl -w vm.overcommit_memory=2
              sysctl -w vm.overcommit_ratio=80
              sysctl -w vm.swappiness=0
              echo "Memory overcommit disabled"
      containers:
        - name: pause
          image: registry.k8s.io/pause:3.9
          resources:
            requests:
              cpu: 1m
              memory: 1Mi
```

Or via pod-level `securityContext.sysctls` (limited — only namespaced sysctls):

```yaml
# NOTE: vm.overcommit_memory is NOT a namespaced sysctl
# It can ONLY be set at the node level
# Pod-level sysctls only work for net.* params
```

### Step 2: Guaranteed QoS for Database Pods

Set requests = limits to get Guaranteed QoS class (last to be OOM-killed):

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgresql
  namespace: databases
spec:
  serviceName: postgresql
  replicas: 3
  selector:
    matchLabels:
      app: postgresql
  template:
    spec:
      containers:
        - name: postgres
          image: postgres:16
          resources:
            requests:
              cpu: "4"
              memory: 16Gi
            limits:
              cpu: "4"        # requests = limits = Guaranteed QoS
              memory: 16Gi    # requests = limits = Guaranteed QoS
          env:
            - name: POSTGRES_SHARED_BUFFERS
              value: "4GB"     # ~25% of container memory
            - name: POSTGRES_EFFECTIVE_CACHE_SIZE
              value: "12GB"    # ~75% of container memory
            - name: POSTGRES_WORK_MEM
              value: "64MB"
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 100Gi
```

### Step 3: Redis with Overcommit Warning Suppressed

Redis checks overcommit and warns — but the real fix is node-level:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: databases
spec:
  serviceName: redis
  replicas: 3
  selector:
    matchLabels:
      app: redis
  template:
    spec:
      containers:
        - name: redis
          image: redis:7.4
          command:
            - redis-server
            - --maxmemory
            - "12gb"
            - --maxmemory-policy
            - "allkeys-lru"
            - --save
            - "900 1"      # RDB save: every 900s if ≥1 key changed
            - --save
            - "300 100"
          resources:
            requests:
              cpu: "2"
              memory: 16Gi
            limits:
              cpu: "2"
              memory: 16Gi    # Guaranteed QoS
          volumeMounts:
            - name: data
              mountPath: /data
      initContainers:
        - name: disable-thp
          image: busybox:1.36
          securityContext:
            privileged: true
          command:
            - sh
            - -c
            - |
              echo never > /sys/kernel/mm/transparent_hugepage/enabled
              echo never > /sys/kernel/mm/transparent_hugepage/defrag
          volumeMounts:
            - name: sys
              mountPath: /sys
      volumes:
        - name: sys
          hostPath:
            path: /sys
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 50Gi
```

### Step 4: HugePages for Database Performance

HugePages are pre-allocated and exempt from overcommit — the memory is physically reserved:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: postgres-hugepages
spec:
  containers:
    - name: postgres
      image: postgres:16
      resources:
        requests:
          cpu: "4"
          memory: 16Gi
          hugepages-2Mi: 4Gi     # 4GB of 2MB HugePages for shared_buffers
        limits:
          cpu: "4"
          memory: 16Gi
          hugepages-2Mi: 4Gi
      env:
        - name: POSTGRES_SHARED_BUFFERS
          value: "4GB"
        - name: POSTGRES_HUGE_PAGES
          value: "on"
      volumeMounts:
        - name: hugepage
          mountPath: /dev/hugepages
  volumes:
    - name: hugepage
      emptyDir:
        medium: HugePages-2Mi
```

Allocate HugePages on the node:

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-worker-db-hugepages
  labels:
    machineconfiguration.openshift.io/role: db-worker
spec:
  kernelArguments:
    - hugepagesz=2M
    - hugepages=2048    # 2048 × 2MB = 4GB pre-reserved
```

### Understanding Overcommit Modes

| Mode | `vm.overcommit_memory` | Behavior | Database Safety |
|------|----------------------|----------|-----------------|
| Heuristic | `0` (default) | Kernel guesses if allocation is "reasonable" | ❌ Dangerous — fork() succeeds then OOM kills |
| Always | `1` | Never refuse allocations | ❌ Worst — guarantees OOM under pressure |
| Never | `2` | Refuse if total commit > CommitLimit | ✅ Safe — allocation fails cleanly, app handles it |

CommitLimit formula: `CommitLimit = (RAM × overcommit_ratio/100) + swap`

Example: 64GB RAM, `overcommit_ratio=80`, no swap → CommitLimit = 51.2GB

### Step 5: Verify Configuration

```bash
# Check overcommit settings on a node
kubectl debug node/db-worker-01 -- chroot /host bash -c '
echo "=== Memory Overcommit ==="
cat /proc/sys/vm/overcommit_memory    # Should be 2
cat /proc/sys/vm/overcommit_ratio     # Should be 80
cat /proc/sys/vm/swappiness           # Should be 0

echo "=== Commit Limit ==="
grep -E "CommitLimit|Committed_AS|MemTotal|SwapTotal" /proc/meminfo

echo "=== HugePages ==="
grep -i huge /proc/meminfo

echo "=== THP ==="
cat /sys/kernel/mm/transparent_hugepage/enabled
'
```

```bash
# Check QoS class of database pods
kubectl get pod -n databases -o custom-columns=\
NAME:.metadata.name,\
QOS:.status.qosClass,\
REQ_MEM:.spec.containers[0].resources.requests.memory,\
LIM_MEM:.spec.containers[0].resources.limits.memory
```

### Step 6: PodDisruptionBudget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: postgresql-pdb
  namespace: databases
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: postgresql
```

```mermaid
graph TD
    subgraph Node: vm.overcommit_memory=0 DEFAULT
        A1[Pod A: 8GB limit] 
        A2[Pod B: 8GB limit]
        A3[Pod C: 8GB limit]
        A4[Total promised: 24GB]
        A5[Physical RAM: 16GB]
        A4 -->|Overcommit!| OOM[OOM Killer<br/>Picks a victim]
        OOM -->|Kills| DB[Database Pod 💀]
    end
    
    subgraph Node: vm.overcommit_memory=2 SAFE
        B1[Pod A: 8GB Guaranteed]
        B2[Pod B: 8GB Guaranteed]
        B3[Pod C: Rejected ✗<br/>CommitLimit exceeded]
        B4[Physical RAM: 16GB]
        B1 --> SAFE[Database Safe ✓]
        B2 --> SAFE
    end
```

## Common Issues

**Redis: `WARNING overcommit_memory is set to 0`**

Redis detects overcommit mode at startup. Fix at node level:
```
vm.overcommit_memory=2
```
Redis also warns about THP — disable with init container (see Redis example above).

**PostgreSQL: `could not fork new process for connection`**

With `overcommit_memory=2`, fork may fail if CommitLimit is reached. This is **correct behavior** — it's better than OOM-killing the postmaster. Solutions:
- Increase `overcommit_ratio` (e.g., 90 if no swap)
- Use connection pooling (PgBouncer) to reduce fork count
- Reduce `max_connections`

**MySQL InnoDB: `Cannot allocate memory for the buffer pool`**

InnoDB can't allocate buffer pool at startup. The allocation fails cleanly instead of succeeding then OOM-killing later. Reduce `innodb_buffer_pool_size` to fit within CommitLimit.

**Pod evicted despite Guaranteed QoS**

Guaranteed QoS makes the pod the last OOM victim, but if the node runs out of memory, even Guaranteed pods can be evicted. Solutions:
- Dedicate nodes to databases (taint + toleration)
- Set `overcommit_ratio` to leave headroom for OS (80% not 100%)
- Reserve resources with `--system-reserved` and `--kube-reserved` kubelet flags

**`vm.overcommit_memory` can't be set in pod securityContext**

Correct — `vm.overcommit_memory` is a global (non-namespaced) sysctl. It must be set at the node level via MachineConfig, DaemonSet, or node provisioning.

## Best Practices

- **Set `vm.overcommit_memory=2`** on all database nodes — never rely on heuristic overcommit
- **Set `overcommit_ratio=80`** to reserve 20% for OS, kubelet, and system pods
- **Disable swap** (`vm.swappiness=0`) — databases should never swap (latency explosion)
- **Use Guaranteed QoS** (requests = limits) — OOM killer targets Burstable/BestEffort first
- **Dedicate nodes** to databases with taints/tolerations — prevent noisy neighbors
- **Use HugePages** for PostgreSQL `shared_buffers` and Redis — physically reserved, exempt from overcommit
- **Disable THP** (Transparent HugePages) — causes latency spikes during defragmentation
- **Connection pooling** (PgBouncer, ProxySQL) reduces per-connection memory from forking
- **PDB minAvailable** for HA — prevent draining both replicas during maintenance
- **Monitor `Committed_AS` vs `CommitLimit`** — alert when approaching the limit
- **Size containers precisely** — oversizing wastes reserved memory; undersizing causes allocation failures

## Key Takeaways

- `vm.overcommit_memory=0` (default) lets the kernel promise more memory than exists — databases die
- `vm.overcommit_memory=2` makes allocation fail cleanly instead of OOM-killing later — databases survive
- Redis `fork()` for RDB/AOF and PostgreSQL `fork()` per connection are the main overcommit victims
- Guaranteed QoS (requests = limits) is necessary but not sufficient — node-level overcommit still matters
- HugePages are physically reserved at boot — immune to overcommit and fragmentation
- `vm.overcommit_memory` is a node-level global sysctl — cannot be set per-pod
- CommitLimit = (RAM × overcommit_ratio/100) + swap — set ratio to leave headroom
- Disable swap AND THP for database workloads — both cause unpredictable latency
- Connection pooling reduces memory pressure from fork-per-connection models
- The goal: allocations fail fast (app handles gracefully) rather than succeed then OOM-kill (data corruption)
