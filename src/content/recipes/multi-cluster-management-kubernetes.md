---
title: "Kubernetes Multi-Cluster Management: Fleet Patterns"
description: "Manage Kubernetes fleets: kubectl contexts/kubectx, Argo CD ApplicationSets, Rancher Fleet, OpenShift ACM, Cluster API, and cross-cluster service mesh."
category: "deployments"
publishDate: "2026-04-20"
author: "Luca Berton"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.25+"
tags: ["multi-cluster", "federation", "fleet", "gitops", "management", "argocd", "cluster-api", "kubectx"]
relatedRecipes:
  - "argocd-multi-cluster-app-of-apps"
  - "argocd-gitops"
  - "kubectl-config-context-management"
  - "cilium-clustermesh-multicluster"
  - "rhacs-multi-cluster-management"
  - "kubernetes-disaster-recovery-enterprise"
---

> 💡 **Quick Answer:** Manage multiple K8s clusters by: 1) `kubectl` contexts for manual switching, 2) ArgoCD ApplicationSets for GitOps fleet deployment, 3) Cluster API for lifecycle management, or 4) Rancher/OpenShift ACM for full platform management.

## The Problem

Organizations run multiple clusters for:
- Environment separation (dev/staging/prod)
- Geographic distribution (multi-region)
- Workload isolation (PCI, GPU, general)
- Disaster recovery (active-active or active-passive)

Managing them individually doesn't scale.

## The Solution

### kubectl Context Management

```bash
# List all configured clusters
kubectl config get-contexts
# CURRENT   NAME          CLUSTER       AUTHINFO    NAMESPACE
# *         prod-us       prod-us       admin       default
#           prod-eu       prod-eu       admin       default
#           staging       staging       dev         default

# Switch context
kubectl config use-context prod-eu

# Run command against specific context
kubectl --context=staging get pods

# Merge kubeconfigs
KUBECONFIG=~/.kube/prod.yaml:~/.kube/staging.yaml kubectl config view --flatten > ~/.kube/config

# Rename context for clarity
kubectl config rename-context kubernetes-admin@cluster prod-us-east

# kubectx / kubens for fast switching
kubectx prod-eu
kubectx prod=arn:aws:eks:eu-west-1:123456789:cluster/production   # rename
kubens payments
```

Always check `kubectl config current-context` (or show it in your prompt) before destructive commands.

### ArgoCD Multi-Cluster GitOps

```yaml
# Register clusters in ArgoCD
# argocd cluster add prod-eu --name prod-eu

# ApplicationSet for fleet-wide deployment
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: myapp-fleet
  namespace: argocd
spec:
  generators:
    - clusters:
        selector:
          matchLabels:
            env: production
  template:
    metadata:
      name: "myapp-{{name}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/org/k8s-manifests.git
        targetRevision: main
        path: "apps/myapp/overlays/{{metadata.labels.region}}"
      destination:
        server: "{{server}}"
        namespace: myapp
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

Register clusters with `argocd cluster add <context> --name prod-eu`, then label the generated cluster Secret (`env`, `region`) for the generator selectors. Run Argo CD in a dedicated management cluster, not in a cluster it deploys to.

### Rancher Fleet (Edge Scale)

```yaml
apiVersion: fleet.cattle.io/v1alpha1
kind: GitRepo
metadata:
  name: my-app
  namespace: fleet-default
spec:
  repo: https://git.example.com/apps/my-app.git
  branch: main
  paths:
    - overlays/edge
  targets:
    - name: edge-clusters
      clusterSelector:
        matchLabels:
          location: edge
```

### OpenShift Advanced Cluster Management (ACM)

ACM groups managed clusters into `ManagedClusterSet`s and selects targets with `Placement`, which policies and Argo CD (OpenShift GitOps) ApplicationSets consume:

```yaml
apiVersion: cluster.open-cluster-management.io/v1beta1
kind: Placement
metadata:
  name: prod-clusters
  namespace: openshift-gitops
spec:
  clusterSets: ["production"]
  predicates:
    - requiredClusterSelector:
        labelSelector:
          matchLabels:
            env: production
```

### Cluster API (Lifecycle Management)

```yaml
# Manage cluster lifecycle declaratively
apiVersion: cluster.x-k8s.io/v1beta1
kind: Cluster
metadata:
  name: prod-eu-west
  namespace: clusters
spec:
  clusterNetwork:
    pods:
      cidrBlocks: ["192.168.0.0/16"]
    services:
      cidrBlocks: ["10.128.0.0/12"]
  controlPlaneRef:
    apiVersion: controlplane.cluster.x-k8s.io/v1beta1
    kind: KubeadmControlPlane
    name: prod-eu-west-cp
  infrastructureRef:
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
    kind: AWSCluster
    name: prod-eu-west
