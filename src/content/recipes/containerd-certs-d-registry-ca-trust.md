---
title: "containerd certs.d Registry CA Trust"
description: "Configure containerd to trust private registry CAs using /etc/containerd/certs.d. Set up hosts.toml for custom CA certificates and mirror registries."
publishDate: "2026-04-30"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "containerd"
  - "registry"
  - "tls"
  - "certificates"
  - "security"
relatedRecipes:
  - "custom-ca-openshift-kubernetes"
  - "kubectl-create-secret-docker-registry"
  - "quay-registry-kubernetes-guide"
  - "openshift-idms-itms-mirror-rules"
---

> 💡 **Quick Answer:** Place your registry CA certificate in `/etc/containerd/certs.d/<registry>/` with a `hosts.toml` configuration file. For `registry.example.com`: create `/etc/containerd/certs.d/registry.example.com/hosts.toml` with `[host."https://registry.example.com"] ca = "/etc/containerd/certs.d/registry.example.com/ca.crt"`. No containerd restart needed — it reads `certs.d` dynamically.

## The Problem

Kubernetes nodes using containerd fail to pull from private registries with self-signed or internal CA certificates:

- `failed to verify certificate: x509: certificate signed by unknown authority`
- `tls: failed to verify certificate: x509: certificate signed by unknown authority`
- `ErrImagePull` on pods targeting private registries

## The Solution

### Directory Structure

```
/etc/containerd/certs.d/
├── registry.example.com/
│   ├── hosts.toml          ← Configuration
│   └── ca.crt              ← CA certificate
├── registry.example.com:5000/
│   ├── hosts.toml
│   └── ca.crt
└── docker.io/              ← Mirror for Docker Hub
    └── hosts.toml
```

### Configure CA Trust for Private Registry

```bash
# Create directory for your registry
mkdir -p /etc/containerd/certs.d/registry.example.com

# Copy CA certificate
cp /path/to/ca-bundle.crt /etc/containerd/certs.d/registry.example.com/ca.crt

# Create hosts.toml
cat > /etc/containerd/certs.d/registry.example.com/hosts.toml << 'EOF'
server = "https://registry.example.com"

[host."https://registry.example.com"]
  ca = "/etc/containerd/certs.d/registry.example.com/ca.crt"
EOF
```

### With Port Number

```bash
mkdir -p "/etc/containerd/certs.d/registry.example.com:5000"

cat > "/etc/containerd/certs.d/registry.example.com:5000/hosts.toml" << 'EOF'
server = "https://registry.example.com:5000"

[host."https://registry.example.com:5000"]
  ca = "/etc/containerd/certs.d/registry.example.com:5000/ca.crt"
EOF
```

### Client Certificate Authentication (mTLS)

```toml
# /etc/containerd/certs.d/registry.example.com/hosts.toml
server = "https://registry.example.com"

[host."https://registry.example.com"]
  ca = "/etc/containerd/certs.d/registry.example.com/ca.crt"
  client = [
    ["/etc/containerd/certs.d/registry.example.com/client.cert",
     "/etc/containerd/certs.d/registry.example.com/client.key"]
  ]
```

### Skip TLS Verification (Development Only)

```toml
# /etc/containerd/certs.d/registry.example.com/hosts.toml
server = "https://registry.example.com"

[host."https://registry.example.com"]
  skip_verify = true     # ⚠️ INSECURE — dev/test only
```

### HTTP Registry (No TLS)

```toml
# /etc/containerd/certs.d/registry.example.com:5000/hosts.toml
server = "http://registry.example.com:5000"

[host."http://registry.example.com:5000"]
  capabilities = ["pull", "resolve"]
```

### Mirror Configuration

```toml
# /etc/containerd/certs.d/docker.io/hosts.toml
# Mirror Docker Hub through local registry
server = "https://docker.io"

[host."https://registry.example.com/docker-hub-cache"]
  capabilities = ["pull", "resolve"]
  ca = "/etc/containerd/certs.d/registry.example.com/ca.crt"

[host."https://registry-1.docker.io"]
  capabilities = ["pull", "resolve"]
```

### Enable certs.d in containerd config

