---
title: "kubectl run: Create Pod from Command Line"
description: "Use kubectl run to create pods and deployments from the command line. Dry-run output, resource limits, environment variables, and CKA exam patterns."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "pods"
  - "cka"
  - "imperative"
  - "deployments"
relatedRecipes:
  - "kubectl-create-secret-docker-registry"
  - "kubernetes-labels-best-practices"
  - "kubernetes-security-context-guide"
  - "kubernetes-replicaset-guide"
---

> 💡 **Quick Answer:** `kubectl run nginx --image=nginx:1.27 --port=80` creates a pod named nginx. Add `--dry-run=client -o yaml` to generate YAML without creating. For CKA exams: `kubectl run busybox --image=busybox --restart=Never --command -- sleep 3600` creates a non-restarting pod. Use `--env`, `--labels`, `--requests`, `--limits` for inline configuration.

## The Problem

Creating pods via YAML is verbose for quick tasks:

- Testing a container image
- Running a one-off debugging pod
- CKA/CKAD exam time pressure — imperative commands are faster
- Generating YAML templates for further customization

## The Solution

### Basic Pod Creation

```bash
# Create a simple nginx pod
kubectl run nginx --image=nginx:1.27

# Create with port exposed
kubectl run nginx --image=nginx:1.27 --port=80

# Create and immediately attach
kubectl run -it busybox --image=busybox --restart=Never -- sh

# Create with labels
kubectl run nginx --image=nginx:1.27 --labels="app=web,tier=frontend"
```

### Generate YAML (Dry Run)

```bash
# Generate YAML without creating the pod
kubectl run nginx --image=nginx:1.27 --port=80 \
  --dry-run=client -o yaml

# Output:
# apiVersion: v1
# kind: Pod
# metadata:
#   labels:
#     run: nginx
#   name: nginx
# spec:
#   containers:
#   - image: nginx:1.27
#     name: nginx
#     ports:
#     - containerPort: 80
#   restartPolicy: Always

# Save to file for editing
kubectl run nginx --image=nginx:1.27 --port=80 \
  --dry-run=client -o yaml > pod.yaml
```

### Resource Limits and Requests

```bash
# Set CPU and memory requests/limits
kubectl run nginx --image=nginx:1.27 \
  --requests='cpu=100m,memory=128Mi' \
  --limits='cpu=500m,memory=256Mi'

# With environment variables
kubectl run nginx --image=nginx:1.27 \
  --env="DB_HOST=postgres" \
  --env="DB_PORT=5432"
```

### CKA Exam Patterns

```bash
# Pod with command override
kubectl run busybox --image=busybox --restart=Never \
  --command -- sleep 3600

# Pod with args
kubectl run busybox --image=busybox --restart=Never \
  -- /bin/sh -c "echo hello && sleep 3600"

# Pod in specific namespace
kubectl run nginx --image=nginx:1.27 -n production

# Pod with service account
kubectl run nginx --image=nginx:1.27 \
  --overrides='{"spec":{"serviceAccountName":"my-sa"}}'

# Temporary pod for DNS testing
kubectl run dnstest --image=busybox:1.36 --restart=Never --rm -it \
  -- nslookup kubernetes.default

# Temporary pod for network testing
kubectl run curlpod --image=curlimages/curl --restart=Never --rm -it \
  -- curl -s http://my-service:8080/health
```

### kubectl run vs kubectl create

| Feature | `kubectl run` | `kubectl create` |
|---------|--------------|-----------------|
| Creates Pod | ✅ | `kubectl create -f pod.yaml` |
| Creates Deployment | ❌ (removed in 1.18+) | `kubectl create deployment` |
| Dry-run YAML | ✅ `--dry-run=client -o yaml` | ✅ same flags |
| Interactive | ✅ `-it` | ❌ |
| One-shot jobs | ✅ `--restart=Never` | `kubectl create job` |
| Resource limits | ✅ `--requests/--limits` | Only via YAML |

### Overrides for Advanced Config

```bash
# Add tolerations via JSON overrides
kubectl run gpu-test --image=nvidia/cuda:12.4.0-runtime-ubuntu22.04 \
  --overrides='{
    "spec": {
      "tolerations": [{"key": "nvidia.com/gpu", "operator": "Exists", "effect": "NoSchedule"}],
      "containers": [{"name": "gpu-test", "image": "nvidia/cuda:12.4.0-runtime-ubuntu22.04",
        "resources": {"limits": {"nvidia.com/gpu": "1"}}}]
    }
  }'

# Add node selector
kubectl run nginx --image=nginx:1.27 \
  --overrides='{"spec":{"nodeSelector":{"disk":"ssd"}}}'
```

## Common Issues

**"error: --restart=OnFailure is not valid for pod"**

Since K8s 1.18, `kubectl run` only creates Pods. Use `kubectl create job` for Jobs or `kubectl create cronjob` for CronJobs.

**Pod stuck in Pending after kubectl run**

No resource requests set — may hit ResourceQuota or LimitRange. Add `--requests` flag.

**"already exists" error**

Delete the existing pod first: `kubectl delete pod nginx` then re-run.

## Best Practices

- **Always use `--dry-run=client -o yaml`** to preview before creating
- **Pin image tags** — `nginx:1.27` not `nginx:latest`
- **Use `--restart=Never --rm -it`** for temporary debug pods that auto-cleanup
- **Set resource requests** even on quick test pods to avoid quota issues
- **Combine imperative + declarative** — generate YAML with `kubectl run`, edit, then `kubectl apply`

## Key Takeaways

- `kubectl run` creates pods quickly from the command line
- `--dry-run=client -o yaml` generates YAML templates without creating resources
- Use `--restart=Never` for one-shot pods, `--rm -it` for temporary debug pods
- `--overrides` handles advanced config (tolerations, node selectors, service accounts)
- Essential for CKA/CKAD exams where speed matters
