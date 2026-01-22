---
title: "How to Configure DNS in Kubernetes"
description: "Understand and configure Kubernetes DNS with CoreDNS. Customize DNS policies, configure external DNS resolution, and troubleshoot DNS issues."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["dns", "coredns", "networking", "service-discovery", "resolution"]
---

# How to Configure DNS in Kubernetes

Kubernetes uses CoreDNS for service discovery and name resolution. Understanding DNS configuration is essential for debugging connectivity issues and customizing name resolution.

## How Kubernetes DNS Works

```bash
# Service DNS format
<service-name>.<namespace>.svc.cluster.local

# Pod DNS format
<pod-ip-with-dashes>.<namespace>.pod.cluster.local

# Examples:
# my-service.default.svc.cluster.local
# 10-244-1-5.default.pod.cluster.local
```

## Check DNS Configuration

```bash
# View CoreDNS pods
kubectl get pods -n kube-system -l k8s-app=kube-dns

# View CoreDNS service
kubectl get svc -n kube-system kube-dns

# Check CoreDNS config
kubectl get configmap coredns -n kube-system -o yaml
```

## Default CoreDNS Configuration

```yaml
# coredns-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health {
           lameduck 5s
        }
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
           ttl 30
        }
        prometheus :9153
        forward . /etc/resolv.conf {
           max_concurrent 1000
        }
        cache 30
        loop
        reload
        loadbalance
    }
```

## Custom DNS Configuration

### Add Custom DNS Entries

```yaml
# coredns-custom.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns-custom
  namespace: kube-system
data:
  custom.server: |
    example.com:53 {
        forward . 10.0.0.10 10.0.0.11
    }
    mycompany.local:53 {
        forward . 192.168.1.1
    }
```

### Add Static Hosts

```yaml
# coredns-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        ready
        hosts {
           10.0.0.100 legacy-server.example.com
           10.0.0.101 database.internal
           fallthrough
        }
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
        }
        forward . /etc/resolv.conf
        cache 30
        reload
    }
```

## Pod DNS Policies

### ClusterFirst (Default)

```yaml
# cluster-first.yaml
apiVersion: v1
kind: Pod
metadata:
  name: cluster-first-pod
spec:
  dnsPolicy: ClusterFirst  # Default - use cluster DNS
  containers:
    - name: app
      image: nginx
```

### ClusterFirstWithHostNet

```yaml
# host-network-dns.yaml
apiVersion: v1
kind: Pod
metadata:
  name: host-network-pod
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet  # Required for hostNetwork pods
  containers:
    - name: app
      image: nginx
```

### Default (Use Node's DNS)

```yaml
# default-dns.yaml
apiVersion: v1
kind: Pod
metadata:
  name: default-dns-pod
spec:
  dnsPolicy: Default  # Use node's /etc/resolv.conf
  containers:
    - name: app
      image: nginx
```

### None (Custom DNS)

```yaml
# custom-dns.yaml
apiVersion: v1
kind: Pod
metadata:
  name: custom-dns-pod
spec:
  dnsPolicy: None
  dnsConfig:
    nameservers:
      - 8.8.8.8
      - 8.8.4.4
    searches:
      - my-namespace.svc.cluster.local
      - svc.cluster.local
      - cluster.local
    options:
      - name: ndots
        value: "5"
      - name: timeout
        value: "3"
  containers:
    - name: app
      image: nginx
```

## Custom DNS Config (dnsConfig)

```yaml
# pod-with-dns-config.yaml
apiVersion: v1
kind: Pod
metadata:
  name: custom-resolved-pod
spec:
  dnsPolicy: ClusterFirst
  dnsConfig:
    nameservers:
      - 1.1.1.1  # Additional nameserver
    searches:
      - my-custom.domain
    options:
      - name: ndots
        value: "2"
      - name: edns0
  containers:
    - name: app
      image: nginx
```

## External DNS Resolution

