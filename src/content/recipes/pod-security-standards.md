---
title: "Kubernetes Pod Security Standards (PSS/PSA)"
description: "Enforce Kubernetes Pod Security Standards with Pod Security Admission: privileged, baseline and restricted levels, namespace labels, rollout and exemptions."
category: "security"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster (1.23+)"
  - "kubectl configured with admin privileges"
  - "Understanding of Pod security concepts"
relatedRecipes:
  - "kubernetes-pod-security-admission"
  - "kubernetes-security-context-guide"
  - "service-accounts-rbac"
  - "kubernetes-rbac-least-privilege"
  - "kubernetes-gvisor-kata-containers-runtimeclass"
  - "ubuntu-2604-kubernetes-sudo-rs"
  - "kubernetes-oidc-authentication-guide"
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

> **💡 Quick Answer:** Pod Security Standards (PSS) replace PodSecurityPolicies. Three levels: `privileged` (unrestricted), `baseline` (minimal restrictions), `restricted` (hardened). Apply via namespace labels: `kubectl label ns myns pod-security.kubernetes.io/enforce=restricted`. Modes: `enforce` (block), `audit` (log), `warn` (warn user). Start with `warn` mode to identify violations before enforcing.
>
> **Gotcha:** Enforcement applies to **pods**, not controllers — a non-compliant Deployment is accepted but its ReplicaSet can't create pods. `warn` shows the problem at `kubectl apply` time; check `kubectl describe rs` for `FailedCreate`.

## The Problem

You need to enforce security policies to prevent containers from running with dangerous privileges like root access or host networking. PodSecurityPolicy was removed in Kubernetes 1.25; Pod Security Admission (PSA), built into the API server and GA since 1.25, is its replacement.

## The Solution

Use Pod Security Standards (PSS) with Pod Security Admission (PSA) to enforce security policies at the namespace level.

## Understanding Pod Security Standards

There are three policy levels:

| Level | Description | Typical use |
|-------|-------------|-------------|
| **Privileged** | Unrestricted, allows all capabilities | CNI, CSI, GPU/network operators, `kube-system` |
| **Baseline** | Blocks known escalations: privileged, host namespaces, hostPath, added caps beyond the default set | Monitoring/logging agents, legacy apps |
| **Restricted** | Baseline + non-root, drop ALL caps, no privilege escalation, seccomp `RuntimeDefault`, restricted volume types | Application namespaces, multi-tenant |

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

`enforce-version: latest` tracks the cluster's version, so an upgrade can tighten the rules. Pin it (e.g. `v1.31`) in regulated environments and bump deliberately.

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

The stock `nginx` image runs as root on port 80, so use the unprivileged variant (listens on 8080 as UID 101):

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
    image: nginxinc/nginx-unprivileged:1.27
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      runAsNonRoot: true
      runAsUser: 101
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

Pass it with `--admission-control-config-file`. Prefer labelling system namespaces `enforce: privileged` over cluster-wide exemptions — labels are visible and auditable.

### OpenShift

OpenShift enforces Security Context Constraints (SCCs) and runs a PSA label syncer that sets `warn`/`audit` labels from the SCCs your service accounts can use. `openshift-*` namespaces are excluded. To opt a namespace out of syncing and manage labels yourself, set `security.openshift.io/scc.podSecurityLabelSync: "false"`.

## Checking Policy Violations

### Dry-Run Test

See which **existing** pods in a namespace would violate a level before enforcing it:

```bash
kubectl label --dry-run=server --overwrite ns production \
  pod-security.kubernetes.io/enforce=restricted
```

### View Audit Logs

With `audit` mode, violations are recorded as `pod-security.kubernetes.io/audit-violations` annotations on audit events (requires API server audit logging at `Metadata` level or higher).

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

## Common Issues

**`violates PodSecurity "restricted:latest"`** — the message lists the fields: typically missing `runAsNonRoot`, `seccompProfile`, `allowPrivilegeEscalation: false`, or `capabilities.drop: ["ALL"]`.

**Deployment created but no pods** — the ReplicaSet is being rejected; `kubectl get events -n <ns> --field-selector reason=FailedCreate`.

**`runAsNonRoot` set but container fails to start** — the image's user is root (UID 0) or a non-numeric username; set a numeric `runAsUser` or rebuild the image with `USER 1000`.

**System components break after enforcing** — label `kube-system`, CNI/CSI and operator namespaces `privileged`.

## Best Practices

- Start with `warn` and `audit` before `enforce`
- Use Restricted for production workloads
- Document exemptions and review regularly
- Test workloads in staging first
- Use namespace isolation for different security levels

## Frequently Asked Questions

### What are the Kubernetes Pod Security Standards?

Three cumulative policy levels defined by upstream Kubernetes — privileged, baseline and restricted — that describe which pod security settings are allowed. Pod Security Admission is the built-in admission controller that enforces them per namespace.

### What is the difference between Pod Security Standards and Pod Security Admission?

Pod Security Standards are the policy definitions; Pod Security Admission is the enforcement mechanism (namespace labels `enforce`, `audit`, `warn`). Kyverno or OPA Gatekeeper can also enforce PSS when you need finer-grained exceptions.

### What replaced PodSecurityPolicy?

Pod Security Admission with the Pod Security Standards. PSP was deprecated in 1.21 and removed in 1.25.

### Can I exempt a single workload from restricted?

PSA only exempts by namespace, username or RuntimeClass. Put the workload in a namespace with a lower level, or use a policy engine such as Kyverno with a scoped exception.

## Key Takeaways

- Pod Security Standards replace PodSecurityPolicies
- Three levels: Privileged, Baseline, Restricted
- Apply via namespace labels
- Use gradual rollout with warn/audit before enforce
- Most production workloads should target Restricted

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
