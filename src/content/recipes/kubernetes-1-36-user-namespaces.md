---
title: "Kubernetes 1.36 User Namespaces in Pods"
description: "Enable user namespaces in Kubernetes 1.36 for rootless containers and stronger Pod isolation. Map container root to unprivileged host UIDs."
tags:
  - "kubernetes-1.36"
  - "user-namespaces"
  - "security"
  - "rootless"
  - "pod-isolation"
category: "security"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-oci-volume-source"
  - "kubernetes-1-36-selinux-mount-labeling"
  - "kubernetes-pod-security-admission"
  - "kubernetes-security-context-guide"
  - "kubernetes-container-runtime-guide"
  - "kubernetes-1-36-gitrepo-removal"
---

> 💡 **Quick Answer:** Kubernetes 1.36 graduates **User Namespaces to GA**. Containers run as root inside the Pod but map to unprivileged UIDs on the host, preventing container breakout from gaining host root access.

## The Problem

By default, root inside a container (UID 0) maps to root on the host (UID 0). If an attacker escapes the container, they have **full host root privileges**. This is the #1 container security concern:

- Container breakout → host root access
- Shared UID space between containers and host
- Privileged containers run as actual host root
- Limited isolation between Pods on the same node

## The Solution

User namespaces remap UIDs inside the container to unprivileged UIDs on the host. Root in the container becomes UID 65534+ on the host.

### Enable User Namespaces

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: isolated-pod
spec:
  hostUsers: false    # Enable user namespace isolation
  containers:
    - name: app
      image: registry.example.com/app:v3.0
      securityContext:
        runAsUser: 0      # Root inside container
        runAsGroup: 0     # Root group inside container
```

With `hostUsers: false`, UID 0 inside the container maps to a high unprivileged UID on the host (e.g., 524288).

### Verify User Namespace Isolation

```bash
# Check UID mapping inside the container
kubectl exec isolated-pod -- cat /proc/1/uid_map
# Output: 0     524288     65536
# Meaning: container UID 0 → host UID 524288

# Verify from the host
ps aux | grep app
# Process runs as UID 524288, not UID 0
```

### Combining with Pod Security Standards

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-pod
spec:
  hostUsers: false
  securityContext:
    runAsNonRoot: false     # OK — root in container is safe with user namespaces
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: registry.example.com/app:v3.0
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
        readOnlyRootFilesystem: true
```

### StatefulSet with User Namespaces

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: database
spec:
  replicas: 3
  selector:
    matchLabels:
      app: database
  template:
    metadata:
      labels:
        app: database
    spec:
      hostUsers: false
      containers:
        - name: db
          image: registry.example.com/postgres:16
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 50Gi
```

### Node Configuration

Ensure the container runtime supports user namespaces:

```bash
# Check runtime support
kubectl get node <node-name> -o jsonpath='{.status.runtimeHandlers}'

# Verify kernel support
cat /proc/sys/user/max_user_namespaces
# Should be > 0

# Check subordinate UID/GID ranges
cat /etc/subuid
cat /etc/subgid
```

## Common Issues

### Pod stuck in Pending with user namespace error
- **Cause**: Container runtime doesn't support user namespaces
- **Fix**: Update to containerd ≥ 1.7 or CRI-O ≥ 1.28 with idmap support

### Volume permission denied
- **Cause**: Volume files owned by UID 0, but container maps to UID 524288
- **Fix**: Use `fsGroup` with `fsGroupChangePolicy: OnRootMismatch`

### Init containers fail with user namespaces
- **Cause**: Init container needs real host root access
- **Fix**: Split privileged init work into a separate non-user-namespace Pod

## Best Practices

1. **Enable for all non-privileged workloads** — `hostUsers: false` should be the default
2. **Combine with Pod Security Standards** — user namespaces + restricted PSS = defense in depth
3. **Test volume permissions** — remapped UIDs need matching file ownership
4. **Update container runtimes** — containerd 1.7+ and CRI-O 1.28+ required
5. **Use with seccomp and AppArmor** — layer multiple security mechanisms

## Key Takeaways

- User namespaces are **GA in Kubernetes 1.36**
- Set `hostUsers: false` to remap container root to unprivileged host UIDs
- Container breakout no longer grants host root access
- Works with volumes, StatefulSets, and all standard workload types
- Requires modern container runtime with idmap mount support
