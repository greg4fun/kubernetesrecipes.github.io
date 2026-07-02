---
title: "K8s SecurityContext: Container Hardening"
description: "Configure Kubernetes SecurityContext for pods and containers. runAsNonRoot, readOnlyRootFilesystem, capabilities, seccomp profiles, and privilege escalation."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "security-context"
  - "security"
  - "containers"
  - "hardening"
  - "cka"
relatedRecipes:
  - "kubernetes-pod-security-admission"
  - "kubernetes-rbac-role-rolebinding"
  - "kubernetes-serviceaccount-guide"
  - "kubernetes-audit-logging-guide"
  - "kubernetes-certificate-management"
  - "kubernetes-kyverno-policy-guide"
  - "kubernetes-falco-runtime-security"
  - "kubernetes-trivy-security-scanning"
  - "cve-2026-31431-linux-kernel-crypto-algif-aead"
---

> 💡 **Quick Answer:** SecurityContext controls pod and container privileges. Minimum hardening: `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities: {drop: ["ALL"]}`, `seccompProfile: {type: RuntimeDefault}`. Set at pod level for defaults, override per container when needed.

## The Problem

By default, containers run with more privileges than necessary:

- Root user (UID 0) inside the container
- Write access to the container filesystem
- Inherits Linux capabilities (kill, chown, setuid)
- Can escalate privileges
- No seccomp filtering

## The Solution

### Full Hardened SecurityContext

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-app
spec:
  # Pod-level security (applies to all containers)
  securityContext:
    runAsNonRoot: true           # Reject if image runs as root
    runAsUser: 1000              # Run as UID 1000
    runAsGroup: 1000             # Primary GID
    fsGroup: 2000                # Volume GID
    fsGroupChangePolicy: OnRootMismatch  # Faster volume permission changes
    seccompProfile:
      type: RuntimeDefault       # Container runtime's default seccomp
    supplementalGroups: [3000]   # Additional GIDs
  
  containers:
  - name: app
    image: myapp:v2
    # Container-level security (overrides pod-level)
    securityContext:
      allowPrivilegeEscalation: false   # No setuid/setgid
      readOnlyRootFilesystem: true      # Immutable filesystem
      capabilities:
        drop: ["ALL"]                   # Remove all Linux capabilities
        # add: ["NET_BIND_SERVICE"]     # Only add what's needed
      privileged: false                 # Never run privileged
    
    # Writable directories via volumes
    volumeMounts:
    - name: tmp
      mountPath: /tmp
    - name: cache
      mountPath: /app/cache
  
  volumes:
  - name: tmp
    emptyDir: {}
  - name: cache
    emptyDir: {}
```

### Pod vs Container SecurityContext

```yaml
spec:
  # Pod-level: applies to ALL containers (and init containers)
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 2000
    seccompProfile:
      type: RuntimeDefault
  
  containers:
  - name: app
    image: myapp:v2
    # Container-level: overrides pod-level for THIS container
    securityContext:
      runAsUser: 2000        # Override pod's 1000
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
  
  - name: sidecar
    image: fluent-bit:3.0
    # Inherits pod-level: runAsNonRoot=true, runAsUser=1000
    securityContext:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
```

### Common Capability Patterns

```yaml
# Web server binding to port 80 (< 1024 needs capability)
securityContext:
  capabilities:
    drop: ["ALL"]
    add: ["NET_BIND_SERVICE"]   # Bind low ports

# Network debugging tools (tcpdump, iptables)
securityContext:
  capabilities:
    drop: ["ALL"]
    add: ["NET_ADMIN", "NET_RAW"]

# Ping
securityContext:
  capabilities:
    drop: ["ALL"]
    add: ["NET_RAW"]

# System monitoring (read-only)
securityContext:
  capabilities:
    drop: ["ALL"]
    add: ["SYS_PTRACE"]        # Read /proc of other processes
```

### ReadOnly Filesystem with Writable Paths

```yaml
containers:
- name: nginx
  image: nginx:1.27
  securityContext:
    readOnlyRootFilesystem: true
  volumeMounts:
  - name: tmp
    mountPath: /tmp
  - name: run
    mountPath: /var/run
  - name: cache
    mountPath: /var/cache/nginx
  - name: logs
    mountPath: /var/log/nginx

