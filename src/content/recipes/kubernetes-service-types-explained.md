---
title: "K8s Service Types: ClusterIP NodePort LB"
description: "Kubernetes Service types explained: ClusterIP, NodePort, LoadBalancer, and ExternalName. When to use each type with YAML examples and traffic flow diagrams."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "services"
  - "networking"
  - "load-balancer"
  - "nodeport"
  - "cka"
relatedRecipes:
  - "kubernetes-ingress-guide"
  - "kubernetes-gateway-api-guide"
  - "dns-policies-configuration"
  - "kubernetes-service-mesh-comparison"
---

> 💡 **Quick Answer:** Kubernetes has 4 Service types: **ClusterIP** (internal-only, default) — accessible within the cluster via virtual IP. **NodePort** — exposes on every node's IP at a static port (30000-32767). **LoadBalancer** — provisions cloud load balancer with external IP. **ExternalName** — DNS CNAME alias to external service. Choose ClusterIP for microservice communication, NodePort for dev/testing, LoadBalancer for production external access.

## The Problem

Pods are ephemeral — their IPs change on restart. Services provide:

- Stable virtual IP for a set of pods
- Load balancing across pod replicas
- DNS-based service discovery
- External access to cluster workloads

But which Service type fits your use case?

## The Solution

### ClusterIP (Default)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  type: ClusterIP   # default, can be omitted
  selector:
    app: api
  ports:
  - port: 80         # Service port
    targetPort: 8080  # Pod port
```

```
[Pod A] → api-service:80 → [api pod 1]
                           → [api pod 2]
                           → [api pod 3]
# Only accessible within the cluster
# DNS: api-service.default.svc.cluster.local
```

**Use when:** microservices communicating within the cluster.

### Headless Service (ClusterIP: None)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: db-service
spec:
  clusterIP: None    # Headless — no virtual IP
  selector:
    app: postgres
  ports:
  - port: 5432
```

```bash
# DNS returns individual pod IPs instead of virtual IP
nslookup db-service
# db-service.default.svc.cluster.local → 10.244.1.5
#                                       → 10.244.2.3
# Used by StatefulSets for stable network identities
```

### NodePort

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-nodeport
spec:
  type: NodePort
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 8080
    nodePort: 30080    # Optional, auto-assigned if omitted (30000-32767)
```

```
[External] → <any-node-ip>:30080 → [web pod 1]
                                  → [web pod 2]
# Accessible from outside via any node's IP
# Port range: 30000-32767
```

**Use when:** development, testing, bare-metal clusters without cloud LB.

### LoadBalancer

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-lb
  annotations:
    # Cloud-specific annotations
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
spec:
  type: LoadBalancer
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 8080
```

```
[Internet] → Cloud LB (external IP) → [web pod 1]
                                     → [web pod 2]
# Cloud provider provisions a load balancer
# kubectl get svc → EXTERNAL-IP: 34.123.45.67
```

**Use when:** production external access on cloud providers (AWS, GCP, Azure).

**Bare-metal:** Use MetalLB to provide LoadBalancer functionality.

### ExternalName

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  type: ExternalName
  externalName: db.example.com
```

```bash
# DNS CNAME — no proxy, no port mapping
nslookup external-db
# external-db.default.svc.cluster.local → CNAME db.example.com
```

**Use when:** aliasing external services with cluster DNS names.

### Comparison Table

| Type | External Access | IP Type | Port Range | Cloud Required |
|------|----------------|---------|------------|----------------|
| ClusterIP | ❌ Internal only | Virtual IP | Any | No |
| NodePort | ✅ Via node IP | Node IPs | 30000-32767 | No |
| LoadBalancer | ✅ External IP | Cloud LB IP | Any | Yes (or MetalLB) |
| ExternalName | ❌ DNS alias | None | N/A | No |
| Headless | ❌ Internal only | Pod IPs directly | Any | No |

### Quick Create Commands

```bash
# ClusterIP
kubectl expose deployment nginx --port=80 --target-port=8080

# NodePort
kubectl expose deployment nginx --type=NodePort --port=80 --target-port=8080

# LoadBalancer
kubectl expose deployment nginx --type=LoadBalancer --port=80 --target-port=8080

# Generate YAML
kubectl expose deployment nginx --port=80 --dry-run=client -o yaml
```

## Common Issues

**LoadBalancer stuck in "Pending" EXTERNAL-IP**

No cloud LB controller. On bare-metal, install MetalLB: `kubectl apply -f https://metallb.io/manifests`.

**NodePort not reachable**

Firewall blocking port range 30000-32767. Open these ports on cloud security groups or `iptables`.

**Service has no endpoints**

Selector doesn't match any pod labels. Check: `kubectl get endpoints <svc>`.

## Best Practices

- **ClusterIP for 90% of services** — internal microservice communication
- **Ingress/Gateway API over NodePort/LoadBalancer** — one LB for many services
- **Headless for StatefulSets** — stable network identity per pod
- **Set `externalTrafficPolicy: Local`** on NodePort/LB — preserves client IP
- **Use annotations for cloud LB tuning** — NLB vs ALB, internal vs external

## Key Takeaways

- ClusterIP is the default — internal-only, stable virtual IP
- NodePort opens a port on every node (30000-32767) — good for dev
- LoadBalancer provisions cloud infrastructure — production external access
- ExternalName creates DNS CNAME aliases to external services
- Most production apps use ClusterIP + Ingress (one LB for many services)
