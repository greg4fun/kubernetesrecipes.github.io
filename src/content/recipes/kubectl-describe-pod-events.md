---
title: "kubectl describe: Read Pod Events Guide"
description: "Use kubectl describe pod to read events, conditions, and container states. Diagnose scheduling failures, image pulls, crashes, and probe failures."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "troubleshooting"
  - "events"
  - "cka"
  - "pods"
relatedRecipes:
  - "kubectl-get-pods-examples"
  - "debug-scheduling-failures"
  - "imagepullbackoff-troubleshooting"
  - "debug-oom-killed"
  - "kubectl-exec-into-pod"
---

> 💡 **Quick Answer:** `kubectl describe pod <name>` shows the full pod lifecycle: container states, conditions, events, resource requests, volumes, and node assignment. Scroll to the **Events** section at the bottom for the diagnostic gold — it shows scheduling decisions, image pulls, container starts, probe failures, and OOM kills in chronological order.

## The Problem

`kubectl get pods` shows status but not *why*:

```
NAME      READY   STATUS             RESTARTS   AGE
my-pod    0/1     CrashLoopBackOff   5          3m
```

What crashed? Why? When? You need `kubectl describe` for the full story.

## The Solution

### Read the Events Section

```bash
kubectl describe pod my-pod

# Scroll to the bottom:
# Events:
#   Type     Reason     Age   From               Message
#   ----     ------     ----  ----               -------
#   Normal   Scheduled  3m    default-scheduler  Successfully assigned default/my-pod to worker-1
#   Normal   Pulling    3m    kubelet            Pulling image "myapp:latest"
#   Normal   Pulled     2m    kubelet            Successfully pulled image
#   Normal   Created    2m    kubelet            Created container my-app
#   Normal   Started    2m    kubelet            Started container my-app
#   Warning  Unhealthy  1m    kubelet            Readiness probe failed: HTTP probe failed with statuscode: 503
#   Warning  BackOff    30s   kubelet            Back-off restarting failed container
```

### Common Event Patterns

**Scheduling failure:**
```
Warning  FailedScheduling  default-scheduler  0/3 nodes are available:
  1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane:},
  2 node(s) didn't match Pod's node affinity/selector
```

**Image pull failure:**
```
Warning  Failed     kubelet  Failed to pull image "myapp:v2": rpc error:
  code = NotFound desc = failed to pull and unpack image: not found
Warning  Failed     kubelet  Error: ImagePullBackOff
```

**OOM Kill:**
```
Warning  OOMKilling  kubelet  Memory cgroup out of memory: Killed process 12345
Normal   Killing     kubelet  Stopping container my-app
```

**Probe failure:**
```
Warning  Unhealthy  kubelet  Liveness probe failed: HTTP probe failed with statuscode: 500
Normal   Killing    kubelet  Container my-app failed liveness probe, will be restarted
```

### Key Sections in Describe Output

```bash
kubectl describe pod my-pod

# 1. Metadata
# Name, Namespace, Node, Labels, Annotations

# 2. Status & Conditions
# Status:    Running
# Conditions:
#   Type              Status
#   Initialized       True
#   Ready             False    ← Pod not serving traffic
#   ContainersReady   False
#   PodScheduled      True

# 3. Container Details
# Container ID, Image, State (Running/Waiting/Terminated)
# Last State: Terminated (exit code, reason, signal)
# Restart Count, Resource Requests/Limits
# Liveness/Readiness probe config
# Environment variables, Mounts

# 4. Volumes
# ConfigMap, Secret, PVC references

# 5. Events (most recent last)
# Chronological lifecycle events
```

### Describe Other Resources

```bash
# Node (capacity, allocatable, conditions, taints)
kubectl describe node worker-1

# Service (endpoints, selector matches)
kubectl describe svc my-service

# Deployment (replicas, rollout status, events)
kubectl describe deployment my-app

# PVC (bound status, storage class, events)
kubectl describe pvc my-data

# Events only (all namespace events)
kubectl get events --sort-by='.lastTimestamp'
kubectl get events -A --field-selector reason=FailedScheduling
```

### Scripting with Events

```bash
# Get events as JSON for automation
kubectl get events -o json | jq '.items[] | select(.reason == "OOMKilling") | {pod: .involvedObject.name, time: .lastTimestamp}'

# Watch events in real time
kubectl get events -w

# Events for a specific pod
kubectl get events --field-selector involvedObject.name=my-pod
```

## Common Issues

**"Events: <none>"**

Events expire after 1 hour by default. If the pod has been running longer, events may have been garbage collected. Check `kubectl get events` for recent cluster events.

**Describe shows "Pending" with no events**

Scheduler hasn't processed the pod yet. Wait a few seconds — if still no events, the scheduler may be overloaded or down.

**Multiple containers — which one failed?**

Each container has its own section in describe output with individual State, Last State, and Restart Count.

## Best Practices

- **Always read Events section first** — it tells the chronological story
- **Check Conditions for Ready/NotReady** — explains why traffic isn't routing
- **Compare Requests vs Node capacity** — for scheduling failures
- **Use `kubectl get events --sort-by`** for cluster-wide troubleshooting
- **`kubectl logs <pod> --previous`** complements describe — events show *what*, logs show *why*

## Key Takeaways

- `kubectl describe pod` is the primary troubleshooting command
- Events section at the bottom shows the complete lifecycle chronology
- Common patterns: FailedScheduling, ImagePullBackOff, OOMKilling, probe failures
- Events expire after 1 hour — check quickly after issues occur
- Combine with `kubectl logs --previous` for full diagnosis
