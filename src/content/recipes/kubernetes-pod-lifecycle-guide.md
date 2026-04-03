---
title: "Kubernetes Pod Lifecycle and States Explained"
description: "Understand the Kubernetes pod lifecycle from Pending to Terminated. Covers pod phases, container states, restart policies, graceful shutdown, and preStop hooks."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-04-03"
tags: ["pod-lifecycle", "phases", "graceful-shutdown", "prestop", "kubernetes"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Understand the Kubernetes pod lifecycle from Pending to Terminated. Covers pod phases, container states, restart policies, graceful shutdown, and preStop hooks.

## The Problem

This is one of the most searched Kubernetes topics. Having a comprehensive, well-structured guide helps both beginners and experienced users quickly find what they need.

## The Solution

### Pod Phases

| Phase | Description |
|-------|-------------|
| **Pending** | Pod accepted, waiting for scheduling or image pull |
| **Running** | At least one container is running |
| **Succeeded** | All containers exited with code 0 |
| **Failed** | All containers terminated, at least one with non-zero exit |
| **Unknown** | Node communication lost |

### Container States

```bash
# Check container state
kubectl get pod <name> -o jsonpath='{.status.containerStatuses[0].state}'

# States: Waiting, Running, Terminated
# Waiting reasons: ContainerCreating, CrashLoopBackOff, ImagePullBackOff, PodInitializing
# Terminated reasons: Completed, Error, OOMKilled
```

### Graceful Shutdown

```yaml
apiVersion: v1
kind: Pod
spec:
  terminationGracePeriodSeconds: 60    # Default: 30
  containers:
    - name: app
      image: my-app:v1
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 5 && /app/shutdown.sh"]
        # preStop runs BEFORE SIGTERM is sent
```

Shutdown sequence:
1. Pod marked for deletion
2. Removed from Service endpoints (no new traffic)
3. `preStop` hook runs
4. `SIGTERM` sent to container
5. Wait `terminationGracePeriodSeconds`
6. `SIGKILL` if still running

### Restart Policies

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `Always` | Restart on any exit (default) | Deployments, StatefulSets |
| `OnFailure` | Restart only on non-zero exit | Jobs |
| `Never` | Never restart | Jobs (debug with logs) |

### Init → Sidecar → Main Container Ordering

```mermaid
graph LR
    A[Pod Created] --> B[Init Container 1]
    B --> C[Init Container 2]
    C --> D[Sidecar starts]
    D --> E[Main Container starts]
    E --> F[Running]
    F -->|Termination| G[preStop hook]
    G --> H[SIGTERM]
    H --> I[Grace period]
    I --> J[SIGKILL if needed]
```

## Frequently Asked Questions

### Why is my pod stuck in Pending?

Common reasons: insufficient CPU/memory on nodes, no nodes match nodeSelector/affinity, PVC not bound, taints without tolerations. Run `kubectl describe pod` and check the Events section.

### What is the difference between pod phase and container state?

Pod phase is the overall pod status. Container state is per-container. A pod can be Running while one container is in CrashLoopBackOff (if there are other running containers).

## Best Practices

- **Start simple** — use the basic form first, add complexity as needed
- **Be consistent** — follow naming conventions across your cluster
- **Document your choices** — add annotations explaining why, not just what
- **Monitor and iterate** — review configurations regularly

## Key Takeaways

- This is fundamental Kubernetes knowledge every engineer needs
- Start with the simplest approach that solves your problem
- Use `kubectl explain` and `kubectl describe` when unsure
- Practice in a test cluster before applying to production
