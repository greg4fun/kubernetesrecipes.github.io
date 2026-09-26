---
title: "Kubernetes NetworkPolicy Default Deny Examples"
description: "Kubernetes NetworkPolicy default deny examples for ingress and egress: deny all, allow DNS, ingress controller, namespace isolation and a zero-trust baseline."
publishDate: "2026-04-12"
author: "Luca Berton"
category: "security"
tags:
  - "networkpolicy"
  - "default-deny"
  - "network-security"
  - "namespace-isolation"
  - "zero-trust"
  - "isolation"
  - "security"
difficulty: "intermediate"
timeToComplete: "15 minutes"
relatedRecipes:
  - "kubernetes-networkpolicy-guide"
  - "kubernetes-networkpolicy-default-deny-egress"
  - "networkpolicy-deny-all"
  - "kubernetes-namespace-guide"
  - "kubernetes-security-checklist-2026"
  - "network-policies"
  - "kubernetes-service-mesh-istio-guide"
---

> 💡 **Quick Answer:** By default, Kubernetes allows ALL traffic between pods. Apply a default-deny NetworkPolicy to block everything, then add allow rules for specific traffic. This is the foundation of zero-trust networking in Kubernetes.
>
> **Key YAML:** `spec: {podSelector: {}, policyTypes: [Ingress, Egress]}` — no rules means deny everything in those directions.
>
> **Gotcha:** Egress deny blocks DNS. Always ship an allow-dns policy with it.

## The Problem

Without NetworkPolicy, every pod can communicate with every other pod in the cluster — across all namespaces. This means a compromised pod can reach databases, internal APIs, and control plane components. Default-deny policies flip this to a secure-by-default posture.

```mermaid
flowchart TB
    subgraph WITHOUT["Without NetworkPolicy"]
        A1["Pod A"] <-->|"✅ All traffic allowed"| B1["Pod B"]
        A1 <-->|"✅ Cross-namespace"| C1["Pod C<br/>(other ns)"]
    end
    subgraph WITH["With Default Deny"]
        A2["Pod A"] -.->|"❌ Blocked"| B2["Pod B"]
        A2 -.->|"❌ Blocked"| C2["Pod C<br/>(other ns)"]
        A2 -->|"✅ Explicit allow"| D2["Pod D"]
    end
```

## The Solution

### Default Deny All Ingress

Block all incoming traffic to pods in a namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}          # Applies to ALL pods in namespace
  policyTypes:
    - Ingress              # Block all incoming traffic
  # No ingress rules = deny all
```

### Default Deny All Egress

Block all outgoing traffic from pods in a namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress
  # No egress rules = deny all
```

### Default Deny Both (Recommended)

Block all ingress AND egress:

```yaml
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

> ⚠️ **Warning:** This blocks DNS too! Pods can't resolve service names. Add a DNS exception (see below).

### Default Deny + Allow DNS

The most common starting point — deny all but allow DNS resolution:

```yaml
---
# 1. Deny all traffic
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
---
# 2. Allow DNS for all pods
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
              kubernetes.io/metadata.name: kube-system   # openshift-dns on OpenShift
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

### Allow Specific Traffic Patterns

After default-deny, add explicit allow rules:

```yaml
# Allow frontend → backend on port 8080
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
---
# Allow backend → database on port 5432
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backend-to-db
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
              app: backend
      ports:
        - protocol: TCP
          port: 5432
---
# Allow backend egress to database
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-egress-to-db
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
              app: database
      ports:
        - protocol: TCP
          port: 5432
```

### Allow Ingress Controller → Frontend

```yaml
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

With egress deny in place, every hop needs **two** policies: egress from the client and ingress on the server (as in the backend → database pair above).

### Namespace Isolation

Allow traffic only within the same namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector: {}   # Any pod in same namespace
```

### Allow from Specific Namespace

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-monitoring
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - protocol: TCP
          port: 9090    # Prometheus scraping
