---
title: "OpenShift oc rsync File Transfer"
description: "Use oc rsync to copy files between local machine and Pods in OpenShift. Covers upload, download, live sync, filtering, and common patterns for debugging and data migration."
tags:
  - "openshift"
  - "oc-rsync"
  - "file-transfer"
  - "debugging"
  - "data-migration"
category: "troubleshooting"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "openshift-cli-essentials"
  - "kubernetes-persistent-volumes-guide"
  - "openshift-pod-troubleshooting"
  - "kubernetes-init-containers-guide"
---

> 💡 **Quick Answer:** `oc rsync` copies files/directories between your local filesystem and a running Pod, using either rsync (if available in the container) or tar as a fallback — no need to rebuild images or mount volumes for quick file transfers.

## The Problem

You need to:

- Copy log files out of a Pod for analysis
- Upload config files or patches into a running container
- Sync application code during development without rebuilding
- Extract data from a PVC-mounted directory
- Transfer large datasets into a Pod for processing

## The Solution

### Copy Files from Pod to Local

```bash
# Copy a directory from Pod to local
oc rsync my-pod:/var/log/app/ ./local-logs/

# Copy from a specific container in a multi-container Pod
oc rsync my-pod:/app/data/ ./backup/ -c app-container

# Copy a single file (use the directory containing it)
oc rsync my-pod:/etc/config/ ./local-config/ \
  --include='app.yaml' --exclude='*'
```

### Copy Files from Local to Pod

```bash
# Upload a directory to a Pod
oc rsync ./my-configs/ my-pod:/etc/app/configs/

# Upload with delete (mirror local to remote — removes extra files in Pod)
oc rsync ./deploy/ my-pod:/app/ --delete

# Upload to a specific namespace
oc rsync ./patches/ my-pod:/tmp/patches/ -n production
```

### Live Sync (Watch Mode)

```bash
# Watch local directory and sync changes to Pod in real-time
oc rsync ./src/ my-pod:/app/src/ --watch

# Useful for development — edit locally, see changes in Pod immediately
# Combine with a live-reload framework in the container
```

### Filtering Files

```bash
# Only sync specific file types
oc rsync my-pod:/app/logs/ ./logs/ \
  --include='*.log' \
  --exclude='*'

# Exclude large files
oc rsync my-pod:/app/ ./backup/ \
  --exclude='node_modules' \
  --exclude='*.tar.gz' \
  --exclude='.git'

# Use an exclude file
cat > exclude-list.txt << 'EXCL'
node_modules
*.pyc
__pycache__
.env
EXCL

oc rsync my-pod:/app/ ./local/ --exclude-from=exclude-list.txt
```

### Common Patterns

```bash
# Extract logs from a crashlooping Pod (copy before it restarts)
oc rsync $(oc get pod -l app=my-app -o name | head -1):/var/log/ ./crash-logs/

# Backup a PVC before migration
oc rsync my-pod:/data/ ./pvc-backup/ --progress

# Seed a database container with initial data
oc rsync ./seed-data/ my-pod:/docker-entrypoint-initdb.d/

# Hot-patch a running application (emergency fix)
oc rsync ./hotfix/ my-pod:/app/ --no-perms

# Copy between Pods (via local intermediate)
oc rsync source-pod:/data/ /tmp/transfer/
oc rsync /tmp/transfer/ dest-pod:/data/

# Download heap dump for analysis
oc rsync my-java-pod:/tmp/heapdump/ ./heap-analysis/
```

### Strategy Selection

```bash
# Force tar strategy (when rsync not available in container)
oc rsync my-pod:/data/ ./local/ --strategy=tar

# Force rsync strategy (faster for incremental sync)
oc rsync my-pod:/data/ ./local/ --strategy=rsync

# Default: tries rsync first, falls back to tar
```

### Permissions and Options

```bash
# Preserve permissions
oc rsync my-pod:/app/ ./backup/

# Skip permission sync (useful when local/remote UID differ)
oc rsync ./configs/ my-pod:/etc/app/ --no-perms

# Show progress for large transfers
oc rsync my-pod:/data/ ./large-backup/ --progress

# Compress during transfer (slower CPU, less network)
oc rsync my-pod:/data/ ./backup/ --compress
```

### Scripted Backup Pattern

```bash
#!/bin/bash
# Backup all Pods matching a label
NAMESPACE="production"
LABEL="app=my-service"
BACKUP_DIR="./backups/$(date +%Y%m%d)"

mkdir -p "$BACKUP_DIR"

for pod in $(oc get pods -n "$NAMESPACE" -l "$LABEL" -o name); do
  POD_NAME=$(basename "$pod")
  echo "Backing up $POD_NAME..."
  oc rsync "${POD_NAME}:/app/data/" "${BACKUP_DIR}/${POD_NAME}/" \
    -n "$NAMESPACE" --progress --compress
done

echo "Backup complete: $BACKUP_DIR"
```

## Common Issues

### "rsync: command not found" in container
- **Cause**: Minimal container image without rsync binary
- **Fix**: `oc rsync` automatically falls back to tar strategy; or use `--strategy=tar`

### Permission denied writing to Pod
- **Cause**: Container runs as non-root; target directory owned by root
- **Fix**: Use `--no-perms`; or target a writable directory like `/tmp`

### Transfer hangs on large files
- **Cause**: Network timeout or tar strategy buffer limits
- **Fix**: Use `--compress`; split into smaller directories; check network policies

### Trailing slash matters
- **Cause**: `oc rsync pod:/dir` vs `oc rsync pod:/dir/` behaves differently
- **Fix**: Always include trailing slash on source to copy directory contents (not the directory itself)

### "error: unable to upgrade connection"
- **Cause**: Network proxy or route doesn't support WebSocket upgrade
- **Fix**: Check `oc` CLI version matches cluster; verify route/proxy supports SPDY/WebSocket

## Best Practices

1. **Always use trailing slash on source** — `pod:/app/` copies contents; `pod:/app` copies the directory
2. **Use `--exclude`** for node_modules, .git, build artifacts
3. **`--no-perms` for cross-platform** — avoids UID/GID conflicts
4. **`--strategy=tar`** for containers without rsync installed
5. **`--watch` for development** — live sync without image rebuilds
6. **`--delete` carefully** — removes files in destination not present in source
7. **Test with `--dry-run`** (if available) or small subset first

## Key Takeaways

- `oc rsync` transfers files between local ↔ Pod without image rebuilds
- Works even with distroless containers (falls back to tar)
- Trailing slash on source path = copy contents; no slash = copy directory
- `--watch` enables live development sync
- `--strategy=tar` when rsync unavailable; `--strategy=rsync` for incremental
- Use `--no-perms` to avoid UID/GID permission mismatches
- Great for log extraction, hot-patching, data seeding, and PVC backups
