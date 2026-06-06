---
title: "OpenShift oc cp File Copy Guide"
description: "Use oc cp to copy files and directories between local machine and Pods. Covers tar-based transfer, container selection, large file handling, and comparison"
tags:
  - "openshift"
  - "oc-cp"
  - "file-transfer"
  - "debugging"
  - "kubectl-cp"
category: "troubleshooting"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "openshift-oc-rsync-file-transfer"
  - "kubernetes-persistent-volumes-guide"
  - "kubernetes-ephemeral-containers-debug"
---

> 💡 **Quick Answer:** `oc cp` (same as `kubectl cp`) copies files between your local machine and a Pod using tar over the exec API. Unlike `oc rsync`, it works for single files and doesn't require rsync or tar in the container path — only `/bin/tar` must exist.

## The Problem

You need to:

- Copy a single file into or out of a running Pod
- Transfer files when `oc rsync` isn't available or appropriate
- Extract crash dumps, config files, or logs quickly
- Work with containers that have minimal tooling

## The Solution

### Copy from Local to Pod

```bash
# Copy a file into a Pod
oc cp ./my-config.yaml my-pod:/etc/app/config.yaml

# Copy a directory into a Pod
oc cp ./configs/ my-pod:/etc/app/configs/

# Copy to a specific container in a multi-container Pod
oc cp ./patch.jar my-pod:/app/lib/patch.jar -c app-container

# Copy to a specific namespace
oc cp ./data.csv my-pod:/tmp/data.csv -n production
```

### Copy from Pod to Local

```bash
# Copy a file from Pod to local
oc cp my-pod:/var/log/app/error.log ./error.log

# Copy a directory from Pod
oc cp my-pod:/app/data/ ./pod-data/

# Copy from specific container
oc cp my-pod:/tmp/heapdump.hprof ./heapdump.hprof -c java-app

# Copy with namespace
oc cp production/my-pod:/etc/app/config.yaml ./current-config.yaml
```

### Pod-to-Pod Copy (via Local)

```bash
# No direct Pod-to-Pod copy — use local as intermediate
oc cp source-pod:/data/export.sql /tmp/export.sql
oc cp /tmp/export.sql dest-pod:/docker-entrypoint-initdb.d/import.sql
rm /tmp/export.sql
```

### Handling Large Files

```bash
# Copy with retries (wrap in script for reliability)
#!/bin/bash
MAX_RETRIES=3
SRC="my-pod:/data/large-backup.tar.gz"
DST="./large-backup.tar.gz"

for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i..."
  if oc cp "$SRC" "$DST" 2>/dev/null; then
    echo "Success"
    # Verify integrity
    if tar -tzf "$DST" > /dev/null 2>&1; then
      echo "Integrity check passed"
      exit 0
    fi
  fi
  echo "Failed, retrying..."
  sleep 5
done
echo "ERROR: Copy failed after $MAX_RETRIES attempts"
exit 1
```

### Extract Specific Files from Pod

```bash
# oc cp copies entire files/directories — for selective extraction:

# Option 1: Copy directory, then filter locally
oc cp my-pod:/var/log/ ./all-logs/
find ./all-logs/ -name "*.log" -mmin -60  # Last hour's logs

# Option 2: Use exec + tar with filtering (advanced)
oc exec my-pod -- tar cf - -C /var/log \
  --include='*.log' . | tar xf - -C ./filtered-logs/

# Option 3: Single file via stdout
oc exec my-pod -- cat /etc/app/config.yaml > ./config.yaml
```

### oc cp vs oc rsync vs oc exec

```text
Feature              oc cp           oc rsync         oc exec + cat/tar
──────────────────────────────────────────────────────────────────────────
Single file          ✅ native       ⚠️ needs filter   ✅ via stdout
Directory            ✅ recursive    ✅ recursive      ⚠️ manual tar
Incremental          ❌ full copy    ✅ delta only     ❌ full copy
Watch/live sync      ❌ no           ✅ --watch        ❌ no
Filtering            ❌ no           ✅ --include      ✅ tar patterns
Requires in Pod      tar             rsync or tar     cat/tar
Preserves perms      ✅ yes          ✅ configurable   ⚠️ depends
Symlink handling     ⚠️ follows      ✅ configurable   ⚠️ depends
Progress indicator   ❌ no           ✅ --progress     ❌ no
```

