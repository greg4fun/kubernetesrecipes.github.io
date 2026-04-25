---
title: "Kubernetes EndpointSlices Explained"
description: "Production guide for kubernetes endpointslices explained. Step-by-step YAML examples, common issues, and best practices for K8s clusters."
category: "networking"
difficulty: "Understand Kubernetes EndpointSlices for scalable service endpoint management. How they improve on Endpoints objects for large clusters with thousands of pods."
publishDate: "2026-04-05"
tags: ["endpointslices", "endpoints", "service-discovery", "networking", "scalability"]
author: "Luca Berton"
relatedRecipes:
  - "kubernetes-service-account-guide"
  - "kubernetes-health-checks"
  - "kubernetes-canary-deployment"
  - "kubernetes-headless-service"
---

> 💡 **Quick Answer:** networking

## The Problem

This is a fundamental Kubernetes topic that engineers search for frequently. A comprehensive reference with production-ready examples saves hours of trial and error.

## The Solution

### EndpointSlices vs Endpoints

```bash
# Old: Endpoints (one object per Service, all IPs)
kubectl get endpoints my-service
# NAME         ENDPOINTS
# my-service   10.244.1.5:80,10.244.2.8:80,...  # Gets huge!

# New: EndpointSlices (chunked into ~100 endpoints each)
kubectl get endpointslices -l kubernetes.io/service-name=my-service
# NAME                  ADDRESSTYPE   PORTS   ENDPOINTS   AGE
# my-service-abc12      IPv4          80      100         1h
# my-service-def34      IPv4          80      100         1h
# my-service-ghi56      IPv4          80      50          1h
```

### Why EndpointSlices Matter

| Feature | Endpoints | EndpointSlices |
|---------|-----------|----------------|
| Max size | 1 object, grows unbounded | ~100 endpoints per slice |
| Update cost | Update entire object | Update only changed slice |
| Dual-stack | One object for IPv4+IPv6 | Separate slices per address type |
| Topology hints | ❌ | ✅ (route to same zone) |
| Default since | Legacy | K8s 1.21+ (default) |

### Topology-Aware Routing

```yaml
# EndpointSlice with topology hints
apiVersion: v1
kind: Service
metadata:
  name: my-service
  annotations:
    service.kubernetes.io/topology-mode: Auto
spec:
  selector:
    app: web
  ports:
    - port: 80
# Kubernetes routes traffic to pods in the same zone when possible
# Reduces cross-zone data transfer costs!
```

```mermaid
graph TD
    A[Service: 250 pods] -->|Old: Endpoints| B[1 object with 250 IPs]
    B -->|Any change| C[Re-sync entire 250-IP object]
    A -->|New: EndpointSlices| D[Slice 1: 100 IPs]
    A --> E[Slice 2: 100 IPs]
    A --> F[Slice 3: 50 IPs]
    D -->|1 pod changes| G[Re-sync only Slice 1]
```

## Frequently Asked Questions

### Do I need to do anything to use EndpointSlices?

No — EndpointSlices are the default since K8s 1.21. The EndpointSlice controller automatically creates and manages them for every Service. You benefit automatically.

## Best Practices

- Start with the simplest configuration that meets your needs
- Test changes in staging before production
- Use `kubectl describe` and events for troubleshooting
- Document your decisions for the team

## Key Takeaways

- This is essential Kubernetes knowledge for production operations
- Follow the principle of least privilege and minimal configuration
- Monitor and iterate based on real-world behavior
- Automation reduces human error and improves consistency
