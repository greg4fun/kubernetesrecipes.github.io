---
title: "Kubernetes Service Types LoadBalancer ClusterIP NodePort"
description: "Understand Kubernetes Service types: ClusterIP, NodePort, LoadBalancer, and ExternalName. When to use each type, configuration examples, and traffic routing"
tags:
  - "services"
  - "networking"
  - "loadbalancer"
  - "clusterip"
  - "nodeport"
category: "networking"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-ingress-nginx-guide"
  - "kubernetes-ai-gateway-inference-extension"
  - "kubernetes-service-dns-discovery"
---

> 💡 **Quick Answer:** `ClusterIP` (default) — internal access only via cluster DNS. `NodePort` — exposes on each node's IP at a static port (30000-32767). `LoadBalancer` — provisions external cloud load balancer. `ExternalName` — CNAME alias to external DNS. Use ClusterIP for service-to-service; LoadBalancer or Ingress for external traffic.

## The Problem

- Need to expose applications internally (to other pods) and externally (to users)
- Different environments require different access patterns (dev vs production)
- Cloud vs on-premises clusters have different external access options
- Understanding when to use LoadBalancer vs Ingress vs NodePort
- Service discovery and DNS resolution for pod-to-pod communication

## The Solution

### Service Types Overview

```text
Type          │ Access Scope      │ Use Case                    │ Port Range
──────────────┼───────────────────┼─────────────────────────────┼───────────
ClusterIP     │ Internal only     │ Service-to-service comms    │ Any
NodePort      │ External via node │ Dev/testing, on-prem        │ 30000-32767
LoadBalancer  │ External via LB   │ Production cloud            │ Any
ExternalName  │ DNS alias         │ External service reference  │ N/A
──────────────┴───────────────────┴─────────────────────────────┴───────────
```

### ClusterIP (Default)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-server
  namespace: production
spec:
  type: ClusterIP    # Default — can be omitted
  selector:
    app: api-server
  ports:
    - name: http
      port: 80           # Service port (what clients connect to)
      targetPort: 8080   # Container port (where app listens)
      protocol: TCP
```

```bash
# Access from within cluster:
curl http://api-server.production.svc.cluster.local:80
curl http://api-server.production:80   # Short form (same namespace)
curl http://api-server:80              # Shortest (same namespace)
```

### NodePort

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-server-nodeport
spec:
  type: NodePort
  selector:
    app: api-server
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30080    # Optional: auto-assigned if omitted (30000-32767)
```

```bash
# Access from outside cluster:
curl http://<any-node-ip>:30080
# Also accessible internally via ClusterIP (NodePort includes ClusterIP)
```

### LoadBalancer

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-server-lb
  annotations:
    # Cloud-specific annotations:
    # AWS:
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
    # GCP:
    # cloud.google.com/neg: '{"ingress": true}'
spec:
  type: LoadBalancer
  selector:
    app: api-server
  ports:
    - port: 443
      targetPort: 8080
      protocol: TCP
  # Optional: restrict source IPs
  loadBalancerSourceRanges:
    - "203.0.113.0/24"
    - "198.51.100.0/24"
```

```bash
# Get external IP
kubectl get svc api-server-lb
# NAME             TYPE           CLUSTER-IP    EXTERNAL-IP     PORT(S)
# api-server-lb    LoadBalancer   10.96.1.100   203.0.113.50    443:31234/TCP

# Access externally:
curl https://203.0.113.50:443
```

### ExternalName

```yaml
# DNS alias to external service (no proxying)
apiVersion: v1
kind: Service
metadata:
  name: external-database
spec:
  type: ExternalName
  externalName: database.example.com
  # Pods can now access: external-database.namespace.svc.cluster.local
  # Resolves to: database.example.com (CNAME)
```

### Headless Service (No ClusterIP)

```yaml
# For StatefulSets — each pod gets its own DNS record
apiVersion: v1
kind: Service
metadata:
  name: database
spec:
  clusterIP: None    # Headless
  selector:
    app: database
  ports:
    - port: 5432
```

```bash
# DNS returns individual pod IPs:
nslookup database.production.svc.cluster.local
# database-0.database.production.svc.cluster.local → 10.0.1.5
# database-1.database.production.svc.cluster.local → 10.0.1.6
```

### When to Use What

```text
Scenario                              │ Recommended
──────────────────────────────────────┼──────────────────────────────
Internal microservice communication   │ ClusterIP
Database accessed by apps             │ ClusterIP (or Headless)
Web app for external users (cloud)    │ LoadBalancer + Ingress
Web app for external users (on-prem)  │ NodePort + external LB
                                      │ or MetalLB + LoadBalancer
Development/testing quick access      │ NodePort or port-forward
Reference external service by DNS     │ ExternalName
StatefulSet pod-specific DNS          │ Headless (clusterIP: None)
──────────────────────────────────────┴──────────────────────────────
```

## Common Issues

### LoadBalancer stuck in "Pending" for EXTERNAL-IP
- **Cause**: No cloud provider or MetalLB installed (bare-metal cluster)
- **Fix**: Install MetalLB for on-prem; or use NodePort + external LB

### Service has no endpoints
- **Cause**: Selector labels don't match any pod labels; or pods not ready
- **Fix**: Compare `kubectl get endpoints <svc>` with `kubectl get pods --show-labels`

### NodePort not reachable from outside
- **Cause**: Firewall blocking high ports; or security group missing rule
- **Fix**: Open port range 30000-32767 on node firewalls/security groups

### ExternalName not resolving
- **Cause**: DNS lookup returns CNAME but client doesn't follow it
- **Fix**: Ensure app handles CNAME; note: ExternalName doesn't support ports or TLS termination

## Best Practices

1. **Default to ClusterIP** — most services only need internal access
2. **Use Ingress/Gateway over LoadBalancer** — one LB for many services (cost savings)
3. **Don't expose NodePort in production** — use LoadBalancer or Ingress instead
4. **Set `targetPort` by name** — reference container port name for flexibility
5. **Use headless for StatefulSets** — enables pod-specific DNS records
6. **Restrict LoadBalancer source ranges** — `loadBalancerSourceRanges` for IP allowlisting

## Key Takeaways

- ClusterIP: internal only (default) — accessed via `<svc>.<ns>.svc.cluster.local`
- NodePort: external via any node IP on port 30000-32767
- LoadBalancer: provisions cloud LB with external IP — includes NodePort + ClusterIP
- ExternalName: DNS CNAME to external service — no proxying
- Headless (`clusterIP: None`): returns individual pod IPs — for StatefulSets
- In production: use Ingress/Gateway API with one LoadBalancer for many services
