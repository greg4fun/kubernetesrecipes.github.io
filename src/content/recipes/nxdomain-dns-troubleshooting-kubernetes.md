---
title: "NXDOMAIN DNS Troubleshooting Kubernetes"
description: "Fix NXDOMAIN errors in Kubernetes. Debug CoreDNS resolution failures, ndots configuration, search domain issues, and external DNS lookups returning NXDOMAIN for valid domains."
publishDate: "2026-04-30"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "dns"
  - "nxdomain"
  - "coredns"
  - "troubleshooting"
  - "networking"
relatedRecipes:
  - "dns-resolution-troubleshooting-kubernetes"
  - "coredns-custom-configuration-kubernetes"
  - "troubleshoot-service-connectivity-kubernetes"
  - "kubernetes-networkpolicy-guide"
---

> 💡 **Quick Answer:** NXDOMAIN in Kubernetes usually means one of three things: (1) the `ndots:5` default causes short names to search cluster domains before trying the FQDN — append a trailing dot (`api.example.com.`) to bypass; (2) CoreDNS can't reach upstream DNS — check `kube-dns` service and CoreDNS pods; (3) the domain genuinely doesn't exist. Debug with `kubectl exec <pod> -- nslookup api.example.com` and check CoreDNS logs.

## The Problem

Pods get NXDOMAIN for domains that resolve fine outside the cluster:

- `curl: (6) Could not resolve host: api.example.com`
- `nslookup: server can't find api.example.com: NXDOMAIN`
- External API calls fail but the domain works from nodes
- Intermittent NXDOMAIN under load (DNS rate limiting)

## The Solution

### Step 1: Test DNS from the Pod

```bash
# Run a debug pod with DNS tools
kubectl run dns-debug --image=busybox:1.36 --restart=Never -- sleep 3600

# Test resolution
kubectl exec dns-debug -- nslookup api.example.com
# Server:    10.96.0.10
# Address:   10.96.0.10:53
# ** server can't find api.example.com: NXDOMAIN

# Try with trailing dot (FQDN — bypasses search domains)
kubectl exec dns-debug -- nslookup api.example.com.
# Name:    api.example.com
# Address: 93.184.216.34
# ✅ Works! It's an ndots issue.
```

### The ndots Problem

Kubernetes sets `ndots:5` in `/etc/resolv.conf` by default:

```bash
kubectl exec dns-debug -- cat /etc/resolv.conf
# nameserver 10.96.0.10
# search default.svc.cluster.local svc.cluster.local cluster.local
# options ndots:5
```

With `ndots:5`, any name with fewer than 5 dots is treated as "not fully qualified" and searched through ALL search domains first:

```
Query: api.example.com (2 dots, < 5)
  1. api.example.com.default.svc.cluster.local → NXDOMAIN
  2. api.example.com.svc.cluster.local → NXDOMAIN
  3. api.example.com.cluster.local → NXDOMAIN
  4. api.example.com → ✅ (finally tries the real domain)
```

This creates 3 unnecessary NXDOMAIN queries before the real one.

### Fix: Reduce ndots or Use FQDN

```yaml
# Option 1: Set ndots:2 in pod spec (recommended)
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  dnsConfig:
    options:
    - name: ndots
      value: "2"
  containers:
  - name: app
    image: myapp:v1

# Option 2: Use trailing dot in application code
# api.example.com.  ← trailing dot = FQDN, no search domains
```

### Step 2: Check CoreDNS

```bash
# Is CoreDNS running?
kubectl get pods -n kube-system -l k8s-app=kube-dns
# NAME                       READY   STATUS    RESTARTS
# coredns-5d78c9869d-abc12   1/1     Running   0

# Check CoreDNS logs for errors
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50

# Is the kube-dns service reachable?
kubectl get svc kube-dns -n kube-system
# NAME       TYPE        CLUSTER-IP   PORT(S)
# kube-dns   ClusterIP   10.96.0.10   53/UDP,53/TCP

# Test from node directly
kubectl debug node/worker-1 -it --image=busybox -- nslookup kubernetes.default.svc.cluster.local 10.96.0.10
```

### Step 3: Check Upstream DNS

```bash
# CoreDNS forwards external queries to upstream
kubectl get configmap coredns -n kube-system -o yaml | grep -A5 forward
#     forward . /etc/resolv.conf
# or
#     forward . 8.8.8.8 8.8.4.4

# Check if upstream resolvers are reachable from CoreDNS
kubectl exec -n kube-system coredns-5d78c9869d-abc12 -- \
  cat /etc/resolv.conf
# This is the NODE's resolv.conf — upstream DNS servers

# Enable CoreDNS debug logging
kubectl edit configmap coredns -n kube-system
# Add "log" plugin:
# .:53 {
#     log        ← Add this line
#     errors
#     ...
# }
kubectl rollout restart deployment coredns -n kube-system

# Watch queries in real-time
kubectl logs -n kube-system -l k8s-app=kube-dns -f
```

### Step 4: Check NetworkPolicy

```bash
# Is DNS traffic blocked by NetworkPolicy?
# CoreDNS needs UDP/TCP port 53 from all pods

# Check if any NetworkPolicy blocks DNS
kubectl get networkpolicy -A -o yaml | grep -B10 "port: 53"

# If NetworkPolicy exists, ensure DNS is allowed:
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: my-namespace
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
```

### Common NXDOMAIN Patterns

| Symptom | Cause | Fix |
|---------|-------|-----|
| External domain NXDOMAIN, trailing dot works | ndots:5 search domain issue | Set `ndots:2` in dnsConfig |
| All DNS fails | CoreDNS pods down | Restart CoreDNS deployment |
| External fails, internal works | Upstream DNS unreachable | Check CoreDNS forward config |
| Intermittent NXDOMAIN | DNS rate limiting / conntrack | Increase CoreDNS replicas, use NodeLocal DNSCache |
| NXDOMAIN after NetworkPolicy | Egress DNS blocked | Allow UDP/TCP 53 to kube-system |

## Common Issues

**Intermittent NXDOMAIN under high load**

Conntrack table full or CoreDNS overwhelmed. Deploy NodeLocal DNSCache DaemonSet to cache DNS on every node: `kubectl apply -f https://raw.githubusercontent.com/kubernetes/kubernetes/master/cluster/addons/dns/nodelocaldns/nodelocaldns.yaml`.

**NXDOMAIN for `*.svc.cluster.local` names**

CoreDNS can't read the Kubernetes API. Check RBAC: `kubectl get clusterrolebinding system:coredns`.

**Alpine/musl-based images have DNS issues**

musl's resolver doesn't handle `ndots` the same as glibc. Use `ndots:1` or switch to debian-based images.

## Best Practices

- **Set `ndots:2`** on pods that call external APIs — reduces 3 unnecessary queries per lookup
- **Use FQDN with trailing dot** for external domains in config files
- **Deploy NodeLocal DNSCache** for clusters with >50 nodes
- **Never block DNS egress** without explicitly allowing port 53 to kube-system
- **Monitor CoreDNS latency and error rate** with Prometheus metrics

## Key Takeaways

- NXDOMAIN for external domains is usually the `ndots:5` search domain behavior
- Trailing dot (`api.example.com.`) forces FQDN lookup — no search domains
- Set `dnsConfig.options.ndots: 2` on pods that primarily call external services
- CoreDNS pods, kube-dns service, and upstream DNS are the three failure points
- NetworkPolicy must explicitly allow egress to UDP/TCP 53 on kube-system
