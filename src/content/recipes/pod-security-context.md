---
title: "How to Configure Pod Security Context"
description: "Secure your Kubernetes pods with Security Context settings. Learn to set user/group IDs, file system permissions, capabilities, and privilege escalation controls."
category: "security"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured with appropriate permissions"
  - "Basic understanding of Linux security concepts"
relatedRecipes:
  - "pod-security-standards"
  - "pod-security-admission"
  - "rbac-service-accounts"
tags:
  - security-context
  - security
  - pod-security
  - containers
  - linux-capabilities
  - seccomp
publishDate: "2026-01-28"
author: "Luca Berton"
---

## The Problem

Your containers run as root by default, which poses security risks. You need to restrict container privileges and enforce security boundaries.

## The Solution

Configure Security Context at both Pod and Container levels to define privilege and access control settings.

## Security Context Hierarchy

```
Security Context Levels:

┌─────────────────────────────────────────────────────────┐
│  POD-LEVEL SECURITY CONTEXT                             │
│  (Applies to all containers in the pod)                │
│                                                         │
│  • runAsUser / runAsGroup                               │
│  • fsGroup / fsGroupChangePolicy                        │
│  • supplementalGroups                                   │
│  • seccompProfile                                       │
│  • sysctls                                              │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  CONTAINER-LEVEL SECURITY CONTEXT               │   │
│  │  (Overrides pod-level for specific container)  │   │
│  │                                                  │   │
│  │  • runAsUser / runAsGroup                        │   │
│  │  • runAsNonRoot                                  │   │
│  │  • privileged                                    │   │
│  │  • capabilities (add/drop)                       │   │
│  │  • allowPrivilegeEscalation                      │   │
│  │  • readOnlyRootFilesystem                        │   │
│  │  • seccompProfile                                │   │
│  │  • seLinuxOptions                                │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Basic Security Context Configuration

### Run as Non-Root User

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
  containers:
    - name: app
      image: nginx:1.25
      securityContext:
        runAsNonRoot: true
        allowPrivilegeEscalation: false
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      emptyDir: {}
```

### Security Context Explained

| Field | Level | Description |
|-------|-------|-------------|
| `runAsUser` | Pod/Container | UID to run the container process |
| `runAsGroup` | Pod/Container | Primary GID for the container process |
| `fsGroup` | Pod | GID for volume ownership and permissions |
| `runAsNonRoot` | Container | Fail if container runs as root (UID 0) |
| `allowPrivilegeEscalation` | Container | Allow process to gain more privileges than parent |
| `readOnlyRootFilesystem` | Container | Mount root filesystem as read-only |

## Comprehensive Secure Pod Configuration

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-pod
  labels:
    app: secure-app
spec:
  # Pod-level security context
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    fsGroupChangePolicy: "OnRootMismatch"
    supplementalGroups: [4000]
    seccompProfile:
      type: RuntimeDefault

  containers:
    - name: app
      image: myapp:1.0
      ports:
        - containerPort: 8080

      # Container-level security context
      securityContext:
        runAsNonRoot: true
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
          add:
            - NET_BIND_SERVICE  # Only if binding to ports < 1024
        seccompProfile:
          type: RuntimeDefault

      # Writable directories for app
      volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /var/cache/app
        - name: run
          mountPath: /var/run

      resources:
        limits:
          memory: "128Mi"
          cpu: "500m"
        requests:
          memory: "64Mi"
          cpu: "250m"

  volumes:
    - name: tmp
      emptyDir: {}
    - name: cache
      emptyDir: {}
    - name: run
      emptyDir: {}

  # Additional security settings
  automountServiceAccountToken: false
  hostNetwork: false
  hostPID: false
  hostIPC: false
```

## Linux Capabilities

### Drop All and Add Specific

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: minimal-capabilities-pod
spec:
  containers:
    - name: app
      image: myapp:1.0
      securityContext:
        capabilities:
          drop:
            - ALL
          add:
            - NET_BIND_SERVICE  # Bind to privileged ports
            # - CHOWN           # Change file ownership
            # - SETUID          # Set user ID
            # - SETGID          # Set group ID
            # - SYS_CHROOT      # Use chroot
```

### Common Linux Capabilities

| Capability | Description | Use Case |
|------------|-------------|----------|
| `NET_BIND_SERVICE` | Bind to ports < 1024 | Web servers on port 80/443 |
| `NET_RAW` | Use RAW/PACKET sockets | Network diagnostics (ping) |
| `SYS_PTRACE` | Trace processes | Debugging tools |
| `SYS_ADMIN` | Various admin operations | Mounting filesystems |
| `CHOWN` | Change file ownership | File management |
| `DAC_OVERRIDE` | Bypass file permission checks | Admin tools |

### Network Tool Pod (Debugging)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: network-debug-pod
spec:
  containers:
    - name: debug
      image: nicolaka/netshoot:latest
      securityContext:
        runAsNonRoot: false  # Some tools need root
        capabilities:
          drop:
            - ALL
          add:
            - NET_RAW        # For ping, traceroute
            - NET_ADMIN      # For network config
      command: ["sleep", "infinity"]
