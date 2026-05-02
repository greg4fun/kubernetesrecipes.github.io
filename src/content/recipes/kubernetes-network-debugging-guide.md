---
title: "K8s Network Debugging: Connectivity Guide"
description: "Debug Kubernetes network issues with tcpdump, netshoot, and connectivity tests. Pod-to-pod, pod-to-service, DNS, and external connectivity troubleshooting."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "networking"
  - "troubleshooting"
  - "debugging"
  - "dns"
  - "connectivity"
relatedRecipes:
  - "kubernetes-coredns-troubleshooting"
  - "kubernetes-networkpolicy-guide"
  - "debug-pod-networking"
  - "kubernetes-kubectl-debug-guide"
---

> 💡 **Quick Answer:** Quick network test: `kubectl run nettest --image=nicolaka/netshoot --rm -it -- bash`. Then: `ping <pod-ip>`, `curl <service>:port`, `nslookup <service>`, `traceroute <pod-ip>`. For packet capture: `kubectl debug -it <pod> --image=nicolaka/netshoot --target=<container> -- tcpdump -i eth0`. Check: DNS (CoreDNS), NetworkPolicy (egress/ingress rules), kube-proxy (iptables/ipvs), CNI plugin health.

## The Problem

Network issues in Kubernetes are hard to diagnose:

- Pod can't reach another pod
- Service returns connection refused
- External traffic doesn't reach the cluster
- Intermittent timeouts
- DNS resolution failures

## The Solution

### Quick Connectivity Test

```bash
# Launch a debug pod with network tools
kubectl run nettest --image=nicolaka/netshoot --rm -it -- bash

# Inside nettest pod:

# 1. DNS resolution
nslookup kubernetes.default
nslookup my-service.my-namespace.svc.cluster.local

# 2. Pod-to-service connectivity
curl -v http://my-service.my-namespace:8080/health
curl -v http://my-service:8080/health  # Same namespace

# 3. Pod-to-pod connectivity
ping 10.244.1.5                        # Pod IP
curl http://10.244.1.5:8080/health

# 4. External connectivity
curl -v https://google.com
dig google.com

# 5. Port scanning
nmap -p 8080 my-service.my-namespace

# 6. Route check
traceroute 10.244.2.10
mtr 10.244.2.10
```

### Packet Capture (tcpdump)

```bash
# Capture on a running pod using ephemeral container
kubectl debug -it my-pod --image=nicolaka/netshoot --target=my-container -- \
  tcpdump -i eth0 -nn port 8080

# Capture DNS traffic
kubectl debug -it my-pod --image=nicolaka/netshoot --target=my-container -- \
  tcpdump -i eth0 -nn port 53

# Capture and save to file
kubectl debug -it my-pod --image=nicolaka/netshoot --target=my-container -- \
  tcpdump -i eth0 -w /tmp/capture.pcap -c 1000

# Capture HTTP traffic
kubectl debug -it my-pod --image=nicolaka/netshoot --target=my-container -- \
  tcpdump -i eth0 -nn -A 'tcp port 8080 and (((ip[2:2] - ((ip[0]&0xf)<<2)) - ((tcp[12]&0xf0)>>2)) != 0)'
```

### Diagnose by Symptom

```bash
# SYMPTOM: "Connection refused"
# → Service port mapping wrong or pod not listening
kubectl get svc my-service -o yaml      # Check port/targetPort
kubectl get endpoints my-service         # Check endpoints exist
kubectl exec my-pod -- ss -tlnp         # Check listening ports

# SYMPTOM: "Connection timed out"
# → NetworkPolicy blocking, node firewall, or pod not running
kubectl get networkpolicy -n my-namespace
kubectl describe networkpolicy <name>
# Test: create allow-all policy temporarily

# SYMPTOM: "No route to host"
# → CNI plugin issue, node network problem
kubectl get pods -n kube-system -l k8s-app=calico-node  # Or cilium, flannel
kubectl logs -n kube-system <cni-pod> --tail=50

# SYMPTOM: "DNS resolution failed"
# → CoreDNS issue
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50
kubectl exec my-pod -- cat /etc/resolv.conf
```

