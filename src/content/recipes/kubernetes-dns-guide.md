---
title: "Kubernetes DNS and CoreDNS Guide"
description: "networking"
category: "intermediate"
difficulty: "Understand Kubernetes DNS resolution with CoreDNS. Debug DNS issues, configure custom DNS, and optimize DNS performance for large clusters."
publishDate: "2026-04-07"
tags: ["dns", "coredns", "service-discovery", "networking", "resolution"]
author: "Luca Berton"
relatedRecipes:
  - "kubernetes-persistent-volume"
  - "kubernetes-service-account-guide"
  - "kubernetes-deployment-strategies"
  - "kubernetes-health-checks"
---

> 💡 **Quick Answer:** networking

## The Problem

This is one of the most searched Kubernetes topics with thousands of monthly searches. A comprehensive, production-ready guide prevents hours of trial and error.

## The Solution

### Kubernetes DNS Format

```
<service>.<namespace>.svc.cluster.local
<pod-ip-dashes>.<namespace>.pod.cluster.local
```

```bash
# From any pod:

# Same namespace — short name works
curl http://api-service/endpoint

# Cross namespace — need namespace
curl http://api-service.production/endpoint

# Fully qualified (FQDN)
curl http://api-service.production.svc.cluster.local/endpoint

# Headless service — individual pods
curl http://postgres-0.postgres.default.svc.cluster.local:5432

# SRV records (find port)
dig _http._tcp.api-service.default.svc.cluster.local SRV
```

### Debug DNS

```bash
# Quick test
kubectl run dns-test --rm -it --image=busybox -- nslookup kubernetes

# Detailed debugging
kubectl run dns-debug --rm -it --image=nicolaka/netshoot -- bash
> dig api-service.default.svc.cluster.local
> dig @10.96.0.10 api-service.default.svc.cluster.local   # Direct CoreDNS
> cat /etc/resolv.conf

# Check CoreDNS is running
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50
```

### Custom DNS Configuration

```yaml
# Pod-level DNS config
spec:
  dnsPolicy: "None"        # Override cluster DNS
  dnsConfig:
    nameservers:
      - 8.8.8.8
      - 1.1.1.1
    searches:
      - default.svc.cluster.local
      - svc.cluster.local
    options:
      - name: ndots
        value: "2"           # Reduce search domain lookups
```

### CoreDNS Custom Zones

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns-custom
  namespace: kube-system
data:
  example.server: |
    example.com:53 {
      forward . 10.0.0.53    # Forward to internal DNS
    }
  # Or static entries
  custom.override: |
    hosts {
      10.0.0.100 api.legacy.example.com
      fallthrough
    }
```

### ndots Optimization

```yaml
# Default ndots=5 means ANY name with <5 dots gets search domains appended
# "api.external.com" → tries api.external.com.default.svc.cluster.local FIRST
# Fix: reduce ndots for pods making many external DNS calls
dnsConfig:
  options:
    - name: ndots
      value: "2"
# Or use trailing dot: "api.external.com." (absolute name, no search)
```

```mermaid
graph TD
    A[Pod: curl api-service] --> B[/etc/resolv.conf]
    B --> C[CoreDNS: 10.96.0.10]
    C -->|cluster.local| D[Return ClusterIP]
    C -->|external| E[Forward to upstream DNS]
```

## Frequently Asked Questions

### Why is DNS slow in my cluster?

Common causes: high ndots (too many search domain attempts), CoreDNS under-resourced, or UDP conntrack table full. Set `ndots: 2` for external-heavy workloads and scale CoreDNS based on cluster size.

## Best Practices

- Start with the simplest configuration that solves your problem
- Test in staging before production
- Use `kubectl describe` and events for troubleshooting
- Document team conventions for consistency

## Key Takeaways

- This is fundamental Kubernetes operational knowledge
- Follow established conventions and recommended labels
- Monitor and iterate based on real production behavior
- Automate repetitive tasks to reduce human error
