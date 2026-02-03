---
title: "How to Debug Kubernetes Node Issues"
description: "Diagnose and troubleshoot node problems in Kubernetes clusters. Identify resource pressure, connectivity issues, and component failures."
category: "troubleshooting"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["nodes", "debugging", "troubleshooting", "kubelet", "resources"]
---

> **💡 Quick Answer:** Check node status with `kubectl get nodes` and `kubectl describe node <name>`. Look for conditions: `Ready=False` (kubelet issue), `MemoryPressure`, `DiskPressure`, or `PIDPressure`. SSH to node and check `systemctl status kubelet`, `journalctl -u kubelet`, and `df -h` for disk space. Drain problematic nodes: `kubectl drain <node> --ignore-daemonsets`.

# How to Debug Kubernetes Node Issues

Node issues can cause pod scheduling failures, evictions, and cluster instability. Learn to diagnose resource pressure, connectivity problems, and component failures.

## Check Node Status

```bash
# List all nodes with status
kubectl get nodes

# Detailed node information
kubectl describe node <node-name>

# Get node conditions
kubectl get nodes -o custom-columns=\
'NAME:.metadata.name,STATUS:.status.conditions[?(@.type=="Ready")].status,REASON:.status.conditions[?(@.type=="Ready")].reason'

# Watch node status changes
kubectl get nodes -w
```

## Node Conditions

```bash
# Key conditions to monitor:
kubectl get node <node> -o jsonpath='{.status.conditions[*]}' | jq

# Conditions:
# Ready         - Node is healthy and accepting pods
# MemoryPressure - Node low on memory
# DiskPressure   - Node low on disk space
# PIDPressure    - Too many processes on node
# NetworkUnavailable - Node network not configured

# Check specific condition
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[?(@.type=="MemoryPressure")].status}{"\n"}{end}'
```

## Resource Usage

```bash
# Node resource usage
kubectl top nodes

# Detailed resource info
kubectl describe node <node> | grep -A 10 "Allocated resources"

# Check allocatable vs capacity
kubectl get node <node> -o jsonpath='{.status.capacity}'
kubectl get node <node> -o jsonpath='{.status.allocatable}'

# Find resource-intensive pods
kubectl top pods -A --sort-by=cpu
kubectl top pods -A --sort-by=memory
```

## Disk Pressure

```bash
# Check disk usage on node
kubectl debug node/<node> -it --image=busybox -- df -h

# Or SSH to node
ssh <node>
df -h
du -sh /var/lib/kubelet/*
du -sh /var/lib/docker/*
du -sh /var/log/*

# Clean up docker/containerd
docker system prune -a  # If using docker
crictl rmi --prune     # If using containerd

# Check kubelet garbage collection thresholds
kubectl get node <node> -o jsonpath='{.status.nodeInfo.kubeletVersion}'
# Check kubelet config for image/container GC settings
```

## Memory Pressure

```bash
# Check memory usage on node
kubectl debug node/<node> -it --image=busybox -- free -m

# Find memory-hungry containers
kubectl top pods -A --sort-by=memory | head -20

# Check for OOM events
kubectl get events -A --field-selector reason=OOMKilling

# On the node
dmesg | grep -i "out of memory"
journalctl -u kubelet | grep -i oom
```

## Network Issues

```bash
# Check node network status
kubectl get node <node> -o jsonpath='{.status.conditions[?(@.type=="NetworkUnavailable")]}'

# Test pod networking from node
kubectl debug node/<node> -it --image=nicolaka/netshoot -- bash

# Inside debug container:
ping 10.96.0.1        # Kubernetes API service
nslookup kubernetes.default
curl -k https://kubernetes.default.svc/healthz

# Check CNI plugin logs
journalctl -u kubelet | grep -i cni
ls -la /etc/cni/net.d/
ls -la /opt/cni/bin/
```

## Kubelet Issues

```bash
# Check kubelet status
systemctl status kubelet

# View kubelet logs
journalctl -u kubelet -f
journalctl -u kubelet --since "10 minutes ago"

# Check kubelet configuration
cat /var/lib/kubelet/config.yaml
cat /etc/kubernetes/kubelet.conf

# Restart kubelet
sudo systemctl restart kubelet

# Check kubelet health
curl -sk https://localhost:10250/healthz
```

