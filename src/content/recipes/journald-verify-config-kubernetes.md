---
title: "Journald Verify Config Kubernetes Nodes"
description: "Validate journald configuration on Kubernetes nodes with --verify-config. Fix journal corruption, tune storage limits, configure log persistence, and troubleshoot systemd-journald on RHEL and CoreOS."
publishDate: "2026-04-30"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "journald"
  - "systemd"
  - "logging"
  - "troubleshooting"
  - "rhel"
  - "openshift"
relatedRecipes:
  - "fluent-bit-kubernetes-logging"
  - "openshift-machineconfig-mcp-guide"
  - "troubleshoot-node-not-ready-kubernetes"
  - "kubernetes-node-drain-cordon"
---

> 💡 **Quick Answer:** Run `journalctl --verify` to check journal file integrity, and validate your journald configuration with `systemd-analyze cat-config systemd/journald.conf` then `systemctl restart systemd-journald`. On Kubernetes nodes, journald misconfigurations cause log loss, disk exhaustion, or kubelet log collection failures. Common fix: set `SystemMaxUse=4G`, `MaxRetentionSec=7day`, and `Storage=persistent` in `/etc/systemd/journald.conf`.

## The Problem

Journald is the log backbone on every Kubernetes node — kubelet, container runtime, and system services all log through it. Misconfigurations cause:

- **Disk full** — unbounded journal fills the node's root filesystem
- **Log loss** — volatile storage loses logs on reboot
- **Corrupt journals** — unclean shutdown corrupts binary journal files
- **Kubelet log collection fails** — `kubectl logs` returns empty
- **Log forwarding gaps** — Fluent Bit/Fluentd can't read from broken journals

## The Solution

### Verify Journal Integrity

```bash
# Check all journal files for corruption
journalctl --verify
# PASS: /var/log/journal/abc123/system.journal
# PASS: /var/log/journal/abc123/user-1000.journal
# FAIL: /var/log/journal/abc123/system@old.journal  ← Corrupt!

# Verify specific journal directory
journalctl --verify --directory=/var/log/journal

# Check journal disk usage
journalctl --disk-usage
# Archived and active journals take up 2.4G in /var/log/journal

# Show current journal configuration
systemd-analyze cat-config systemd/journald.conf
```

### Validate and Fix Configuration

```bash
# View effective journald config (merged from all drop-ins)
systemd-analyze cat-config systemd/journald.conf

# Check for syntax errors
systemd-analyze verify /etc/systemd/journald.conf 2>&1

# Recommended configuration for Kubernetes nodes
cat > /etc/systemd/journald.conf.d/99-kubernetes.conf << 'EOF'
[Journal]
# Persistent storage (survives reboot)
Storage=persistent

# Limit total journal size (prevent disk exhaustion)
SystemMaxUse=4G
SystemKeepFree=1G
SystemMaxFileSize=128M

# Runtime (volatile) limits
RuntimeMaxUse=512M

# Retention
MaxRetentionSec=7day
MaxFileSec=1day

# Rate limiting (prevent log floods from crashing pods)
RateLimitIntervalSec=30s
RateLimitBurst=10000

# Compression
Compress=yes

# Forward to syslog for compatibility
ForwardToSyslog=no
ForwardToConsole=no
EOF

# Restart journald to apply
systemctl restart systemd-journald

# Verify new config is active
journalctl --header | grep -E "File size|State"
```

### Configuration Parameters

| Parameter | Recommended | Purpose |
|-----------|-------------|---------|
| `Storage=persistent` | ✅ | Persist logs to `/var/log/journal` |
| `SystemMaxUse=4G` | ✅ | Cap total journal size |
| `SystemKeepFree=1G` | ✅ | Reserve disk space for system |
| `SystemMaxFileSize=128M` | ✅ | Individual journal file size |
| `MaxRetentionSec=7day` | ✅ | Auto-delete logs older than 7 days |
| `RateLimitBurst=10000` | ✅ | Allow burst logging from containers |
| `Compress=yes` | ✅ | Save ~50% disk space |

