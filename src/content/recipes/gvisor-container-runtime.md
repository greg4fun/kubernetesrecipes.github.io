---
title: "Secure Containers with gVisor Runtime"
description: "Enhance container isolation using gVisor sandbox runtime to add an additional security layer between containers and the host kernel for untrusted workloads"
category: "security"
difficulty: "advanced"
timeToComplete: "45 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Understanding of container runtimes"
  - "Knowledge of Kubernetes RuntimeClass"
  - "Linux kernel and syscall concepts"
relatedRecipes:
  - "kubernetes-runtimeclass"
  - "pod-security-standards"
  - "container-security-scanning"
tags:
  - gvisor
  - container-runtime
  - sandbox
  - security-isolation
  - runtime-class
publishDate: "2026-01-28"
author: "kubernetes-recipes"
---

## Problem

Standard container runtimes (runc) share the host kernel, which means kernel vulnerabilities or container escapes can compromise the entire host. You need stronger isolation for untrusted workloads without the overhead of full VMs.

## Solution

Use gVisor, a user-space kernel that intercepts and handles system calls, providing an additional isolation layer between containers and the host kernel. gVisor implements the Linux system call interface in user space, reducing the attack surface.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│              Standard Container                      │
│  ┌─────────────────────────────────────────────┐   │
│  │           Application Process               │   │
│  └─────────────────────┬───────────────────────┘   │
│                        │ syscalls                   │
│                        ▼                            │
│  ┌─────────────────────────────────────────────┐   │
│  │              Host Kernel                     │   │
│  │         (shared with host)                   │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│             gVisor Sandboxed Container              │
│  ┌─────────────────────────────────────────────┐   │
│  │           Application Process               │   │
│  └─────────────────────┬───────────────────────┘   │
│                        │ syscalls                   │
│                        ▼                            │
│  ┌─────────────────────────────────────────────┐   │
│  │         gVisor Sentry (user-space)          │   │
│  │    (implements Linux syscall interface)     │   │
│  └─────────────────────┬───────────────────────┘   │
│                        │ limited syscalls          │
│                        ▼                            │
│  ┌─────────────────────────────────────────────┐   │
│  │              Host Kernel                     │   │
│  │         (reduced attack surface)            │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Step 1: Install gVisor on Nodes

Install gVisor (runsc) on Kubernetes nodes:

```bash
# Download and install gVisor
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg

echo "deb [arch=amd64 signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | \
  sudo tee /etc/apt/sources.list.d/gvisor.list

sudo apt-get update && sudo apt-get install -y runsc

# Verify installation
runsc --version
```

### Step 2: Configure containerd for gVisor

Add gVisor runtime to containerd configuration:

```toml
# /etc/containerd/config.toml
version = 2

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes]
  # Default runtime (runc)
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
    runtime_type = "io.containerd.runc.v2"
    [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
      SystemdCgroup = true

  # gVisor runtime
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
    runtime_type = "io.containerd.runsc.v1"
    [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc.options]
      TypeUrl = "io.containerd.runsc.v1.options"
      ConfigPath = "/etc/containerd/runsc.toml"
```

Create gVisor configuration:

```toml
# /etc/containerd/runsc.toml
[runsc_config]
  # Platform options: ptrace, kvm (if available)
  platform = "systrap"
  # Enable debug logging
  debug = false
  # Enable strace for syscall debugging (dev only)
  strace = false
  # Network configuration
  network = "sandbox"
  # File access configuration
  file-access = "exclusive"
```

Restart containerd:

```bash
sudo systemctl restart containerd
sudo systemctl status containerd
```

### Step 3: Create RuntimeClass

Define RuntimeClass for gVisor:

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
scheduling:
  nodeSelector:
    gvisor.io/enabled: "true"
  tolerations:
  - key: "gvisor.io/sandbox"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
# Optional: Overhead configuration
# overhead:
#   podFixed:
#     memory: "100Mi"
#     cpu: "100m"
```

Label nodes with gVisor:

```bash
# Label nodes that have gVisor installed
kubectl label nodes node1 node2 gvisor.io/enabled=true

# Optionally taint nodes for gVisor-only workloads
kubectl taint nodes node1 gvisor.io/sandbox=true:NoSchedule
```

### Step 4: Deploy Workloads with gVisor

Run pods using gVisor runtime:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: untrusted-app
  namespace: sandbox
spec:
  replicas: 3
  selector:
    matchLabels:
      app: untrusted-app
  template:
    metadata:
      labels:
        app: untrusted-app
    spec:
      runtimeClassName: gvisor  # Use gVisor runtime
      containers:
      - name: app
        image: untrusted-app:v1.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "200m"
        securityContext:
          readOnlyRootFilesystem: true
          runAsNonRoot: true
          runAsUser: 1000
```

### Step 5: Configure gVisor Platform Options

Optimize gVisor for different use cases:

```toml
# /etc/containerd/runsc-ptrace.toml
# For maximum compatibility (slower)
[runsc_config]
  platform = "ptrace"
  file-access = "exclusive"

# /etc/containerd/runsc-kvm.toml
# For better performance (requires KVM)
[runsc_config]
  platform = "kvm"
  file-access = "exclusive"
  
# /etc/containerd/runsc-systrap.toml
# Balanced option (default)
[runsc_config]
  platform = "systrap"
  file-access = "exclusive"
```

