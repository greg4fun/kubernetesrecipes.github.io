---
title: "Kubernetes NetworkPolicy Examples and Guide"
description: "Copy-paste Kubernetes NetworkPolicy examples: default deny, allow DNS, allow by label or namespace, ingress controller, database access and egress CIDRs."
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
  - "examples"
  - "egress"
relatedRecipes:
  - "kubernetes-networkpolicy-default-deny"
  - "kubernetes-networkpolicy-default-deny-egress"
  - "kubernetes-calico-networkpolicy"
  - "rhacs-network-segmentation"
  - "networkpolicy-deny-all"
  - "kubernetes-namespace-guide"
  - "kubernetes-service-mesh-comparison"
  - "dns-policies-configuration"
  - "kubernetes-endpoint-slices-discovery"
  - "network-policy-debug-connectivity"
  - "kubernetes-network-policy-egress"
---

> 💡 **Quick Answer:** NetworkPolicy controls pod-to-pod traffic at L3/L4. Default: all traffic allowed. Apply a default-deny policy, then whitelist specific flows. Use `podSelector` to target pods, `ingress`/`egress` to define allowed traffic, and `namespaceSelector` for cross-namespace rules. Requires a CNI that enforces NetworkPolicy (Calico, Cilium, OVN-Kubernetes on OpenShift, Antrea — **not** plain Flannel, where policies are silently ignored).
>
> **Gotcha:** Policies are additive allow-lists. Once any policy selects a pod for a direction, everything not explicitly allowed in that direction is dropped — including DNS.

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
# Allow traffic from a specific namespace (auto-label, no manual labelling needed)
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
          kubernetes.io/metadata.name: monitoring
    ports:
    - protocol: TCP
      port: 9090
```

### AND vs OR Selectors

The single most common NetworkPolicy bug is one YAML dash:

```yaml
ingress:
- from:
  - namespaceSelector:              # ONE element: namespace AND pod must match
      matchLabels: { kubernetes.io/metadata.name: monitoring }
    podSelector:
      matchLabels: { app: prometheus }
---
ingress:
- from:
  - namespaceSelector:              # TWO elements: ANY pod in monitoring
      matchLabels: { kubernetes.io/metadata.name: monitoring }
  - podSelector:                    # OR app=prometheus in THIS namespace
      matchLabels: { app: prometheus }
```

### Allow Same-Namespace Traffic

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: production
spec:
  podSelector: {}
  policyTypes: [Ingress]
  ingress:
  - from:
    - podSelector: {}               # any pod in this namespace
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
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system   # openshift-dns on OpenShift
      podSelector:
        matchLabels:
          k8s-app: kube-dns                          # dns.operator.openshift.io/daemonset-dns: default
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
# Frontend → API → Database pattern (DNS comes from the allow-dns policy above)
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
          kubernetes.io/metadata.name: ingress-nginx
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

### Port Ranges (endPort)

```yaml
  ingress:
  - ports:
    - protocol: TCP
      port: 32000
      endPort: 32768        # GA since 1.25; port must be numeric, not a named port
```

## Test a Policy

```bash
kubectl get networkpolicy -n production
kubectl describe networkpolicy api-policy -n production

# From an allowed pod
kubectl exec -n production deploy/frontend -- curl -s -m 3 http://api:8080/healthz
# From a pod that should be blocked (expect timeout)
kubectl run np-test -n production --rm -it --image=busybox --restart=Never -- \
  wget -qO- -T 3 http://postgres:5432 || echo BLOCKED
```

Blocked traffic times out rather than being refused, so use short timeouts. Cilium (`hubble observe --verdict DROPPED`) and Calico flow logs show which policy dropped a packet.

## Common Issues

**Pods can't resolve DNS after default-deny**

Add a DNS egress policy allowing traffic to kube-dns on port 53 (see example above).

**NetworkPolicy not enforced**

CNI doesn't enforce NetworkPolicy. Plain Flannel doesn't — switch to Calico, Cilium, or run Calico in policy-only mode alongside Flannel (Canal).

**Ingress controller can't reach backend pods**

Add an ingress rule allowing from the ingress controller namespace via `kubernetes.io/metadata.name`. On OpenShift, routers run with host networking on some platforms — allow `policy-group.network.openshift.io/ingress: ""` instead.

**Egress to a Service IP doesn't match `ipBlock`**

`ipBlock` is evaluated after Service DNAT, against pod IPs, and isn't meant for in-cluster destinations. Use pod/namespace selectors for cluster traffic.

## Best Practices

- **Always start with default deny** — whitelist, don't blacklist
- **Allow DNS first** — almost every policy needs DNS egress
- **Label namespaces** — enables `namespaceSelector` in policies
- **Use a policy-enforcing CNI** — Calico, Cilium, OVN-Kubernetes
- **Test with `kubectl exec` + `curl`** — verify connectivity after policy changes

## Frequently Asked Questions

### What does a Kubernetes NetworkPolicy do?

It's an L3/L4 allow-list for pod traffic, enforced by the CNI. It selects pods by label and lists which peers (pods, namespaces, CIDRs) and ports may connect to them (ingress) or that they may connect to (egress).

### Are NetworkPolicies deny or allow?

Allow only. There's no explicit deny rule in the core API; isolation happens because a pod selected by any policy drops traffic that no policy allows. A "default deny" is just a policy selecting all pods with no rules. Calico and Cilium add explicit deny and cluster-wide policies via their own CRDs.

### Why does my pod lose DNS after applying a NetworkPolicy?

Your policy includes `Egress` in `policyTypes` without allowing UDP/TCP 53 to the cluster DNS pods. Add an allow-dns egress policy like the one above.

### Do NetworkPolicies work with Flannel?

No. Flannel provides connectivity only; policies are accepted by the API server but not enforced. Use Canal (Flannel + Calico policy), Calico or Cilium.

## Key Takeaways

- NetworkPolicy is the firewall for pod-to-pod traffic (L3/L4)
- Start with default-deny, then allow specific flows
- Always allow DNS egress or pods can't resolve service names
- Requires a policy-enforcing CNI (Calico, Cilium, OVN-Kubernetes — not plain Flannel)
- Use podSelector + namespaceSelector + ipBlock for precise rules
