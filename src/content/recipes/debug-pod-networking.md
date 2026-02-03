---
title: "How to Debug Pod Networking Issues"
description: "Diagnose and fix Kubernetes networking problems. Troubleshoot connectivity, DNS resolution, service discovery, and network policies with practical tools."
category: "troubleshooting"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["networking", "debugging", "troubleshooting", "connectivity", "dns"]
---

> 💡 **Quick Answer:** Use a debug pod with network tools: `kubectl run netshoot --rm -it --image=nicolaka/netshoot -- bash`. Inside, test DNS (`nslookup kubernetes`), connectivity (`curl service-name:port`), and routing (`traceroute`). Check NetworkPolicies with `kubectl get networkpolicy` if traffic is blocked.
>
> **Key command:** `kubectl exec -it <pod> -- nslookup <service>` and `kubectl exec -it <pod> -- wget -qO- <service>:<port>`
>
> **Gotcha:** DNS issues often stem from CoreDNS—check `kubectl logs -n kube-system -l k8s-app=kube-dns`.

# How to Debug Pod Networking Issues

Network issues in Kubernetes can be challenging to diagnose. This guide provides systematic approaches and tools for debugging connectivity problems between pods, services, and external endpoints.

## Debug Pod with Network Tools

```bash
# Deploy a debug pod with networking tools
kubectl run netshoot --image=nicolaka/netshoot --rm -it -- bash

# Or as a deployment for persistent debugging
kubectl create deployment netshoot --image=nicolaka/netshoot
kubectl exec -it deploy/netshoot -- bash
```

## Basic Connectivity Tests

```bash
# Inside debug pod:

# Test DNS resolution
nslookup kubernetes.default
nslookup my-service.my-namespace.svc.cluster.local
dig my-service.my-namespace.svc.cluster.local

# Test TCP connectivity
nc -zv my-service 80
nc -zv 10.96.0.1 443

# Test HTTP endpoints
curl -v http://my-service:8080/health
wget -qO- http://my-service:8080/health

# Ping (if ICMP allowed)
ping my-service
ping 10.244.1.5
```

## Check Pod Network Configuration

```bash
# View pod's network config
kubectl exec my-pod -- cat /etc/resolv.conf
kubectl exec my-pod -- ip addr
kubectl exec my-pod -- ip route

# Check environment variables for service discovery
kubectl exec my-pod -- env | grep SERVICE
```

## Service Debugging

```bash
# Check service exists and has endpoints
kubectl get svc my-service
kubectl get endpoints my-service
kubectl describe svc my-service

# Verify service selector matches pods
kubectl get pods -l app=myapp --show-labels

# Test service DNS
kubectl run tmp --image=busybox --rm -it -- nslookup my-service

# Test service ClusterIP directly
kubectl run tmp --image=curlimages/curl --rm -it -- curl -v http://10.96.123.45:8080
```

## Endpoint Debugging

```bash
# List endpoints
kubectl get endpoints my-service -o yaml

# Check if endpoints are populated
kubectl describe endpoints my-service

# No endpoints? Check:
# 1. Pods are running
kubectl get pods -l app=myapp

# 2. Pods are ready (readiness probe passing)
kubectl describe pod my-pod | grep -A 5 Readiness

# 3. Selector matches labels
kubectl get svc my-service -o jsonpath='{.spec.selector}'
kubectl get pods --show-labels
```

## DNS Troubleshooting

```bash
# Check CoreDNS is running
kubectl get pods -n kube-system -l k8s-app=kube-dns

# Check CoreDNS logs
kubectl logs -n kube-system -l k8s-app=kube-dns

# Test DNS from pod
kubectl exec my-pod -- nslookup kubernetes.default.svc.cluster.local

# Check resolv.conf
kubectl exec my-pod -- cat /etc/resolv.conf

# Verify DNS service IP
kubectl get svc -n kube-system kube-dns

# Test external DNS
kubectl exec my-pod -- nslookup google.com
```

## Network Policy Debugging

```bash
# List network policies
kubectl get networkpolicies -A
kubectl describe networkpolicy my-policy

# Check if network policies are blocking traffic
# Deploy test pod in same namespace
kubectl run test-client -n my-namespace --image=busybox --rm -it -- wget -qO- http://my-service:8080

# Check from different namespace
kubectl run test-client -n other-namespace --image=busybox --rm -it -- wget -qO- http://my-service.my-namespace:8080

# Temporarily delete network policy to test
kubectl delete networkpolicy my-policy --dry-run=client -o yaml > policy-backup.yaml
kubectl delete networkpolicy my-policy
# Test connectivity
kubectl apply -f policy-backup.yaml
```

## Pod-to-Pod Connectivity