```

### Architecture Patterns

```mermaid
graph TD
    A[Management Cluster] --> B[Cluster API]
    A --> C[ArgoCD]
    A --> D[Monitoring Hub]
    
    B -->|Provisions| E[Prod US]
    B -->|Provisions| F[Prod EU]
    B -->|Provisions| G[Staging]
    
    C -->|Deploys apps| E
    C -->|Deploys apps| F
    C -->|Deploys apps| G
    
    D -->|Collects metrics| E
    D -->|Collects metrics| F
    D -->|Collects metrics| G
```

### Fleet Management Tools Comparison

| Tool | Use Case | Approach |
|------|----------|----------|
| kubectl contexts | Small teams, <5 clusters | Manual context switching |
| ArgoCD ApplicationSets | GitOps fleet deployment | Pull-based, declarative |
| Flux + Cluster API | Full lifecycle + deploy | GitOps native |
| Rancher | Platform management | UI + API, full lifecycle |
| OpenShift ACM | Red Hat enterprise | Policy-driven governance |
| Loft/vCluster | Virtual clusters | Multi-tenancy on single cluster |
| Crossplane | Infrastructure as code | Compositions, cloud resources |

### Service Mesh Multi-Cluster

```bash
# Istio multi-primary: shared root CA, then give each control plane
# API access to the other cluster for endpoint discovery
istioctl create-remote-secret --context=prod-eu --name=prod-eu | \
  kubectl apply -f - --context=prod-us
istioctl create-remote-secret --context=prod-us --name=prod-us | \
  kubectl apply -f - --context=prod-eu
# Same-named Services in the same namespace are now load-balanced across clusters
```

```yaml
# Cilium Cluster Mesh: mark a Service global (same name/namespace in each cluster)
apiVersion: v1
kind: Service
metadata:
  name: backend
  annotations:
    service.cilium.io/global: "true"
spec:
  selector:
    app: backend
  ports:
    - port: 80
```

### Centralized Monitoring

```bash
# Thanos for multi-cluster Prometheus
# Each cluster runs Prometheus + Thanos Sidecar
# Central Thanos Query aggregates all clusters

# Or use Grafana Cloud / Datadog with cluster labels
# Add cluster label to all metrics:
# external_labels:
#   cluster: prod-us-east
#   region: us-east-1
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Wrong cluster deployed to | Context confusion | Use namespace-per-cluster or ArgoCD |
| Certificate expired on remote | kubeconfig token stale | Refresh credentials or use OIDC |
| Network connectivity | Clusters not peered | Set up VPN/peering between VPCs |
| Config drift between clusters | Manual changes | Enforce GitOps — no `kubectl apply` |
| Inconsistent versions | Clusters at different K8s versions | Use Cluster API for version management |

## Frequently Asked Questions

### What is the best tool for Kubernetes multi-cluster management?
It depends on the layer. For app delivery, Argo CD ApplicationSets or Flux; for edge fleets of hundreds of clusters, Rancher Fleet; for cluster lifecycle, Cluster API or your cloud's managed API; for governance on OpenShift, ACM. Most enterprises combine a GitOps tool with one lifecycle tool.

### Is Kubernetes Federation (KubeFed) still used?
No. KubeFed was archived in 2023. Its role is covered by GitOps fan-out (ApplicationSets, Fleet), ACM/Open Cluster Management placement, and multi-cluster service meshes.

### How do services communicate across clusters?
Via a multi-cluster mesh or CNI: Istio multi-primary/primary-remote, Cilium Cluster Mesh global services, Linkerd multicluster, or Skupper for L7 links without flat networking. The Kubernetes MCS API (`ServiceExport`/`ServiceImport`) standardizes this where supported.

## Best Practices

1. **Use a management cluster** — single pane for fleet operations
2. **GitOps for all deployments** — ArgoCD ApplicationSets across clusters
3. **Standardize cluster labels** — `env`, `region`, `tier` for fleet targeting
4. **Separate kubeconfigs per cluster** — avoid accidental cross-cluster commands; use descriptive context names, not ARNs
5. **Centralize observability** — one Grafana for all clusters with cluster label

## Key Takeaways

- Start with kubectl contexts, graduate to ArgoCD/Flux for automation
- Management cluster pattern: one cluster manages the fleet's lifecycle and deployments
- Cluster API provisions clusters declaratively; ArgoCD deploys apps declaratively
- Label clusters consistently for ApplicationSet generators
- Multi-cluster service mesh (Istio/Linkerd) enables cross-cluster service discovery
