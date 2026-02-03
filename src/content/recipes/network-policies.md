---
title: "How to Implement Network Policies"
description: "Secure pod-to-pod communication with Kubernetes Network Policies. Learn to create ingress and egress rules, isolate namespaces, and implement zero-trust networking."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["network-policies", "security", "networking", "zero-trust", "isolation"]
---

> **💡 Quick Answer:** Network Policies are firewall rules for pods. Start with deny-all: `spec: {podSelector: {}, policyTypes: [Ingress, Egress]}`. Then allow specific traffic with `ingress.from` and `egress.to` rules using `podSelector`, `namespaceSelector`, or `ipBlock`. Requires a CNI that supports policies (Calico, Cilium). Test with `kubectl exec <pod> -- curl <target>`.

# How to Implement Network Policies

Network Policies control traffic flow between pods and external endpoints. They implement firewall rules at the pod level, enabling zero-trust networking and namespace isolation.

## Prerequisites

Your CNI plugin must support Network Policies:
- Calico
- Cilium
- Weave Net
- Antrea

Note: The default Kubernetes networking (kubenet) doesn't enforce Network Policies.

## Default Deny All Traffic

```yaml
# deny-all-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: production
spec:
  podSelector: {}  # Applies to all pods
  policyTypes:
    - Ingress
---
# deny-all-egress.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress
---
# deny-all-traffic.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

## Allow Specific Ingress

```yaml
# allow-frontend-to-backend.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

## Allow Traffic from Specific Namespace

```yaml
# allow-from-monitoring.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: monitoring
        - podSelector:
            matchLabels:
              app: prometheus
      ports:
        - protocol: TCP
          port: 9090
```

## Allow Egress to Specific Destinations

```yaml
# allow-egress-to-database.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backend-to-db
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
    # Allow DNS resolution
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
```

## Allow External Egress with CIDR

```yaml
# allow-external-api.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-external-api
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-client
  policyTypes:
    - Egress
  egress:
    # Allow specific external IP ranges
    - to:
        - ipBlock:
            cidr: 203.0.113.0/24
      ports:
        - protocol: TCP
          port: 443
    # Allow all egress except private ranges
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - protocol: TCP
          port: 443
```

## Multi-Tier Application Network Policy

```yaml
# web-tier.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-tier-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: web
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow from ingress controller
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 80
  egress:
    # Allow to app tier
    - to:
        - podSelector:
            matchLabels:
              tier: app
      ports:
        - protocol: TCP
          port: 8080
    # DNS
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
---
# app-tier.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: app-tier-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: app
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              tier: web
      ports:
        - protocol: TCP
          port: 8080
  egress:
    # Allow to database tier
    - to:
        - podSelector:
            matchLabels:
              tier: database
      ports:
        - protocol: TCP
          port: 5432
    # DNS
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
---
# database-tier.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: database-tier-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: database
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              tier: app
      ports:
        - protocol: TCP
          port: 5432
```

## Namespace Isolation

```yaml
# namespace-isolation.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: namespace-isolation
  namespace: team-a
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Only allow from same namespace
    - from:
        - podSelector: {}
  egress:
    # Allow to same namespace
    - to:
        - podSelector: {}
    # Allow DNS
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
```

## Allow Ingress Controller Traffic

```yaml
# allow-ingress-controller.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-nginx
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: web-app
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
          podSelector:
            matchLabels:
              app.kubernetes.io/name: ingress-nginx
      ports:
        - protocol: TCP
          port: 8080
```

## AND vs OR Logic

```yaml
# OR logic: from namespace OR from specific pod
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: or-logic
spec:
  podSelector:
    matchLabels:
      app: backend
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              env: staging
        - podSelector:        # OR - separate list item
            matchLabels:
              role: admin
---
# AND logic: from namespace AND specific pod
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: and-logic
spec:
  podSelector:
    matchLabels:
      app: backend
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              env: staging
          podSelector:        # AND - same list item
            matchLabels:
              role: admin
```

## Port Ranges

```yaml
# port-range.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-port-range
spec:
  podSelector:
    matchLabels:
      app: service
  ingress:
    - ports:
        - protocol: TCP
          port: 32000
          endPort: 32768
```

## Test Network Policies

```bash
# Deploy test pods
kubectl run test-client --image=nicolaka/netshoot --rm -it -- bash

# Test connectivity from inside the pod
curl -v --connect-timeout 5 backend-service:8080
nc -zv postgres-service 5432

# Test with specific namespace
kubectl run test -n team-a --image=busybox --rm -it -- wget -qO- http://service.team-b.svc.cluster.local

# Verify policies
kubectl get networkpolicies -A
kubectl describe networkpolicy allow-frontend-to-backend
```

## Visualize Network Policies

```bash
# Using kubectl-np-viewer plugin
kubectl np-viewer

# Export policies for documentation
kubectl get networkpolicies -o yaml > network-policies-backup.yaml
```

## Summary

Network Policies provide essential security controls for Kubernetes networking. Start with a default-deny policy, then explicitly allow required traffic. Use namespace selectors for cross-namespace communication and CIDR blocks for external traffic. Remember that policies are additive—if any policy allows traffic, it's permitted. Always include DNS egress rules when restricting outbound traffic.

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
