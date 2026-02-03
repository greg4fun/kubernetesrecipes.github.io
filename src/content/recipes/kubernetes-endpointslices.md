---
title: "How to Use Kubernetes EndpointSlices"
description: "Understand and manage EndpointSlices for scalable service discovery. Configure endpoint slicing, troubleshoot connectivity, and optimize large clusters."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["endpointslices", "services", "networking", "discovery", "scalability"]
---

> 💡 **Quick Answer:** EndpointSlices replace legacy Endpoints for better scalability—they chunk endpoints into ~100 per slice. View with `kubectl get endpointslices -l kubernetes.io/service-name=<svc>`. They're auto-managed by the EndpointSlice controller; you rarely create them manually.
>
> **Key benefit:** Large services (1000+ pods) update faster with EndpointSlices vs single Endpoints object.
>
> **Gotcha:** Some older CNIs/service meshes may still use legacy Endpoints—verify your stack supports EndpointSlices.

# How to Use Kubernetes EndpointSlices

EndpointSlices are the modern, scalable replacement for Endpoints. They split service endpoints into smaller chunks for better performance in large clusters.

## EndpointSlices vs Endpoints

```bash
# Traditional Endpoints (one object per service)
kubectl get endpoints my-service -o yaml

# EndpointSlices (multiple slices per service)
kubectl get endpointslices -l kubernetes.io/service-name=my-service

# EndpointSlices advantages:
# - Scalable: Split into 100-endpoint chunks
# - Dual-stack: Native IPv4/IPv6 support
# - Topology: Include zone/region information
# - Efficient: Smaller updates, less API traffic
```

## View EndpointSlices

```bash
# List all EndpointSlices
kubectl get endpointslices -A

# Get EndpointSlices for a service
kubectl get endpointslices -l kubernetes.io/service-name=nginx

# Detailed view
kubectl describe endpointslice nginx-abc12

# YAML output
kubectl get endpointslice nginx-abc12 -o yaml
```

## EndpointSlice Structure

```yaml
# Example EndpointSlice
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: my-service-abc12
  labels:
    kubernetes.io/service-name: my-service
    endpointslice.kubernetes.io/managed-by: endpointslice-controller.k8s.io
addressType: IPv4  # IPv4, IPv6, or FQDN
endpoints:
  - addresses:
      - "10.244.0.5"
    conditions:
      ready: true
      serving: true
      terminating: false
    nodeName: node-1
    zone: us-east-1a
    hints:
      forZones:
        - name: us-east-1a
  - addresses:
      - "10.244.1.8"
    conditions:
      ready: true
      serving: true
      terminating: false
    nodeName: node-2
    zone: us-east-1b
ports:
  - name: http
    port: 8080
    protocol: TCP
```

## Manual EndpointSlice

```yaml
# manual-endpointslice.yaml
# For external services without selectors
apiVersion: v1
kind: Service
metadata:
  name: external-database
spec:
  ports:
    - port: 5432
      targetPort: 5432
  # No selector - manual endpoints
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: external-database-1
  labels:
    kubernetes.io/service-name: external-database
addressType: IPv4
endpoints:
  - addresses:
      - "192.168.1.100"
    conditions:
      ready: true
  - addresses:
      - "192.168.1.101"
    conditions:
      ready: true
ports:
  - port: 5432
    protocol: TCP
```

## Topology Aware Routing

```yaml
# service-with-topology.yaml
apiVersion: v1
kind: Service
metadata:
  name: web-service
  annotations:
    # Enable topology aware hints
    service.kubernetes.io/topology-mode: Auto
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
```

```bash
# Check topology hints in EndpointSlices
kubectl get endpointslice -l kubernetes.io/service-name=web-service -o yaml | grep -A5 hints
```

## Endpoint Conditions

```yaml
# EndpointSlice conditions explained:
endpoints:
  - addresses: ["10.244.0.5"]
    conditions:
      # Pod is ready to receive traffic
      ready: true
      
      # Pod can serve traffic (even if terminating)
      serving: true
      
      # Pod is terminating (graceful shutdown)
      terminating: false
```