volumes:
- name: tmp
  emptyDir: {}
- name: run
  emptyDir: {}
- name: cache
  emptyDir: {}
- name: logs
  emptyDir: {}
```

### fsGroup and Volume Permissions

```yaml
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 2000          # All volume files get GID 2000
    fsGroupChangePolicy: OnRootMismatch  # Only change when needed (fast)
  
  containers:
  - name: app
    image: myapp:v2
    volumeMounts:
    - name: data
      mountPath: /data
    # Files in /data will have group 2000
    # Container process runs as uid=1000, gid=1000, groups=2000

  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: app-data
```

### Verify SecurityContext

```bash
# Check what user the container runs as
kubectl exec my-pod -- id
# uid=1000 gid=1000 groups=2000

# Check capabilities
kubectl exec my-pod -- cat /proc/1/status | grep -i cap
# CapBnd: 0000000000000000   (no capabilities)

# Check filesystem
kubectl exec my-pod -- touch /test
# touch: /test: Read-only file system ✅

# Check seccomp
kubectl exec my-pod -- cat /proc/1/status | grep Seccomp
# Seccomp:  2  (filter mode)
```

### Custom Seccomp, SELinux, and AppArmor

`RuntimeDefault` seccomp covers most cases; a custom profile is a tighter allowlist for workloads where you know exactly which syscalls are needed:

```yaml
securityContext:
  seccompProfile:
    type: Localhost
    localhostProfile: profiles/custom-profile.json   # relative to the kubelet's seccomp root
```

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64"],
  "syscalls": [{"names": ["accept4", "bind", "close", "connect", "read", "write"], "action": "SCMP_ACT_ALLOW"}]
}
```

```yaml
# SELinux (RHEL/OpenShift nodes)
securityContext:
  seLinuxOptions: {level: "s0:c123,c456", type: "container_t"}
```

```yaml
# AppArmor
metadata:
  annotations: {container.apparmor.security.beta.kubernetes.io/app: runtime/default}
```

### Fixing an Image That Doesn't Support Non-Root

Not every base image works under `runAsNonRoot` out of the box — directories the process needs to write to may be owned by root:

```dockerfile
FROM nginx:1.25
RUN chown -R 1000:1000 /var/cache/nginx /var/run /var/log/nginx
USER 1000
```

If you can't rebuild the image, fix ownership at pod startup instead with a root initContainer:

```yaml
initContainers:
  - name: fix-permissions
    image: busybox:1.36
    command: ["sh", "-c", "chown -R 1000:1000 /data"]
    securityContext: {runAsUser: 0}   # needs root to chown, main container still runs non-root
    volumeMounts: [{name: data, mountPath: /data}]
```

## Common Issues

**Container fails with "permission denied"**

Running as non-root but image writes to root-owned directories. Add emptyDir volumes for writable paths or rebuild image with correct ownership.

**"readOnlyRootFilesystem" breaks application**

App writes to filesystem (logs, temp files, PID files). Mount emptyDir volumes at each writable path.

**fsGroup makes pod startup slow**

Large volumes with many files — Kubernetes recursively chowns everything. Use `fsGroupChangePolicy: OnRootMismatch` (K8s 1.20+).

## Best Practices

- **Drop ALL capabilities** then add only what's needed — principle of least privilege
- **runAsNonRoot + specific runAsUser** — never run as root
- **readOnlyRootFilesystem** — prevents filesystem-based attacks
- **allowPrivilegeEscalation: false** — blocks setuid binaries
- **seccompProfile: RuntimeDefault** — filters dangerous syscalls
- **Never set `privileged: true`** unless absolutely required (and document why)

## Key Takeaways

- SecurityContext controls UID/GID, capabilities, filesystem, and seccomp per pod/container
- Minimum hardening: runAsNonRoot, drop ALL caps, readOnly filesystem, no privilege escalation
- Pod-level sets defaults; container-level overrides per container
- Use emptyDir volumes for writable paths with readOnlyRootFilesystem
- fsGroup sets volume ownership for the pod's group
