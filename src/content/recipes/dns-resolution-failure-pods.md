---
title: "Debug DNS Resolution Failures in Pods"
description: "Troubleshoot pods unable to resolve DNS names. Check CoreDNS health, ndots configuration, search domains, and NetworkPolicies blocking UDP port 53 DNS traffic."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - dns
  - coredns
  - resolution
  - networking
  - troubleshooting
relatedRecipes:
  - "network-policy-debug-connectivity"
  - "node-not-ready-troubleshooting"
---
> 💡 **Quick Answer:** Test with `kubectl exec <pod> -- nslookup kubernetes.default`. If it fails, check CoreDNS pods (`kubectl get pods -n kube-system -l k8s-app=kube-dns`), verify the Service ClusterIP (`kubectl get svc kube-dns -n kube-system`), and check if NetworkPolicies block UDP/TCP port 53.

## The Problem

Pods can't resolve DNS names — Service names, external domains, or both. Applications fail with "Name or service not known", "Temporary failure in name resolution", or connection timeouts when using hostnames.

## The Solution

### Step 1: Test DNS from Inside a Pod

```bash
# Quick test — resolve the kubernetes API service
kubectl exec -it deploy/myapp -- nslookup kubernetes.default
# If this fails → cluster DNS is broken

# Test external resolution
kubectl exec -it deploy/myapp -- nslookup google.com
# If cluster DNS works but external fails → upstream DNS issue

# Use a debug pod if your containers don't have nslookup
kubectl run dns-test --image=busybox:1.36 --rm -it -- nslookup kubernetes.default
```

### Step 2: Check CoreDNS

```bash
# Are CoreDNS pods running?
kubectl get pods -n kube-system -l k8s-app=kube-dns
# NAME                       READY   STATUS    RESTARTS
# coredns-5d78c9869d-abc12   1/1     Running   0
# coredns-5d78c9869d-def34   1/1     Running   0

# Check CoreDNS logs for errors
kubectl logs -n kube-system -l k8s-app=kube-dns --since=5m

# Check the DNS Service ClusterIP
kubectl get svc kube-dns -n kube-system
# NAME       TYPE        CLUSTER-IP   PORT(S)
# kube-dns   ClusterIP   10.96.0.10   53/UDP,53/TCP
```

### Step 3: Check Pod DNS Configuration

```bash
# See what DNS config the pod has
kubectl exec myapp-pod -- cat /etc/resolv.conf
# nameserver 10.96.0.10         ← Should point to kube-dns ClusterIP
# search myapp.svc.cluster.local svc.cluster.local cluster.local
# options ndots:5               ← Important!
```

### Step 4: The ndots Problem

With `ndots:5`, any name with fewer than 5 dots is treated as a relative name. `google.com` (1 dot) triggers 4 search domain lookups BEFORE the absolute query:
1. `google.com.myapp.svc.cluster.local` → NXDOMAIN
2. `google.com.svc.cluster.local` → NXDOMAIN
3. `google.com.cluster.local` → NXDOMAIN
4. `google.com.` → SUCCESS

This adds latency. Fix with a trailing dot or lower ndots:

```yaml
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"    # Reduce unnecessary search domain lookups
```

### Step 5: Check NetworkPolicy

```bash
# If you have NetworkPolicies, DNS (port 53) must be allowed
kubectl get networkpolicy -n myapp

# Ensure egress allows DNS
# See: network-policy-debug-connectivity recipe for the allow-dns policy
```

## Common Issues

### CoreDNS CrashLooping

```bash
kubectl logs -n kube-system -l k8s-app=kube-dns --previous
# Common: "Loop detected" — CoreDNS is forwarding to itself
# Fix: check /etc/resolv.conf on the NODE (not pod) — ensure it doesn't point to the ClusterIP
```

### DNS Works for Services but Not External Names

CoreDNS upstream forwarder may be misconfigured:
```bash
kubectl get configmap coredns -n kube-system -o yaml
# Check the "forward" directive — should point to valid upstream DNS
# forward . /etc/resolv.conf   ← Uses node's DNS
# forward . 8.8.8.8 8.8.4.4   ← Explicit upstream
```

## Best Practices

- **Lower ndots to 2** for pods that resolve many external names — reduces DNS queries by 3x
- **Use FQDN with trailing dot** in configs — `api.example.com.` skips search domains entirely
- **Always allow DNS in NetworkPolicies** — UDP+TCP port 53 to kube-dns
- **Monitor CoreDNS** — dashboard or `coredns_dns_request_count_total` metric
- **Don't use `dnsPolicy: Default`** unless you want node DNS instead of cluster DNS

## Key Takeaways

- `nslookup kubernetes.default` is the first test — if it fails, CoreDNS is down or unreachable
- Check `/etc/resolv.conf` in the pod — nameserver should be the kube-dns ClusterIP
- `ndots:5` causes 4 extra lookups per external name — lower it for latency-sensitive apps
- NetworkPolicies blocking port 53 is a common hidden cause
- CoreDNS logs reveal upstream failures, loop detection, and SERVFAIL causes