```yaml
# forward-external.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
        }
        # Forward external queries to public DNS
        forward . 8.8.8.8 8.8.4.4 {
           max_concurrent 1000
        }
        cache 30
        reload
    }
```

## Stub Domains for Private Zones

```yaml
# stub-domains.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough
        }
        forward . /etc/resolv.conf
        cache 30
        reload
    }
    # Stub domain for corporate DNS
    corp.example.com:53 {
        forward . 10.150.0.1
        cache 30
    }
    # Stub domain for AWS private zones
    aws.internal:53 {
        forward . 169.254.169.253
        cache 30
    }
```

## Headless Service DNS

```yaml
# headless-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: my-headless
spec:
  clusterIP: None
  selector:
    app: my-app
  ports:
    - port: 80
```

```bash
# Headless service returns individual pod IPs
nslookup my-headless.default.svc.cluster.local
# Returns:
# 10.244.1.5
# 10.244.2.6
# 10.244.3.7

# StatefulSet pod DNS
# pod-0.my-headless.default.svc.cluster.local
# pod-1.my-headless.default.svc.cluster.local
```

## Debug DNS Issues

```bash
# Test DNS from a pod
kubectl run dnsutils --image=gcr.io/kubernetes-e2e-test-images/dnsutils:1.3 --rm -it -- bash

# Inside pod:
nslookup kubernetes.default
nslookup my-service.my-namespace
dig my-service.my-namespace.svc.cluster.local
cat /etc/resolv.conf

# Check CoreDNS logs
kubectl logs -n kube-system -l k8s-app=kube-dns

# Check CoreDNS metrics
kubectl port-forward -n kube-system svc/kube-dns 9153:9153
curl localhost:9153/metrics
```

## Common DNS Issues

### ndots Configuration

```yaml
# Default ndots=5 causes many DNS queries for external names
# Reduce for performance with external services

spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"  # Reduce from default 5
```

### DNS Caching

```yaml
# Increase cache for frequently resolved names
data:
  Corefile: |
    .:53 {
        cache {
           success 9984 300  # Cache successful responses for 5 min
           denial 9984 30    # Cache NXDOMAIN for 30 sec
        }
        # ... rest of config
    }
```

### High DNS Query Volume

```yaml
# Add more CoreDNS replicas
kubectl scale deployment coredns -n kube-system --replicas=3

# Or use NodeLocal DNSCache
# Creates a DNS cache on each node
```

## NodeLocal DNS Cache

```yaml
# nodelocaldns.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-local-dns
  namespace: kube-system
spec:
  selector:
    matchLabels:
      k8s-app: node-local-dns
  template:
    metadata:
      labels:
        k8s-app: node-local-dns
    spec:
      hostNetwork: true
      dnsPolicy: Default
      containers:
        - name: node-cache
          image: registry.k8s.io/dns/k8s-dns-node-cache:1.22.20
          args:
            - -localip
            - "169.254.20.10"
            - -conf
            - /etc/Corefile
          ports:
            - containerPort: 53
              name: dns
              protocol: UDP
            - containerPort: 53
              name: dns-tcp
              protocol: TCP
```

## ExternalName Service

```yaml
# external-name.yaml
apiVersion: v1
kind: Service
metadata:
  name: my-database
spec:
  type: ExternalName
  externalName: database.example.com
```

```bash
# Queries for my-database.default.svc.cluster.local
# return CNAME database.example.com
```

## View Pod DNS Configuration

```bash
# Check resolv.conf in pod
kubectl exec my-pod -- cat /etc/resolv.conf

# Expected output:
# nameserver 10.96.0.10
# search default.svc.cluster.local svc.cluster.local cluster.local
# options ndots:5
```

## Summary

Kubernetes DNS via CoreDNS enables service discovery within the cluster. Use DNS policies to control how pods resolve names, dnsConfig for custom settings, and CoreDNS ConfigMap for cluster-wide customization. For performance, consider reducing ndots, enabling NodeLocal DNS Cache, and scaling CoreDNS replicas. Use stub domains to integrate with existing corporate DNS infrastructure.
