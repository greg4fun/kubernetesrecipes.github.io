---
title: "Kubernetes DNS: How Service Discovery Works"
description: "Understand Kubernetes DNS resolution with CoreDNS. Service discovery, pod DNS, headless services, custom DNS policies, and troubleshooting DNS failures."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-04-03"
tags: ["dns", "coredns", "service-discovery", "networking", "kubernetes"]
author: "Luca Berton"
relatedRecipes:
  - "kubernetes-dns-configuration"
  - "coredns-configuration"
  - "custom-dns-configuration"
  - "dns-policies-configuration"
---

> 💡 **Quick Answer:** Understand Kubernetes DNS resolution with CoreDNS. Service discovery, pod DNS, headless services, custom DNS policies, and troubleshooting DNS failures.

## The Problem

This is one of the most searched Kubernetes topics. Having a comprehensive, well-structured guide helps both beginners and experienced users quickly find what they need.

## The Solution

### DNS Resolution Format

```
<service>.<namespace>.svc.cluster.local

# Examples:
postgres.default.svc.cluster.local          # Service in default namespace
redis.cache.svc.cluster.local               # Service in cache namespace
my-pod.my-service.default.svc.cluster.local # Pod via headless service
```

### How It Works

```bash
# Every pod gets DNS configured automatically
kubectl exec my-pod -- cat /etc/resolv.conf
# nameserver 10.96.0.10          ← CoreDNS ClusterIP
# search default.svc.cluster.local svc.cluster.local cluster.local
# ndots:5

# Because of search domains, you can use short names:
# "postgres"         → postgres.default.svc.cluster.local
# "redis.cache"      → redis.cache.svc.cluster.local
```

### DNS for Service Types

| Service Type | DNS Record | Returns |
|-------------|-----------|---------|
| ClusterIP | A record | ClusterIP (virtual IP) |
| Headless (clusterIP: None) | A record | All pod IPs |
| ExternalName | CNAME | External hostname |
| NodePort/LoadBalancer | A record | ClusterIP |

### Troubleshoot DNS

```bash
# Test DNS resolution
kubectl run dns-debug --rm -it --image=nicolaka/netshoot -- bash
# dig my-service.default.svc.cluster.local
# nslookup my-service

# Check CoreDNS pods
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns

# Check CoreDNS configmap
kubectl get configmap coredns -n kube-system -o yaml
```

### Custom DNS Policy

```yaml
spec:
  dnsPolicy: None
  dnsConfig:
    nameservers:
      - 8.8.8.8
      - 8.8.4.4
    searches:
      - my.custom.domain
    options:
      - name: ndots
        value: "2"    # Reduce DNS queries (default 5 causes extra lookups)
```

```mermaid
graph LR
    A[Pod: curl postgres] --> B[/etc/resolv.conf]
    B -->|Search: default.svc.cluster.local| C[CoreDNS]
    C -->|postgres.default.svc.cluster.local| D[Return ClusterIP 10.96.5.10]
    D --> E[Pod connects to ClusterIP]
    E --> F[kube-proxy routes to backend pod]
```

## Frequently Asked Questions

### Why does DNS resolution take 5 seconds?

Usually `ndots:5` causing unnecessary lookups. If your service name has fewer than 5 dots, Kubernetes appends each search domain before trying the absolute name. Set `ndots:2` in your pod's dnsConfig for external lookups.

### Can pods in different namespaces reach each other via DNS?

Yes — use the full name: `service.other-namespace.svc.cluster.local` or short: `service.other-namespace`.

## Best Practices

- **Start simple** — use the basic form first, add complexity as needed
- **Be consistent** — follow naming conventions across your cluster
- **Document your choices** — add annotations explaining why, not just what
- **Monitor and iterate** — review configurations regularly

## Key Takeaways

- This is fundamental Kubernetes knowledge every engineer needs
- Start with the simplest approach that solves your problem
- Use `kubectl explain` and `kubectl describe` when unsure
- Practice in a test cluster before applying to production
