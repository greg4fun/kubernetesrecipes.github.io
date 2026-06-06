---
title: "Default Deny NetworkPolicy: Zero-Trust Examples"
description: "Implement default deny network policies in Kubernetes for zero-trust pod networking. Block all ingress and egress by default, then allow only required traffic"
tags:
  - "networkpolicy"
  - "security"
  - "zero-trust"
  - "networking"
  - "isolation"
category: "security"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-network-policy-guide"
  - "kubernetes-security-checklist-2026"
---

> 💡 **Quick Answer:** Apply a default deny NetworkPolicy to block all ingress and egress traffic in a namespace, then create allow policies for specific required flows. Without any NetworkPolicy, all pods can communicate freely. A single empty-selector `{}` policy with no `ingress`/`egress` rules denies all traffic matching that direction.

## The Problem

- By default, all pods can communicate with all other pods (flat network)
- A compromised pod can reach any service in the cluster
- Compliance requires network segmentation and least-privilege communication
- Need to prevent lateral movement after initial compromise
- Must allow only explicitly required traffic paths

## The Solution

### Default Deny All Ingress

```yaml
# Block all incoming traffic to pods in this namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}    # Applies to ALL pods in namespace
  policyTypes:
    - Ingress
  # No ingress rules = deny all incoming
```

### Default Deny All Egress

```yaml
# Block all outgoing traffic from pods in this namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress
  # No egress rules = deny all outgoing (including DNS!)
```

### Default Deny Both (Full Isolation)

```yaml
# Block all traffic in both directions
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

### Allow DNS (Required with Egress Deny)

```yaml
# Must allow DNS or pods can't resolve service names
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
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

### Allow Specific Service Communication

```yaml
# Allow frontend → api-server on port 8080
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-api
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-server
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
---
# Allow api-server → database on port 5432
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-api-to-db
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: database
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api-server
      ports:
        - protocol: TCP
          port: 5432
```

### Allow Ingress from External (Ingress Controller)

```yaml
# Allow traffic from ingress-nginx namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-controller
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - protocol: TCP
          port: 8080
```

### Complete Zero-Trust Example

```yaml
# 1. Default deny all
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
# 2. Allow DNS for all pods
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: production
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - {protocol: UDP, port: 53}
        - {protocol: TCP, port: 53}
---
# 3. Allow ingress → frontend
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-external-to-frontend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - {protocol: TCP, port: 8080}
---
# 4. Allow frontend → api (ingress + egress)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-to-api
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: api-server
      ports:
        - {protocol: TCP, port: 8080}
```

## Common Issues

### Pods can't resolve DNS after default-deny-egress
- **Cause**: DNS (port 53) is blocked by egress deny
- **Fix**: Add explicit allow-dns NetworkPolicy (shown above)

### NetworkPolicy has no effect
- **Cause**: CNI doesn't support NetworkPolicy (e.g., Flannel without policy engine)
- **Fix**: Use Calico, Cilium, or Antrea — they enforce NetworkPolicy rules

### Pods in same namespace can still communicate after deny
- **Cause**: Another NetworkPolicy in the namespace allows the traffic
- **Fix**: NetworkPolicies are additive — any allow rule permits traffic. Check all policies

### Health checks failing after deny
- **Cause**: Kubelet health probes come from node IP (not a pod)
- **Fix**: Allow ingress from node CIDR; or use `ipBlock` with node subnet

## Best Practices

1. **Default deny first, then allow** — zero-trust approach
2. **Always allow DNS with egress deny** — pods need name resolution
3. **Use namespace labels for cross-namespace rules** — cleaner than IP blocks
4. **Test with `kubectl exec` + curl** — verify connectivity after applying policies
5. **Label pods consistently** — NetworkPolicy selectors depend on labels
6. **Document allowed flows** — maintain a traffic matrix for the namespace
7. **Use CNI that supports NetworkPolicy** — Calico, Cilium, Antrea (not basic Flannel)

## Key Takeaways

- Without NetworkPolicy, all pods can talk to all pods (flat network)
- `podSelector: {}` + no rules = deny all (for that policyType)
- NetworkPolicies are additive — if ANY policy allows traffic, it's allowed
- Default deny egress blocks DNS — always add an allow-dns policy
- Required CNI support: Calico, Cilium, Antrea (basic Flannel doesn't enforce)
- Combine namespace selectors + pod selectors for precise traffic control
- Zero-trust pattern: deny all → allow DNS → allow specific flows only
