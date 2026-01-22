---
title: "How to Implement Pod Security Standards"
description: "Secure your Kubernetes workloads using Pod Security Standards (PSS). Learn to enforce Privileged, Baseline, and Restricted policies at the namespace level."
category: "security"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster (1.23+)"
  - "kubectl configured with admin privileges"
  - "Understanding of Pod security concepts"
relatedRecipes:
  - "rbac-service-accounts"
  - "networkpolicy-deny-all"
tags:
  - security
  - pod-security
  - pss
  - psa
  - hardening
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You need to enforce security policies to prevent containers from running with dangerous privileges like root access or host networking.

## The Solution

Use Pod Security Standards (PSS) with Pod Security Admission (PSA) to enforce security policies at the namespace level.

## Understanding Pod Security Standards

There are three policy levels:

| Level | Description |
|-------|-------------|
| **Privileged** | Unrestricted, allows all capabilities |
| **Baseline** | Minimally restrictive, prevents known privilege escalations |
| **Restricted** | Highly restrictive, follows security best practices |

## Enforcement Modes

| Mode | Behavior |
|------|----------|
| **enforce** | Rejects pods that violate the policy |
| **audit** | Logs violations but allows pods |
| **warn** | Shows warnings but allows pods |

## Step 1: Label Namespaces

Apply Pod Security Standards via namespace labels:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

Apply it:

```bash
kubectl apply -f namespace.yaml
```

Or label an existing namespace:

```bash
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted
```

## Step 2: Gradual Rollout Strategy

Start with warn/audit, then enforce:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: staging
  labels:
    # Start with warnings only
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted
    # Don't enforce yet
    pod-security.kubernetes.io/enforce: baseline
```

## Compliant Pod Examples

### Baseline Compliant Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: baseline-pod
spec:
  containers:
  - name: app
    image: nginx:latest
    ports:
    - containerPort: 80
```

### Restricted Compliant Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: restricted-pod
spec:
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:latest
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      runAsNonRoot: true
      runAsUser: 1000
      capabilities:
        drop:
          - ALL
    ports:
    - containerPort: 8080
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

## Non-Compliant Pod (Will Be Rejected)

This pod violates restricted policy:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: privileged-pod
spec:
  containers:
  - name: app
    image: nginx:latest
    securityContext:
      privileged: true      # ❌ Not allowed
      runAsUser: 0          # ❌ Root not allowed
```

## Restricted-Compliant Deployment Template

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secure-app
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: secure-app
  template:
    metadata:
      labels:
        app: secure-app
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
        image: myapp:latest
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
              - ALL
        resources:
          limits:
            memory: "256Mi"
            cpu: "500m"
          requests:
            memory: "128Mi"
            cpu: "100m"
        ports:
        - containerPort: 8080
        volumeMounts:
        - name: tmp
          mountPath: /tmp
      volumes:
      - name: tmp
        emptyDir: {}
```

## Exemptions

For system pods that need elevated privileges, use exemptions at the cluster level (configured in AdmissionConfiguration):

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
- name: PodSecurity
  configuration:
    apiVersion: pod-security.admission.config.k8s.io/v1
    kind: PodSecurityConfiguration
    defaults:
      enforce: "restricted"
      audit: "restricted"
      warn: "restricted"
    exemptions:
      usernames: []
      runtimeClasses: []
      namespaces:
        - kube-system
        - cert-manager
```

## Checking Policy Violations

### Dry-Run Test

Test if a pod would be admitted:

```bash
kubectl label --dry-run=server --overwrite ns production \
  pod-security.kubernetes.io/enforce=restricted
```

### View Audit Logs

Check the API server audit logs for violations.

### Warnings in kubectl

```bash
# You'll see warnings when applying non-compliant pods
kubectl apply -f deployment.yaml
# Warning: would violate PodSecurity "restricted:latest"
```

## Migration Checklist

When moving to Restricted:

1. **Run as non-root:**
   ```yaml
   securityContext:
     runAsNonRoot: true
     runAsUser: 1000
   ```

2. **Drop all capabilities:**
   ```yaml
   securityContext:
     capabilities:
       drop: ["ALL"]
   ```

3. **Disable privilege escalation:**
   ```yaml
   securityContext:
     allowPrivilegeEscalation: false
   ```

4. **Use read-only root filesystem:**
   ```yaml
   securityContext:
     readOnlyRootFilesystem: true
   ```

5. **Set seccomp profile:**
   ```yaml
   securityContext:
     seccompProfile:
       type: RuntimeDefault
   ```

## Best Practices

- Start with `warn` and `audit` before `enforce`
- Use Restricted for production workloads
- Document exemptions and review regularly
- Test workloads in staging first
- Use namespace isolation for different security levels

## Key Takeaways

- Pod Security Standards replace PodSecurityPolicies
- Three levels: Privileged, Baseline, Restricted
- Apply via namespace labels
- Use gradual rollout with warn/audit before enforce
- Most production workloads should target Restricted
