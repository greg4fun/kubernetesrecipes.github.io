---
title: "Cluster API: Declarative K8s Management"
description: "Manage Kubernetes cluster lifecycle with Cluster API. Provision, upgrade, and scale clusters declaratively using management clusters and infrastructure providers."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "cluster-api"
  - "cluster-management"
  - "infrastructure"
  - "automation"
  - "cka"
relatedRecipes:
  - "kubernetes-kubeadm-init-guide"
  - "kubernetes-kubeadm-upgrade-guide"
  - "kubernetes-operator-pattern-guide"
  - "kubernetes-crossplane-infrastructure-guide"
---

> 💡 **Quick Answer:** Cluster API (CAPI) manages Kubernetes clusters as Kubernetes resources. A management cluster runs CAPI controllers that provision workload clusters on AWS, Azure, GCP, vSphere, bare metal, etc. Define clusters in YAML, apply to management cluster, CAPI handles provisioning. Key resources: `Cluster`, `MachineDeployment`, `MachinePool`. Install: `clusterctl init --infrastructure aws`.

## The Problem

Managing multiple Kubernetes clusters is complex:

- Manual provisioning is error-prone and slow
- Each cloud has different tools (eksctl, az aks, gcloud)
- Upgrades require careful coordination
- No unified API for multi-cloud cluster management
- Infrastructure as Code tools (Terraform) don't understand K8s lifecycle

## The Solution

### Architecture

```
Management Cluster (runs CAPI controllers)
├── Cluster API core controllers
├── Bootstrap provider (kubeadm)
├── Control plane provider (kubeadm)
├── Infrastructure provider (AWS/Azure/vSphere/...)
│
├── Cluster/production-us
│   ├── KubeadmControlPlane (3 control planes)
│   └── MachineDeployment (10 workers)
│
└── Cluster/staging-eu
    ├── KubeadmControlPlane (1 control plane)
    └── MachineDeployment (3 workers)
```

### Install Cluster API

```bash
# Install clusterctl CLI
curl -L https://github.com/kubernetes-sigs/cluster-api/releases/download/v1.7.0/clusterctl-linux-amd64 \
  -o clusterctl
chmod +x clusterctl
mv clusterctl /usr/local/bin/

# Initialize management cluster (current kubeconfig)
# AWS example:
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=<key>
export AWS_SECRET_ACCESS_KEY=<secret>

clusterctl init --infrastructure aws

# Other providers:
# clusterctl init --infrastructure azure
# clusterctl init --infrastructure vsphere
# clusterctl init --infrastructure docker  (for testing)

# Verify
kubectl get providers -A
```

### Create a Workload Cluster

```bash
# Generate cluster manifest
clusterctl generate cluster production \
  --kubernetes-version v1.30.0 \
  --control-plane-machine-count 3 \
  --worker-machine-count 5 \
  > production-cluster.yaml

# Apply to management cluster
kubectl apply -f production-cluster.yaml

# Watch provisioning
kubectl get cluster production -w
# NAME         PHASE          AGE
# production   Provisioning   1m
# production   Provisioned    5m

# Get workload cluster kubeconfig
clusterctl get kubeconfig production > production.kubeconfig
kubectl --kubeconfig=production.kubeconfig get nodes
```

### Cluster Resources

```yaml
apiVersion: cluster.x-k8s.io/v1beta1
kind: Cluster
metadata:
  name: production
  namespace: default
spec:
  clusterNetwork:
    pods:
      cidrBlocks: ["192.168.0.0/16"]
    services:
      cidrBlocks: ["10.96.0.0/12"]
  controlPlaneRef:
    apiVersion: controlplane.cluster.x-k8s.io/v1beta1
    kind: KubeadmControlPlane
    name: production-cp
  infrastructureRef:
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
    kind: AWSCluster
    name: production

---
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: AWSCluster
metadata:
  name: production
spec:
  region: us-east-1
  sshKeyName: my-key

---
apiVersion: controlplane.cluster.x-k8s.io/v1beta1
kind: KubeadmControlPlane
metadata:
  name: production-cp
spec:
  replicas: 3
  version: v1.30.0
  machineTemplate:
    infrastructureRef:
      apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
      kind: AWSMachineTemplate
      name: production-cp
  kubeadmConfigSpec:
    initConfiguration:
      nodeRegistration:
        kubeletExtraArgs:
          cloud-provider: external

---
apiVersion: cluster.x-k8s.io/v1beta1
kind: MachineDeployment
metadata:
  name: production-workers
spec:
  clusterName: production
  replicas: 5
  selector:
    matchLabels: {}
  template:
    spec:
      clusterName: production
      version: v1.30.0
      bootstrap:
        configRef:
          apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
          kind: KubeadmConfigTemplate
          name: production-workers
      infrastructureRef:
        apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
        kind: AWSMachineTemplate
        name: production-workers
```

### Scale and Upgrade

```bash
# Scale workers
kubectl patch machinedeployment production-workers --type merge \
  -p '{"spec":{"replicas": 10}}'

# Upgrade Kubernetes version (rolling update)
kubectl patch kubeadmcontrolplane production-cp --type merge \
  -p '{"spec":{"version":"v1.31.0"}}'
# Control planes upgrade first, then workers follow

# Monitor upgrade
kubectl get machines -w
# NAME                        PHASE     VERSION
# production-cp-abc           Running   v1.31.0  ← upgraded
# production-cp-def           Running   v1.30.0  ← upgrading
# production-workers-ghi      Running   v1.30.0  ← waiting

# Delete cluster
kubectl delete cluster production
# All infrastructure cleaned up automatically
```

### clusterctl Operations

```bash
# List clusters
kubectl get clusters -A

# Cluster status
clusterctl describe cluster production

# Move management to another cluster
clusterctl move --to-kubeconfig new-mgmt.kubeconfig

# Upgrade CAPI components
clusterctl upgrade plan
clusterctl upgrade apply --contract v1beta1

# List available providers
clusterctl config repositories
```

## Common Issues

**Cluster stuck in Provisioning**

Check infrastructure provider logs: `kubectl logs -n capi-system deployment/capi-controller-manager`. Usually cloud credentials or quota issue.

**Machines not joining**

Bootstrap failure. Check: `kubectl get machines` → describe the stuck machine → check bootstrap data and cloud-init logs.

**Management cluster lost**

If management cluster dies, workload clusters keep running but can't be managed. Use `clusterctl move` to back up to another cluster.

## Best Practices

- **Dedicated management cluster** — don't run workloads on it
- **GitOps for cluster definitions** — version-control all cluster YAML
- **Use MachineHealthCheck** — auto-replace unhealthy nodes
- **Back up management cluster** — etcd snapshots of CAPI state
- **Test upgrades on staging** before production

## Key Takeaways

- Cluster API manages K8s clusters as Kubernetes resources (CRDs)
- Management cluster runs controllers; workload clusters run applications
- Supports AWS, Azure, GCP, vSphere, bare metal, Docker (test)
- Scale and upgrade clusters by patching resources (declarative)
- GitOps-friendly — define entire cluster fleet in version-controlled YAML
