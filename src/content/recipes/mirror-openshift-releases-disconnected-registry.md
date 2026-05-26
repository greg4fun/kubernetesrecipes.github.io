---
title: "Mirror OpenShift Releases to Disconnected Registry"
description: "Mirror OCP release images to an air-gapped internal Quay registry using oc adm release mirror. Auth file setup, proxy configuration, ImageDigestMirrorSet, and complete disconnected update workflow."
tags:
  - "openshift"
  - "disconnected"
  - "registry"
  - "mirror"
  - "air-gap"
category: "configuration"
publishDate: "2026-05-26"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "openshift-cluster-update-process-explained"
  - "container-private-registry-kubernetes"
  - "openshift-lifecycle-management"
---

> 💡 **Quick Answer:** Use `oc adm release mirror` from a bastion host with access to both the internet (or proxy) and your internal registry. First create auth credentials with `podman login` to both registries, merge into a single auth file, then mirror. For fully air-gapped environments, use `oc mirror` with disk-to-disk transfer.

## The Problem

- OpenShift clusters in disconnected/air-gapped environments cannot pull release images from quay.io
- Mirroring requires authentication to both source (quay.io) and destination (internal registry)
- Bastion hosts often have no direct internet access — require proxy or sneakernet
- DNS resolution fails for external registries on isolated networks
- Auth file must exist before mirroring can proceed
- `ImageContentSourcePolicy` (ICSP) is deprecated — must use `ImageDigestMirrorSet` (IDMS)

## The Solution

### Prerequisites

```bash
# Bastion host requirements:
# - oc CLI (matching target OCP version)
# - podman (for registry login)
# - Network access to internal registry
# - Internet access (direct or via proxy) to quay.io
# - Sufficient disk space (~15-20 GB per OCP release)
```

### Step 1: Configure Proxy (If Required)

```bash
# If bastion cannot reach quay.io directly, configure proxy
export HTTPS_PROXY=http://proxy.example.com:8080
export HTTP_PROXY=http://proxy.example.com:8080

# Exclude internal networks and registries from proxy
export NO_PROXY="127.0.0.1,localhost,.cluster.local,\
registry.example.com,\
10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

# Verify connectivity to quay.io through proxy
curl -sI https://quay.io/v2/ | head -5
# HTTP/1.1 401 UNAUTHORIZED  ← Good, means we can reach it
```

### Step 2: Create Auth File

```bash
# Create directory for auth file
mkdir -p $HOME/.docker

# Login to source registry (Red Hat / quay.io)
podman login quay.io \
  --authfile $HOME/.docker/config.json
# Username: your-redhat-username
# Password: your-token-or-password

# Login to destination (internal registry)
podman login registry.example.com \
  --authfile $HOME/.docker/config.json
# Username: mirror-service-account
# Password: ****

# Also add Red Hat registry for operator images
podman login registry.redhat.io \
  --authfile $HOME/.docker/config.json

# Verify auth file contains all registries
cat $HOME/.docker/config.json | jq '.auths | keys'
# [
#   "quay.io",
#   "registry.example.com",
#   "registry.redhat.io"
# ]
```

### Step 3: Mirror the Release

```bash
# Mirror OCP release to internal registry
oc adm release mirror \
  --from=quay.io/openshift-release-dev/ocp-release:4.20.12-x86_64 \
  --to=registry.example.com/ocp4/openshift4 \
  --to-release-image=registry.example.com/ocp4/openshift4:4.20.12-x86_64 \
  --registry-config=$HOME/.docker/config.json \
  --print-mirror-instructions=idms

# Output includes:
# - Progress of each image layer being mirrored
# - ImageDigestMirrorSet YAML to apply to cluster
# - Total images mirrored (typically 150-200 images)
```

### Step 4: Apply ImageDigestMirrorSet

```yaml
# Save the IDMS output from mirror command, or create manually:
apiVersion: config.openshift.io/v1
kind: ImageDigestMirrorSet
metadata:
  name: ocp-release-4-20
spec:
  imageDigestMirrors:
    - mirrors:
        - registry.example.com/ocp4/openshift4
      source: quay.io/openshift-release-dev/ocp-release
    - mirrors:
        - registry.example.com/ocp4/openshift4
      source: quay.io/openshift-release-dev/ocp-v4.0-art-dev
```