```

### Verify Policies

```bash
# List policies in namespace
kubectl get networkpolicy -n production

# Describe a specific policy
kubectl describe networkpolicy default-deny-all -n production

# Test connectivity
kubectl exec -n production frontend-pod -- curl -s --connect-timeout 3 backend:8080
# Should succeed (allowed)

kubectl exec -n production frontend-pod -- curl -s --connect-timeout 3 database:5432
# Should fail (denied)

# Check if CNI supports NetworkPolicy
kubectl get pods -A | grep -E "calico|cilium|antrea|ovnkube"
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| DNS resolution broken | Default deny blocks UDP 53 | Add DNS allow policy |
| All pods can't communicate | Default deny applied without allow rules | Add specific allow policies |
| Policy has no effect | CNI doesn't support NetworkPolicy | Use Calico, Cilium, or Antrea |
| Cross-namespace traffic blocked | Missing `namespaceSelector` | Add `namespaceSelector` in `from`/`to` |
| Monitoring broken | Prometheus can't scrape metrics | Allow from monitoring namespace on metrics port |
| Pod-to-external blocked | Egress deny blocks internet access | Add egress rule for external CIDR |
| Traffic still allowed after deny | Another policy in the namespace allows it | Policies are additive (OR) — `kubectl get netpol -n <ns>` and review all |
| Pods can't reach the API server | Egress deny blocks `kubernetes.default` | Allow egress to the API server endpoint IPs/port 6443 (or 443) via `ipBlock` |
| Health probes failing | Usually not the policy: node→pod traffic for kubelet probes is allowed by most CNIs | Check probe config first; only Cilium host-firewall/strict modes need a node CIDR allow |

## Best Practices

- **Start with default-deny + DNS** — then add allow rules incrementally
- **Apply per namespace** — NetworkPolicy is namespace-scoped
- **Use labels consistently** — policies match on labels, not pod names
- **Allow monitoring explicitly** — Prometheus, log collectors need ingress access
- **Test before production** — verify with `curl`/`wget` from test pods
- **Use a CNI that supports policies** — Calico, Cilium, Antrea, OVN-Kubernetes (not plain Flannel)
- **Document allowed flows** — keep a traffic matrix per namespace
- **Stamp default deny into every new namespace** — via GitOps or a Kyverno generate rule

## Frequently Asked Questions

### How do I create a default deny NetworkPolicy in Kubernetes?

Apply a NetworkPolicy with `podSelector: {}` (all pods in the namespace) and `policyTypes: [Ingress, Egress]` with no `ingress` or `egress` rules. Then add allow policies for DNS and each required flow.

### Does default deny block DNS?

Yes, if it includes `Egress`. Add an egress policy allowing UDP and TCP 53 to the cluster DNS pods, otherwise service names stop resolving.

### Is there a cluster-wide default deny?

Not in the core NetworkPolicy API — it's namespaced, so you need one per namespace. Calico `GlobalNetworkPolicy`, Cilium `CiliumClusterwideNetworkPolicy`, or the upstream `AdminNetworkPolicy`/`BaselineAdminNetworkPolicy` APIs (supported by OVN-Kubernetes on OpenShift) provide cluster-wide defaults.

### Does default deny ingress affect traffic between pods in the same namespace?

Yes. Ingress deny drops traffic from every source, including pods in the same namespace. Add an `allow-same-namespace` policy if intra-namespace traffic should stay open.

## Key Takeaways

- Kubernetes allows all pod-to-pod traffic by default — no built-in isolation
- `podSelector: {}` with no rules = deny all (for specified `policyTypes`)
- Always add DNS exception (UDP/TCP 53) when using egress deny
- Policies are additive — multiple policies combine with OR logic
- Requires a CNI that supports NetworkPolicy (Calico, Cilium, Antrea)
- Default-deny is the foundation of zero-trust networking in Kubernetes