```

## File System Group (fsGroup)

### Understanding fsGroup Behavior

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: fsgroup-demo
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 2000  # All files in mounted volumes will be owned by GID 2000
    fsGroupChangePolicy: "OnRootMismatch"  # Only change if not already correct
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "ls -la /data && sleep infinity"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: my-pvc
```

### fsGroupChangePolicy Options

| Policy | Description |
|--------|-------------|
| `Always` | Always recursively change ownership (default) |
| `OnRootMismatch` | Only change if root directory ownership differs |

## Read-Only Root Filesystem

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: readonly-root-pod
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      securityContext:
        readOnlyRootFilesystem: true
      volumeMounts:
        # Nginx needs writable directories
        - name: tmp
          mountPath: /tmp
        - name: var-run
          mountPath: /var/run
        - name: var-cache-nginx
          mountPath: /var/cache/nginx
        - name: var-log-nginx
          mountPath: /var/log/nginx
  volumes:
    - name: tmp
      emptyDir: {}
    - name: var-run
      emptyDir: {}
    - name: var-cache-nginx
      emptyDir: {}
    - name: var-log-nginx
      emptyDir: {}
```

## Seccomp Profiles

### Using Runtime Default Profile

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: seccomp-default-pod
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: myapp:1.0
```

### Custom Seccomp Profile

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: custom-seccomp-pod
spec:
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/custom-profile.json
  containers:
    - name: app
      image: myapp:1.0
```

Custom profile example (`/var/lib/kubelet/seccomp/profiles/custom-profile.json`):

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64"],
  "syscalls": [
    {
      "names": [
        "accept4", "bind", "clone", "close", "connect",
        "epoll_create1", "epoll_ctl", "epoll_pwait",
        "execve", "exit_group", "fcntl", "fstat",
        "futex", "getdents64", "getpid", "getrandom",
        "listen", "mmap", "mprotect", "nanosleep",
        "openat", "read", "rt_sigaction", "rt_sigprocmask",
        "setsockopt", "socket", "write"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

## SELinux Options

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: selinux-pod
spec:
  securityContext:
    seLinuxOptions:
      level: "s0:c123,c456"
  containers:
    - name: app
      image: myapp:1.0
      securityContext:
        seLinuxOptions:
          level: "s0:c123,c456"
          user: "system_u"
          role: "system_r"
          type: "container_t"
```

## AppArmor Profiles

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: apparmor-pod
  annotations:
    container.apparmor.security.beta.kubernetes.io/app: runtime/default
spec:
  containers:
    - name: app
      image: myapp:1.0
```

## Complete Secure Deployment

```yaml
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
      serviceAccountName: secure-app-sa
      automountServiceAccountToken: false
      
      securityContext:
        runAsUser: 10000
        runAsGroup: 10000
        fsGroup: 10000
        seccompProfile:
          type: RuntimeDefault

      containers:
        - name: app
          image: myapp:1.0
          ports:
            - containerPort: 8080
              protocol: TCP

          securityContext:
            runAsNonRoot: true
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL

          resources:
            limits:
              memory: "256Mi"
              cpu: "500m"
            requests:
              memory: "128Mi"
              cpu: "250m"

          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10

          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5

          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: config
              mountPath: /etc/app/config
              readOnly: true

      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 100Mi
        - name: config
          configMap:
            name: app-config

      # Network isolation
      hostNetwork: false
      hostPID: false
      hostIPC: false
      
      # DNS policy
      dnsPolicy: ClusterFirst
```

## Verification Commands

```bash
# Check running user/group
kubectl exec secure-pod -- id

# Verify read-only filesystem
kubectl exec readonly-root-pod -- touch /test.txt
# Should fail with "Read-only file system"

# Check capabilities
kubectl exec minimal-capabilities-pod -- cat /proc/1/status | grep Cap

# Decode capabilities
capsh --decode=00000000a80425fb

# Verify seccomp profile
kubectl exec seccomp-default-pod -- cat /proc/1/status | grep Seccomp

# Check file permissions with fsGroup
kubectl exec fsgroup-demo -- ls -la /data
```

## Troubleshooting

### Container Fails to Start as Non-Root

```bash
# Check if image supports non-root
docker run --rm -u 1000:1000 myapp:1.0 whoami

# Solution: Use images designed for non-root or rebuild
FROM nginx:1.25
RUN chown -R 1000:1000 /var/cache/nginx /var/run /var/log/nginx
USER 1000
```

### Permission Denied on Volume

```yaml
# Ensure fsGroup matches or use initContainer to fix permissions
initContainers:
  - name: fix-permissions
    image: busybox:1.36
    command: ["sh", "-c", "chown -R 1000:1000 /data"]
    volumeMounts:
      - name: data
        mountPath: /data
    securityContext:
      runAsUser: 0  # Run as root to change ownership
```

## Summary

Security Context is essential for hardening Kubernetes workloads. Always follow the principle of least privilege: drop all capabilities, run as non-root, use read-only filesystems, and enable seccomp profiles.

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