```bash
# Apply to cluster
oc apply -f imagedigestmirrorset.yaml

# Verify nodes pick up the mirror config
oc get nodes
# Nodes will restart MCD to apply new mirror config
```

### Step 5: Update the Disconnected Cluster

```bash
# Point cluster to internal release image
oc adm upgrade \
  --to-image=registry.example.com/ocp4/openshift4@sha256:<digest> \
  --allow-explicit-upgrade

# Or if you tagged it:
oc adm upgrade \
  --to-image=registry.example.com/ocp4/openshift4:4.20.12-x86_64 \
  --allow-explicit-upgrade --force
```

### Fully Air-Gapped Mirror (Disk Transfer)

```bash
# On internet-connected host: mirror to disk
oc mirror --config=imageset-config.yaml \
  file:///var/tmp/mirror-data

# Transfer /var/tmp/mirror-data to bastion via USB/SCP/etc.

# On bastion: push from disk to internal registry
oc mirror --from=/var/tmp/mirror-data \
  docker://registry.example.com/ocp4 \
  --registry-config=$HOME/.docker/config.json
```

```yaml
# imageset-config.yaml
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v1alpha2
storageConfig:
  local:
    path: /var/tmp/mirror-data
mirror:
  platform:
    channels:
      - name: stable-4.20
        minVersion: 4.20.12
        maxVersion: 4.20.12
  additionalImages: []
  operators: []
```

## Common Issues

### "stat ~/.docker/config.json: no such file or directory"
- **Cause**: Auth file doesn't exist yet — must login to registries first
- **Fix**: Run `podman login` to both source and destination registries with `--authfile $HOME/.docker/config.json`

### "dial tcp: lookup quay.io: no such host"
- **Cause**: Bastion has no DNS resolution for external hosts (disconnected network)
- **Fix**: Configure `HTTPS_PROXY` pointing to a proxy with internet access, or use air-gapped disk mirror approach

### "proxyconnect tcp: dial tcp proxy:8080: i/o timeout"
- **Cause**: Proxy is unreachable from bastion, or proxy blocks container registry traffic
- **Fix**: Verify proxy IP/port; check proxy allowlist includes `quay.io`, `*.quay.io`, `cdn.quay.io`; test with `curl --proxy`

### "Flag --print-mirror-instructions's value 'icsp' has been deprecated"
- **Cause**: ICSP replaced by IDMS in OCP 4.13+
- **Fix**: Use `--print-mirror-instructions=idms` to get `ImageDigestMirrorSet` output

### "unauthorized: access to the requested resource is not authorized"
- **Cause**: Auth token expired or wrong credentials for destination registry
- **Fix**: Re-login to internal registry; verify service account has push permissions to target namespace

### Mirror hangs or is extremely slow
- **Cause**: Each OCP release contains 150+ images (~15-20 GB total)
- **Fix**: Ensure sufficient bandwidth; use `--max-per-registry=6` to limit concurrency; check proxy bandwidth limits

## Best Practices

1. **Automate with CI/CD** — schedule mirror jobs for each new z-stream release
2. **Use a dedicated service account** for registry auth (not personal credentials)
3. **Keep auth file permissions restricted** — `chmod 600 $HOME/.docker/config.json`
4. **Mirror to a dedicated namespace** — `ocp4/openshift4` keeps release images organized
5. **Test mirror integrity** — `oc adm release info --registry-config=... registry.example.com/ocp4/openshift4:4.20.12-x86_64`
6. **Pre-stage before maintenance window** — mirror days before planned update
7. **Use IDMS not ICSP** — ICSP is deprecated; IDMS supports digest-based mirrors
8. **Document your proxy config** — disconnected environments are fragile; keep a runbook

## Key Takeaways

- `oc adm release mirror` copies all release images from quay.io to your internal registry
- Auth file must contain credentials for BOTH source and destination registries
- Disconnected bastions need proxy config (`HTTPS_PROXY`) or disk-based transfer (`oc mirror`)
- DNS failures for quay.io indicate missing proxy — the bastion is on an isolated network
- `ImageDigestMirrorSet` (IDMS) replaces deprecated `ImageContentSourcePolicy` (ICSP) since OCP 4.13
- Each OCP release is ~150-200 container images (~15-20 GB) — plan storage and bandwidth
- After mirroring, update the cluster with `oc adm upgrade --to-image=<internal-image>`
