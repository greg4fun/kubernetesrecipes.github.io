---
title: "Install VPA with hack/vpa-up.sh Script"
description: "Install Kubernetes Vertical Pod Autoscaler using hack/vpa-up.sh from the official repository. VPA components, prerequisites, and troubleshooting guide."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "autoscaling"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "vpa"
  - "autoscaling"
  - "installation"
  - "vertical-pod-autoscaler"
relatedRecipes:
  - "vertical-pod-autoscaler"
  - "horizontal-pod-autoscaler"
---

> 💡 **Quick Answer:** Clone the VPA repo and run `./hack/vpa-up.sh`: `git clone https://github.com/kubernetes/autoscaler.git && cd autoscaler/vertical-pod-autoscaler && ./hack/vpa-up.sh`. This installs three components: VPA Recommender (generates recommendations), VPA Updater (applies them), and VPA Admission Controller (injects on pod creation). Verify with `kubectl get pods -n kube-system | grep vpa`.

## The Problem

Kubernetes VPA isn't included in default cluster installations. The official installation method uses `hack/vpa-up.sh` which:

- Deploys all three VPA components
- Creates required CRDs
- Sets up RBAC and certificates
- Works on any Kubernetes cluster (not just managed services)

## The Solution

### Prerequisites

```bash
# Kubernetes 1.25+ cluster running
kubectl version --short

# metrics-server must be running (VPA needs pod metrics)
kubectl get pods -n kube-system | grep metrics-server
# If missing:
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# OpenSSL (for certificate generation)
openssl version
```

### Install VPA

```bash
# Clone the autoscaler repository
git clone https://github.com/kubernetes/autoscaler.git
cd autoscaler/vertical-pod-autoscaler

# Run the install script
./hack/vpa-up.sh

# Output:
# customresourcedefinition.apiextensions.k8s.io/verticalpodautoscalers.autoscaling.k8s.io created
# customresourcedefinition.apiextensions.k8s.io/verticalpodautoscalercheckpoints.autoscaling.k8s.io created
# clusterrole.rbac.authorization.k8s.io/system:vpa-actor created
# ...
# deployment.apps/vpa-recommender created
# deployment.apps/vpa-updater created
# deployment.apps/vpa-admission-controller created
```

### Verify Installation

```bash
# Check all VPA pods are running
kubectl get pods -n kube-system | grep vpa
# vpa-admission-controller-xxx   1/1   Running   0   30s
# vpa-recommender-xxx            1/1   Running   0   30s
# vpa-updater-xxx                1/1   Running   0   30s

# Check CRDs
kubectl get crd | grep verticalpodautoscaler
# verticalpodautoscalercheckpoints.autoscaling.k8s.io
# verticalpodautoscalers.autoscaling.k8s.io

# Test with a sample VPA
cat <<EOF | kubectl apply -f -
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: test-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-deployment
  updatePolicy:
    updateMode: "Off"
EOF

kubectl get vpa
```

### VPA Components Explained

| Component | Purpose | What It Does |
|-----------|---------|-------------|
| **vpa-recommender** | Generates recommendations | Watches pod metrics, calculates optimal CPU/memory requests |
| **vpa-updater** | Applies recommendations | Evicts pods so they restart with new resource requests |
| **vpa-admission-controller** | Mutating webhook | Injects recommended resources into new pods at creation |

### Uninstall VPA

```bash
# From the same directory
./hack/vpa-down.sh

# Or manually
kubectl delete -f deploy/
kubectl delete crd verticalpodautoscalers.autoscaling.k8s.io
kubectl delete crd verticalpodautoscalercheckpoints.autoscaling.k8s.io
```

### Alternative: Helm Installation

```bash
# If you prefer Helm over hack/vpa-up.sh
helm repo add fairwinds-stable https://charts.fairwinds.com/stable
helm install vpa fairwinds-stable/vpa -n vpa --create-namespace

# Or using the official chart (newer)
helm repo add cowboysysop https://cowboysysop.github.io/charts/
helm install vpa cowboysysop/vertical-pod-autoscaler -n kube-system
```

### Quick VPA Test

```yaml
# Create a deployment + VPA to verify everything works
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vpa-test
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vpa-test
  template:
    metadata:
      labels:
        app: vpa-test
    spec:
      containers:
      - name: stress
        image: polinux/stress
        command: ["stress", "--cpu", "1", "--vm", "1", "--vm-bytes", "100M"]
        resources:
          requests:
            cpu: 50m
            memory: 50Mi

---
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: vpa-test
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vpa-test
  updatePolicy:
    updateMode: "Off"    # Recommendation only
```

```bash
# Wait 5 minutes for recommendations to appear
kubectl get vpa vpa-test -o yaml | grep -A15 recommendation
# recommendation:
#   containerRecommendations:
#   - containerName: stress
#     target:
#       cpu: 587m
#       memory: 262144k
```

## Common Issues

**"error: unable to recognize" CRD errors**

Old Kubernetes version. VPA v1 API requires K8s 1.25+. For older clusters, use VPA v1beta2.

**hack/vpa-up.sh fails with certificate errors**

OpenSSL not installed or wrong version. Install: `apt install openssl` or `brew install openssl`.

**VPA recommender shows no recommendations**

Needs at least 5 minutes of pod metrics. Check metrics-server is running: `kubectl top pods`.

**VPA admission controller webhook failing**

Certificate expired or secret missing. Re-run: `./hack/vpa-up.sh` to regenerate.

## Best Practices

- **Start with `updateMode: Off`** — get recommendations before auto-applying
- **Install metrics-server first** — VPA depends on it for pod metrics data
- **Use Helm for production** — easier upgrades and GitOps compatibility
- **Pin VPA version** — `git checkout vpa-release-1.2` before running hack/vpa-up.sh
- **Monitor VPA recommendations** with Goldilocks dashboard

## Key Takeaways

- `./hack/vpa-up.sh` is the official VPA installation method from the autoscaler repo
- Installs three components: recommender, updater, and admission controller
- Requires metrics-server running in the cluster
- Start with `updateMode: Off` to review recommendations before auto-applying
- Helm installation is an easier alternative for production clusters