### Check kube-proxy and Services

```bash
# kube-proxy mode
kubectl get configmap kube-proxy -n kube-system -o yaml | grep mode
# mode: iptables  (or ipvs)

# Check iptables rules for a Service
# SSH to node:
iptables -t nat -L KUBE-SERVICES | grep my-service
iptables -t nat -L KUBE-SVC-XXXXX        # Service chain

# Or for IPVS
ipvsadm -Ln | grep <ClusterIP>

# Check if endpoints are programmed
kubectl get endpoints my-service
# NAME         ENDPOINTS                          AGE
# my-service   10.244.1.5:8080,10.244.2.3:8080   5d

# No endpoints? Labels don't match
kubectl get pods -l app=myapp             # Service selector
kubectl get svc my-service -o jsonpath='{.spec.selector}'
```

### NetworkPolicy Debugging

```bash
# List all policies in namespace
kubectl get networkpolicy -n my-namespace

# Describe policy details
kubectl describe networkpolicy default-deny -n my-namespace

# Temporarily allow all (for testing)
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-all-temp
  namespace: my-namespace
spec:
  podSelector: {}
  ingress:
  - {}
  egress:
  - {}
  policyTypes:
  - Ingress
  - Egress
EOF

# Test connectivity
# If it works → NetworkPolicy was blocking

# Clean up
kubectl delete networkpolicy allow-all-temp -n my-namespace
```

### CNI Plugin Health

```bash
# Check CNI pods
kubectl get pods -n kube-system | grep -E 'calico|cilium|flannel|weave'

# Calico
kubectl get pods -n calico-system
calicoctl node status           # If calicoctl installed

# Cilium
cilium status                   # If cilium CLI installed
kubectl exec -n kube-system cilium-xxxxx -- cilium status

# Check node-to-node connectivity
kubectl get nodes -o wide       # Get node IPs
# SSH to node1, ping node2's pod CIDR
ping 10.244.2.1                 # Pod network on node2
```

### Full Debugging Flowchart

```
Can pod reach another pod?
├── No → Check CNI, node connectivity, NetworkPolicy
│
├── Can pod reach Service ClusterIP?
│   ├── No → Check endpoints, kube-proxy, Service selector
│   │
│   ├── Can pod resolve Service DNS?
│   │   ├── No → Check CoreDNS, /etc/resolv.conf
│   │   └── Yes → Check port/targetPort mapping
│   │
│   └── Yes → Service works ✅
│
└── Yes → Pod networking works ✅

External traffic not reaching pods?
├── Check Ingress/LoadBalancer configuration
├── Check cloud LB health checks
├── Check NodePort firewall rules
└── Check ExternalTrafficPolicy (Local vs Cluster)
```

## Common Issues

**Pod can reach ClusterIP but not Service name**

DNS issue. Check CoreDNS pods and `/etc/resolv.conf` in the pod.

**Intermittent connection timeouts**

Possible causes: conntrack table full, DNS timeout (ndots:5), or node network flapping. Check `dmesg` on nodes for conntrack errors.

**ExternalTrafficPolicy: Local drops traffic**

No backend pods on the node receiving traffic. Use `Cluster` (default) or ensure pods on all nodes (DaemonSet).

## Best Practices

- **nicolaka/netshoot as your debug image** — has every network tool
- **Check the basics first** — DNS, endpoints, service selector labels
- **Temporarily remove NetworkPolicy** to isolate the issue
- **Use `kubectl debug`** for packet capture — no image modification needed
- **Check events** — `kubectl get events --sort-by='.lastTimestamp'`

## Key Takeaways

- Start debugging with: DNS → endpoints → connectivity → NetworkPolicy
- `nicolaka/netshoot` is the Swiss Army knife for K8s network debugging
- `kubectl debug` with `--target` enables tcpdump on any pod
- Most "connection refused" errors are port mapping or missing endpoints
- Most "timeout" errors are NetworkPolicy or CNI issues
