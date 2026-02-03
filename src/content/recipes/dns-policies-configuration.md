---
title: "How to Configure Kubernetes DNS Policies"
description: "Control pod DNS resolution with DNS policies and configs. Configure custom nameservers, search domains, and optimize DNS for your workloads."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["dns", "networking", "coredns", "resolution", "configuration"]
---

> 💡 **Quick Answer:** Set `spec.dnsPolicy` in your pod: **ClusterFirst** (default—cluster DNS then node), **Default** (node's resolv.conf), **None** (fully custom via `dnsConfig`). Use `dnsConfig` to add nameservers, searches, and options like `ndots`.
>
> **Key config:** Reduce `ndots: 2` (from default 5) to speed up external DNS lookups by reducing search domain iterations.
>
> **Gotcha:** `ClusterFirstWithHostNet` is required when using `hostNetwork: true` but still needing cluster DNS.

# How to Configure Kubernetes DNS Policies

Kubernetes offers multiple DNS policies to control how pods resolve names. Configure custom DNS settings for hybrid cloud, split-horizon DNS, and special requirements.

## DNS Policy Options

```yaml
# dnsPolicy options:
# - ClusterFirst (default): Use cluster DNS, fall back to node DNS
# - ClusterFirstWithHostNet: ClusterFirst for hostNetwork pods
# - Default: Use node's DNS settings
# - None: No DNS config, must specify dnsConfig

apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  dnsPolicy: ClusterFirst  # Default
  containers:
    - name: app
      image: nginx
```

## ClusterFirst (Default)

```yaml
# Cluster DNS for service discovery
# Falls back to upstream for external names
apiVersion: v1
kind: Pod
metadata:
  name: cluster-first-pod
spec:
  dnsPolicy: ClusterFirst
  containers:
    - name: app
      image: busybox
      command: ["sleep", "3600"]
```

```bash
# Inside pod, resolv.conf shows:
# nameserver 10.96.0.10 (cluster DNS)
# search default.svc.cluster.local svc.cluster.local cluster.local
# options ndots:5

# Resolution order:
# 1. my-svc -> my-svc.default.svc.cluster.local
# 2. External names -> upstream DNS
```

## ClusterFirstWithHostNet

```yaml
# For pods using host network
apiVersion: v1
kind: Pod
metadata:
  name: hostnet-pod
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet  # Still use cluster DNS
  containers:
    - name: app
      image: busybox
      command: ["sleep", "3600"]
```

## Default Policy (Node DNS)

```yaml
# Use node's DNS settings directly
apiVersion: v1
kind: Pod
metadata:
  name: node-dns-pod
spec:
  dnsPolicy: Default
  containers:
    - name: app
      image: busybox
      command: ["sleep", "3600"]
```

```bash
# resolv.conf matches node's /etc/resolv.conf
# No cluster service discovery
# Useful for pods that only need external DNS
```

## None Policy with Custom DNS

```yaml
# Full control over DNS
apiVersion: v1
kind: Pod
metadata:
  name: custom-dns-pod
spec:
  dnsPolicy: None
  dnsConfig:
    nameservers:
      - 8.8.8.8
      - 1.1.1.1
    searches:
      - mycompany.local
      - svc.cluster.local
    options:
      - name: ndots
        value: "2"
      - name: timeout
        value: "3"
      - name: attempts
        value: "2"
  containers:
    - name: app
      image: busybox
```

## Hybrid DNS Configuration

```yaml
# Combine cluster DNS with custom settings
apiVersion: v1
kind: Pod
metadata:
  name: hybrid-dns
spec:
  dnsPolicy: ClusterFirst
  dnsConfig:
    nameservers:
      - 10.0.0.53  # Additional corporate DNS
    searches:
      - corp.example.com  # Corporate domain
    options:
      - name: ndots
        value: "2"
  containers:
    - name: app
      image: myapp:v1
```

## Optimize DNS with ndots

```yaml
# Default ndots=5 causes many DNS queries
# For apps using FQDNs, lower ndots
apiVersion: v1
kind: Pod
metadata:
  name: optimized-dns
spec:
  dnsPolicy: ClusterFirst
  dnsConfig:
    options:
      - name: ndots
        value: "2"  # Fewer search domain attempts
      - name: single-request-reopen
        value: ""   # Avoid DNS race conditions
  containers:
    - name: app
      image: myapp:v1
```

```bash
# With ndots=5 (default), "api.example.com" triggers:
# 1. api.example.com.default.svc.cluster.local
# 2. api.example.com.svc.cluster.local
# 3. api.example.com.cluster.local
# 4. api.example.com.ec2.internal
# 5. api.example.com (finally!)

# With ndots=2, "api.example.com" (3 dots) goes direct
```

## DNS for StatefulSets

```yaml
# StatefulSets get predictable DNS names
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql  # Headless service name
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
        - name: mysql
          image: mysql:8
---
apiVersion: v1
kind: Service
metadata:
  name: mysql
spec:
  clusterIP: None  # Headless
  selector:
    app: mysql
  ports:
    - port: 3306
```

```bash
# DNS names for StatefulSet pods:
# mysql-0.mysql.default.svc.cluster.local
# mysql-1.mysql.default.svc.cluster.local
# mysql-2.mysql.default.svc.cluster.local
```

## External DNS Resolution

```yaml
# ExternalName service for external endpoints
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  type: ExternalName
  externalName: database.example.com
```

```bash
# Pods resolve external-db to database.example.com
# Useful for migrating services or external dependencies
```

## Debug DNS Issues

```bash
# Create DNS test pod
kubectl run dnstest --rm -it --image=busybox -- sh

# Inside pod:
nslookup kubernetes.default
nslookup my-service
nslookup my-service.my-namespace.svc.cluster.local

# Check resolv.conf
cat /etc/resolv.conf

# Test external DNS
nslookup google.com
```

## DNS Debugging Pod

```yaml
# dnsutils pod for debugging
apiVersion: v1
kind: Pod
metadata:
  name: dnsutils
spec:
  containers:
    - name: dnsutils
      image: registry.k8s.io/e2e-test-images/jessie-dnsutils:1.7
      command: ["sleep", "3600"]
```

```bash
kubectl exec -it dnsutils -- nslookup kubernetes.default
kubectl exec -it dnsutils -- dig +search my-service
kubectl exec -it dnsutils -- dig @10.96.0.10 kubernetes.default
```

## Per-Pod Host Aliases

```yaml
# Add entries to /etc/hosts
apiVersion: v1
kind: Pod
metadata:
  name: pod-with-hosts
spec:
  hostAliases:
    - ip: "10.0.0.100"
      hostnames:
        - "legacy-db"
        - "old-database.local"
    - ip: "10.0.0.101"
      hostnames:
        - "cache-server"
  containers:
    - name: app
      image: myapp:v1
```

## DNS Caching

```yaml
# NodeLocal DNSCache reduces DNS latency
# Runs DNS cache on each node

# Check if enabled
kubectl get pods -n kube-system -l k8s-app=node-local-dns

# Pods automatically use local cache
# Reduces load on CoreDNS
# Improves DNS reliability
```

## Summary

Kubernetes DNS policies control name resolution: ClusterFirst (default) uses cluster DNS with upstream fallback; ClusterFirstWithHostNet for hostNetwork pods; Default uses node DNS; None requires manual dnsConfig. Customize with dnsConfig to add nameservers, search domains, and options. Optimize with lower ndots values for external-heavy workloads. StatefulSets get predictable DNS names via headless services. Use ExternalName services for external endpoints. Debug with dnsutils pod and nslookup/dig commands. Add static entries via hostAliases. Enable NodeLocal DNSCache for improved performance.

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