```bash
# Get pod IPs
kubectl get pods -o wide

# Test direct pod-to-pod connectivity
kubectl exec pod-a -- curl -v http://10.244.1.5:8080
kubectl exec pod-a -- nc -zv 10.244.1.5 8080

# Test across nodes
# Get pods on different nodes
kubectl get pods -o wide
# Test connectivity between them
kubectl exec pod-on-node1 -- ping 10.244.2.5  # Pod on node2
```

## Node Network Debugging

```bash
# Check node network
kubectl get nodes -o wide

# Debug from node (if SSH access available)
ssh node1
ip route
iptables -L -n -v
conntrack -L

# Check kube-proxy
kubectl get pods -n kube-system -l k8s-app=kube-proxy
kubectl logs -n kube-system -l k8s-app=kube-proxy

# Check CNI plugin pods
kubectl get pods -n kube-system | grep -E 'calico|cilium|weave|flannel'
kubectl logs -n kube-system <cni-pod-name>
```

## Ingress Debugging

```bash
# Check ingress resource
kubectl get ingress my-ingress
kubectl describe ingress my-ingress

# Check ingress controller logs
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller

# Test from inside cluster
kubectl run tmp --image=curlimages/curl --rm -it -- curl -v http://my-ingress-controller-service

# Check backend service
kubectl get svc my-backend-service
kubectl get endpoints my-backend-service

# Test with host header
curl -v -H "Host: myapp.example.com" http://<ingress-ip>/
```

## Tcpdump Packet Capture

```bash
# Capture packets in debug pod
kubectl exec -it netshoot -- tcpdump -i eth0 -n port 80

# Capture DNS traffic
kubectl exec -it netshoot -- tcpdump -i eth0 -n port 53

# Capture and save to file
kubectl exec -it netshoot -- tcpdump -i eth0 -w /tmp/capture.pcap
kubectl cp netshoot:/tmp/capture.pcap ./capture.pcap

# Filter by host
kubectl exec -it netshoot -- tcpdump -i eth0 -n host 10.244.1.5
```

## IPTables Debugging

```bash
# On the node (requires access)
# View NAT rules (service routing)
iptables -t nat -L -n -v | grep my-service

# View filter rules (network policies)
iptables -t filter -L -n -v

# Check KUBE-SERVICES chain
iptables -t nat -L KUBE-SERVICES -n -v

# Check specific service
iptables -t nat -L KUBE-SVC-<hash> -n -v
```

## Common Issues and Solutions

### Service Has No Endpoints

```bash
# Check pod readiness
kubectl get pods -l app=myapp
kubectl describe pod my-pod | grep -A 10 Conditions

# Fix: Check readiness probe
# Pod might be running but not ready
```

### DNS Resolution Fails

```bash
# Check CoreDNS
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns | grep -i error

# Fix: Restart CoreDNS
kubectl rollout restart deployment coredns -n kube-system
```

### Connection Refused

```bash
# Application not listening
kubectl exec my-pod -- netstat -tlnp
kubectl exec my-pod -- ss -tlnp

# Fix: Check application is bound to correct address (0.0.0.0 not 127.0.0.1)
```

### Connection Timeout

```bash
# Network policy blocking
kubectl get networkpolicies -n my-namespace

# Check if pods are on same network
kubectl get pods -o wide

# Check node connectivity
kubectl debug node/my-node -it --image=busybox -- ping other-node
```

## Connectivity Test Script

```bash
#!/bin/bash
# network-test.sh

SERVICE=$1
NAMESPACE=${2:-default}

echo "=== Service Info ==="
kubectl get svc $SERVICE -n $NAMESPACE

echo -e "\n=== Endpoints ==="
kubectl get endpoints $SERVICE -n $NAMESPACE

echo -e "\n=== DNS Test ==="
kubectl run dns-test --image=busybox --rm -it --restart=Never -- \
  nslookup $SERVICE.$NAMESPACE.svc.cluster.local

echo -e "\n=== Connectivity Test ==="
kubectl run conn-test --image=curlimages/curl --rm -it --restart=Never -- \
  curl -v --connect-timeout 5 http://$SERVICE.$NAMESPACE.svc.cluster.local

echo -e "\n=== Network Policies ==="
kubectl get networkpolicies -n $NAMESPACE
```

## Debug Checklist

```markdown
1. [ ] Service exists and has correct selector
2. [ ] Endpoints are populated
3. [ ] Pods are Running and Ready
4. [ ] DNS resolves correctly
5. [ ] No network policies blocking traffic
6. [ ] Application listening on correct port
7. [ ] Pod security context allows network access
8. [ ] CNI plugin is healthy
9. [ ] kube-proxy is running
10. [ ] No node-level firewall blocking
```

## Summary

Network debugging requires a systematic approach: verify service configuration and endpoints, test DNS resolution, check network policies, and examine connectivity at pod and node levels. Use debug pods with network tools like netshoot for comprehensive testing. Always check both the data plane (actual packet flow) and control plane (service/endpoint configuration).

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
