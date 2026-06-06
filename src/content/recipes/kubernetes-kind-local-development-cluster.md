---
title: "Kubernetes Kind Local Development Cluster"
description: "Create local Kubernetes clusters with kind (Kubernetes in Docker). Multi-node clusters, ingress setup, local registry, port mapping, volume mounts, and CI/CD"
tags:
  - "kind"
  - "local-development"
  - "docker"
  - "testing"
  - "ci-cd"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-local-development"
---

> 💡 **Quick Answer:** kind (Kubernetes IN Docker) runs K8s clusters using Docker containers as nodes. Install with `go install sigs.k8s.io/kind@latest` or `brew install kind`. Create a cluster: `kind create cluster`. Multi-node, ingress, local registries, and CI/CD — all configured via a YAML config file. Clusters start in ~30 seconds.

## The Problem

- Need a local Kubernetes cluster for development without cloud costs
- Minikube is single-node — can't test multi-node scenarios
- CI pipelines need ephemeral K8s clusters for integration tests
- Testing ingress, NetworkPolicy, and multi-node scheduling locally
- Need to load local Docker images into the cluster without a registry

## The Solution

### Install kind

```bash
# macOS
brew install kind

# Linux
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.25.0/kind-linux-amd64
chmod +x ./kind
mv ./kind /usr/local/bin/kind

# Verify
kind version
```

### Basic Cluster

```bash
# Create default cluster (1 control-plane node)
kind create cluster

# Create with specific name and K8s version
kind create cluster --name my-cluster --image kindest/node:v1.31.0

# List clusters
kind get clusters

# Delete cluster
kind delete cluster --name my-cluster
```

### Multi-Node Cluster

```yaml
# kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: control-plane
  - role: control-plane
  - role: worker
  - role: worker
  - role: worker
networking:
  podSubnet: "10.244.0.0/16"
  serviceSubnet: "10.96.0.0/16"
```

```bash
kind create cluster --config kind-config.yaml --name ha-cluster
```

### Ingress Setup (NGINX)

```yaml
# kind-ingress.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
        protocol: TCP
      - containerPort: 443
        hostPort: 443
        protocol: TCP
  - role: worker
  - role: worker
```

```bash
kind create cluster --config kind-ingress.yaml

# Install NGINX ingress controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# Wait for it
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s

# Now localhost:80 routes to ingress
```

### Local Registry

```bash
#!/bin/bash
# Create a local registry and kind cluster connected to it

reg_name='kind-registry'
reg_port='5001'

# Create registry container
if [ "$(docker inspect -f '{{.State.Running}}' "${reg_name}" 2>/dev/null)" != 'true' ]; then
  docker run -d --restart=always -p "127.0.0.1:${reg_port}:5000" --network bridge --name "${reg_name}" registry:2
fi

# Create kind cluster with registry config
cat <<EOF | kind create cluster --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
containerdConfigPatches:
  - |-
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors."localhost:${reg_port}"]
      endpoint = ["http://${reg_name}:5000"]
EOF

# Connect registry to kind network
docker network connect "kind" "${reg_name}" 2>/dev/null || true

# Usage:
# docker build -t localhost:5001/my-app:v1 .
# docker push localhost:5001/my-app:v1
# kubectl create deployment my-app --image=localhost:5001/my-app:v1
```

### Load Local Images (Without Registry)

```bash
# Build image locally
docker build -t my-app:latest .

# Load into kind cluster
kind load docker-image my-app:latest --name my-cluster

# Use in pod (must set imagePullPolicy: Never or IfNotPresent)
kubectl run my-app --image=my-app:latest --image-pull-policy=IfNotPresent
```

### CI/CD Integration (GitHub Actions)

```yaml
# .github/workflows/test.yaml
name: Integration Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Create kind cluster
        uses: helm/kind-action@v1
        with:
          cluster_name: test-cluster
          node_image: kindest/node:v1.31.0

      - name: Build and load image
        run: |
          docker build -t my-app:test .
          kind load docker-image my-app:test --name test-cluster

      - name: Deploy and test
        run: |
          kubectl apply -f k8s/
          kubectl wait --for=condition=ready pod -l app=my-app --timeout=60s
          kubectl port-forward svc/my-app 8080:80 &
          sleep 3
          curl -f http://localhost:8080/health
```

### Volume Mounts (Host → Node)

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraMounts:
      - hostPath: /path/on/host
        containerPath: /data
        readOnly: false
  - role: worker
    extraMounts:
      - hostPath: /path/on/host
        containerPath: /data
```

## Common Issues

### "too many open files" on Linux
- **Cause**: kind creates many containers; default inotify limits too low
- **Fix**: `sysctl fs.inotify.max_user_watches=524288; sysctl fs.inotify.max_user_instances=512`

### Pods stuck in ImagePullBackOff for local images
- **Cause**: Image not loaded into cluster; or `imagePullPolicy: Always`
- **Fix**: `kind load docker-image <img>`; set `imagePullPolicy: IfNotPresent`

### Port mapping not working (connection refused on localhost)
- **Cause**: `extraPortMappings` not configured; or service not type NodePort
- **Fix**: Add port mappings in kind config; or use `kubectl port-forward`

### Cluster creation slow on macOS
- **Cause**: Docker Desktop filesystem performance on macOS
- **Fix**: Use `virtiofs` in Docker Desktop settings; or use OrbStack

## Best Practices

1. **Use specific K8s version** — `--image kindest/node:v1.31.0` for reproducibility
2. **Local registry for multi-image projects** — faster than `kind load` for many images
3. **Name your clusters** — `--name` prevents conflicts between projects
4. **Delete after CI** — `kind delete cluster` in cleanup step
5. **Port mappings for ingress testing** — map 80/443 to host
6. **inotify limits on Linux** — set before creating large clusters
7. **kind + Tilt/Skaffold** — best dev workflow for rapid iteration

## Key Takeaways

- kind = Kubernetes clusters using Docker containers as nodes (~30s startup)
- Multi-node clusters via YAML config — test HA, scheduling, affinity
- `kind load docker-image` — push local images without a registry
- `extraPortMappings` — expose ingress controller on localhost:80
- Local registry pattern: most flexible for multi-service development
- Native GitHub Actions support via `helm/kind-action`
- Best for: local dev, CI/CD testing, multi-node scenarios, ingress testing
