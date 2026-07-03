---
title: "K8s DNS for Services: Resolution Guide"
description: "Understand Kubernetes DNS for Services and Pods. Service discovery patterns, FQDN format, headless services, DNS policies, ndots configuration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "dns"
  - "services"
  - "networking"
  - "service-discovery"
  - "cka"
relatedRecipes:
  - "kubernetes-coredns-troubleshooting"
  - "kubernetes-networkpolicy-guide"
  - "kubernetes-network-debugging-tools"
---

> 💡 **Quick Answer:** Services get DNS: `<service>.<namespace>.svc.cluster.local`. Same namespace: just `<service>`. Headless services (clusterIP: None) return individual pod IPs. Pod DNS: `<pod-ip-dashed>.<namespace>.pod.cluster.local`. StatefulSet pods: `<pod-name>.<headless-service>.<namespace>.svc.cluster.local`. Tune `ndots: 2` in dnsConfig to reduce DNS lookups for external domains.

## The Problem

Kubernetes creates DNS records automatically, but:

- What's the full DNS name format?
- How do pods discover services in other namespaces?
- How does headless service DNS differ?
- Why are external DNS lookups slow (ndots)?
- How to debug DNS resolution failures?

## The Solution

### Service DNS Records

```bash
# Service DNS format:
# <service-name>.<namespace>.svc.cluster.local

# Same namespace — short name works
curl http://my-service:8080

# Cross-namespace — need namespace
curl http://my-service.production:8080

# Full FQDN (trailing dot = absolute)
curl http://my-service.production.svc.cluster.local.:8080

# SRV records (for port discovery)
# _<port-name>._<protocol>.<service>.<namespace>.svc.cluster.local
dig SRV _http._tcp.my-service.production.svc.cluster.local
# Returns: port and target hostname
```

### Headless Services (clusterIP: None)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: db-headless
  namespace: production
spec:
  clusterIP: None              # Headless!
  selector:
    app: postgres
  ports:
  - port: 5432
```

```bash
# Normal Service DNS → returns ClusterIP
nslookup my-service.production.svc.cluster.local
# Address: 10.96.45.123  (ClusterIP)

# Headless Service DNS → returns ALL pod IPs
nslookup db-headless.production.svc.cluster.local
# Address: 10.244.1.5    (Pod 1)
# Address: 10.244.2.8    (Pod 2)
# Address: 10.244.3.12   (Pod 3)

# Clients get all IPs and can load-balance themselves
# Essential for databases, Kafka, Elasticsearch
```

### StatefulSet DNS

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  clusterIP: None
  selector:
    app: postgres
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres        # Links to headless service
  replicas: 3
```

```bash
# Each StatefulSet pod gets a stable DNS name:
# <pod-name>.<service-name>.<namespace>.svc.cluster.local

nslookup postgres-0.postgres.production.svc.cluster.local
# Address: 10.244.1.5   (always postgres-0)

nslookup postgres-1.postgres.production.svc.cluster.local
# Address: 10.244.2.8   (always postgres-1)

nslookup postgres-2.postgres.production.svc.cluster.local
# Address: 10.244.3.12  (always postgres-2)

# Stable identity — even after pod restart, same DNS name
# Perfect for: primary/replica discovery, clustering
```

### Pod DNS Records

```bash
# Pod DNS (auto-created):
# <pod-ip-dashed>.<namespace>.pod.cluster.local

# Pod 10.244.1.5 in production namespace:
nslookup 10-244-1-5.production.pod.cluster.local
# Address: 10.244.1.5

# Custom hostname and subdomain
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  hostname: my-host            # Custom hostname
  subdomain: my-subdomain      # Creates DNS record
  containers:
  - name: app
    image: nginx

# DNS: my-host.my-subdomain.<namespace>.svc.cluster.local
```

### DNS Policy and Config

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  dnsPolicy: ClusterFirst      # Default: use CoreDNS
  # dnsPolicy: Default         # Use node's DNS
  # dnsPolicy: None            # Only use dnsConfig
  # dnsPolicy: ClusterFirstWithHostNet  # For hostNetwork pods
  
  dnsConfig:
    nameservers:
    - 8.8.8.8                  # Additional nameserver
    searches:
    - production.svc.cluster.local
    - svc.cluster.local
    options:
    - name: ndots
      value: "2"               # Reduce DNS lookups!
```

### The ndots Problem

```bash
# Default ndots: 5
# DNS search list: default.svc.cluster.local, svc.cluster.local, cluster.local

# Lookup "google.com" (1 dot, < 5):
# 1. google.com.default.svc.cluster.local   → NXDOMAIN
# 2. google.com.svc.cluster.local           → NXDOMAIN
# 3. google.com.cluster.local               → NXDOMAIN
# 4. google.com.                            → resolved! ✅
# = 4 DNS queries for one external lookup!

# Fix: set ndots: 2 (or use FQDN with trailing dot)
dnsConfig:
  options:
  - name: ndots
    value: "2"

# Now "google.com" (1 dot, < 2):
# 1. google.com.default.svc.cluster.local   → NXDOMAIN
# 2. google.com.                            → resolved! ✅
# = 2 queries (still not ideal)

# Best: use trailing dot for external
# curl http://api.example.com.   ← absolute, 1 query
```

### ExternalName Services

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  type: ExternalName
  externalName: db.example.com
# DNS: external-db.<namespace>.svc.cluster.local → CNAME db.example.com
# No proxy — just DNS alias
```

### Debug DNS

```bash
# Quick DNS test
kubectl run dnstest --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup my-service.production.svc.cluster.local

# Check resolv.conf
kubectl exec my-pod -- cat /etc/resolv.conf
# nameserver 10.96.0.10
# search default.svc.cluster.local svc.cluster.local cluster.local
# options ndots:5

# Detailed DNS query
kubectl run dnstest --image=nicolaka/netshoot --rm -it --restart=Never -- \
  dig my-service.production.svc.cluster.local

# Check CoreDNS
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=20
```

## Common Issues

**Cross-namespace service not resolving**

Use full name: `<service>.<namespace>` or FQDN. Short names only work within the same namespace.

**Slow external DNS lookups**

ndots:5 causes multiple search domain lookups. Set `ndots: 2` or use FQDN with trailing dot.

**DNS returns stale pod IPs**

CoreDNS cache. Default TTL is 30s. Check: `kubectl get configmap coredns -n kube-system -o yaml`.

## Best Practices

- **Same namespace: short name** — `my-service:8080`
- **Cross-namespace: include namespace** — `my-service.production:8080`
- **Set ndots: 2** for pods making external calls — reduces DNS queries
- **Use headless services** for StatefulSets and databases
- **Trailing dot for external** — `api.example.com.` avoids search domain queries

## Key Takeaways

- Service DNS: `<service>.<namespace>.svc.cluster.local`
- Headless services return pod IPs instead of a single ClusterIP
- StatefulSet pods get stable DNS: `<pod>.<service>.<namespace>.svc.cluster.local`
- Default ndots:5 causes slow external lookups — tune to 2
- ExternalName services create CNAME records to external endpoints
