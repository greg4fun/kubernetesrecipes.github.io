---
title: "K8s Metrics Server: kubectl top Guide"
description: "Install Kubernetes Metrics Server for kubectl top and HPA. Resource usage monitoring, troubleshooting metrics, and custom metrics integration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "observability"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "metrics"
  - "monitoring"
  - "kubectl"
  - "hpa"
  - "cka"
relatedRecipes:
  - "kubernetes-hpa-cpu-memory-guide"
  - "resource-limits-requests"
  - "prometheus-monitoring-kubernetes-guide"
  - "kubernetes-resource-optimization-strategies"
---

> 💡 **Quick Answer:** Install Metrics Server: `kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml`. Then `kubectl top nodes` for node usage and `kubectl top pods` for pod usage. Metrics Server is required for HPA (CPU/memory autoscaling) and `kubectl top`. It scrapes kubelet's `/metrics/resource` endpoint every 15s.

## The Problem

Without Metrics Server:

- `kubectl top nodes` and `kubectl top pods` don't work
- HPA can't autoscale on CPU/memory (no metrics source)
- No visibility into actual resource consumption
- Can't identify resource hogs or right-size requests

## The Solution

### Install Metrics Server

```bash
# Standard installation
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# For self-signed certs (kubeadm, minikube, kind)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Patch for insecure TLS (dev/test only)
kubectl patch deployment metrics-server -n kube-system \
  --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

# Verify
kubectl get deployment metrics-server -n kube-system
kubectl get apiservice v1beta1.metrics.k8s.io
# NAME                     SERVICE                      AVAILABLE
# v1beta1.metrics.k8s.io   kube-system/metrics-server   True
```

### kubectl top

```bash
# Node resource usage
kubectl top nodes
# NAME        CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
# cp-1        312m         15%    2451Mi           31%
# worker-1    1250m        31%    8192Mi           64%
# worker-2    876m         21%    6144Mi           48%

# Pod resource usage (current namespace)
kubectl top pods
# NAME                    CPU(cores)   MEMORY(bytes)
# nginx-5d5dd5db49-abc    2m           12Mi
# redis-7b8c9d-xyz        15m          89Mi

# All namespaces
kubectl top pods -A

# Sort by CPU
kubectl top pods -A --sort-by=cpu

# Sort by memory
kubectl top pods -A --sort-by=memory

# Specific pod with containers
kubectl top pod nginx-5d5dd5db49-abc --containers
# POD                     NAME       CPU(cores)   MEMORY(bytes)
# nginx-5d5dd5db49-abc    nginx      2m           10Mi
# nginx-5d5dd5db49-abc    sidecar    1m           2Mi

# By label selector
kubectl top pods -l app=nginx
```

### How Metrics Server Works

```
kubelet ─── /metrics/resource ──→ Metrics Server ──→ Metrics API
  (every 15s scrape)                  (in-memory)       (kubectl top, HPA)

Architecture:
1. Metrics Server runs as Deployment in kube-system
2. Scrapes kubelet's resource metrics endpoint every 15s
3. Stores only latest values (no history)
4. Exposes via Kubernetes Metrics API (metrics.k8s.io)
5. kubectl top and HPA read from this API

NOT a monitoring solution — use Prometheus for:
- Historical data
- Custom metrics
- Alerting
- Dashboards
```

### Verify Metrics API

```bash
# Check API is available
kubectl get apiservices | grep metrics
# v1beta1.metrics.k8s.io   kube-system/metrics-server   True

# Raw API query
kubectl get --raw /apis/metrics.k8s.io/v1beta1/nodes
kubectl get --raw /apis/metrics.k8s.io/v1beta1/namespaces/default/pods

# Test from inside cluster
kubectl run test --image=curlimages/curl --rm -it -- \
  curl -s https://metrics-server.kube-system.svc/apis/metrics.k8s.io/v1beta1/nodes -k
```

### Helm Installation (Alternative)

```bash
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm install metrics-server metrics-server/metrics-server \
  -n kube-system \
  --set args[0]=--kubelet-insecure-tls    # Dev only
```

### Resource Right-Sizing

```bash
# Find pods using most CPU
kubectl top pods -A --sort-by=cpu | head -20

# Find pods using most memory
kubectl top pods -A --sort-by=memory | head -20

# Compare actual usage vs requests
kubectl top pods -n production
kubectl get pods -n production -o custom-columns=\
NAME:.metadata.name,\
CPU_REQ:.spec.containers[0].resources.requests.cpu,\
MEM_REQ:.spec.containers[0].resources.requests.memory

# Pod using 50m CPU but requesting 1000m → over-provisioned
# Pod using 900m CPU but requesting 100m → under-provisioned
```

## Common Issues

**"Metrics API not available"**

Metrics Server not installed or not ready. Check: `kubectl get pods -n kube-system -l k8s-app=metrics-server`.

**"unable to fetch metrics from node"**

kubelet TLS verification failing. For dev: `--kubelet-insecure-tls`. For prod: ensure proper certificates.

**Metrics show 0 for new pods**

Wait 60-90 seconds — Metrics Server needs at least one scrape interval plus processing time.

**HPA shows "unknown" for CPU/memory**

Metrics Server not running or pod has no resource requests set. HPA needs `requests` to calculate percentage.

## Best Practices

- **Always install Metrics Server** — prerequisite for `kubectl top` and HPA
- **Don't use `--kubelet-insecure-tls` in production** — configure proper certificates
- **Use `kubectl top` for quick checks** — Prometheus for deep analysis
- **Set resource requests on all pods** — enables meaningful HPA percentages
- **Monitor Metrics Server itself** — if it goes down, HPA stops working

## Key Takeaways

- Metrics Server provides real-time CPU/memory metrics for nodes and pods
- Required for `kubectl top` and HPA autoscaling
- In-memory only, no history — use Prometheus for historical metrics
- Scrapes kubelet every 15 seconds via the resource metrics endpoint
- Install with one kubectl apply, verify with `kubectl top nodes`