### When oc cp Fails (No tar in Container)

```bash
# Scratch/distroless container without tar:
# Error: tar: not found

# Workaround 1: Use ephemeral debug container
oc debug my-pod --image=busybox -- \
  tar cf - -C /proc/1/root/app/data . > ./backup.tar

# Workaround 2: kubectl exec with base64 (small files only)
oc exec my-pod -- base64 /app/config.yaml | base64 -d > config.yaml

# Workaround 3: Inject ephemeral container with tar
oc debug my-pod --image=busybox:1.36
# Inside: tar cf /tmp/backup.tar /app/data
# Then: oc cp my-pod-debug:/tmp/backup.tar ./backup.tar

# Workaround 4: Mount the PVC in a temporary Pod with tar
cat <<YAML | oc apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: pvc-extractor
spec:
  containers:
    - name: extractor
      image: busybox:1.36
      command: ["sleep", "3600"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: my-app-data
YAML

# Wait for Pod to start, then copy
oc cp pvc-extractor:/data/ ./pvc-backup/
oc delete pod pvc-extractor
```

### Gotchas and Edge Cases

```bash
# Symlinks: oc cp follows symlinks (copies the target file)
# This can result in larger transfers than expected

# Relative paths in Pod: always use absolute paths
# BAD:  oc cp my-pod:app/config.yaml ./config.yaml
# GOOD: oc cp my-pod:/app/config.yaml ./config.yaml

# Directory trailing slash behavior:
# oc cp my-pod:/data ./local/     → creates ./local/data/
# oc cp my-pod:/data/ ./local/    → copies contents into ./local/

# Binary files work fine (tar handles them)
oc cp my-pod:/tmp/core.dump ./core.dump
```

## Common Issues

### "tar: Removing leading '/' from member names"
- **Cause**: Warning from tar stripping absolute paths (harmless)
- **Fix**: Ignore — files are extracted correctly

### "error: unable to upgrade connection"
- **Cause**: Proxy/route doesn't support SPDY or WebSocket
- **Fix**: Use `--retries=3`; check `oc` version matches cluster

### Copy seems to hang (large file)
- **Cause**: No progress indicator; tar buffers the entire stream
- **Fix**: Use `oc rsync --progress` instead for large directories

### Permission denied writing to container
- **Cause**: Container runs as non-root; target path owned by root
- **Fix**: Copy to `/tmp` first, then `oc exec` to move with correct perms

### "command terminated with exit code 2"
- **Cause**: tar in container can't read the source file (permissions)
- **Fix**: Check file permissions inside Pod with `oc exec ls -la`

## Best Practices

1. **Use `oc cp` for single files** — simpler syntax than rsync
2. **Use `oc rsync` for directories** — incremental, progress, filtering
3. **Always absolute paths** in Pod — relative paths cause confusion
4. **Verify after copy** — `oc exec md5sum` to confirm integrity
5. **`/tmp` as staging** — copy there first if target dir has permission issues
6. **Clean up** — don't leave debug data in production Pods
7. **Prefer ephemeral containers** for containers without tar

## Key Takeaways

- `oc cp` uses tar over exec API — requires `/bin/tar` in the container
- Same syntax as `kubectl cp` (OpenShift wrapper)
- Best for single files; `oc rsync` better for directories/incremental
- No progress indicator — use rsync for large transfers
- Fallbacks when no tar: ephemeral containers, base64 exec, PVC mount Pod
- Always use absolute paths inside the Pod
- Trailing slash matters: `/data` vs `/data/` changes copy behavior
- Binary-safe: works for heap dumps, core files, images, databases