Create multiple RuntimeClasses for different options:

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor-kvm
handler: runsc-kvm
---
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor-ptrace
handler: runsc-ptrace
```

### Step 6: Network Configuration for gVisor

Configure network modes:

```toml
# /etc/containerd/runsc.toml
[runsc_config]
  # Network modes:
  # "sandbox" - full network isolation (recommended)
  # "host" - use host network stack
  # "none" - no networking
  network = "sandbox"
  
  # Enable GSO for better network performance
  gso = true
  
  # Network namespace configuration
  network-namespace = "/var/run/netns/%s"
```

### Step 7: Monitor gVisor Workloads

Debug and monitor gVisor containers:

```bash
# Check runtime class of pods
kubectl get pods -o custom-columns=\
NAME:.metadata.name,\
RUNTIME:.spec.runtimeClassName

# View gVisor logs
sudo journalctl -u containerd | grep runsc

# Debug gVisor container
sudo runsc --root /run/containerd/runsc/k8s.io debug <container-id>

# Get syscall stats
sudo runsc --root /run/containerd/runsc/k8s.io events <container-id>
```

### Step 8: Enforce gVisor with Policies

Use admission policies to enforce gVisor for untrusted workloads:

```yaml
# Kyverno policy to enforce gVisor
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-gvisor-runtime
spec:
  validationFailureAction: Enforce
  rules:
  - name: require-gvisor-for-untrusted
    match:
      any:
      - resources:
          kinds:
          - Pod
          namespaces:
          - untrusted
          - sandbox
    validate:
      message: "Pods in untrusted namespaces must use gVisor runtime"
      pattern:
        spec:
          runtimeClassName: gvisor
---
# Mutating policy to add gVisor automatically
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: default-gvisor-for-sandbox
spec:
  rules:
  - name: add-gvisor-runtime
    match:
      any:
      - resources:
          kinds:
          - Pod
          namespaces:
          - sandbox
    mutate:
      patchStrategicMerge:
        spec:
          runtimeClassName: gvisor
```

### Step 9: Compare Performance

Benchmark gVisor vs standard runtime:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: benchmark-gvisor
spec:
  template:
    spec:
      runtimeClassName: gvisor
      containers:
      - name: benchmark
        image: alpine:latest
        command:
        - sh
        - -c
        - |
          echo "Starting benchmark with gVisor..."
          time for i in $(seq 1 1000); do
            echo "test" > /tmp/file
            cat /tmp/file > /dev/null
          done
          echo "Benchmark complete"
      restartPolicy: Never
---
apiVersion: batch/v1
kind: Job
metadata:
  name: benchmark-runc
spec:
  template:
    spec:
      # No runtimeClassName = default runc
      containers:
      - name: benchmark
        image: alpine:latest
        command:
        - sh
        - -c
        - |
          echo "Starting benchmark with runc..."
          time for i in $(seq 1 1000); do
            echo "test" > /tmp/file
            cat /tmp/file > /dev/null
          done
          echo "Benchmark complete"
      restartPolicy: Never
```

## Verification

Verify gVisor is running:

```bash
# Check RuntimeClass exists
kubectl get runtimeclass gvisor

# Deploy test pod
kubectl run test-gvisor --image=alpine --rm -it \
  --overrides='{"spec":{"runtimeClassName":"gvisor"}}' \
  -- uname -a

# Output should show something like:
# Linux test-gvisor 4.4.0 #1 SMP ... x86_64 Linux
# (gVisor reports a synthetic kernel version)

# Verify runtime
kubectl get pod test-gvisor -o jsonpath='{.spec.runtimeClassName}'
```

Test syscall interception:

```bash
# Create test pod
kubectl run gvisor-test --image=alpine --rm -it \
  --overrides='{"spec":{"runtimeClassName":"gvisor"}}' -- sh

# Inside the container, run:
cat /proc/version  # Shows gVisor version info
dmesg             # May show limited/different output
mount             # May show different mounts than standard container
```

Check gVisor events:

```bash
# List gVisor containers
sudo runsc --root /run/containerd/runsc/k8s.io list

# Get detailed state
sudo runsc --root /run/containerd/runsc/k8s.io state <container-id>

# Monitor events
sudo runsc --root /run/containerd/runsc/k8s.io events <container-id>
```

## Best Practices

1. **Use gVisor for untrusted workloads** only (performance overhead)
2. **Test application compatibility** before deployment
3. **Choose appropriate platform** (systrap/kvm/ptrace)
4. **Monitor memory overhead** from gVisor sentry
5. **Combine with Pod Security Standards** for defense in depth
6. **Use dedicated node pools** for sandboxed workloads
7. **Document compatibility limitations** for development teams
8. **Benchmark critical paths** for performance impact
9. **Keep gVisor updated** for security fixes
10. **Use network=sandbox** for full network isolation

## Limitations and Compatibility

**Not supported in gVisor:**
- Direct device access
- Some ioctl operations
- Certain /proc and /sys features
- Some network protocols
- Certain file system features

**Check compatibility:**
```bash
# Test application with gVisor locally
docker run --runtime=runsc myapp:latest
```

## Common Issues

**Pod fails to start with gVisor:**
- Check if RuntimeClass handler matches containerd config
- Verify gVisor is installed on node
- Check containerd logs for errors

**Performance degradation:**
- Consider using KVM platform if available
- Optimize file-access settings
- Use standard runtime for performance-critical workloads

**Syscall not implemented:**
- Check gVisor compatibility documentation
- Consider using ptrace platform for better compatibility
- Report missing syscalls to gVisor project

## Related Resources

- [gVisor Documentation](https://gvisor.dev/docs/)
- [RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/)
- [gVisor Compatibility](https://gvisor.dev/docs/user_guide/compatibility/)
- [Container Sandboxing](https://gvisor.dev/docs/architecture_guide/security/)

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
