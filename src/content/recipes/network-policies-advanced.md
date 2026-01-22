---
title: "How to Implement Advanced NetworkPolicies"
description: "Master advanced Kubernetes NetworkPolicies for fine-grained traffic control. Learn egress rules, CIDR blocks, namespace isolation, and common security patterns."
category: "security"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["networkpolicy", "security", "networking", "isolation", "zero-trust"]
---

# How to Implement Advanced NetworkPolicies

NetworkPolicies provide fine-grained control over pod network traffic. Learn advanced patterns for securing microservices with ingress and egress rules.

## Default Deny All Traffic

```yaml
# deny-all.yaml - Start with zero trust
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}  # Applies to all pods
  policyTypes:
    - Ingress
    - Egress
```

## Allow DNS Egress (Required After Default Deny)

```yaml
# allow-dns.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
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
        - protocol: TCP
          port: 53
```

## Multi-Tier Application Isolation

```yaml
# Frontend can receive external traffic
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: frontend
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow from ingress controller
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - port: 8080
  egress:
    # Allow to backend only
    - to:
        - podSelector:
            matchLabels:
              tier: backend
      ports:
        - port: 8080
    # Allow DNS
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - port: 53
          protocol: UDP
---
# Backend can only talk to frontend and database
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              tier: frontend
      ports:
        - port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              tier: database
      ports:
        - port: 5432
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - port: 53
          protocol: UDP
---
# Database only accepts from backend
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: database-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: database
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              tier: backend
      ports:
        - port: 5432
  egress: []  # No egress allowed
```

## Allow Traffic from Specific Namespaces

```yaml
# cross-namespace-policy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring
  namespace: production
spec:
  podSelector: {}  # All pods in production
  policyTypes:
    - Ingress
  ingress:
    # Allow Prometheus scraping from monitoring namespace
    - from:
        - namespaceSelector:
            matchLabels:
              name: monitoring
          podSelector:
            matchLabels:
              app: prometheus
      ports:
        - port: 9090
        - port: 8080
```

## CIDR-Based Rules for External Services

```yaml
# external-services-policy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-external-apis
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-gateway
  policyTypes:
    - Egress
  egress:
    # Allow external payment API
    - to:
        - ipBlock:
            cidr: 203.0.113.0/24  # Payment provider IP range
      ports:
        - port: 443
    # Allow AWS S3 (us-east-1)
    - to:
        - ipBlock:
            cidr: 52.216.0.0/15
      ports:
        - port: 443
    # Block private IPs except internal services
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - port: 443
```

## Namespace Isolation with Exceptions

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
    # Allow within same namespace
    - from:
        - podSelector: {}
    # Allow from shared services
    - from:
        - namespaceSelector:
            matchLabels:
              shared-services: "true"
  egress:
    # Allow within same namespace
    - to:
        - podSelector: {}
    # Allow to shared services
    - to:
        - namespaceSelector:
            matchLabels:
              shared-services: "true"
    # Allow DNS
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
```

## Service Mesh Compatible Policy

```yaml
# istio-compatible-policy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-istio-mtls
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow Istio sidecar injection
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: istio-system
    # Allow mTLS between sidecars
    - from:
        - podSelector: {}
      ports:
        - port: 15006  # Istio inbound
        - port: 15001  # Istio outbound
        - port: 15090  # Envoy stats
  egress:
    # Allow to Istio control plane
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: istio-system
      ports:
        - port: 15012  # istiod
        - port: 443
```

## Audit and Test Policies

```yaml
# test-pod.yaml - For testing connectivity
apiVersion: v1
kind: Pod
metadata:
  name: netpol-test
  namespace: production
  labels:
    tier: frontend
spec:
  containers:
    - name: test
      image: nicolaka/netshoot:latest
      command: ["sleep", "infinity"]
```

```bash
# Test connectivity
kubectl exec -it netpol-test -n production -- sh

# Test DNS
nslookup kubernetes.default

# Test pod connectivity
curl -v backend-service:8080/health

# Test external connectivity
curl -v https://api.example.com

# Scan for open ports
nc -zv backend-pod 8080
```

## Complex Label Selectors

```yaml
# complex-selectors.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: complex-selector
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
    matchExpressions:
      - key: environment
        operator: In
        values: ["production", "staging"]
      - key: team
        operator: NotIn
        values: ["deprecated"]
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchExpressions:
              - key: role
                operator: In
                values: ["frontend", "worker"]
```

## Logging Denied Connections (CNI Dependent)

```yaml
# With Calico CNI - Enable logging
apiVersion: projectcalico.org/v3
kind: NetworkPolicy
metadata:
  name: log-denied
  namespace: production
spec:
  selector: app == 'sensitive-app'
  types:
    - Ingress
  ingress:
    - action: Log
    - action: Deny
```

## Verify Policies

```bash
# List all policies
kubectl get networkpolicies -A

# Describe policy
kubectl describe networkpolicy frontend-policy -n production

# Check if CNI supports NetworkPolicy
kubectl get pods -n kube-system | grep -E "calico|cilium|weave"

# Visualize policies (requires kubectl plugin)
kubectl neat get networkpolicy -n production -o yaml
```

## Summary

Advanced NetworkPolicies enable zero-trust networking in Kubernetes. Start with default deny, then explicitly allow required traffic. Combine pod selectors, namespace selectors, and CIDR blocks for comprehensive security. Always test policies before applying to production.
