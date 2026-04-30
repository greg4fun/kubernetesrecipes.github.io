---
title: "oc-mirror Troubleshooting Disconnected"
description: "Troubleshoot oc-mirror failures in disconnected OpenShift environments. Fix archive corruption, registry auth errors, disk space issues, v1 vs v2 incompatibilities, and delta mirror failures."
publishDate: "2026-04-30"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "oc-mirror"
  - "disconnected"
  - "openshift"
  - "troubleshooting"
  - "registry"
relatedRecipes:
  - "airgap-openshift-upgrade-oc-mirror-osus"
  - "osus-direct-vs-replicated-openshift"
  - "openshift-upgrade-disconnected-environment"
  - "mirror-registry-disconnected-openshift"
  - "skopeo-container-image-operations"
---

> 💡 **Quick Answer:** Most oc-mirror failures fall into 5 categories: registry authentication (401/403), disk space (archive can be 25+ GB), v1/v2 format mismatch, corrupted archives from interrupted transfers, and ImageSetConfiguration syntax errors. Check `oc mirror` logs with `--log-level debug`, verify registry credentials with `podman login`, and ensure you use the same oc-mirror version on both connected and disconnected sides.

## The Problem

oc-mirror is the standard tool for mirroring OpenShift content to disconnected environments, but it fails in many non-obvious ways:

- Registry auth errors that don't match pull-secret content
- Archives that appear complete but fail on the disconnected side
- Delta (incremental) mirrors that produce empty results
- Disk space exhaustion mid-mirror with no resume capability
- v1 archives pushed with v2 binary (or vice versa)
- Graph-data image silently not included

## The Solution

### Error: Registry Authentication (401/403)

```bash
# Symptom
# error: unable to retrieve source image: unauthorized: authentication required

# Check 1: Verify pull-secret has the right registries
cat ~/.docker/config.json | jq '.auths | keys'
# Must include:
# - "registry.redhat.io"
# - "quay.io"
# - "registry.connect.redhat.com"
# - Your mirror registry

# Check 2: Test login directly
podman login registry.redhat.io
podman login quay.io
podman login registry.example.com:5000

# Check 3: Use explicit auth file
oc mirror -c imageset-config.yaml \
  --registry-config=/path/to/pull-secret.json \
  file:///data/mirror \
  --v2

# Check 4: Token expired — re-authenticate
# Red Hat tokens expire after 12h
podman login registry.redhat.io --username='your-rh-user'
```

### Error: Disk Space Exhaustion

```bash
# Symptom
# error: write /data/mirror/mirror_seq1_000042.tar: no space left on device

# Check available space (need 2-3x the expected mirror size)
df -h /data/mirror

# Estimate mirror size before running
# Rule of thumb:
# - Single OCP version: ~5-8 GB
# - shortestPath 4-version range: ~8-15 GB
# - Full 4-version range: ~25-50 GB
# - Operators catalog: ~15-40 GB each

# Solution: Use a larger volume or mirror directly to registry
# (skip file:// intermediate)
oc mirror -c imageset-config.yaml \
  docker://registry.example.com:5000 \
  --v2
# Only works if bastion has network access to mirror registry
```

### Error: v1 vs v2 Format Mismatch

```bash
# Symptom
# error: invalid archive format / unable to read metadata

# v1 and v2 archives are NOT compatible
# Check which version created the archive
cat /data/mirror/.metadata.json 2>/dev/null  # v1
cat /data/mirror/working-dir/metadata.json 2>/dev/null  # v2

# Rule: Use --v2 on BOTH sides
# Connected:
oc mirror -c config.yaml file:///data/mirror --v2
# Disconnected:
oc mirror --from file:///data/mirror docker://registry:5000 --v2

# If mixed, re-mirror from scratch with consistent version
```

### Error: Delta/Incremental Mirror Failures

```bash
# Symptom: second oc-mirror run produces empty results
# or: "all images already mirrored"

# oc-mirror v2 uses sequence numbers for incremental mirrors
ls /data/mirror/mirror_seq*.tar
# mirror_seq1_000000.tar  ← initial
# mirror_seq2_000000.tar  ← delta

# If delta is empty, the metadata thinks everything is current
# Force a full re-mirror:
rm -rf /data/mirror/working-dir/
oc mirror -c config.yaml file:///data/mirror --v2

# Or update ImageSetConfiguration to include new versions
# oc-mirror only mirrors NEW content not in previous sequences
```

