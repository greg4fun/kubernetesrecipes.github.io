---
title: "What's New in containerd v2.4.2: Security Patches and Hardening"
description: "containerd 2.4.2 patch release fixes 3 CVEs, hardens CRI log handling, seccomp, and image pulls. Upgrade steps and verification included."
publishDate: "2026-10-24"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "containerd"
  - "cri"
  - "security"
  - "cve"
  - "runtime"
  - "upgrade"
  - "runc"
---
> 💡 **Quick Answer:** containerd v2.4.2 is a patch release for the 2.4 branch that fixes three CVEs and hardens CRI log file handling, image reference parsing, seccomp socket domains, and image-pull memory usage. Operators on 2.4.x should upgrade; this is not a feature release.

## The Problem

containerd 2.4.1 and earlier in the 2.4 branch are affected by security issues patched in this release, including symlink-following risks in CRI container log files, unbounded memory growth during image pulls when registry downloads outpace local writes, and a non-allowlisted seccomp socket domain policy that is broader than necessary. Image references containing `..` path components could also be used to rewrite the target host.

## The Solution

Upgrade to containerd v2.4.2, which bundles the fixes below along with an updated `runc` binary (v1.5.2) and Go toolchain (go1.26.9 / go1.27.2) for additional security hardening.

## Whats New

**Security fixes (CVEs):**
- [CVE-2026-95839](https://github.com/containerd/containerd/security/advisories/GHSA-vwhp-8p66-mq4f)
- [GHSA-8647-2jxj-p2rc](https://github.com/containerd/containerd/security/advisories/GHSA-8647-2jxj-p2rc)
- [GHSA-hc94-p972-ch66](https://github.com/containerd/containerd/security/advisories/GHSA-hc94-p972-ch66)

**CRI:**
- Hardening to not follow symlinks for container log files ([#14302](https://github.com/containerd/containerd/pull/14302))

**Image Distribution:**
- Fixed excessive memory usage during image pulls when registry downloads outpace content writes, via bounded parallel fetch readers and throttled worker chunk buffers ([#14342](https://github.com/containerd/containerd/pull/14342))
- Hardening to reject image references containing `..` path components that could rewrite the host ([#14282](https://github.com/containerd/containerd/pull/14282))

**Runtime:**
- Seccomp default profile now uses an allowlist for socket domains instead of a denylist ([#14247](https://github.com/containerd/containerd/pull/14247))
- Bundled `runc` updated to v1.5.2 ([#14241](https://github.com/containerd/containerd/pull/14241))

No dependency changes and no breaking API changes are noted for this patch release. No deprecations were announced.

## Upgrade Steps

These steps assume containerd is installed from upstream binaries (not a distro package). Adjust paths for your OS/distro packaging if you use one (e.g. `apt`, `dnf`).

```bash
# 1. Check current version
containerd --version

# 2. Download the release tarball (dynamically linked, glibc >= 2.35)
VERSION=2.4.2
ARCH=amd64 # or arm64
curl -LO https://github.com/containerd/containerd/releases/download/v${VERSION}/containerd-${VERSION}-linux-${ARCH}.tar.gz

# 3. Verify checksum (recommended)
curl -LO https://github.com/containerd/containerd/releases/download/v${VERSION}/containerd-${VERSION}-linux-${ARCH}.tar.gz.sha256sum
sha256sum -c containerd-${VERSION}-linux-${ARCH}.tar.gz.sha256sum

# 4. Drain the node before touching the runtime
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# 5. Stop containerd, extract new binaries, restart
systemctl stop containerd
sudo tar Cxzvf /usr/local containerd-${VERSION}-linux-${ARCH}.tar.gz
systemctl daemon-reload
systemctl restart containerd

# 6. Update runc as well (bundled fix, v1.5.2)
curl -Lo runc https://github.com/opencontainers/runc/releases/download/v1.5.2/runc.${ARCH}
sudo install -m 755 runc /usr/local/sbin/runc

# 7. Uncordon the node
kubectl uncordon <node-name>
```

For Helm-managed node images (e.g. via a custom AMI/bootstrap chart), bump the pinned `containerd` and `runc` versions in your `values.yaml` and roll nodes through your usual node-group update mechanism (e.g. `eksctl`, `kubeadm`, or your cluster-autoscaler image rotation).

## Verify

```bash
# Confirm the running version on the node
containerd --version
# Expected: containerd github.com/containerd/containerd/v2 v2.4.2 ...

# Confirm runc version
runc --version
# Expected: runc version 1.5.2

# Confirm containerd service is healthy
systemctl status containerd --no-pager

# Confirm the kubelet can still talk to the CRI socket
crictl info

# Confirm the node is Ready again
kubectl get node <node-name>
```

## Common Issues

- **CRI socket mismatch after binary swap**: if `crictl info` or kubelet logs show connection errors, confirm `containerd.sock` path hasn't changed and restart `kubelet` after `containerd`.
- **Seccomp allowlist regressions**: workloads relying on uncommon socket domains in custom seccomp profiles (not the default) are unaffected, but if you were depending on containerd's old default seccomp behavior allowing arbitrary socket domains, re-test workloads that use less common socket families (e.g. `AF_VSOCK`, `AF_NETLINK` variants) after upgrade.
- **Image references with `..`**: any pull jobs or CI pipelines generating synthetic image references with path traversal segments will now fail pulls; this is intentional hardening, fix the reference generation instead of working around it.

## Best Practices

- Treat 2.4.x patch releases as security-relevant and apply them promptly given the three CVEs fixed here.
- Roll node upgrades one at a time with `kubectl drain`/`uncordon` rather than restarting containerd on all nodes simultaneously.
- Pin exact `containerd` and `runc` versions in node bootstrap scripts/IaC so upgrades are deliberate and auditable.
- Review the [containerd v2.4.2 release page](https://github.com/containerd/containerd/releases/tag/v2.4.2) and linked GHSA advisories for full CVE details relevant to your threat model.
