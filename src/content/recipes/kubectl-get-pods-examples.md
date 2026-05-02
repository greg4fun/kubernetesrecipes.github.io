---
title: "kubectl get pods: Output Formats Guide"
description: "Master kubectl get pods with output formats, label selectors, field selectors, and custom columns. Wide output, JSON, YAML, and jsonpath examples."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "pods"
  - "cka"
  - "troubleshooting"
relatedRecipes:
  - "kubectl-run-pod-command"
  - "kubernetes-labels-best-practices"
  - "record-kubectl-sessions-kubernetes"
---

> 💡 **Quick Answer:** `kubectl get pods` lists pods in the current namespace. Add `-o wide` for node/IP info, `-o yaml` for full spec, `-l app=nginx` for label filtering, `--all-namespaces` for cluster-wide view, and `--field-selector status.phase=Running` for phase filtering. Use `-o jsonpath='{.items[*].metadata.name}'` to extract specific fields.

## The Problem

Default `kubectl get pods` output is limited:

- Doesn't show which node pods run on
- Can't filter by status, label, or field efficiently
- No easy way to extract specific fields for scripting
- Custom columns require knowing the syntax

## The Solution

### Basic Output Formats

```bash
# Default table output
kubectl get pods
# NAME      READY   STATUS    RESTARTS   AGE
# nginx-1   1/1     Running   0          5m

# Wide output (node, IP, nominated node)
kubectl get pods -o wide
# NAME      READY   STATUS    RESTARTS   AGE   IP           NODE
# nginx-1   1/1     Running   0          5m    10.244.1.5   worker-1

# YAML output (full spec)
kubectl get pod nginx-1 -o yaml

# JSON output
kubectl get pod nginx-1 -o json

# Just pod names
kubectl get pods -o name
# pod/nginx-1
# pod/nginx-2
```

### Label Selectors

```bash
# Filter by label
kubectl get pods -l app=nginx
kubectl get pods -l 'app in (nginx, apache)'
kubectl get pods -l 'app!=redis'
kubectl get pods -l 'tier=frontend,app=nginx'

# Show labels in output
kubectl get pods --show-labels
# NAME      READY   STATUS    RESTARTS   AGE   LABELS
# nginx-1   1/1     Running   0          5m    app=nginx,tier=frontend

# Filter by label existence
kubectl get pods -l 'app'          # has label 'app'
kubectl get pods -l '!canary'      # doesn't have label 'canary'
```

### Field Selectors

```bash
# Running pods only
kubectl get pods --field-selector status.phase=Running

# Pods on a specific node
kubectl get pods --field-selector spec.nodeName=worker-1

# Not in Succeeded phase
kubectl get pods --field-selector status.phase!=Succeeded

# Combine field selectors
kubectl get pods --field-selector 'status.phase=Running,spec.nodeName=worker-1'

# All namespaces, failed pods
kubectl get pods -A --field-selector status.phase=Failed
```

### JSONPath Queries

```bash
# Get pod IPs
kubectl get pods -o jsonpath='{.items[*].status.podIP}'
# 10.244.1.5 10.244.2.3

# Pod names and their nodes
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.nodeName}{"\n"}{end}'

# Container images per pod
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.containers[*].image}{"\n"}{end}'

# Restart counts
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}: {.status.containerStatuses[0].restartCount}{"\n"}{end}'

# Pods with high restart count
kubectl get pods -o json | jq '.items[] | select(.status.containerStatuses[0].restartCount > 5) | .metadata.name'
```

### Custom Columns

```bash
# Define custom columns
kubectl get pods -o custom-columns=\
NAME:.metadata.name,\
STATUS:.status.phase,\
NODE:.spec.nodeName,\
IP:.status.podIP

# From a file
cat <<EOF > columns.txt
NAME          RESTARTS                                         NODE
metadata.name status.containerStatuses[0].restartCount         spec.nodeName
EOF
kubectl get pods -o custom-columns-file=columns.txt
```

### Sorting and Counting

```bash
# Sort by restart count
kubectl get pods --sort-by='.status.containerStatuses[0].restartCount'

# Sort by creation time
kubectl get pods --sort-by='.metadata.creationTimestamp'

# Sort by node
kubectl get pods --sort-by='.spec.nodeName'

# Count pods by status
kubectl get pods -A --no-headers | awk '{print $4}' | sort | uniq -c | sort -rn
#  142 Running
#    5 Pending
#    2 CrashLoopBackOff
```

### Watch Mode

```bash
# Watch pod changes in real time
kubectl get pods -w

# Watch with wide output
kubectl get pods -o wide -w

# Watch specific pod
kubectl get pod nginx-1 -w
```

### All Namespaces

```bash
# All pods across all namespaces
kubectl get pods -A
kubectl get pods --all-namespaces

# System pods
kubectl get pods -n kube-system

# Count per namespace
kubectl get pods -A --no-headers | awk '{print $1}' | sort | uniq -c | sort -rn
```

## Common Issues

**"No resources found" but pods exist**

Wrong namespace. Use `-n <namespace>` or `-A` for all namespaces.

**jsonpath returns empty**

Check field path with `kubectl get pod <name> -o yaml` first. Common mistake: using `status.containerStatuses` on pods that haven't started yet.

**Custom columns showing `<none>`**

Field doesn't exist for that pod. Use `jsonpath` with `?(@.field)` for conditional access.

## Best Practices

- **Use `-o wide` by default** — node and IP info helps debugging
- **Label everything** — enables powerful `-l` filtering
- **`-A` for cluster overview** — see pods across all namespaces
- **`--sort-by` for troubleshooting** — find highest restart counts or oldest pods
- **Pipe to `jq`** for complex filtering — more flexible than jsonpath

## Key Takeaways

- `-o wide` adds node name, pod IP, and readiness gates
- `-l` for label selectors, `--field-selector` for status/node filtering
- `-o jsonpath` and `-o custom-columns` for scripting and custom views
- `--sort-by` orders by any field path in the pod spec
- `-A` or `--all-namespaces` for cluster-wide pod listing
