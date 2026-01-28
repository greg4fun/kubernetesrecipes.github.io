---
title: "How to Use Kubernetes RuntimeClass"
description: "Configure different container runtimes for workloads. Use gVisor, Kata Containers, or other runtimes for enhanced security and isolation."
category: "security"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["runtimeclass", "gvisor", "kata", "containers", "isolation"]
---

# How to Use Kubernetes RuntimeClass

RuntimeClass lets you select different container runtimes for pods. Use sandboxed runtimes like gVisor or Kata Containers for enhanced security isolation.

## RuntimeClass Basics

```yaml
# RuntimeClass defines a container runtime configuration
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc  # Must match containerd/CRI-O config
scheduling:
  nodeSelector:
    runtime: gvisor
---
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata
handler: kata-runtime
```

## Use RuntimeClass in Pod

```yaml
# pod-with-runtime.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-pod
spec:
  runtimeClassName: gvisor  # Use gVisor runtime
  containers:
    - name: app
      image: nginx:alpine
      ports:
        - containerPort: 80
```

## Available Runtimes

```yaml
# Common container runtimes:

# 1. runc (default)
# - Standard OCI runtime
# - Shares kernel with host
# - Best performance

# 2. gVisor (runsc)
# - Application kernel in userspace
# - Strong isolation
# - Some syscall limitations

# 3. Kata Containers
# - Lightweight VMs
# - Hardware virtualization
# - Full Linux kernel per pod

# 4. Firecracker
# - microVMs
# - Fast boot times
# - AWS Lambda/Fargate uses this
```

## Configure containerd for gVisor

```toml
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc.options]
  TypeUrl = "io.containerd.runsc.v1.options"
  ConfigPath = "/etc/containerd/runsc.toml"
```

```bash
# Restart containerd
sudo systemctl restart containerd
```

## Configure containerd for Kata

```toml
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata]
  runtime_type = "io.containerd.kata.v2"
  privileged_without_host_devices = true

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata.options]
  ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration.toml"
```

## RuntimeClass with Scheduling

```yaml
# runtimeclass-scheduling.yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
scheduling:
  # Only schedule on nodes with gVisor
  nodeSelector:
    sandbox.gvisor.dev/runtime: "true"
  tolerations:
    - key: "sandbox.gvisor.dev/runtime"
      operator: "Equal"
      value: "true"
      effect: "NoSchedule"
```

## RuntimeClass with Overhead

```yaml
# Account for runtime overhead
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata
handler: kata-runtime
overhead:
  podFixed:
    cpu: "250m"
    memory: "160Mi"
# This overhead is added to pod resource calculations
# for scheduling and resource quota
```

## Deployment with RuntimeClass

```yaml
# secure-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secure-app
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
      runtimeClassName: gvisor
      containers:
        - name: app
          image: myapp:v1
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          securityContext:
            runAsNonRoot: true
            readOnlyRootFilesystem: true
```

## Multi-Tenant Isolation

```yaml
# Different runtimes for different trust levels
# Trusted internal workloads - standard runtime
apiVersion: v1
kind: Pod
metadata:
  name: internal-app
  namespace: trusted
spec:
  # No runtimeClassName = default runc
  containers:
    - name: app
      image: internal-app:v1
---
# Untrusted/external workloads - sandboxed
apiVersion: v1
kind: Pod
metadata:
  name: external-app
  namespace: untrusted
spec:
  runtimeClassName: gvisor
  containers:
    - name: app
      image: external-app:v1
```

## Verify RuntimeClass

```bash
# List RuntimeClasses
kubectl get runtimeclass

# Check pod's runtime
kubectl get pod sandboxed-pod -o jsonpath='{.spec.runtimeClassName}'

# Verify runtime in container
kubectl exec sandboxed-pod -- dmesg | head
# gVisor shows: "Starting gVisor"
# Kata shows VM-related messages

# Check node supports runtime
kubectl get nodes -l runtime=gvisor
```

## gVisor Compatibility

```yaml
# gVisor has some limitations:
# - Not all syscalls supported
# - No /dev access by default
# - GPU not supported
# - Some networking differences

# Test compatibility first
apiVersion: v1
kind: Pod
metadata:
  name: gvisor-test
spec:
  runtimeClassName: gvisor
  containers:
    - name: test
      image: myapp:v1
      command: ["./run-tests.sh"]
```

## Policy Enforcement

```yaml
# Kyverno policy requiring RuntimeClass
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-sandbox
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-gvisor
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaceSelector:
                matchLabels:
                  security: high
      validate:
        message: "Pods in high-security namespaces must use gvisor runtime"
        pattern:
          spec:
            runtimeClassName: gvisor
```

## Debugging RuntimeClass Issues

```bash
# Check if handler exists on node
kubectl get nodes -o jsonpath='{.items[*].status.nodeInfo.containerRuntimeVersion}'

# Check pod events
kubectl describe pod sandboxed-pod

# Common errors:
# "RuntimeClass not found" - RuntimeClass doesn't exist
# "handler not found" - containerd not configured for handler
# "failed to create sandbox" - runtime binary missing

# Check containerd config
sudo cat /etc/containerd/config.toml | grep -A5 runtimes
```

## Summary

RuntimeClass enables selecting different container runtimes per pod. Use gVisor for syscall-level isolation or Kata Containers for VM-level isolation. Define RuntimeClass with handler matching containerd/CRI-O configuration. Add scheduling constraints to ensure pods land on nodes with the runtime installed. Account for runtime overhead in resource calculations. Use policy engines like Kyverno to enforce RuntimeClass requirements for security-sensitive namespaces. Test application compatibility before deploying with sandboxed runtimes.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