### Error: Graph-Data Image Not Mirrored

```bash
# Symptom: OSUS has no graph data, "No updates available"

# Verify graph: true is set
grep -A5 "graph:" imageset-config.yaml
#   graph: true   ← Must be under mirror.platform, NOT under channels

# CORRECT placement:
# mirror:
#   platform:
#     channels:
#     - name: stable-4.20
#       ...
#     graph: true       ← HERE, at platform level

# WRONG placement:
# mirror:
#   platform:
#     channels:
#     - name: stable-4.20
#       graph: true     ← WRONG — this is not a channel field

# Verify graph-data was mirrored
skopeo list-tags docker://registry.example.com:5000/openshift-update-service/graph-data
```

### Error: Archive Corruption After Transfer

```bash
# Symptom
# error: unexpected EOF / checksum mismatch

# Verify archive integrity after transfer
sha256sum /data/mirror/mirror_seq1_*.tar > checksums.txt
# Compare on both sides

# If using USB drive, check filesystem
fsck /dev/sdb1

# For large archives, use rsync with checksum verification
rsync -avz --checksum /data/mirror/ /media/usb/mirror/

# Or split large archives for transfer
split -b 4G mirror_seq1_000000.tar mirror_part_
# Reassemble on other side
cat mirror_part_* > mirror_seq1_000000.tar
```

### Error: ImageSetConfiguration Syntax

```bash
# Common YAML mistakes

# Wrong: minVersion > maxVersion
# channels:
# - name: stable-4.20
#   minVersion: 4.20.12   ← higher than max!
#   maxVersion: 4.20.8

# Wrong: missing type
# channels:
# - name: stable-4.20
#   minVersion: 4.20.8
#   # type: ocp            ← required for platform channels

# Validate before mirroring
oc mirror -c imageset-config.yaml --dry-run file:///tmp/test --v2
```

### Debug Logging

```bash
# Full debug output
oc mirror -c imageset-config.yaml \
  file:///data/mirror \
  --v2 \
  --log-level debug 2>&1 | tee mirror.log

# Search for specific errors
grep -i "error\|fail\|skip\|warn" mirror.log

# Check which images were mirrored
grep "copying" mirror.log | wc -l
```

### Quick Diagnostic Checklist

```bash
#!/bin/bash
echo "=== oc-mirror Diagnostic ==="
echo "[1] Version: $(oc mirror version 2>/dev/null || echo 'not found')"
echo "[2] Auth registries: $(cat ~/.docker/config.json 2>/dev/null | jq -r '.auths | keys[]' | tr '\n' ' ')"
echo "[3] Disk space: $(df -h /data 2>/dev/null | tail -1)"
echo "[4] Archive files: $(ls /data/mirror/mirror_seq*.tar 2>/dev/null | wc -l)"
echo "[5] Working dir: $(ls /data/mirror/working-dir/ 2>/dev/null | head -5)"
echo "[6] Graph data: $(grep -c 'graph: true' imageset-config.yaml 2>/dev/null) graph:true entries"
```

## Common Issues

**Mirror succeeds but generated manifests are empty**

Working directory was cleaned between runs. oc-mirror generates `cluster-resources/` in the working directory — don't delete it between mirror and push.

**"skipping operator" warnings during mirror**

Operator channel doesn't exist for the specified version range. Check `oc mirror list operators --catalog` for available channels.

**Push to registry hangs at 99%**

Large manifest lists take time. Registry may need `REGISTRY_STORAGE_DELETE_ENABLED=true` for layer dedup. Check registry disk I/O.

## Best Practices

- **`--v2` everywhere** — v2 is faster, more reliable, and the future
- **Same binary version on both sides** — never mix oc-mirror versions
- **`--dry-run` first** — validate config before long mirror operations
- **Checksum archives after transfer** — one flipped bit = corrupt archive
- **Keep working directory** — oc-mirror needs it for incremental mirrors and manifest generation
- **Mirror to file first, push second** — two-step is safer than direct mirror to registry
- **`graph: true` at platform level** — not under individual channels

## Key Takeaways

- Most oc-mirror failures are auth, disk space, or v1/v2 mismatches
- `graph: true` must be at `mirror.platform` level to build the OSUS graph-data image
- Always use `--v2` on both connected and disconnected sides
- Verify archive integrity with checksums after physical transfer
- `--dry-run` catches ImageSetConfiguration errors before the multi-hour mirror
- Keep the working directory intact between mirror and push operations
