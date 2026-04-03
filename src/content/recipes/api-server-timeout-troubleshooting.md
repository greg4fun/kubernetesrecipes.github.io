---
title: "Fix API Server Timeout and Overload"
description: "Debug kubectl timeouts, API server overload, and connection refused errors. Covers etcd latency, webhook timeouts, and rate limiting."
category: "troubleshooting"
difficulty: "advanced"
publishDate: "2026-04-02"
tags: ["api-server", "timeout", "connectivity", "performance", "troubleshooting"]
author: "Luca Berton"
relatedRecipes:
  - "etcd-high-latency-troubleshooting"
  - "webhook-timeout-admission-errors"
---

> 💡 **Quick Answer:** Debug kubectl timeouts, API server connection refused errors, and slow API responses. Covers etcd latency, webhook timeouts, request throttling, and audit log impact.

## The Problem

This is a common issue in Kubernetes troubleshooting that catches both beginners and experienced operators.

## The Solution

### Step 1: Identify the Bottleneck

```bash
# Check API server response time
time kubectl get pods > /dev/null
# > 5s = problem

# Check API server health
kubectl get --raw /healthz
kubectl get --raw /readyz

# Check API server logs
kubectl logs -n kube-system kube-apiserver-master-0 --tail=100
```

### Step 2: Common Causes

**etcd latency:**
```bash
# Check etcd metrics
kubectl get --raw /metrics | grep etcd_request_duration_seconds
# If p99 > 1s, see etcd troubleshooting recipe
```

**Webhook timeouts:**
```bash
# List webhooks
kubectl get mutatingwebhookconfigurations
kubectl get validatingwebhookconfigurations

# A slow/down webhook blocks ALL API calls matching its rules
# Temporarily delete the problematic webhook
kubectl delete mutatingwebhookconfiguration slow-webhook
```

**Request throttling:**
```bash
# Check for throttling
kubectl get --raw /metrics | grep apiserver_dropped_requests_total
# Increase --max-requests-inflight and --max-mutating-requests-inflight
```

**Too many objects (large LIST calls):**
```bash
# Count objects by type
kubectl get --raw /metrics | grep apiserver_storage_objects
# If any type has >50K objects, use pagination:
kubectl get pods --chunk-size=500
```

### Step 3: Emergency — API Server Down

```bash
# If kubectl doesn't work at all, SSH to control plane node
ssh master-0

# Check API server container
crictl ps | grep kube-apiserver
crictl logs <container-id> --tail 50

# Restart API server (kubeadm)
mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/
sleep 10
mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/
```

## Best Practices

- **Monitor proactively** with Prometheus alerts before issues become incidents
- **Document runbooks** for your team's most common failure scenarios
- **Use `kubectl describe` and events** as your first debugging tool
- **Automate recovery** where possible with operators or scripts

## Key Takeaways

- Always check events and logs first — Kubernetes tells you what's wrong
- Most issues have clear error messages pointing to the root cause
- Prevention through monitoring and proper configuration beats reactive debugging
- Keep this recipe bookmarked for quick reference during incidents
