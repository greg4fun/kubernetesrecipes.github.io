---
title: "How to Run Kubernetes in Docker (kind)"
description: "Create local Kubernetes clusters using kind (Kubernetes in Docker). Set up multi-node clusters, configure networking, and test applications locally."
category: "troubleshooting"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["kind", "local-development", "docker", "testing", "development"]
---

# How to Run Kubernetes in Docker (kind)

kind (Kubernetes IN Docker) runs Kubernetes clusters using Docker containers as nodes. It's perfect for local development, testing, and CI/CD pipelines.

## Install kind

```bash
# macOS with Homebrew
brew install kind

# Linux
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind

# Windows with Chocolatey
choco install kind

# Verify installation
kind version
```

## Create Basic Cluster

```bash
# Create cluster with default name "kind"
kind create cluster

# Create cluster with custom name
kind create cluster --name my-cluster

# Create with specific Kubernetes version
kind create cluster --image kindest/node:v1.28.0

# List clusters
kind get clusters

# Get cluster info
kubectl cluster-info --context kind-my-cluster
```

## Multi-Node Cluster

```yaml
# multi-node-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
  - role: worker
```

```bash
kind create cluster --config multi-node-config.yaml
kubectl get nodes
```

## High Availability Cluster

```yaml
# ha-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: control-plane
  - role: control-plane
  - role: worker
  - role: worker
```

```bash
kind create cluster --name ha-cluster --config ha-config.yaml
```

## Expose Ports (Ingress)

```yaml
# ingress-config.yaml
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
```

```bash
# Create cluster with ingress support
kind create cluster --config ingress-config.yaml

# Install NGINX Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# Wait for ingress controller
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s
```

## NodePort Access

```yaml
# nodeport-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30000
        hostPort: 30000
      - containerPort: 30001
        hostPort: 30001
```

```bash
# Create NodePort service accessible on localhost:30000
kubectl create deployment nginx --image=nginx
kubectl expose deployment nginx --type=NodePort --port=80 --node-port=30000
curl localhost:30000
```

## Mount Host Directory

```yaml
# mount-config.yaml
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

## Load Docker Image

```bash
# Build local image
docker build -t myapp:v1 .

# Load image into kind cluster
kind load docker-image myapp:v1 --name my-cluster

# For images from archive
kind load image-archive myimage.tar --name my-cluster

# Verify image is available
docker exec -it my-cluster-control-plane crictl images | grep myapp
```

## Custom Kubernetes Configuration

```yaml
# custom-k8s-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
featureGates:
  # Enable specific feature gates
  CSIMigration: true
runtimeConfig:
  # Enable specific API versions
  "api/alpha": "true"
kubeadmConfigPatches:
  - |
    kind: ClusterConfiguration
    apiServer:
      extraArgs:
        enable-admission-plugins: NodeRestriction,PodSecurityPolicy
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            max-pods: "150"
```

## Networking Configuration

```yaml
# networking-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  # Disable default CNI (install your own)
  disableDefaultCNI: true
  # Change pod subnet
  podSubnet: "10.244.0.0/16"
  # Change service subnet
  serviceSubnet: "10.96.0.0/12"
  # API server address
  apiServerAddress: "127.0.0.1"
  # API server port
  apiServerPort: 6443
```

## Install Custom CNI

```yaml
# calico-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  disableDefaultCNI: true
  podSubnet: "192.168.0.0/16"
nodes:
  - role: control-plane
  - role: worker
```

```bash
# Create cluster
kind create cluster --config calico-config.yaml

# Install Calico
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml

# Wait for Calico
kubectl wait --for=condition=ready pod -l k8s-app=calico-node -n kube-system --timeout=90s
```

## Local Registry

```bash
#!/bin/bash
# create-cluster-with-registry.sh

# Create registry container
reg_name='kind-registry'
reg_port='5001'

if [ "$(docker inspect -f '{{.State.Running}}' "${reg_name}" 2>/dev/null || true)" != 'true' ]; then
  docker run -d --restart=always -p "127.0.0.1:${reg_port}:5000" --name "${reg_name}" registry:2
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
if [ "$(docker inspect -f='{{json .NetworkSettings.Networks.kind}}' "${reg_name}")" = 'null' ]; then
  docker network connect "kind" "${reg_name}"
fi

# Document the local registry
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "localhost:${reg_port}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
EOF
```

```bash
# Use the local registry
docker tag myapp:v1 localhost:5001/myapp:v1
docker push localhost:5001/myapp:v1

# Deploy using local registry
kubectl create deployment myapp --image=localhost:5001/myapp:v1
```

## Delete Cluster

```bash
# Delete specific cluster
kind delete cluster --name my-cluster

# Delete default cluster
kind delete cluster

# Delete all clusters
kind delete clusters --all
```

## CI/CD Usage

```yaml
# GitHub Actions example
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Create kind cluster
        uses: helm/kind-action@v1.8.0
        with:
          cluster_name: test-cluster
      
      - name: Test cluster
        run: |
          kubectl cluster-info
          kubectl get nodes
      
      - name: Run tests
        run: |
          kubectl apply -f manifests/
          kubectl wait --for=condition=ready pod -l app=myapp --timeout=60s
```

## Troubleshooting

```bash
# Get cluster logs
kind export logs --name my-cluster ./logs

# Check Docker containers
docker ps -a | grep kind

# Access node shell
docker exec -it my-cluster-control-plane bash

# Check kubelet logs on node
docker exec -it my-cluster-control-plane journalctl -u kubelet

# Restart cluster (delete and recreate)
kind delete cluster --name my-cluster
kind create cluster --name my-cluster --config config.yaml
```

## Common Issues

```bash
# Port already in use
# Check what's using the port
lsof -i :80
# Change port mapping in config

# Image not found
# Load image into cluster
kind load docker-image myapp:v1

# Network issues
# Restart Docker
docker restart

# Insufficient resources
# Increase Docker memory/CPU limits
# Docker Desktop > Settings > Resources
```

## Summary

kind creates disposable Kubernetes clusters in Docker containers for local development and testing. Use configuration files to set up multi-node clusters, expose ports for ingress, and mount host directories. Load local Docker images with `kind load docker-image`. kind is ideal for CI/CD pipelines due to its fast creation time and isolation. Remember to delete clusters when done to free resources.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