## Debug Service Connectivity

```bash
# 1. Check service exists
kubectl get svc my-service

# 2. Check EndpointSlices
kubectl get endpointslice -l kubernetes.io/service-name=my-service

# 3. Verify endpoints are ready
kubectl get endpointslice -l kubernetes.io/service-name=my-service -o yaml | grep -A3 conditions

# 4. Check pod labels match selector
kubectl get pods -l app=my-app --show-labels

# 5. Verify pods are ready
kubectl get pods -l app=my-app -o wide

# 6. Test connectivity
kubectl run debug --rm -it --image=busybox -- wget -qO- my-service:80
```

## Large Cluster Optimization

```yaml
# EndpointSlices automatically split at 100 endpoints
# For very large services, multiple slices are created

# Check slice count
kubectl get endpointslice -l kubernetes.io/service-name=large-service --no-headers | wc -l

# Monitor EndpointSlice controller
kubectl logs -n kube-system -l component=kube-controller-manager | grep -i endpointslice
```

## Dual-Stack EndpointSlices

```yaml
# IPv4 EndpointSlice
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: dual-stack-service-ipv4
  labels:
    kubernetes.io/service-name: dual-stack-service
addressType: IPv4
endpoints:
  - addresses: ["10.244.0.5"]
    conditions:
      ready: true
ports:
  - port: 80
---
# IPv6 EndpointSlice
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: dual-stack-service-ipv6
  labels:
    kubernetes.io/service-name: dual-stack-service
addressType: IPv6
endpoints:
  - addresses: ["fd00::5"]
    conditions:
      ready: true
ports:
  - port: 80
```

## Watch Endpoint Changes

```bash
# Watch EndpointSlice changes
kubectl get endpointslice -l kubernetes.io/service-name=my-service -w

# Watch with output
kubectl get endpointslice -l kubernetes.io/service-name=my-service -o wide -w

# Check events
kubectl get events --field-selector reason=EndpointSliceUpdated
```

## EndpointSlice in Code

```go
// Go client example
import (
    discoveryv1 "k8s.io/api/discovery/v1"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// List EndpointSlices for a service
slices, _ := clientset.DiscoveryV1().EndpointSlices("default").List(
    context.TODO(),
    metav1.ListOptions{
        LabelSelector: "kubernetes.io/service-name=my-service",
    },
)

for _, slice := range slices.Items {
    for _, endpoint := range slice.Endpoints {
        if *endpoint.Conditions.Ready {
            fmt.Printf("Ready endpoint: %v\n", endpoint.Addresses)
        }
    }
}
```

## Troubleshooting

```bash
# No EndpointSlices created
# Check: Service has selector and pods match

# Endpoints not ready
# Check: Pod readiness probe passing
kubectl describe pod <pod> | grep -A5 Readiness

# Missing endpoints
# Check: Pod in same namespace as service
# Check: Pod labels match service selector
kubectl get svc my-service -o jsonpath='{.spec.selector}'
kubectl get pods -l <selector>

# Stale endpoints
# Force EndpointSlice controller reconciliation
kubectl annotate svc my-service reconcile=$(date +%s)
```

## Mirroring to Endpoints

```bash
# EndpointSlice controller also maintains legacy Endpoints
# for backward compatibility

# Both should show same data
kubectl get endpoints my-service
kubectl get endpointslice -l kubernetes.io/service-name=my-service

# Disable mirroring (if not needed)
# Set on Service:
# metadata.labels:
#   endpointslice.kubernetes.io/skip-mirror: "true"
```

## Summary

EndpointSlices replace Endpoints for scalable service discovery. They automatically split large services into 100-endpoint chunks. Each slice includes endpoint conditions (ready, serving, terminating) and optional topology hints for zone-aware routing. Use EndpointSlices for debugging service connectivity - check that endpoints exist and are ready. Create manual EndpointSlices for services without selectors (external services). Monitor with `kubectl get endpointslice -l kubernetes.io/service-name=<name>`. The controller maintains both EndpointSlices and legacy Endpoints for compatibility.

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
