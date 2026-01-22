---
title: "How to Configure Pod Security Admission"
description: "Enforce security standards with Pod Security Admission. Configure privileged, baseline, and restricted policies at namespace level for cluster-wide security."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["pod-security", "psa", "security", "policies", "hardening"]
---

# How to Configure Pod Security Admission

Pod Security Admission (PSA) enforces Pod Security Standards at the namespace level. It replaces the deprecated PodSecurityPolicy and provides three security levels: privileged, baseline, and restricted.

## Pod Security Standards

```yaml
# Three levels of security:
# 1. Privileged - Unrestricted, for system workloads
# 2. Baseline - Minimally restrictive, prevents known privilege escalations
# 3. Restricted - Heavily restricted, security best practices
```

## Enable PSA on Namespace

```yaml
# restricted-namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    # Enforce mode - reject non-compliant pods
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    # Warn mode - allow but warn
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
    # Audit mode - log violations
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
```

```bash
kubectl apply -f restricted-namespace.yaml

# Or label existing namespace
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted
```

## Baseline Namespace

```yaml
# baseline-namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: development
  labels:
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/enforce-version: v1.28
    pod-security.kubernetes.io/warn: restricted
```

## Privileged Namespace (System)

```yaml
# privileged-namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: kube-system
  labels:
    pod-security.kubernetes.io/enforce: privileged
```

## Compliant Pod (Restricted)

```yaml
# restricted-compliant-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
  namespace: production
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: nginx:latest
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop:
            - ALL
      volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /var/cache/nginx
        - name: run
          mountPath: /var/run
  volumes:
    - name: tmp
      emptyDir: {}
    - name: cache
      emptyDir: {}
    - name: run
      emptyDir: {}
```

## Compliant Deployment Template

```yaml
# secure-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secure-api
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: secure-api
  template:
    metadata:
      labels:
        app: secure-api
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10000
        runAsGroup: 10000
        fsGroup: 10000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: api
          image: myapi:v1
          ports:
            - containerPort: 8080
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "200m"
```

## Baseline Compliant Pod

```yaml
# baseline-compliant-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: baseline-app
  namespace: development
spec:
  containers:
    - name: app
      image: nginx:latest
      securityContext:
        # Baseline allows these but restricted doesn't
        # allowPrivilegeEscalation: true (default)
        # readOnlyRootFilesystem: false (default)
        capabilities:
          drop:
            - ALL
          add:
            - NET_BIND_SERVICE  # Allowed in baseline
```

## What Each Level Restricts

### Restricted Level Requirements

```yaml
# All of these are REQUIRED for restricted:
spec:
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault  # or Localhost
  containers:
    - securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
        # Only these capabilities may be added:
        # - NET_BIND_SERVICE (and only if dropping ALL first)
```

### Baseline Level Restrictions

```yaml
# Baseline PROHIBITS:
# - hostNetwork: true
# - hostPID: true
# - hostIPC: true
# - privileged: true
# - hostPath volumes (some paths)
# - hostPort (some ranges)
# - Dangerous capabilities (SYS_ADMIN, NET_RAW, etc.)
# - /proc mount types other than Default
# - Seccomp profiles: Unconfined
# - Unsafe sysctls
```

## Exemptions

```yaml
# Configure exemptions in AdmissionConfiguration
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
  - name: PodSecurity
    configuration:
      apiVersion: pod-security.admission.config.k8s.io/v1
      kind: PodSecurityConfiguration
      defaults:
        enforce: baseline
        enforce-version: latest
        warn: restricted
        warn-version: latest
        audit: restricted
        audit-version: latest
      exemptions:
        # Exempt specific usernames
        usernames:
          - system:serviceaccount:kube-system:replicaset-controller
        # Exempt specific namespaces
        namespaces:
          - kube-system
          - istio-system
        # Exempt specific runtime classes
        runtimeClasses:
          - gvisor
```

## Test Policy Compliance

```bash
# Dry-run to test if pod would be admitted
kubectl apply -f pod.yaml --dry-run=server

# Check warnings when creating resources
kubectl apply -f deployment.yaml
# Warning: would violate PodSecurity "restricted:latest"

# Describe namespace for policy info
kubectl describe namespace production
```

## Migrate from PodSecurityPolicy

```bash
# Step 1: Add audit/warn labels to namespaces
kubectl label namespace myapp \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted

# Step 2: Review audit logs and warnings
kubectl get events -A | grep PodSecurity

# Step 3: Fix non-compliant workloads

# Step 4: Enable enforce mode
kubectl label namespace myapp \
  pod-security.kubernetes.io/enforce=restricted
```

## Common Violations and Fixes

### Running as Root

```yaml
# Violation
spec:
  containers:
    - name: app
      image: nginx  # Runs as root by default

# Fix
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
  containers:
    - name: app
      image: nginx
```

### Privilege Escalation

```yaml
# Violation (implicit allowPrivilegeEscalation: true)
spec:
  containers:
    - name: app
      image: myapp

# Fix
spec:
  containers:
    - name: app
      image: myapp
      securityContext:
        allowPrivilegeEscalation: false
```

### Missing Seccomp Profile

```yaml
# Violation
spec:
  containers:
    - name: app
      image: myapp

# Fix
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: myapp
```

### Capabilities Not Dropped

```yaml
# Violation
spec:
  containers:
    - name: app
      image: myapp

# Fix
spec:
  containers:
    - name: app
      image: myapp
      securityContext:
        capabilities:
          drop:
            - ALL
```

## Namespace-Level Policy Script

```bash
#!/bin/bash
# apply-psa-policies.sh

# Production namespaces - restricted
for ns in production api-prod data-prod; do
  kubectl label namespace $ns \
    pod-security.kubernetes.io/enforce=restricted \
    pod-security.kubernetes.io/warn=restricted \
    pod-security.kubernetes.io/audit=restricted \
    --overwrite
done

# Development namespaces - baseline with restricted warnings
for ns in development staging; do
  kubectl label namespace $ns \
    pod-security.kubernetes.io/enforce=baseline \
    pod-security.kubernetes.io/warn=restricted \
    pod-security.kubernetes.io/audit=restricted \
    --overwrite
done

# System namespaces - privileged
for ns in kube-system monitoring logging; do
  kubectl label namespace $ns \
    pod-security.kubernetes.io/enforce=privileged \
    --overwrite
done
```

## View Namespace Policies

```bash
# List all namespaces with their PSA labels
kubectl get namespaces -L \
  pod-security.kubernetes.io/enforce,\
  pod-security.kubernetes.io/warn,\
  pod-security.kubernetes.io/audit
```

## Summary

Pod Security Admission enforces security standards at the namespace level using labels. Use `restricted` for production workloads, `baseline` for development, and `privileged` only for system namespaces. Start with `warn` and `audit` modes to identify violations before enabling `enforce`. Update workloads to be compliant by setting proper security contexts, dropping capabilities, and running as non-root.
