---
title: "K8s NetworkPolicy: Allow and Deny Rules"
description: "Configure Kubernetes NetworkPolicy for pod-to-pod traffic control. Default deny, allow by label, namespace selectors, egress rules, and CIDR blocks."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "networkpolicy"
  - "security"
  - "networking"
  - "cka"
  - "zero-trust"
relatedRecipes:
  - "networkpolicy-deny-all"
  - "kubernetes-namespace-guide"
  - "kubernetes-service-mesh-comparison"
  - "dns-policies-configuration"
  - "kubernetes-endpoint-slices-discovery"
---

> 💡 **Quick Answer:** NetworkPolicy controls pod-to-pod traffic at L3/L4. Default: all traffic allowed. Apply a default-deny policy, then whitelist specific flows. Use `podSelector` to target pods, `ingress`/`egress` to define allowed traffic, and `namespaceSelector` for cross-namespace rules. Requires a CNI that supports NetworkPolicy (Calico, Cilium, Weave — NOT default Flannel).

## The Problem

By default, every pod can talk to every other pod in the cluster:

- Compromised pod can reach databases directly
- No network segmentation between teams/environments
- Lateral movement after initial compromise
- Compliance violations (PCI-DSS requires network segmentation)

## The Solution

### Default Deny All

```yaml
# Deny all ingress and egress in a namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}          # Applies to ALL pods in namespace
  policyTypes:
  - Ingress
  - Egress
```

### Allow Specific Ingress

```yaml
# Allow traffic to frontend from any pod with role=loadbalancer
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-ingress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: frontend
  ingress:
  - from:
    - podSelector:
        matchLabels:
          role: loadbalancer
    ports:
    - protocol: TCP
      port: 8080

---
# Allow traffic from specific namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-monitoring
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          purpose: monitoring
    ports:
    - protocol: TCP
      port: 9090
```

### Allow DNS Egress (Essential)

```yaml
# After default-deny, pods can't resolve DNS
# This allows DNS traffic to kube-dns
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: production
spec:
  podSelector: {}
  egress:
  - to:
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  policyTypes:
  - Egress
```

### Complete Microservice Example

```yaml
# Frontend → API → Database pattern
---
# Frontend: accept from ingress, talk to API
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-policy
spec:
  podSelector:
    matchLabels:
      app: frontend
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          app: ingress-nginx
    ports:
    - port: 80
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: api
    ports:
    - port: 8080

---
# API: accept from frontend, talk to database
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-policy
spec:
  podSelector:
    matchLabels:
      app: api
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - port: 8080
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgres
    ports:
    - port: 5432

---
# Database: accept from API only, no egress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: database-policy
spec:
  podSelector:
    matchLabels:
      app: postgres
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: api
    ports:
    - port: 5432
  policyTypes:
  - Ingress
  - Egress     # Empty egress = deny all outbound
```

### CIDR-Based Rules

```yaml
# Allow egress to external API
spec:
  podSelector:
    matchLabels:
      app: api
  egress:
  - to:
    - ipBlock:
        cidr: 203.0.113.0/24    # External API range
    ports:
    - port: 443
  - to:
    - ipBlock:
        cidr: 0.0.0.0/0
        except:
        - 10.0.0.0/8            # Block internal ranges
        - 172.16.0.0/12
        - 192.168.0.0/16
    ports:
    - port: 443
```

## Common Issues

**Pods can't resolve DNS after default-deny**

Add a DNS egress policy allowing traffic to kube-dns on port 53 (see example above).

**NetworkPolicy not enforced**

CNI doesn't support NetworkPolicy. Flannel doesn't — switch to Calico or Cilium.

**Ingress controller can't reach backend pods**

Add ingress rule allowing from the ingress-nginx namespace. Use `namespaceSelector` with the ingress namespace labels.

## Best Practices

- **Always start with default deny** — whitelist, don't blacklist
- **Allow DNS first** — almost every policy needs DNS egress
- **Label namespaces** — enables `namespaceSelector` in policies
- **Use Calico or Cilium** — full NetworkPolicy support
- **Test with `kubectl exec` + `curl`** — verify connectivity after policy changes

## Key Takeaways

- NetworkPolicy is the firewall for pod-to-pod traffic (L3/L4)
- Start with default-deny, then allow specific flows
- Always allow DNS egress or pods can't resolve service names
- Requires a compatible CNI (Calico, Cilium, Weave — not Flannel)
- Use podSelector + namespaceSelector + ipBlock for precise rules
