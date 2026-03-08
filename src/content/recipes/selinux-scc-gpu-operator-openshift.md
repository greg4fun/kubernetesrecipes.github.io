---
title: "SELinux and SCC Config for GPU Operator"
description: "Understand SELinux device relabeling and Security Context Constraints (SCC) requirements for the NVIDIA GPU Operator driver pods on OpenShift."
category: "security"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenShift 4.10+ cluster"
  - "NVIDIA GPU Operator installed"
  - "SELinux in enforcing mode (default on RHCOS)"
relatedRecipes:
  - "switch-proprietary-to-open-kernel-modules"
  - "fix-nvidia-peermem-not-detected"
  - "configure-clusterpolicy-kernel-module-type"
  - "troubleshoot-nvidia-fs-module-conflict"
tags:
  - nvidia
  - gpu-operator
  - selinux
  - scc
  - openshift
  - security
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** The driver pod logs `SELinux is enabled / Change device files security context` — these are normal informational messages, not errors. The GPU Operator driver DaemonSet runs under the `privileged` SCC to perform kernel module insertion and SELinux device relabeling.


When running the NVIDIA GPU Operator on OpenShift with SELinux enforcing, the driver container logs device relabeling messages that can be mistaken for errors.

## Normal Log Messages

These messages are expected and indicate successful operation:

```text
SELinux is enabled
Change device files security context for selinux compatibility
Done, now waiting for signal
```

The driver container runs `chcon` or `restorecon` on `/dev/nvidia*` device nodes to make them accessible under the host SELinux policy.

## What the Driver Container Does

1. Detects SELinux enforcement mode
2. Applies correct security contexts to NVIDIA device files
3. Changes file contexts from `modules_object_t` for kernel module compatibility
4. Signals readiness and waits for shutdown

This is visible in the driver init sequence:

```text
find . -type f '(' -name '*.txt' -or -name '*.go' ')' -exec chcon -t modules_object_t '{}' ';'
```

## SCC Requirements

The GPU driver DaemonSet requires the `privileged` SCC to:

- Insert kernel modules (`modprobe`, `insmod`)
- Access host device nodes (`/dev/nvidia*`)
- Mount host filesystems
- Perform SELinux relabeling

Verify the SCC assignment:

```bash
oc describe pod -n gpu-operator \
  $(oc get pod -n gpu-operator -l app=nvidia-driver-daemonset -o name | head -1) \
  | grep scc
```

Expected:

```text
openshift.io/scc=privileged
```

## When SCC Causes Real Problems

If the SCC is misconfigured, you will see actual errors:

```text
permission denied on /dev/nvidia*
modprobe: could not insert 'nvidia': Permission denied
operation not permitted
```

These indicate the driver pod is not running under the `privileged` SCC. Fix by ensuring the GPU Operator service account has the correct role binding:

```bash
oc adm policy add-scc-to-user privileged \
  -z nvidia-driver -n gpu-operator
```

## Troubleshoot SELinux Denials

Check for actual SELinux denials:

```bash
oc debug node/<node-name>
chroot /host
ausearch -m AVC -ts recent | grep nvidia
```

If denials exist, they typically involve device access or module loading — not the informational messages above.

## Why This Matters

Understanding these log messages prevents false alarm investigations. The `privileged` SCC is essential for GPU driver operation, and the SELinux relabeling is a necessary step for device compatibility on RHCOS.
