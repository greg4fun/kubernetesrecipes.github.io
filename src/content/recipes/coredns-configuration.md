---
title: "How to Configure Kubernetes Cluster DNS"
description: "Customize CoreDNS configuration for your cluster. Add custom DNS entries, configure forwarding, and optimize DNS resolution."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["coredns", "dns", "networking", "configuration", "resolution"]
---

# How to Configure Kubernetes Cluster DNS

CoreDNS handles DNS resolution in Kubernetes clusters. Customize it for custom domains, external forwarding, and performance optimization.

## View CoreDNS Configuration

```bash
# Check CoreDNS deployment
kubectl get deployment coredns -n kube-system

# View ConfigMap
kubectl get configmap coredns -n kube-system -o yaml

# CoreDNS pods
kubectl get pods -n kube-system -l k8s-app=kube-dns

# CoreDNS service
kubectl get svc kube-dns -n kube-system
```

## Default Corefile

```yaml
# Default CoreDNS configuration
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

## Custom DNS Entries

```yaml
# Add custom DNS records with hosts plugin
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns-custom
  namespace: kube-system
data:
  custom.server: |
    # Custom DNS entries
    hosts {
        192.168.1.100 legacy-db.internal
        192.168.1.101 legacy-api.internal
        10.0.0.50 external-service.company.com
        fallthrough
    }
```

```yaml
# Update main Corefile to import custom
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
        
        # Import custom configurations
        import /etc/coredns/custom/*.server
        
        kubernetes cluster.local in-addr.arpa ip6.arpa {
            pods insecure
            fallthrough in-addr.arpa ip6.arpa
            ttl 30
        }
        prometheus :9153
        forward . /etc/resolv.conf
        cache 30
        loop
        reload
        loadbalance
    }
```

## Forward to Custom DNS Server

```yaml
# Forward specific domains to internal DNS
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    # Corporate domain forwarding
    corp.example.com:53 {
        errors
        cache 30
        forward . 10.0.0.53 10.0.0.54
    }
    
    # Default zone
    .:53 {
        errors
        health
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
            pods insecure
            fallthrough in-addr.arpa ip6.arpa
            ttl 30
        }
        prometheus :9153
        forward . 8.8.8.8 8.8.4.4  # Google DNS
        cache 30
        loop
        reload
        loadbalance
    }
```

## Stub Domains

```yaml
# Forward specific domains to different DNS servers
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    # AWS Route53 private zone
    aws.internal:53 {
        errors
        cache 30
        forward . 10.0.0.2  # VPC DNS
    }
    
    # On-prem domain
    onprem.company.com:53 {
        errors
        cache 30
        forward . 192.168.1.10
    }
    
    # Default
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
```

## Rewrite DNS Queries

```yaml
# Rewrite queries to different names
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
        
        # Rewrite old domain to new
        rewrite name old-service.default.svc.cluster.local new-service.default.svc.cluster.local
        
        # Rewrite external to internal
        rewrite name api.example.com api-internal.production.svc.cluster.local
        
        kubernetes cluster.local in-addr.arpa ip6.arpa {
            pods insecure
            fallthrough
        }
        forward . /etc/resolv.conf
        cache 30
        reload
    }
```

## DNS Caching Configuration

```yaml
# Optimize caching
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
            ttl 60  # Increase TTL for cluster DNS
        }
        forward . /etc/resolv.conf {
            max_concurrent 1000
            prefer_udp
        }
        cache {
            success 9984 60  # Cache successful responses
            denial 9984 30   # Cache negative responses
            prefetch 10 1m 10%  # Prefetch popular records
        }
        reload
    }
```

## Enable DNS Logging

```yaml
# Add logging for debugging
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        log  # Enable query logging
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
```

```bash
# View DNS query logs
kubectl logs -n kube-system -l k8s-app=kube-dns -f
```

## NodeLocal DNSCache

```yaml
# Deploy NodeLocal DNSCache for better performance
# This runs a DNS cache on each node

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
          image: registry.k8s.io/dns/k8s-dns-node-cache:1.22.28
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
          volumeMounts:
            - name: config-volume
              mountPath: /etc/coredns
      volumes:
        - name: config-volume
          configMap:
            name: node-local-dns
```

## Pod DNS Configuration

```yaml
# Custom DNS settings per pod
apiVersion: v1
kind: Pod
metadata:
  name: custom-dns-pod
spec:
  dnsPolicy: "None"  # Don't use cluster DNS
  dnsConfig:
    nameservers:
      - 8.8.8.8
      - 8.8.4.4
    searches:
      - mycompany.local
      - prod.svc.cluster.local
    options:
      - name: ndots
        value: "2"
      - name: timeout
        value: "3"
      - name: attempts
        value: "2"
  containers:
    - name: app
      image: myapp:v1
```

## Test DNS Configuration

```bash
# Deploy DNS test pod
kubectl run dnstest --image=busybox:1.28 --restart=Never -- sleep 3600

# Test resolution
kubectl exec dnstest -- nslookup kubernetes.default
kubectl exec dnstest -- nslookup google.com
kubectl exec dnstest -- nslookup custom-domain.internal

# Check resolv.conf
kubectl exec dnstest -- cat /etc/resolv.conf

# Cleanup
kubectl delete pod dnstest
```

## Apply Changes

```bash
# Edit CoreDNS ConfigMap
kubectl edit configmap coredns -n kube-system

# Or apply from file
kubectl apply -f coredns-config.yaml

# Restart CoreDNS to apply changes
kubectl rollout restart deployment coredns -n kube-system

# Verify CoreDNS is running
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

## Summary

CoreDNS is the default DNS server in Kubernetes. Customize the Corefile ConfigMap to add custom DNS entries with the hosts plugin, forward specific domains to internal DNS servers, or rewrite queries. Optimize performance with caching settings and consider NodeLocal DNSCache for large clusters. Enable logging temporarily for debugging DNS issues. Use pod-level dnsConfig for special DNS requirements. Always test changes before applying to production and restart CoreDNS after ConfigMap updates.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
