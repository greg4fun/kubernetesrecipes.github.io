---
title: "Cilium: eBPF-Powered K8s Networking"
description: "Deploy Cilium CNI in Kubernetes for eBPF-based networking, network policies, service mesh, and observability with Hubble."
publishDate: "2026-05-03"
author: "Luca Berton"
category: "networking"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "cilium"
  - "ebpf"
  - "cni"
  - "networking"
  - "network-policy"
relatedRecipes:
  - "kubernetes-networkpolicy-guide"
  - "kubernetes-linkerd-service-mesh-guide"
  - "kubernetes-service-mesh-istio-guide"
---

> 💡 **Quick Answer:** Cilium is the eBPF-based CNI that replaces iptables and kube-proxy for faster networking. Install: `helm install cilium cilium/cilium -n kube-system --set kubeProxyReplacement=true`. Provides L3/L4/L7 network policies, transparent encryption (WireGuard), service mesh without sidecars, and Hubble observability. Identity-based policies instead of IP-based — works with dynamic pod IPs.

## The Problem

Traditional K8s networking (iptables/kube-proxy) has limitations:

- iptables rules scale poorly (O(n) per packet)
- Network policies are L3/L4 only (no HTTP-level filtering)
- No built-in encryption between pods
- Limited observability — can't see which service talks to which
- Service mesh requires sidecars (resource overhead)

## The Solution

### Install Cilium

```bash
# Helm install (new cluster or replacing existing CNI)
helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium \
  -n kube-system \
  --set kubeProxyReplacement=true \
  --set hubble.enabled=true \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true

# Install CLI
curl -L --remote-name https://github.com/cilium/cilium-cli/releases/latest/download/cilium-linux-amd64.tar.gz
tar xzf cilium-linux-amd64.tar.gz && mv cilium /usr/local/bin/

# Verify
cilium status
# KubeProxyReplacement:  True
# Cilium:                OK
# Hubble Relay:          OK

# Connectivity test
cilium connectivity test
```

### L7 Network Policies (HTTP-Aware)

```yaml
# Allow only GET /api/public — deny everything else
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: api-l7-policy
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: api-server
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: frontend
    toPorts:
    - ports:
      - port: "8080"
        protocol: TCP
      rules:
        http:
        - method: GET
          path: "/api/public.*"
        - method: POST
          path: "/api/orders"
          headers:
          - 'Content-Type: application/json'

---
# DNS-aware egress policy
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-external-api
spec:
  endpointSelector:
    matchLabels:
      app: my-service
  egress:
  - toFQDNs:
    - matchName: "api.stripe.com"
    - matchName: "api.sendgrid.com"
    toPorts:
    - ports:
      - port: "443"
        protocol: TCP
  # All other egress denied
```

### Cluster-Wide Policies

```yaml
apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: deny-all-default
spec:
  endpointSelector: {}            # All pods
  ingress:
  - fromEndpoints:
    - {}                           # Allow intra-cluster only
  egress:
  - toEndpoints:
    - {}                           # Allow intra-cluster only
  - toEntities:
    - kube-apiserver               # Allow API server access
  - toPorts:
    - ports:
      - port: "53"
        protocol: ANY             # Allow DNS

---
# Allow specific namespace communication
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-monitoring
  namespace: production
spec:
  endpointSelector: {}
  ingress:
  - fromEndpoints:
    - matchLabels:
        k8s:io.kubernetes.pod.namespace: monitoring
    toPorts:
    - ports:
      - port: "9090"              # Prometheus scraping
```

### Transparent Encryption (WireGuard)

```bash
# Enable WireGuard encryption — all pod-to-pod traffic encrypted
helm upgrade cilium cilium/cilium \
  -n kube-system \
  --set encryption.enabled=true \
  --set encryption.type=wireguard

# Verify encryption
cilium encrypt status
# Encryption: WireGuard
# Keys in use: 1

# All inter-node pod traffic now encrypted with zero config
# No sidecars, no certificates to manage
```

### Hubble Observability

```bash
# Install Hubble CLI
curl -L --remote-name https://github.com/cilium/hubble/releases/latest/download/hubble-linux-amd64.tar.gz
tar xzf hubble-linux-amd64.tar.gz && mv hubble /usr/local/bin/

# Port-forward Hubble Relay
cilium hubble port-forward &

# Observe all flows
hubble observe

# Filter by namespace
hubble observe -n production

# Filter by pod
hubble observe --to-pod production/api-server

# Filter by verdict (dropped traffic)
hubble observe --verdict DROPPED

# Filter HTTP
hubble observe -n production --protocol http
# Shows: source → destination, HTTP method, path, status code

# Access Hubble UI
kubectl port-forward -n kube-system svc/hubble-ui 12000:80
# http://localhost:12000 — service dependency map
```

### Cilium Service Mesh (No Sidecars)

```bash
# Enable service mesh features
helm upgrade cilium cilium/cilium \
  -n kube-system \
  --set ingressController.enabled=true \
  --set envoy.enabled=true

# Cilium Ingress (replaces NGINX Ingress)
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  annotations:
    ingress.cilium.io/loadbalancer-mode: shared
spec:
  ingressClassName: cilium
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app
            port:
              number: 80
```

### BGP and LoadBalancer

```yaml
# Cilium BGP for bare-metal LoadBalancer IPs
apiVersion: cilium.io/v2alpha1
kind: CiliumBGPPeeringPolicy
metadata:
  name: rack1
spec:
  virtualRouters:
  - localASN: 64512
    neighbors:
    - peerAddress: 10.0.0.1/32
      peerASN: 64513
    serviceSelector:
      matchExpressions:
      - key: io.cilium/bgp-announce
        operator: In
        values: ["true"]
```

### Bandwidth Management

```yaml
# Pod-level bandwidth limits via eBPF
apiVersion: v1
kind: Pod
metadata:
  name: bandwidth-limited
  annotations:
    kubernetes.io/egress-bandwidth: "10M"
    kubernetes.io/ingress-bandwidth: "20M"
spec:
  containers:
  - name: app
    image: myapp:v1
```

## Common Issues

**Pods stuck in Init after Cilium install**

Old CNI config still present. Remove `/etc/cni/net.d/` files from previous CNI and restart kubelet.

**"policy verdict: DENIED" in Hubble**

Network policy blocking traffic. Use `hubble observe --verdict DROPPED` to see which policy is blocking.

**kube-proxy replacement not working**

Kernel version too old. kube-proxy replacement requires Linux 5.10+. Check: `cilium status`.

## Best Practices

- **kube-proxy replacement** — eBPF is faster than iptables
- **L7 policies for APIs** — filter by HTTP method/path, not just port
- **WireGuard encryption** — zero-config pod-to-pod encryption
- **Hubble for debugging** — visualize service dependencies and dropped traffic
- **FQDN egress policies** — whitelist external domains, deny everything else

## Key Takeaways

- Cilium uses eBPF instead of iptables — better performance at scale
- L7 network policies: filter HTTP methods, paths, headers
- WireGuard encryption with zero configuration
- Hubble provides real-time flow observability and service maps
- Built-in service mesh, ingress controller, and BGP — no sidecars needed