### Kubernetes Node — MachineConfig (OpenShift)

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-journald-kubernetes
  labels:
    machineconfiguration.openshift.io/role: worker
spec:
  config:
    ignition:
      version: 3.2.0
    storage:
      files:
      - path: /etc/systemd/journald.conf.d/99-kubernetes.conf
        mode: 0644
        contents:
          source: data:text/plain;charset=utf-8,%5BJournal%5D%0AStorage%3Dpersistent%0ASystemMaxUse%3D4G%0ASystemKeepFree%3D1G%0ASystemMaxFileSize%3D128M%0AMaxRetentionSec%3D7day%0ARateLimitBurst%3D10000%0ACompress%3Dyes%0A
```

### Fix Corrupt Journal Files

```bash
# Identify corrupt files
journalctl --verify 2>&1 | grep FAIL
# FAIL: /var/log/journal/abc123/system@00061-0005abc.journal

# Remove corrupt file (journald recreates automatically)
rm /var/log/journal/abc123/system@00061-0005abc.journal

# Restart journald
systemctl restart systemd-journald

# Verify clean
journalctl --verify
```

### Vacuum Old Journals

```bash
# Remove journals older than 3 days
journalctl --vacuum-time=3d

# Reduce journal size to 2G
journalctl --vacuum-size=2G

# Remove all archived journals
journalctl --vacuum-files=2
```

### Debug kubectl logs Empty

```bash
# kubelet reads container logs from /var/log/pods/ (not journald directly)
# But CRI-O/containerd log to journald

# Check if journald is running
systemctl status systemd-journald

# Check kubelet's log source
journalctl -u kubelet --since "10 min ago" | tail -20

# Check container runtime logs
journalctl -u crio --since "10 min ago" | tail -20
# or
journalctl -u containerd --since "10 min ago" | tail -20

# If journal is full, new logs are dropped
journalctl --disk-usage
df -h /var/log/journal
```

## Common Issues

**"Failed to open journal: No space left on device"**

Journal filled the disk. Emergency fix: `journalctl --vacuum-size=1G`. Then set `SystemMaxUse` to prevent recurrence.

**Logs missing after node reboot**

`Storage=volatile` (default on some distros) keeps logs in `/run/log/journal` (tmpfs). Change to `Storage=persistent`.

**Rate limiting dropping container logs**

Default `RateLimitBurst=10000` in 30s. High-throughput pods exceed this. Increase or set `RateLimitIntervalSec=0` to disable (not recommended).

**Journal files grow indefinitely despite MaxRetentionSec**

`MaxRetentionSec` only applies when journald rotates files. If `SystemMaxFileSize` is too large, rotation is infrequent. Set both `SystemMaxUse` AND `MaxRetentionSec`.

## Best Practices

- **`Storage=persistent`** on all Kubernetes nodes — volatile loses logs on reboot
- **`SystemMaxUse=4G`** — prevent journal from filling root filesystem
- **`journalctl --verify`** after unclean shutdown — catch corruption early
- **Use MachineConfig on OpenShift** — ensures config survives upgrades
- **Monitor journal disk usage** — alert at 80% of SystemMaxUse
- **`RateLimitBurst=10000`** minimum for K8s — containers generate high log volume

## Key Takeaways

- `journalctl --verify` checks journal file integrity — run after crashes
- `systemd-analyze cat-config systemd/journald.conf` shows effective merged config
- Set `Storage=persistent`, `SystemMaxUse=4G`, `MaxRetentionSec=7day` on K8s nodes
- Corrupt journal files can be safely deleted — journald recreates them
- On OpenShift, use MachineConfig drop-ins for persistent journald configuration
- Journal disk exhaustion causes log loss AND can fill root FS → node NotReady
