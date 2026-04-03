---
title: "Fix Ingress 502 and 503 Gateway Errors"
description: "Debug 502 Bad Gateway and 503 Service Unavailable from Kubernetes ingress controllers. Fix backend health and timeout issues."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-04-02"
tags: ["ingress", "nginx", "502", "503", "gateway", "troubleshooting"]
author: "Luca Berton"
relatedRecipes:
  - "ingress-routing"
  - "service-endpoints-not-ready"
  - "ingress-tls-certificates"
---

> 💡 **Quick Answer:** Debug 502 Bad Gateway and 503 Service Unavailable from Kubernetes ingress. Covers backend health checks, endpoint readiness, timeouts, and upstream connection issues.

## The Problem

This is a common issue in Kubernetes networking that catches both beginners and experienced operators.

## The Solution

### Step 1: Check Backend Pods

```bash
# Are backend pods ready?
kubectl get endpoints my-service
# Empty ENDPOINTS = no healthy backends = 503

# Check pod readiness
kubectl get pods -l app=myapp
# If 0/1 Ready, fix readiness probe
```

### Step 2: Check Ingress Controller Logs

```bash
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=100
# Look for "upstream connect error" or "no healthy upstream"
```

### Step 3: Common Fixes

**502 — backend crashed or wrong port:**
```yaml
# Ensure service port matches container port
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  ports:
    - port: 80
      targetPort: 8080  # Must match container port
```

**503 — no endpoints:**
```bash
# Check selector matches pod labels
kubectl describe service my-service
kubectl get pods --show-labels
```

**504 — timeout:**
```yaml
# Increase proxy timeouts
metadata:
  annotations:
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "30"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "120"
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