## Container Runtime Issues

```bash
# Check container runtime status
systemctl status containerd  # or docker

# View runtime logs
journalctl -u containerd -f

# List containers on node
crictl ps -a        # containerd
docker ps -a        # docker

# Check runtime socket
ls -la /run/containerd/containerd.sock
crictl info

# Inspect failing container
crictl inspect <container-id>
crictl logs <container-id>
```

## Node Not Ready

```bash
# Diagnose NotReady node
kubectl describe node <node> | grep -A 20 Conditions

# Common causes:
# 1. Kubelet not running
# 2. Container runtime failure
# 3. Network plugin issues
# 4. Certificate expiry

# Check kubelet certificate
openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -text -noout | grep -A 2 Validity

# Check API server connectivity from node
curl -k https://<api-server>:6443/healthz

# Check required services
systemctl status kubelet containerd
```

## Node Events

```bash
# View node events
kubectl get events --field-selector involvedObject.kind=Node,involvedObject.name=<node>

# All events sorted by time
kubectl get events --sort-by='.lastTimestamp' | grep <node>

# Watch for new events
kubectl get events -w --field-selector involvedObject.name=<node>
```

## Debug with Node Shell

```bash
# Access node filesystem
kubectl debug node/<node> -it --image=busybox

# Or with more tools
kubectl debug node/<node> -it --image=nicolaka/netshoot

# Inside the debug pod, node root is at /host
chroot /host
# Now you have full node access

# Check system logs
cat /host/var/log/syslog
journalctl -u kubelet
```

## Drain and Cordon

```bash
# Prevent new pods on node
kubectl cordon <node>

# Safely evict pods and cordon
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data

# Remove cordon
kubectl uncordon <node>

# Check if node is schedulable
kubectl get node <node> -o jsonpath='{.spec.unschedulable}'
```

## Node Taints

```bash
# Check node taints
kubectl describe node <node> | grep Taints

# Common automatic taints:
# node.kubernetes.io/not-ready
# node.kubernetes.io/unreachable
# node.kubernetes.io/memory-pressure
# node.kubernetes.io/disk-pressure
# node.kubernetes.io/pid-pressure
# node.kubernetes.io/network-unavailable
# node.kubernetes.io/unschedulable

# Remove taint
kubectl taint nodes <node> node.kubernetes.io/disk-pressure:NoSchedule-
```

## Resource Monitoring

```bash
# Install node-problem-detector for automatic issue detection
kubectl apply -f https://raw.githubusercontent.com/kubernetes/node-problem-detector/master/deployment/node-problem-detector.yaml

# Check detected problems
kubectl get events --field-selector source=node-problem-detector

# Prometheus queries for node health
# Node CPU usage
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# Node memory usage
(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100

# Node disk usage
(node_filesystem_size_bytes - node_filesystem_avail_bytes) / node_filesystem_size_bytes * 100
```

## Common Issues Checklist

```markdown
□ Node NotReady
  - Check kubelet: systemctl status kubelet
  - Check container runtime: systemctl status containerd
  - Check certificates: openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -dates

□ Disk Pressure
  - Clean container images: crictl rmi --prune
  - Clear logs: journalctl --vacuum-size=1G
  - Check large files: du -sh /var/lib/*

□ Memory Pressure
  - Find memory-hungry pods: kubectl top pods -A --sort-by=memory
  - Check for OOM: dmesg | grep -i oom
  - Adjust kubelet eviction thresholds

□ Network Issues
  - Check CNI: ls /etc/cni/net.d/
  - Test DNS: nslookup kubernetes.default
  - Check kube-proxy: kubectl logs -n kube-system -l k8s-app=kube-proxy
```

## Summary

Node troubleshooting starts with checking node status and conditions via `kubectl describe node`. Investigate specific issues: disk pressure (clean images/logs), memory pressure (find hungry pods, check OOM), network issues (verify CNI and connectivity). Use `kubectl debug node/<node>` for node-level access. Check kubelet and container runtime logs with `journalctl`. Use `kubectl drain` to safely evacuate nodes for maintenance. Monitor node health proactively with metrics and alerting on conditions.

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
