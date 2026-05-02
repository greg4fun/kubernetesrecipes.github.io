---
title: "K8s CoreDNS: Troubleshoot DNS Issues"
description: "Troubleshoot Kubernetes CoreDNS resolution failures. Debug dns pods, ndots settings, search domains, custom Corefile, and forward plugin configuration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "coredns"
  - "dns"
  - "troubleshooting"
  - "networking"
  - "cka"
relatedRecipes:
  - "dns-policies-configuration"
  - "nxdomain-dns-troubleshooting-kubernetes"
  - "kubernetes-networkpolicy-guide"
  - "debug-pod-networking"
---

> 💡 **Quick Answer:** Test DNS from a pod: `kubectl run dnstest --image=busybox:1.36 --rm -it -- nslookup kubernetes.default`. If it fails, check CoreDNS pods: `kubectl get pods -n kube-system -l k8s-app=kube-dns`. Check logs: `kubectl logs -n kube-system -l k8s-app=kube-dns`. Common fix: restart CoreDNS: `kubectl rollout restart deployment/coredns -n kube-system`. The `ndots:5` setting in `/etc/resolv.conf` causes excessive DNS lookups — reduce it for external-heavy workloads.

## The Problem

DNS issues are the #1 networking problem in Kubernetes:

- Pods can't resolve service names → connection refused
- External DNS resolution fails → can't reach external APIs
- Slow DNS lookups → application timeout
- Intermittent failures → hard to diagnose

## The Solution

### Quick Diagnosis

```bash
# Test internal DNS
kubectl run dnstest --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup kubernetes.default
# Should return: 10.96.0.1 (cluster IP of kubernetes service)

# Test service DNS
kubectl run dnstest --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup my-service.my-namespace.svc.cluster.local

# Test external DNS
kubectl run dnstest --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup google.com

# Check resolv.conf inside a pod
kubectl exec my-pod -- cat /etc/resolv.conf
# nameserver 10.96.0.10        ← CoreDNS service IP
# search default.svc.cluster.local svc.cluster.local cluster.local
# options ndots:5
```

### Check CoreDNS Health

```bash
# CoreDNS pods running?
kubectl get pods -n kube-system -l k8s-app=kube-dns
# coredns-5dd5756b68-xxxxx   1/1   Running   0   5d

# CoreDNS logs
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50

# CoreDNS service
kubectl get svc -n kube-system kube-dns
# NAME       TYPE        CLUSTER-IP   PORT(S)
# kube-dns   ClusterIP   10.96.0.10   53/UDP,53/TCP,9153/TCP

# Check endpoints (should match pod IPs)
kubectl get endpoints -n kube-system kube-dns
```

### Common DNS Failures and Fixes

```bash
# Problem: CoreDNS pods in CrashLoopBackOff
kubectl logs -n kube-system coredns-xxxxx
# If "Loop detected": CoreDNS forwarding to itself
# Fix: Edit Corefile to forward to upstream DNS, not 127.0.0.1

# Problem: DNS timeout (5+ seconds)
# Likely: ndots:5 causing excessive search domain lookups
# Fix: Set dnsConfig in pod spec (see below)

# Problem: "NXDOMAIN" for service names
# Check: Service exists? Correct namespace? Endpoints?
kubectl get svc,endpoints -n my-namespace

# Problem: External DNS works, internal doesn't
# Check: CoreDNS ConfigMap for correct zone config
kubectl get configmap coredns -n kube-system -o yaml
```

### Optimize ndots

```yaml
# Default ndots:5 means "google.com" triggers 5 lookups:
# 1. google.com.default.svc.cluster.local
# 2. google.com.svc.cluster.local
# 3. google.com.cluster.local
# 4. google.com.<host-search-domain>
# 5. google.com (finally!)

# Fix for pods making many external DNS calls:
apiVersion: v1
kind: Pod
metadata:
  name: external-app
spec:
  dnsConfig:
    options:
    - name: ndots
      value: "2"       # Reduces search domain lookups
  containers:
  - name: app
    image: myapp:v1
```

### Custom CoreDNS Configuration

```bash
# Edit CoreDNS ConfigMap
kubectl edit configmap coredns -n kube-system
```

```
# Corefile
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

# Add custom DNS zone
example.com:53 {
    forward . 10.0.0.53
    cache 60
}

# Add stub domain
consul.local:53 {
    forward . 10.0.0.100:8600
}
```

```bash
# Restart CoreDNS after config change
kubectl rollout restart deployment/coredns -n kube-system
```

### DNS Policies

```yaml
# Default: use CoreDNS (ClusterFirst)
spec:
  dnsPolicy: ClusterFirst

# Use node's DNS (skip CoreDNS)
spec:
  dnsPolicy: Default

# No DNS config (empty resolv.conf)
spec:
  dnsPolicy: None
  dnsConfig:
    nameservers:
    - 8.8.8.8
    - 8.8.4.4
    searches:
    - example.com

# ClusterFirstWithHostNet (for hostNetwork: true pods)
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet
```

## Common Issues

**"i/o timeout" resolving DNS**

CoreDNS pods not reachable. Check: NetworkPolicy blocking DNS port 53, or CoreDNS pods on failing nodes.

**"SERVFAIL" for external domains**

CoreDNS can't reach upstream DNS. Check: `forward . /etc/resolv.conf` — is the node's resolv.conf correct? Try `forward . 8.8.8.8`.

**DNS works from some pods but not others**

NetworkPolicy blocking egress to CoreDNS. Add DNS egress rule allowing UDP/TCP port 53 to kube-dns pods.

## Best Practices

- **Set `ndots: 2`** for pods making external DNS calls — reduces latency
- **Use FQDN with trailing dot** for external names: `api.example.com.` — skips search domains
- **Monitor CoreDNS metrics** — `coredns_dns_requests_total`, `coredns_dns_responses_total`
- **Scale CoreDNS** for large clusters — default 2 replicas may not be enough for 100+ nodes
- **Cache TTL tuning** — increase for stable internal services, decrease for dynamic external

## Key Takeaways

- CoreDNS is the cluster DNS — if it's down, nothing resolves
- `nslookup` from a busybox pod is the fastest DNS test
- `ndots:5` causes 4 extra lookups for every external domain — reduce it
- Check CoreDNS pods, logs, and ConfigMap when DNS fails
- NetworkPolicy must allow egress to port 53 for DNS to work
