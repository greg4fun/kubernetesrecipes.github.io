---
title: "Network Debugging Tools Kubernetes"
description: "Debug Kubernetes networking with tcpdump, netshoot, iptables tracing, conntrack inspection, and DNS resolution testing techniques."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "networking"
  - "tcpdump"
  - "debug"
  - "conntrack"
  - "dns"
relatedRecipes:
  - "kubernetes-exec-into-pod"
  - "kubernetes-dns-debugging-guide"
  - "kubernetes-debug-pods"
  - "kubernetes-networkpolicy-zero-trust"
  - "nxdomain-dns-troubleshooting-kubernetes"
  - "kubernetes-coredns-troubleshooting"
---

> 💡 **Quick Answer:** Deploy `nicolaka/netshoot` as an ephemeral container or debug pod. Use `tcpdump -i eth0 -w capture.pcap` for packet capture, `conntrack -L` for NAT table inspection, and `nslookup svc.namespace.svc.cluster.local` for DNS verification.

## The Problem

Service-to-service communication fails, but `kubectl get svc` shows endpoints are healthy. The problem could be anywhere: DNS resolution, iptables/IPVS rules, NetworkPolicy, CNI, or the application itself. You need a systematic debugging approach.

## The Solution

### Systematic Debugging Workflow

```bash
# Step 1: DNS resolution
kubectl run debug --rm -it --image=nicolaka/netshoot -- \
  nslookup backend-svc.production.svc.cluster.local

# Step 2: TCP connectivity
kubectl run debug --rm -it --image=nicolaka/netshoot -- \
  curl -v --connect-timeout 5 http://backend-svc.production:8080/health

# Step 3: Packet capture (ephemeral container)
kubectl debug -it failing-pod --image=nicolaka/netshoot --target=app -- \
  tcpdump -i eth0 -n host 10.96.0.10 -w /tmp/capture.pcap

# Step 4: Conntrack inspection (on node)
kubectl debug node/worker-1 -it --image=nicolaka/netshoot -- \
  conntrack -L -d 10.96.100.50

# Step 5: iptables trace (on node)
kubectl debug node/worker-1 -it --image=nicolaka/netshoot -- bash -c \
  'iptables -t raw -A PREROUTING -p tcp --dport 8080 -j TRACE && \
   iptables -t raw -A OUTPUT -p tcp --dport 8080 -j TRACE && \
   dmesg -w | grep TRACE'
```

### Common Commands

| Tool | Command | Purpose |
|------|---------|---------|
| nslookup | `nslookup svc.ns.svc.cluster.local` | DNS resolution |
| curl | `curl -v http://svc:port/path` | HTTP connectivity |
| tcpdump | `tcpdump -i eth0 -n port 8080` | Packet capture |
| ss | `ss -tlnp` | Listening ports |
| conntrack | `conntrack -L -d <ClusterIP>` | NAT table entries |
| ip | `ip route show` | Routing table |
| traceroute | `traceroute -T -p 8080 target` | Path tracing |

```mermaid
graph TD
    START[Connection fails] --> DNS{DNS resolves?}
    DNS -->|No| FIX_DNS[Check CoreDNS pods<br/>Check NetworkPolicy DNS egress]
    DNS -->|Yes| TCP{TCP connects?}
    TCP -->|No| FIX_NET[Check iptables/IPVS<br/>Check NetworkPolicy<br/>Check endpoints]
    TCP -->|Yes| HTTP{HTTP responds?}
    HTTP -->|No| FIX_APP[Check pod logs<br/>Check readiness probe<br/>Check container port]
    HTTP -->|Yes| OK[✅ Working]
```

### Inspecting the Service Layer (kube-proxy)

When DNS resolves and the ClusterIP exists but traffic still doesn't reach a pod, the fault is usually in how kube-proxy programmed the Service, or that the Service has no endpoints at all:

```bash
# No endpoints means the Service selector doesn't match any pod's labels
kubectl get endpoints my-service
kubectl get pods -l app=myapp                          # does this match the Service selector?
kubectl get svc my-service -o jsonpath='{.spec.selector}'

# Check kube-proxy's mode, then inspect the corresponding rules on the node
kubectl get configmap kube-proxy -n kube-system -o yaml | grep mode
# iptables mode:
iptables -t nat -L KUBE-SERVICES | grep my-service
# IPVS mode:
ipvsadm -Ln | grep <ClusterIP>
```

### CNI Plugin Health

If pod-to-pod connectivity fails even before DNS/Service routing comes into play, check the CNI itself:

```bash
kubectl get pods -n kube-system | grep -E 'calico|cilium|flannel|weave'

# Calico
calicoctl node status
# Cilium
cilium status

# Node-to-node pod network reachability
kubectl get nodes -o wide
ping <other-node-pod-cidr-ip>   # from one node to another node's pod subnet
```

### Isolate NetworkPolicy as the Cause

Temporarily replacing all policies in a namespace with an allow-all rule is the fastest way to confirm (or rule out) NetworkPolicy as the blocker:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-all-temp, namespace: my-namespace}
spec:
  podSelector: {}
  ingress: [{}]
  egress: [{}]
  policyTypes: [Ingress, Egress]
EOF
# If connectivity now works, a NetworkPolicy was the cause — narrow it down from there
kubectl delete networkpolicy allow-all-temp -n my-namespace
```

## Common Issues

**DNS resolves but curl times out**

iptables rules or NetworkPolicy blocking traffic. Check: `kubectl get networkpolicy -n production` and verify the policy allows ingress on the target port.

**Intermittent connection failures**

Likely conntrack table exhaustion. Check: `conntrack -C` (count) vs `sysctl net.netfilter.nf_conntrack_max`. Increase max if near limit.

## Best Practices

- **Always start with DNS** — 50% of K8s networking issues are DNS-related
- **Use `nicolaka/netshoot`** — has every networking tool pre-installed
- **Capture packets on both sides** — source and destination pods
- **Check NetworkPolicy first** — the most common cause of blocked traffic after DNS
- **`conntrack -L`** reveals NAT issues — stale entries cause intermittent failures

## Key Takeaways

- Systematic debugging: DNS → TCP → HTTP → Application
- netshoot container has all tools: tcpdump, curl, dig, ss, conntrack, iperf
- 50% of connectivity issues are DNS — always start there
- NetworkPolicy is the #2 cause — check for missing egress/ingress rules
- Conntrack exhaustion causes intermittent failures — monitor `nf_conntrack_count`
