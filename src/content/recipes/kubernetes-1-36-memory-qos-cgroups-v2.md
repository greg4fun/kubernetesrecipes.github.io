---
title: "Kubernetes 1.36 Memory QoS with cgroups v2"
description: "Configure memory quality of service with cgroups v2 in Kubernetes 1.36. Set memory.min and memory.high for guaranteed memory and throttling before OOM kills."
tags:
  - "kubernetes-1.36"
  - "memory"
  - "cgroups"
  - "qos"
  - "performance"
category: "configuration"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-resource-limits-cpu-memory-format"
  - "oom-killed-troubleshooting"
  - "kubernetes-pod-priority-preemption"
---

> 💡 **Quick Answer:** Kubernetes 1.36 enhances **Memory QoS with cgroups v2** (KEP-2570). The kubelet now sets `memory.min` (guaranteed memory) and `memory.high` (throttle before OOM) cgroup parameters, providing graceful memory pressure handling instead of sudden OOM kills.

## The Problem

With cgroups v1, memory management is binary:
- Under the limit → fine
- Over the limit → **OOM killed immediately**

There's no middle ground. No warning. No throttling. Applications go from "working" to "dead" with no chance to shed load or free caches.

## The Solution

cgroups v2 introduces `memory.min`, `memory.low`, and `memory.high` for graduated memory management:

```
memory.min  → Guaranteed minimum (never reclaimed)
memory.low  → Best-effort protection (reclaimed under extreme pressure)
memory.high → Throttling threshold (slow down before OOM)
memory.max  → Hard limit (OOM kill)
```

### How Kubernetes Maps Resources to cgroups v2

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: memory-qos-demo
spec:
  containers:
    - name: app
      image: registry.example.com/app:v3.0
      resources:
        requests:
          memory: "1Gi"     # → memory.min = 1Gi (guaranteed)
        limits:
          memory: "4Gi"     # → memory.max = 4Gi (hard limit)
                            # → memory.high = ~3.6Gi (auto-calculated)
```

The kubelet automatically sets:
- `memory.min` = requests (guaranteed, never reclaimed)
- `memory.high` = ~90% of limits (throttle zone)
- `memory.max` = limits (hard OOM boundary)

### Verify cgroup Settings

```bash
# Check the container's cgroup parameters
kubectl exec memory-qos-demo -- cat /sys/fs/cgroup/memory.min
# 1073741824 (1Gi)

kubectl exec memory-qos-demo -- cat /sys/fs/cgroup/memory.high
# 3865470566 (~3.6Gi)

kubectl exec memory-qos-demo -- cat /sys/fs/cgroup/memory.max
# 4294967296 (4Gi)

# Check current memory usage
kubectl exec memory-qos-demo -- cat /sys/fs/cgroup/memory.current
```

### QoS Class Mapping

```yaml
# Guaranteed Pod (requests == limits)
# memory.min = memory.max = 4Gi
# memory.high = max (no throttling, direct OOM at limit)
resources:
  requests:
    memory: "4Gi"
  limits:
    memory: "4Gi"

# Burstable Pod (requests < limits)
# memory.min = 1Gi, memory.high = ~3.6Gi, memory.max = 4Gi
# Throttled between 3.6-4Gi, OOM killed at 4Gi
resources:
  requests:
    memory: "1Gi"
  limits:
    memory: "4Gi"

# BestEffort Pod (no requests/limits)
# memory.min = 0, memory.high = max, memory.max = max
# First to be reclaimed under node pressure
```

### Node-Level Configuration

```yaml
# Kubelet configuration
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
featureGates:
  MemoryQoS: true
cgroupDriver: systemd    # cgroups v2 required
memoryThrottlingFactor: 0.9    # memory.high = 90% of limit (default)
```

### Monitor Memory Throttling

```bash
# Check if container is being throttled (not OOM killed)
kubectl exec memory-qos-demo -- cat /sys/fs/cgroup/memory.events
# high 142    ← number of times memory.high was hit (throttled)
# max 0       ← number of times memory.max was hit (would OOM)
# oom 0       ← actual OOM kills
# oom_kill 0

# Prometheus metrics
container_memory_high_events_total    # Times throttled
container_memory_max_events_total     # Times at OOM boundary
```

### Behavior Under Memory Pressure

```
Memory Usage Timeline:
────────────────────────────────────────────────────
0                 1Gi              3.6Gi         4Gi
│    Normal        │   Protected    │  Throttled  │ OOM
│                  │   (min)        │  (high)     │ (max)
│ Can be reclaimed │ Never reclaimed│ Slowed down │ Killed
────────────────────────────────────────────────────
```

## Common Issues

### Node using cgroups v1
- **Cause**: Older kernel or bootloader config
- **Fix**: Add `systemd.unified_cgroup_hierarchy=1` to kernel boot parameters

### Memory throttling too aggressive
- **Cause**: `memoryThrottlingFactor` too low
- **Fix**: Increase from 0.9 to 0.95 in kubelet config

### Container OOM killed without throttling
- **Cause**: Memory spike too fast to throttle (bypasses `memory.high`)
- **Fix**: Set `memory.high` lower or increase limits; fast allocations can jump past high

## Best Practices

1. **Use cgroups v2** — required for memory QoS; most modern distros default to v2
2. **Set requests < limits for burstable** — enables the throttling zone
3. **Monitor `memory.events`** — `high` count shows throttling frequency
4. **Tune `memoryThrottlingFactor`** — 0.8-0.95 depending on workload sensitivity
5. **Alert on high throttle counts** — indicates the container needs more memory

## Key Takeaways

- Memory QoS with cgroups v2 progresses in **Kubernetes 1.36** (KEP-2570)
- `memory.min` guarantees memory is never reclaimed (backed by requests)
- `memory.high` throttles containers before OOM kill (graceful degradation)
- Applications get slowed down instead of instantly killed
- Requires cgroups v2 and `MemoryQoS` feature gate enabled
