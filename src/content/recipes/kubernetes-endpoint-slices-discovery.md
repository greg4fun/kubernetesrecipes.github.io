---
title: "K8s EndpointSlice and Service Discovery"
description: "Understand Kubernetes EndpointSlice for scalable service discovery. DNS resolution, headless services, external services, and endpoint conditions."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "endpointslice"
  - "service-discovery"
  - "dns"
  - "networking"
  - "cka"
relatedRecipes:
  - "kubernetes-service-types-explained"
  - "kubernetes-coredns-troubleshooting"
  - "kubernetes-ingress-nginx-guide"
  - "dns-policies-configuration"
  - "kubernetes-dns-services-guide"
---

> 💡 **Quick Answer:** EndpointSlices are the scalable replacement for Endpoints objects. Each slice holds up to 100 endpoints, enabling efficient updates in large clusters. Kubernetes auto-creates them for Services. For service discovery: `my-svc.my-ns.svc.cluster.local` resolves to the ClusterIP. Headless services (`clusterIP: None`) return individual pod IPs. Use `ExternalName` services to alias external DNS.

## The Problem

Service discovery in Kubernetes needs to:

- Route traffic to healthy pod backends
- Scale to thousands of endpoints without API pressure
- Support both internal and external service resolution
- Handle pod lifecycle (ready/not-ready/terminating)

Old Endpoints objects stored ALL backends in one resource — updating one pod modified the entire object.

## The Solution

### How Service Discovery Works

```
Pod → DNS Query → CoreDNS → Service → EndpointSlice → Pod IPs

DNS Resolution:
  <service>.<namespace>.svc.cluster.local → ClusterIP
  
  Example:
  my-api.production.svc.cluster.local → 10.96.23.45

Short names (within same namespace):
  my-api → 10.96.23.45
  my-api.production → 10.96.23.45
```

### View EndpointSlices

```bash
# List EndpointSlices for a service
kubectl get endpointslices -l kubernetes.io/service-name=my-api

# Detailed view
kubectl describe endpointslice my-api-xxxxx
# Endpoints:
#   - Addresses: 10.244.1.5
#     Conditions:
#       Ready: true
#       Serving: true
#       Terminating: false
#     TargetRef: Pod/my-api-abc123
#     NodeName: worker-1
#     Zone: us-east-1a

# JSON query for ready endpoints
kubectl get endpointslice -l kubernetes.io/service-name=my-api \
  -o jsonpath='{.items[*].endpoints[?(@.conditions.ready==true)].addresses}'
```

### Service Types and DNS

```yaml
# ClusterIP (default) — internal DNS
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: production
spec:
  selector:
    app: backend
  ports:
  - port: 8080
    targetPort: 8080
# DNS: backend.production.svc.cluster.local → ClusterIP

---
# Headless — returns pod IPs directly
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  clusterIP: None           # Headless
  selector:
    app: postgres
  ports:
  - port: 5432
# DNS: db.production.svc.cluster.local → [pod-ip-1, pod-ip-2, ...]
# Per-pod: postgres-0.db.production.svc.cluster.local → pod-ip

---
# ExternalName — alias for external DNS
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  type: ExternalName
  externalName: db.example.com
# DNS: external-db.production.svc.cluster.local → CNAME db.example.com

---
# Service without selector — manual endpoints
apiVersion: v1
kind: Service
metadata:
  name: legacy-api
spec:
  ports:
  - port: 443
    targetPort: 443
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: legacy-api-manual
  labels:
    kubernetes.io/service-name: legacy-api
addressType: IPv4
ports:
- port: 443
  protocol: TCP
endpoints:
- addresses:
  - "203.0.113.10"
  - "203.0.113.11"
```

### SRV Records

```bash
# SRV records for named ports
# _<port-name>._<protocol>.<service>.<namespace>.svc.cluster.local

# Service with named port:
# ports:
# - name: http
#   port: 8080

# SRV lookup:
dig _http._tcp.backend.production.svc.cluster.local SRV
# Returns: priority, weight, port, target
# 0 50 8080 backend.production.svc.cluster.local
```

### Endpoint Conditions

```
Ready: true        → Pod passed readiness probe, receives traffic
Serving: true      → Pod can serve (even during termination)
Terminating: true  → Pod is shutting down

Combinations:
Ready=true,  Terminating=false → Normal, serving traffic
Ready=false, Terminating=false → Not ready, excluded from traffic
Ready=false, Terminating=true  → Shutting down, no traffic
Serving=true, Terminating=true → Draining connections (graceful shutdown)
```

### Topology-Aware Routing

```yaml
# Prefer same-zone endpoints (reduces cross-zone traffic)
apiVersion: v1
kind: Service
metadata:
  name: backend
  annotations:
    service.kubernetes.io/topology-mode: Auto
spec:
  selector:
    app: backend
  ports:
  - port: 8080

# With topology-mode: Auto
# Traffic from zone-a preferentially routes to backends in zone-a
# Falls back to other zones if zone-a has insufficient capacity
```

## Common Issues

**Service returns no endpoints**

Labels don't match. Check: `kubectl get pods -l <selector>` vs `kubectl get svc <name> -o yaml | grep selector`.

**Stale endpoints after pod deletion**

EndpointSlice controller runs asynchronously. Takes a few seconds to update. Configure readiness probe for accurate health.

**Cross-namespace service discovery**

Use FQDN: `<service>.<namespace>.svc.cluster.local`. Short names only work within the same namespace.

## Best Practices

- **Use Service DNS names** — not pod IPs (pods are ephemeral)
- **Headless Services for StatefulSets** — stable per-pod DNS
- **ExternalName for external service abstraction** — swap backends without app changes
- **Set readiness probes** — controls when pods enter EndpointSlices
- **Topology-aware routing** — reduce cross-zone network costs

## Key Takeaways

- EndpointSlices are the scalable backend for Kubernetes service discovery
- Services get DNS: `<name>.<namespace>.svc.cluster.local`
- Headless Services (clusterIP: None) return individual pod IPs
- ExternalName Services alias external DNS names
- Topology-aware routing keeps traffic in the same zone
