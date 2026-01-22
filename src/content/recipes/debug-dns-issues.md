---
title: "How to Debug DNS Issues in Kubernetes"
description: "Troubleshoot and resolve DNS problems in Kubernetes. Learn to diagnose CoreDNS issues, test resolution, and fix common DNS failures."
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "debug-crashloopbackoff"
  - "service-loadbalancer-nodeport"
tags:
  - dns
  - coredns
  - troubleshooting
  - networking
  - debugging
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

Your pods can't resolve service names, external domains, or are experiencing intermittent DNS failures.

## Understanding Kubernetes DNS

Kubernetes uses CoreDNS (or kube-dns in older clusters) to provide DNS services:

- **Service discovery**: `<service>.<namespace>.svc.cluster.local`
- **Pod discovery**: `<pod-ip>.<namespace>.pod.cluster.local`
- **External resolution**: Forwards to upstream DNS

## Step 1: Check CoreDNS Status

```bash
# Check CoreDNS pods
kubectl get pods -n kube-system -l k8s-app=kube-dns

# Check CoreDNS service
kubectl get svc -n kube-system kube-dns

# View CoreDNS logs
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=100
```

## Step 2: Test DNS from a Pod

### Using a Debug Pod

```bash
# Run a debug pod
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- sh

# Inside the pod, test DNS:
nslookup kubernetes.default
nslookup google.com
cat /etc/resolv.conf
```

### One-Liner Tests

```bash
# Test internal DNS
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup kubernetes.default.svc.cluster.local

# Test external DNS
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup google.com

# Test specific service
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup myservice.mynamespace.svc.cluster.local
```

### Using dnsutils Image

```bash
kubectl run dnsutils --image=registry.k8s.io/e2e-test-images/jessie-dnsutils:1.3 \
  --rm -it --restart=Never -- bash

# Inside pod:
dig kubernetes.default.svc.cluster.local
dig +short google.com
host myservice.default.svc.cluster.local
```

## Step 3: Check resolv.conf

Every pod should have proper DNS configuration:

```bash
kubectl exec <pod-name> -- cat /etc/resolv.conf
```

Expected output:
```
nameserver 10.96.0.10
search default.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

## Common Issues and Solutions

### Issue 1: CoreDNS Pods Not Running

**Symptoms:**
```
kubectl get pods -n kube-system -l k8s-app=kube-dns
# No pods or pods in CrashLoopBackOff
```

**Solution:**
```bash
# Check events
kubectl describe pods -n kube-system -l k8s-app=kube-dns

# Restart CoreDNS
kubectl rollout restart deployment/coredns -n kube-system
```

### Issue 2: DNS Timeout

**Symptoms:**
```
;; connection timed out; no servers could be reached
```

**Possible Causes:**
1. Network policy blocking DNS traffic
2. CoreDNS pods are overloaded
3. Node networking issues

**Solution - Check Network Policy:**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to:
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
```

### Issue 3: High ndots Value

**Symptoms:** Slow DNS resolution, especially for external domains.

**Explanation:** With `ndots:5`, any name with fewer than 5 dots is searched in all domains first.

For `google.com` (1 dot), Kubernetes tries:
1. `google.com.default.svc.cluster.local`
2. `google.com.svc.cluster.local`
3. `google.com.cluster.local`
4. `google.com`

**Solution - Override in Pod:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  dnsConfig:
    options:
    - name: ndots
      value: "2"
  containers:
  - name: myapp
    image: myapp:latest
```

### Issue 4: CoreDNS ConfigMap Misconfiguration

**Check ConfigMap:**
```bash
kubectl get configmap coredns -n kube-system -o yaml
```

**Default Corefile:**
```yaml
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

### Issue 5: Upstream DNS Not Working

**Test upstream DNS:**
```bash
# Check what upstream DNS CoreDNS is using
kubectl exec -n kube-system <coredns-pod> -- cat /etc/resolv.conf
```

**Solution - Configure Custom Upstream:**
```yaml
data:
  Corefile: |
    .:53 {
        forward . 8.8.8.8 8.8.4.4
        # ... rest of config
    }
```

### Issue 6: DNS Loop Detected

**Symptoms in logs:**
```
[FATAL] plugin/loop: Loop detected
```

**Cause:** CoreDNS is forwarding to itself.

**Solution:**
```yaml
# Edit CoreDNS configmap
forward . 8.8.8.8 8.8.4.4  # Use external DNS instead of /etc/resolv.conf
```

## Debugging Tools

### DNS Debug Script

```bash
#!/bin/bash
echo "=== CoreDNS Status ==="
kubectl get pods -n kube-system -l k8s-app=kube-dns

echo -e "\n=== CoreDNS Service ==="
kubectl get svc -n kube-system kube-dns

echo -e "\n=== Testing Internal DNS ==="
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup kubernetes.default.svc.cluster.local

echo -e "\n=== Testing External DNS ==="
kubectl run dns-test2 --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup google.com

echo -e "\n=== CoreDNS Logs (last 20 lines) ==="
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=20
```

### Continuous DNS Test

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: dns-monitor
spec:
  containers:
  - name: dns-test
    image: busybox:1.36
    command:
    - /bin/sh
    - -c
    - |
      while true; do
        echo "$(date) - Testing DNS..."
        nslookup kubernetes.default > /dev/null 2>&1 && echo "Internal: OK" || echo "Internal: FAIL"
        nslookup google.com > /dev/null 2>&1 && echo "External: OK" || echo "External: FAIL"
        sleep 10
      done
```

## Performance Tuning

### Scale CoreDNS

```bash
kubectl scale deployment/coredns -n kube-system --replicas=3
```

### Enable DNS Autoscaling

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: coredns
  namespace: kube-system
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: coredns
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### NodeLocal DNSCache

For high DNS traffic, use NodeLocal DNSCache:

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/kubernetes/master/cluster/addons/dns/nodelocaldns/nodelocaldns.yaml
```

## Best Practices

1. **Monitor CoreDNS** - Set up alerts for DNS failures
2. **Scale appropriately** - More replicas for larger clusters
3. **Use headless services** carefully - They can generate many DNS records
4. **Consider NodeLocal DNS** for high-traffic clusters
5. **Test DNS in CI/CD** before deploying applications

## Key Takeaways

- DNS issues often manifest as connection timeouts
- Always check CoreDNS pods and logs first
- Use debug pods to test DNS resolution
- The `ndots` setting can significantly impact performance
- Scale CoreDNS for larger clusters
