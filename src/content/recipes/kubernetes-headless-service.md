---
title: "Kubernetes Headless Service Explained"
description: "networking"
category: "intermediate"
difficulty: "Create Kubernetes headless services for StatefulSet DNS, direct pod addressing, and service discovery. Understand when clusterIP None is the right choice."
publishDate: "2026-04-05"
tags: ["headless-service", "statefulset", "dns", "service-discovery", "kubernetes"]
author: "Luca Berton"
relatedRecipes:
  - "kubernetes-service-account-guide"
  - "kubernetes-health-checks"
  - "kubernetes-canary-deployment"
  - "kubernetes-pod-security-standards"
---

> 💡 **Quick Answer:** networking

## The Problem

This is a fundamental Kubernetes topic that engineers search for frequently. A comprehensive reference with production-ready examples saves hours of trial and error.

## The Solution

### Create a Headless Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  clusterIP: None       # ← This makes it headless
  selector:
    app: postgres
  ports:
    - port: 5432
```

### DNS Behavior Difference

```bash
# Regular Service DNS → returns ClusterIP (virtual IP, load-balanced)
dig my-service.default.svc.cluster.local
# ANSWER: 10.96.5.10

# Headless Service DNS → returns ALL pod IPs (no load balancing)
dig postgres.default.svc.cluster.local
# ANSWER: 10.244.1.5, 10.244.2.8, 10.244.3.12

# With StatefulSet → individual pod DNS records
dig postgres-0.postgres.default.svc.cluster.local
# ANSWER: 10.244.1.5
dig postgres-1.postgres.default.svc.cluster.local
# ANSWER: 10.244.2.8
```

### When to Use Headless Services

| Use Case | Why Headless |
|----------|-------------|
| StatefulSet (databases) | Clients need to connect to specific pods |
| Client-side load balancing | App does its own routing (gRPC) |
| Peer discovery | Pods need to find each other (clustering) |
| DNS-based service discovery | External tools need pod IPs |

### Headless + StatefulSet (Required)

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres   # Must match headless Service name
  replicas: 3
```

```mermaid
graph TD
    A[Regular Service] -->|DNS returns| B[ClusterIP 10.96.5.10]
    B -->|kube-proxy routes to| C[Random pod]
    D[Headless Service] -->|DNS returns| E[Pod IPs directly]
    E --> F[postgres-0: 10.244.1.5]
    E --> G[postgres-1: 10.244.2.8]
    E --> H[postgres-2: 10.244.3.12]
```

## Frequently Asked Questions

### Can I have both headless and regular services for the same pods?

Yes! Common pattern: headless service for StatefulSet pod addressing + regular ClusterIP service for load-balanced client access.

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
