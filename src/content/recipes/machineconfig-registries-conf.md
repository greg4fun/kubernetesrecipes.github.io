---
title: "Configure Container Registries via MachineC..."
description: "Set up mirror registries and blocked registries on OpenShift nodes using MachineConfig to control CRI-O image pull on RHCOS."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - machineconfig
  - registries
  - cri-o
  - mirror
relatedRecipes:
  - "itms-registries-conf-machineconfig"
  - "imagestream-import-errors"
  - "openshift-idms-install-config"
  - "itms-external-registry-mapping"
  - "crio-container-runtime-errors"
---
> 💡 **Quick Answer:** On OpenShift, use IDMS/ITMS (preferred) or a MachineConfig with a base64-encoded `/etc/containers/registries.conf` to configure registry mirrors, blocked registries, and unqualified search registries. MCO will drain and reboot each node to apply the new CRI-O configuration.

## The Problem

You need to configure container registry mirrors (for air-gapped environments or caching), block certain registries (security policy), or change the unqualified search order. On RHCOS, you can't SSH and edit files — changes must go through the MachineConfig Operator or IDMS/ITMS resources.

## The Solution

### Preferred Method: IDMS/ITMS (OpenShift 4.13+)

```yaml
# ImageDigestMirrorSet — for digest-based mirroring
apiVersion: config.openshift.io/v1
kind: ImageDigestMirrorSet
metadata:
  name: mirror-config
spec:
  imageDigestMirrors:
    - mirrors:
        - mirror.internal.example.com/openshift-release
      source: quay.io/openshift-release-dev/ocp-release
      mirrorSourcePolicy: AllowContactingSource
```

### Alternative: MachineConfig (Full Control)

```bash
# Create registries.conf
cat > /tmp/registries.conf << 'EOF'
unqualified-search-registries = ["registry.access.redhat.com", "docker.io"]

[[registry]]
  prefix = ""
  location = "docker.io"
  
  [[registry.mirror]]
    location = "mirror.internal.example.com/docker-hub"
    pull-from-mirror = "digest-only"

[[registry]]
  prefix = ""
  location = "quay.io"
  
  [[registry.mirror]]
    location = "mirror.internal.example.com/quay"

# Block untrusted registries
[[registry]]
  prefix = ""
  location = "untrusted-registry.example.com"
  blocked = true
EOF

# Base64 encode
REG_B64=$(base64 -w0 /tmp/registries.conf)

# Create MachineConfig
cat > 99-worker-registries.yaml << EOF
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-worker-registries
  labels:
    machineconfiguration.openshift.io/role: worker
spec:
  config:
    ignition:
      version: 3.2.0
    storage:
      files:
        - path: /etc/containers/registries.conf
          mode: 0644
          overwrite: true
          contents:
            source: "data:text/plain;charset=utf-8;base64,${REG_B64}"
EOF

oc apply -f 99-worker-registries.yaml
```

### Verify After Rollout

```bash
oc debug node/worker-1 -- chroot /host cat /etc/containers/registries.conf
# Should show your custom configuration

# Test image pull from mirror
oc debug node/worker-1 -- chroot /host crictl pull docker.io/library/nginx:latest
# Should pull from mirror.internal.example.com/docker-hub
```

## Common Issues

### ITMS Race Condition with Ingress

Applying ITMS/MachineConfig registries changes triggers a rolling reboot. See [ITMS Race Condition with Ingress Controllers](/recipes/troubleshooting/itms-ingress-controller-race-condition/) for the deadlock scenario.

### TOML Syntax Error Degrades Nodes

Invalid `registries.conf` syntax causes CRI-O to fail, degrading the node. Always validate TOML syntax before applying.

## Best Practices

- **Use IDMS/ITMS instead of raw MachineConfig** when possible — they're API-managed and validated
- **Test registries.conf syntax** before applying — TOML errors break CRI-O
- **Use `AllowContactingSource`** during migration — falls back to original if mirror misses
- **Apply to both worker and master MCPs** in air-gapped environments
- **Pre-sync all images to mirrors** before switching to `NeverContactSource`

## Key Takeaways

- RHCOS nodes use `/etc/containers/registries.conf` for CRI-O registry behavior
- IDMS (digest-based) and ITMS (tag-based) are the preferred OpenShift approach
- Raw MachineConfig gives full control but requires manual TOML management
- Changes trigger MCO drain + reboot per node — plan for maintenance window
- Always verify mirror completeness before blocking source registries
