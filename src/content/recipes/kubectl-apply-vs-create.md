---
title: "kubectl apply vs create: Key Differences"
description: "Understand when to use kubectl apply vs kubectl create. Declarative vs imperative, last-applied annotation, server-side apply, and GitOps workflows."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "configuration"
  - "gitops"
  - "cka"
relatedRecipes:
  - "kubectl-run-pod-command"
  - "kustomize-vs-helm-comparison"
  - "kubernetes-resource-quota-limitrange"
---

> 💡 **Quick Answer:** `kubectl apply -f file.yaml` is **declarative** — it creates resources if they don't exist and updates them if they do, tracking changes via the `last-applied-configuration` annotation. `kubectl create -f file.yaml` is **imperative** — it creates resources but fails if they already exist. **Use `apply` for GitOps, CI/CD, and production. Use `create` for one-off resources and CKA exam speed.**

## The Problem

Both commands create resources, but behave differently:

```bash
# First run: both succeed
kubectl create -f deployment.yaml   # ✅ Created
kubectl apply -f deployment.yaml    # ✅ Created

# Second run: different behavior
kubectl create -f deployment.yaml   # ❌ Error: already exists
kubectl apply -f deployment.yaml    # ✅ Updated (no error)
```

## The Solution

### Comparison Table

| Feature | `kubectl apply` | `kubectl create` |
|---------|-----------------|------------------|
| Creates new resources | ✅ | ✅ |
| Updates existing | ✅ (merge patch) | ❌ (error) |
| Deletes removed fields | Only with `--prune` | N/A |
| Tracks changes | `last-applied-configuration` | No tracking |
| Idempotent | ✅ | ❌ |
| GitOps compatible | ✅ | ❌ |
| Server-side apply | ✅ `--server-side` | ❌ |
| Generates YAML | ❌ | ✅ `--dry-run=client -o yaml` |

### kubectl apply (Declarative)

```bash
# Create or update resources
kubectl apply -f deployment.yaml

# Apply entire directory
kubectl apply -f manifests/

# Apply from URL
kubectl apply -f https://raw.githubusercontent.com/example/manifests/main/deploy.yaml

# Apply with prune (delete resources no longer in files)
kubectl apply -f manifests/ --prune -l app=myapp

# Server-side apply (K8s 1.22+, recommended)
kubectl apply -f deployment.yaml --server-side

# Force conflicts (take ownership of fields)
kubectl apply -f deployment.yaml --server-side --force-conflicts
```

**How apply tracks changes:**

```yaml
# After kubectl apply, K8s stores this annotation:
metadata:
  annotations:
    kubectl.kubernetes.io/last-applied-configuration: |
      {"apiVersion":"apps/v1","kind":"Deployment",...}
```

When you run `apply` again, it computes a 3-way merge:
1. **Last applied** (annotation) vs **current live** vs **new desired**
2. Fields you added → created
3. Fields you changed → updated
4. Fields you removed from YAML → deleted (if they were in last-applied)
5. Fields changed by others (HPA, controllers) → preserved

### kubectl create (Imperative)

```bash
# Create resources (fails if exists)
kubectl create -f deployment.yaml

# Create with --save-config (adds last-applied annotation)
kubectl create -f deployment.yaml --save-config

# Imperative resource creation
kubectl create deployment nginx --image=nginx:1.27 --replicas=3
kubectl create service clusterip nginx --tcp=80:80
kubectl create configmap myconfig --from-file=config.properties
kubectl create secret generic mysecret --from-literal=password=s3cr3t
kubectl create namespace production
kubectl create serviceaccount mysa

# Generate YAML (most useful feature)
kubectl create deployment nginx --image=nginx:1.27 \
  --dry-run=client -o yaml > deployment.yaml
```

### When to Use Each

```bash
# GitOps / CI/CD pipelines → apply
kubectl apply -f manifests/

# Quick testing / CKA exam → create
kubectl create deployment nginx --image=nginx:1.27

# Generate then customize → create + apply
kubectl create deployment nginx --image=nginx:1.27 \
  --dry-run=client -o yaml > deployment.yaml
# Edit deployment.yaml...
kubectl apply -f deployment.yaml

# Replace completely (nuclear option)
kubectl replace -f deployment.yaml --force
```

### Server-Side Apply (Modern Best Practice)

```bash
# Client-side apply (default, older)
kubectl apply -f deployment.yaml
# Problem: annotation-based, large objects hit annotation size limits

# Server-side apply (recommended for K8s 1.22+)
kubectl apply -f deployment.yaml --server-side
# Benefits:
# - No annotation size limit
# - Field-level ownership tracking
# - Better conflict detection
# - Multiple managers can own different fields

# Check field managers
kubectl get deployment nginx -o yaml | grep -A5 managedFields
```

## Common Issues

**"already exists" with kubectl create**

Resource exists. Use `kubectl apply` instead, or `kubectl delete` first.

**apply warning: "last-applied-configuration missing"**

Resource was created with `kubectl create` (no annotation). Fix: `kubectl apply -f file.yaml --force` or add `--save-config` to create.

**apply deleting fields set by HPA or controllers**

Use `--server-side` apply — it tracks field ownership and won't overwrite fields managed by other controllers.

## Best Practices

- **Use `apply` for everything in production** — idempotent and GitOps-friendly
- **Use `create --dry-run=client -o yaml`** for generating YAML templates
- **Prefer `--server-side`** on K8s 1.22+ for better conflict handling
- **Never mix `create` and `apply`** on the same resource — causes annotation confusion
- **Store manifests in git** — `kubectl apply` + git = GitOps

## Key Takeaways

- `kubectl apply` is declarative: creates, updates, and is idempotent
- `kubectl create` is imperative: creates only, fails if resource exists
- Apply tracks changes via `last-applied-configuration` annotation
- Server-side apply (`--server-side`) is the modern best practice
- Use `create --dry-run=client -o yaml` for YAML generation, `apply` for everything else
