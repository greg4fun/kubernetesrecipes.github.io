---
title: "Fix CreateContainerError in Kubernetes"
description: "Troubleshoot Kubernetes CreateContainerError with step-by-step debugging. ConfigMap mounts, Secret references, volume permissions, and container runtime issues."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "troubleshooting"
  - "containers"
  - "errors"
  - "debugging"
  - "cka"
relatedRecipes:
  - "kubernetes-imagepullbackoff-troubleshoot"
  - "kubernetes-kubectl-debug-guide"
  - "debug-crashloopbackoff"
  - "kubernetes-secret-types-guide"
---

> 💡 **Quick Answer:** `CreateContainerError` means the container can't start — usually a missing ConfigMap/Secret, bad volume mount, or invalid security context. Debug: `kubectl describe pod <name>` → check Events section. Common fixes: create the missing ConfigMap/Secret, fix volume mount paths, or adjust `securityContext` (runAsUser, fsGroup).

## The Problem

Pod stuck in `CreateContainerError`:

```
NAME      READY   STATUS                 RESTARTS   AGE
my-pod    0/1     CreateContainerError   0          5m
```

The container runtime can't create the container — different from `CrashLoopBackOff` (container starts then crashes) or `ImagePullBackOff` (can't pull image).

## The Solution

### Step 1: Describe the Pod

```bash
kubectl describe pod my-pod
# Look at the Events section at the bottom:

# Events:
#   Warning  Failed  kubelet  Error: configmap "app-config" not found
#   Warning  Failed  kubelet  Error: secret "db-credentials" not found
#   Warning  Failed  kubelet  Error: container has runAsNonRoot and image will run as root
```

### Common Cause 1: Missing ConfigMap

```bash
# Error: configmap "app-config" not found
kubectl get configmap app-config
# Error from server (NotFound)

# Fix: create the ConfigMap
kubectl create configmap app-config \
  --from-literal=DATABASE_HOST=db.example.com \
  --from-literal=LOG_LEVEL=info

# Or from file
kubectl create configmap app-config --from-file=config.yaml
```

```yaml
# Pod referencing ConfigMap
spec:
  containers:
  - name: app
    envFrom:
    - configMapRef:
        name: app-config        # Must exist!
    volumeMounts:
    - name: config
      mountPath: /etc/config
  volumes:
  - name: config
    configMap:
      name: app-config          # Must exist!
      optional: true            # Add this to avoid CreateContainerError
```

### Common Cause 2: Missing Secret

```bash
# Error: secret "db-credentials" not found
kubectl get secret db-credentials
# Error from server (NotFound)

# Fix: create the Secret
kubectl create secret generic db-credentials \
  --from-literal=username=admin \
  --from-literal=password=s3cur3p4ss
```

```yaml
# Make Secret references optional
spec:
  containers:
  - name: app
    env:
    - name: DB_PASSWORD
      valueFrom:
        secretKeyRef:
          name: db-credentials
          key: password
          optional: true        # Pod starts even if Secret missing
```

### Common Cause 3: Security Context Mismatch

```bash
# Error: container has runAsNonRoot and image will run as root

# The image's default user is root (UID 0)
# But pod spec says runAsNonRoot: true
```

```yaml
# Fix: set a non-root user
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000             # Must be non-zero
    fsGroup: 1000
  containers:
  - name: app
    image: myapp:v2
    securityContext:
      allowPrivilegeEscalation: false
```

### Common Cause 4: Volume Mount Issues

```bash
# Error: failed to create containerd container: mount destination not allowed

# Subpath doesn't exist in ConfigMap/Secret
# Or PVC not bound
kubectl get pvc
# NAME        STATUS    VOLUME   CAPACITY
# data-pvc    Pending   <none>   <none>        ← Not bound!
```

```yaml
# Fix: ensure subPath key exists
volumes:
- name: config
  configMap:
    name: app-config
    items:
    - key: app.conf            # This key must exist in ConfigMap
      path: app.conf
```

### Common Cause 5: Resource Limit Issues

```bash
# Error: failed to create containerd task: OCI runtime create failed

# Possible: hugepages request without host support
# Or invalid resource format
```

```yaml
# Fix: valid resource format
resources:
  requests:
    cpu: 100m                  # Not "100 m" (no space)
    memory: 256Mi              # Not "256 mb" (case matters)
  limits:
    cpu: 500m
    memory: 512Mi
```

### Debugging Flowchart

```
CreateContainerError
├── kubectl describe pod → check Events
│
├── "configmap not found"
│   └── Create ConfigMap or add optional: true
│
├── "secret not found"
│   └── Create Secret or add optional: true
│
├── "runAsNonRoot and image will run as root"
│   └── Set runAsUser: 1000 or fix image
│
├── "mount destination not allowed"
│   └── Check volume paths, PVC bound status
│
├── "OCI runtime create failed"
│   └── Check container runtime logs on node
│   └── journalctl -u containerd | tail -50
│
└── Other
    └── kubectl logs my-pod --previous
    └── Check node: journalctl -u kubelet | grep my-pod
```

## Common Issues

**CreateContainerError vs CreateContainerConfigError**

`CreateContainerConfigError` specifically means config resolution failed (missing ConfigMap/Secret). `CreateContainerError` is broader — includes runtime failures.

**Error persists after creating ConfigMap**

Pod may need to be deleted and recreated — or wait for kubelet retry cycle (~10s).

**Works on one node, fails on another**

Node-specific issue: SELinux, AppArmor, missing kernel module, or local volume path doesn't exist.

## Best Practices

- **Use `optional: true`** on non-critical ConfigMap/Secret references
- **Check `kubectl describe`** — Events section tells you exactly what's wrong
- **Pre-create ConfigMaps/Secrets** before Deployments in CI/CD
- **Use Helm hooks or init containers** to ensure dependencies exist
- **Test securityContext** locally — `docker run --user 1000 <image>` to verify

## Key Takeaways

- CreateContainerError = container can't be created (config or runtime issue)
- `kubectl describe pod` Events section gives the exact error
- Top causes: missing ConfigMap/Secret, security context, volume mounts
- Use `optional: true` to prevent missing config from blocking pod start
- Different from CrashLoopBackOff (container starts then dies) and ImagePullBackOff (image issue)
