---
title: "Kata Containers RuntimeClass Kubernetes"
description: "Deploy Kata Containers with Kubernetes RuntimeClass for hardware-isolated pods. VM-based sandboxing, microVM configuration, and multi-runtime clusters."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kata-containers"
  - "runtimeclass"
  - "security"
  - "sandboxing"
  - "microvm"
relatedRecipes:
  - "gvisor-container-runtime"
  - "pod-security-context"
  - "kubernetes-rbac-role-rolebinding"
---

> 💡 **Quick Answer:** Kata Containers runs pods inside lightweight VMs (microVMs) for hardware-level isolation. Install kata-containers on nodes, configure containerd with a `kata` runtime handler, create a `RuntimeClass` named `kata`, then set `runtimeClassName: kata` on pods. Each pod gets its own kernel — stronger isolation than gVisor, at the cost of ~100ms startup overhead and ~128MB memory per pod.

## The Problem

Standard container isolation (namespaces + cgroups) shares the host kernel:

- Kernel exploits affect all containers on the node
- Multi-tenant clusters need stronger isolation
- Compliance requirements (PCI-DSS, FedRAMP) may require VM-level isolation
- Untrusted workloads (CI/CD runners, user-submitted code) risk host compromise

## The Solution

### Install Kata Containers

```bash
# Option 1: kata-deploy DaemonSet (recommended for Kubernetes)
kubectl apply -f https://raw.githubusercontent.com/kata-containers/kata-containers/main/tools/packaging/kata-deploy/kata-rbac/base/kata-rbac.yaml
kubectl apply -f https://raw.githubusercontent.com/kata-containers/kata-containers/main/tools/packaging/kata-deploy/kata-deploy/base/kata-deploy.yaml

# Wait for installation on all nodes
kubectl -n kube-system wait --for=condition=Ready pod -l name=kata-deploy --timeout=300s

# Option 2: Package manager (per-node)
# Ubuntu/Debian
sudo apt install kata-containers

# RHEL/CentOS
sudo dnf install kata-containers
```

### Configure containerd Runtime

```toml
# /etc/containerd/config.toml
# kata-deploy adds this automatically, but for manual setup:

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata]
  runtime_type = "io.containerd.kata.v2"
  privileged_without_host_devices = true
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata.options]
    ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration.toml"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-qemu]
  runtime_type = "io.containerd.kata.v2"
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-qemu.options]
    ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration-qemu.toml"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-clh]
  runtime_type = "io.containerd.kata.v2"
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-clh.options]
    ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration-clh.toml"
```

### Create RuntimeClass

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata
handler: kata           # Matches containerd runtime name
overhead:
  podFixed:
    memory: "160Mi"     # VM overhead per pod
    cpu: "250m"
scheduling:
  nodeSelector:
    katacontainers.io/kata-runtime: "true"

---
# Cloud-Hypervisor variant (faster startup)
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata-clh
handler: kata-clh
overhead:
  podFixed:
    memory: "130Mi"
    cpu: "200m"
scheduling:
  nodeSelector:
    katacontainers.io/kata-runtime: "true"
```

### Use in Pods

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: isolated-workload
spec:
  runtimeClassName: kata      # ← This runs the pod in a microVM
  containers:
  - name: app
    image: nginx:1.27
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m
        memory: 256Mi

---
# CI/CD runner with untrusted code
apiVersion: batch/v1
kind: Job
metadata:
  name: ci-build
spec:
  template:
    spec:
      runtimeClassName: kata
      containers:
      - name: builder
        image: docker.io/library/golang:1.22
        command: ["go", "test", "./..."]
        securityContext:
          runAsNonRoot: true
          runAsUser: 1000
      restartPolicy: Never
```

### Kata vs gVisor vs runc

| Feature | runc (default) | gVisor (runsc) | Kata Containers |
|---------|---------------|----------------|-----------------|
| Isolation | Namespaces + cgroups | User-space kernel | Hardware VM |
| Kernel | Shared host kernel | Go-based guest kernel | Linux guest kernel |
| Startup | ~100ms | ~200ms | ~500ms (QEMU), ~200ms (CLH) |
| Memory overhead | None | ~50MB | ~128-160MB |
| Syscall compat | 100% | ~80% (limited) | ~99% (full kernel) |
| GPU support | ✅ | ❌ | ✅ (VFIO passthrough) |
| Nested containers | ✅ | ❌ | ✅ |
| Best for | General workloads | Untrusted simple apps | Full isolation + compat |

### Hypervisor Options

```bash
# Check available hypervisors
ls /opt/kata/share/defaults/kata-containers/configuration-*.toml

# QEMU — most compatible, slower startup
kata-runtime kata-env | grep -A5 Hypervisor
# Hypervisor: QEMU

# Cloud-Hypervisor (CLH) — faster, recommended for production
# Edit kata configuration:
sudo sed -i 's/default_hypervisor = "qemu"/default_hypervisor = "cloud-hypervisor"/' \
  /opt/kata/share/defaults/kata-containers/configuration.toml

# Firecracker — AWS-style microVM, fastest but limited features
```

### Verify Isolation

```bash
# Inside a Kata pod — separate kernel!
kubectl exec -it isolated-workload -- uname -r
# 6.1.0-kata  ← Guest kernel, NOT host kernel

# Compare with standard pod
kubectl exec -it normal-pod -- uname -r
# 6.5.0-host  ← Host kernel

# Check VM from host
ps aux | grep qemu
# qemu-system-x86_64 ... -name sandbox-abc123 ...
```

## Common Issues

**"kata runtime not found" or "handler kata not registered"**

kata-deploy DaemonSet hasn't finished or containerd wasn't restarted. Check: `kubectl get pods -n kube-system -l name=kata-deploy`.

**Pod startup takes 5+ seconds**

Use Cloud-Hypervisor (`kata-clh`) instead of QEMU — 2-3x faster startup. Or use Firecracker for even faster cold starts.

**"nested virtualization required"**

Kata needs hardware virtualization (VT-x/AMD-V). On cloud VMs, ensure nested virtualization is enabled. Bare metal always works.

**GPU passthrough not working**

Kata supports GPU via VFIO — requires IOMMU enabled and GPU assigned to VFIO driver. Not transparent like runc GPU access.

## Best Practices

- **Use `kata-clh` in production** — Cloud-Hypervisor is faster and more resource-efficient than QEMU
- **Set `overhead` on RuntimeClass** — scheduler accounts for VM memory/CPU
- **Kata for multi-tenant isolation** — run untrusted workloads in VMs
- **runc for trusted workloads** — no need for VM overhead on trusted code
- **Combine with Pod Security Standards** — defense in depth

## Key Takeaways

- Kata Containers runs each pod in a lightweight VM for hardware-level isolation
- Create a RuntimeClass and set `runtimeClassName: kata` on pods
- Cloud-Hypervisor is the recommended hypervisor (faster than QEMU)
- ~128MB memory overhead per pod — use selectively for untrusted workloads
- Full kernel inside VM means near-100% syscall compatibility unlike gVisor
