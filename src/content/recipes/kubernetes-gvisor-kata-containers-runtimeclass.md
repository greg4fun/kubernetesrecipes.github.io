---
title: "Kubernetes gVisor and Kata Containers RuntimeClass"
description: "Deploy sandboxed container runtimes on Kubernetes using RuntimeClass with gVisor (runsc) and Kata Containers. Isolate untrusted workloads with kernel-level"
tags:
  - "gvisor"
  - "kata-containers"
  - "runtimeclass"
  - "security"
  - "sandboxing"
  - "container-runtime"
category: "security"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-security-checklist-2026"
  - "crun-vs-runc-container-runtime"
---

> 💡 **Quick Answer:** RuntimeClass lets you run specific pods with sandboxed runtimes instead of the default runc. gVisor (runsc) interposes a user-space kernel between the container and host — no direct syscalls. Kata Containers runs each pod in a lightweight VM. Create a RuntimeClass, configure containerd with the handler, then set `runtimeClassName` in your pod spec.

## The Problem

- Default runc containers share the host kernel — a kernel exploit escapes to host
- Multi-tenant clusters need stronger isolation than Linux namespaces/cgroups
- Untrusted code (CI builds, user uploads, AI inference) needs sandboxing
- Compliance requires defense-in-depth beyond standard container boundaries
- Need different isolation levels for different workloads in same cluster

## The Solution

### RuntimeClass Definition

```yaml
# gVisor RuntimeClass
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc    # Must match containerd config handler name
scheduling:
  nodeSelector:
    sandbox.gvisor.dev/runtime: "true"
---
# Kata Containers RuntimeClass
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata
handler: kata    # Must match containerd config handler name
scheduling:
  nodeSelector:
    katacontainers.io/kata-runtime: "true"
overhead:
  podFixed:
    memory: "160Mi"    # VM overhead
    cpu: "250m"
```

### Configure containerd for gVisor

```toml
# /etc/containerd/config.toml — add gVisor handler
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc.options]
  TypeUrl = "io.containerd.runsc.v1.options"
  ConfigPath = "/etc/containerd/runsc.toml"
```

```bash
# Install gVisor
curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list
apt-get update && apt-get install -y runsc

# Verify
runsc --version
systemctl restart containerd
```

### Configure containerd for Kata

```toml
# /etc/containerd/config.toml — add Kata handler
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata]
  runtime_type = "io.containerd.kata.v2"
  privileged_without_host_devices = true

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata.options]
  ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration.toml"
```

### Use RuntimeClass in Pods

```yaml
# Run untrusted workload in gVisor sandbox
apiVersion: v1
kind: Pod
metadata:
  name: untrusted-build
spec:
  runtimeClassName: gvisor    # ← This is all you need
  containers:
    - name: build
      image: registry.example.com/ci-runner:v1
      command: ["./run-untrusted-build.sh"]
      resources:
        limits:
          cpu: "2"
          memory: "4Gi"
---
# Run in Kata VM-level isolation
apiVersion: v1
kind: Pod
metadata:
  name: isolated-inference
spec:
  runtimeClassName: kata
  containers:
    - name: inference
      image: registry.example.com/model-server:v1
      resources:
        limits:
          cpu: "4"
          memory: "8Gi"
```

### Comparison: runc vs gVisor vs Kata

```text
Feature          │ runc (default) │ gVisor (runsc)  │ Kata Containers
─────────────────┼────────────────┼─────────────────┼─────────────────
Isolation        │ Namespaces     │ User-space       │ VM (hypervisor)
                 │ + cgroups      │ kernel           │
─────────────────┼────────────────┼─────────────────┼─────────────────
Kernel access    │ Shared host    │ Intercepted      │ Separate guest
                 │ kernel         │ (Sentry)         │ kernel
─────────────────┼────────────────┼─────────────────┼─────────────────
Startup time     │ ~100ms         │ ~200ms           │ ~1-2s
─────────────────┼────────────────┼─────────────────┼─────────────────
Memory overhead  │ ~5MB           │ ~50-100MB        │ ~128-256MB
─────────────────┼────────────────┼─────────────────┼─────────────────
Syscall compat   │ 100%           │ ~80% (growing)   │ ~100%
─────────────────┼────────────────┼─────────────────┼─────────────────
Performance      │ Near-native    │ Varies (I/O hit) │ Near-native
                 │                │                  │ (after start)
─────────────────┼────────────────┼─────────────────┼─────────────────
GPU support      │ Full           │ Limited          │ VFIO passthrough
─────────────────┼────────────────┼─────────────────┼─────────────────
Use case         │ Trusted apps   │ Untrusted code,  │ Hard multi-tenancy,
                 │                │ CI/CD, serverless│ compliance, secrets
─────────────────┴────────────────┴─────────────────┴─────────────────
```

## Common Issues

### Pod stuck in `ContainerCreating` with RuntimeClass
- **Cause**: Handler not installed on node; or node doesn't have required label
- **Fix**: Verify gVisor/Kata installed on node; check `scheduling.nodeSelector` matches

### "operation not supported" errors inside gVisor container
- **Cause**: gVisor doesn't support all syscalls (e.g., `io_uring`, some `ioctl`)
- **Fix**: Check gVisor compatibility matrix; fall back to runc for incompatible workloads

### Kata pod fails with "no hardware virtualization support"
- **Cause**: Node doesn't have KVM/VT-x enabled
- **Fix**: Enable virtualization in BIOS; or use cloud instances with nested virtualization

### Performance degradation with gVisor
- **Cause**: File I/O intensive workloads hit gVisor's user-space filesystem overhead
- **Fix**: Use `directfs` gVisor option for better I/O; or use Kata for I/O-heavy workloads

## Best Practices

1. **Use RuntimeClass (not runtime annotations)** — the standard K8s API since 1.20
2. **gVisor for untrusted code** — CI builds, user-submitted code, serverless functions
3. **Kata for hard multi-tenancy** — when namespace isolation isn't sufficient
4. **Set overhead in RuntimeClass** — accounts for sandbox memory in scheduling
5. **Node selectors on RuntimeClass** — only schedule sandboxed pods on prepared nodes
6. **Test syscall compatibility** — validate your application works under gVisor before production
7. **Default runc for trusted workloads** — no need to sandbox everything (overhead vs security)

## Key Takeaways

- RuntimeClass (`node.k8s.io/v1`) selects container runtime per-pod via `runtimeClassName`
- gVisor: user-space kernel intercepting syscalls — fast startup, some compatibility gaps
- Kata Containers: lightweight VM per pod — full syscall compatibility, higher overhead
- Both provide stronger isolation than default runc (namespaces + cgroups only)
- Configure handler in containerd config, create RuntimeClass, set `runtimeClassName` in pod
- Use gVisor for untrusted code; Kata for compliance/hard multi-tenancy; runc for everything else