```toml
# /etc/containerd/config.toml
# Ensure config_path is set (default on modern containerd)
[plugins."io.containerd.grpc.v1.cri".registry]
  config_path = "/etc/containerd/certs.d"
```

```bash
# Verify containerd sees the config
# No restart needed for certs.d changes, but verify config_path:
containerd config dump | grep config_path
# config_path = "/etc/containerd/certs.d"

# If config_path was just added, restart containerd:
systemctl restart containerd
```

### Kubernetes Node Setup (All Nodes)

```bash
# DaemonSet to distribute CA certs to all nodes
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: registry-ca-setup
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: registry-ca-setup
  template:
    metadata:
      labels:
        app: registry-ca-setup
    spec:
      hostPID: true
      containers:
      - name: setup
        image: busybox:1.36
        command:
        - sh
        - -c
        - |
          mkdir -p /host/etc/containerd/certs.d/registry.example.com
          cp /certs/ca.crt /host/etc/containerd/certs.d/registry.example.com/ca.crt
          cat > /host/etc/containerd/certs.d/registry.example.com/hosts.toml << 'TOML'
          server = "https://registry.example.com"
          [host."https://registry.example.com"]
            ca = "/etc/containerd/certs.d/registry.example.com/ca.crt"
          TOML
          echo "CA configured. Sleeping."
          sleep infinity
        volumeMounts:
        - name: host-etc
          mountPath: /host/etc
        - name: ca-cert
          mountPath: /certs
      volumes:
      - name: host-etc
        hostPath:
          path: /etc
      - name: ca-cert
        configMap:
          name: registry-ca
```

### OpenShift — MachineConfig Approach

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-registry-ca-trust
  labels:
    machineconfiguration.openshift.io/role: worker
spec:
  config:
    ignition:
      version: 3.2.0
    storage:
      files:
      - path: /etc/containers/registries.conf.d/010-registry-mirror.conf
        mode: 0644
        contents:
          source: data:text/plain;charset=utf-8,%5B%5Bregistry%5D%5D%0Alocation%20%3D%20%22registry.example.com%22%0Ainsecure%20%3D%20false%0Ablocked%20%3D%20false%0A
      - path: /etc/pki/ca-trust/source/anchors/registry-ca.crt
        mode: 0644
        contents:
          source: data:text/plain;charset=utf-8,-----BEGIN%20CERTIFICATE-----%0A...%0A-----END%20CERTIFICATE-----%0A
```

### Verify

```bash
# Test pulling from the registry
crictl pull registry.example.com/myimage:latest

# Or with containerd directly
ctr images pull registry.example.com/myimage:latest

# Check containerd logs for TLS errors
journalctl -u containerd --since "5 min ago" | grep -i "tls\|cert\|x509"
```

## Common Issues

**"config_path" not set — certs.d directory ignored**

containerd needs `config_path = "/etc/containerd/certs.d"` in its config. Some older installations don't have this. Add it and restart containerd.

**CA cert works with curl but not containerd**

The CA must be PEM-encoded (not DER). Convert: `openssl x509 -in ca.der -inform DER -out ca.crt -outform PEM`.

**Changes not taking effect**

`certs.d` changes are read dynamically — no restart needed. But if you changed `config.toml`, restart containerd: `systemctl restart containerd`.

## Best Practices

- **Use `certs.d` directory** — no containerd restart needed for cert updates
- **Never `skip_verify: true` in production** — always configure proper CA trust
- **Same CA cert on ALL nodes** — use DaemonSet or MachineConfig for distribution
- **PEM format only** — containerd doesn't support DER certificates in certs.d
- **Test with `crictl pull`** before deploying workloads

## Key Takeaways

- `/etc/containerd/certs.d/<registry>/hosts.toml` + `ca.crt` configures CA trust
- No containerd restart needed for `certs.d` changes (dynamic reading)
- `config_path` must be set in containerd's `config.toml` to enable `certs.d`
- Supports CA trust, client mTLS, TLS skip, HTTP registries, and mirrors
- Distribute certs to all nodes via DaemonSet (K8s) or MachineConfig (OpenShift)
