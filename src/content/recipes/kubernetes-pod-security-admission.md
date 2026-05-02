---
title: "K8s Pod Security Admission Standards"
description: "Configure Kubernetes Pod Security Admission with enforce, audit, and warn modes. Privileged, baseline, and restricted profiles for namespace-level pod security."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "pod-security"
  - "security"
  - "admission-controller"
  - "namespaces"
  - "cka"
relatedRecipes:
  - "kubernetes-rbac-role-rolebinding"
  - "kubernetes-namespace-guide"
  - "kubernetes-security-context-guide"
  - "kubernetes-audit-logging-guide"
  - "kubernetes-certificate-management"
  - "kubernetes-kyverno-policy-guide"
  - "kubernetes-falco-runtime-security"
---

> 💡 **Quick Answer:** Label namespaces with `pod-security.kubernetes.io/enforce: restricted` to enforce Pod Security Standards. Three profiles: `privileged` (unrestricted), `baseline` (prevent known escalations), `restricted` (hardened best practices). Three modes: `enforce` (reject), `audit` (log), `warn` (warning). PSA replaced PodSecurityPolicy in K8s 1.25.

## The Problem

Without pod security controls:

- Any pod can run as root
- Containers can access host namespaces, filesystem, and devices
- Privilege escalation is trivial
- No defense-in-depth against container breakout

PodSecurityPolicy (PSP) was removed in K8s 1.25. Pod Security Admission (PSA) is the built-in replacement.

## The Solution

### Apply Security Standards via Labels

```bash
# Enforce restricted profile on a namespace
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted

# Baseline for staging (less strict)
kubectl label namespace staging \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=restricted
```

### Security Profiles

```yaml
# PRIVILEGED — no restrictions (kube-system, monitoring)
# Allows: everything
# Use for: system components, CNI, CSI, monitoring agents

# BASELINE — prevent known privilege escalations
# Blocks: hostNetwork, hostPID, hostIPC, privileged containers,
#         hostPath volumes, host ports, adding capabilities
# Allows: running as root, some volume types

# RESTRICTED — hardened (production workloads)
# Blocks: everything in baseline PLUS:
#         running as root, privilege escalation,
#         all capabilities except NET_BIND_SERVICE
# Requires: runAsNonRoot, seccompProfile, drop ALL capabilities
```

### Restricted-Compliant Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
  namespace: production    # Has enforce=restricted
spec:
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: myapp:v2
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
      readOnlyRootFilesystem: true
      runAsUser: 1000
      runAsGroup: 1000
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m
        memory: 256Mi
```

### Namespace Configuration

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.28
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: v1.28
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.28

---
# System namespace — privileged
apiVersion: v1
kind: Namespace
metadata:
  name: kube-system
  labels:
    pod-security.kubernetes.io/enforce: privileged
```

### Dry-Run Before Enforcing

```bash
# Check what would fail under restricted
kubectl label --dry-run=server --overwrite ns production \
  pod-security.kubernetes.io/enforce=restricted

# Output shows violations:
# Warning: existing pods in namespace "production" violate the new
# PodSecurity enforce level "restricted:latest":
#   nginx-xxx (must set securityContext.runAsNonRoot, ...)

# Step 1: Start with warn only
kubectl label ns production pod-security.kubernetes.io/warn=restricted

# Step 2: Fix violations (update pod specs)

# Step 3: Enforce
kubectl label ns production pod-security.kubernetes.io/enforce=restricted
```

### Exempt Specific Resources

```yaml
# AdmissionConfiguration (cluster-level, kube-apiserver config)
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
- name: PodSecurity
  configuration:
    apiVersion: pod-security.admission.config.k8s.io/v1
    kind: PodSecurityConfiguration
    defaults:
      enforce: baseline
      audit: restricted
      warn: restricted
    exemptions:
      usernames:
      - system:serviceaccount:kube-system:replicaset-controller
      runtimeClasses:
      - kata
      namespaces:
      - kube-system
      - monitoring
```

## Common Issues

**Pod rejected: "violates PodSecurity"**

Pod doesn't meet the namespace's security profile. Check violations with `warn` mode first, then fix securityContext.

**System DaemonSets failing in restricted namespace**

System components need `privileged` profile. Use namespace exemptions or keep system workloads in `kube-system`.

**"must set seccompProfile" error**

Restricted profile requires `seccompProfile.type: RuntimeDefault` at pod or container level.

## Best Practices

- **Start with `warn`/`audit`** before `enforce` — find violations first
- **`restricted` for all app namespaces** — defense in depth
- **`privileged` only for `kube-system`** and infrastructure namespaces
- **Pin enforce-version** — `v1.28` instead of `latest` for predictability
- **Combine with RBAC** — PSA controls pod specs, RBAC controls who can create them

## Key Takeaways

- Pod Security Admission replaces deprecated PodSecurityPolicy
- Three profiles (privileged/baseline/restricted) × three modes (enforce/audit/warn)
- Apply via namespace labels — no CRDs or webhooks needed
- Restricted profile requires: runAsNonRoot, drop ALL caps, seccomp, no privilege escalation
- Always dry-run before enforcing to find existing violations
