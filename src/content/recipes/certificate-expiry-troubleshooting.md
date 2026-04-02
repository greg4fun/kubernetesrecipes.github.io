---
title: "Fix Kubernetes Certificate Expiry Issues"
description: "Debug and renew expired Kubernetes certificates for API server, kubelet, and etcd. Covers kubeadm cert renewal, OpenShift auto-rotation, and monitoring expiry."
category: "security"
difficulty: "advanced"
publishDate: "2026-04-02"
tags: ["certificates", "tls", "expiry", "kubeadm", "troubleshooting"]
author: "Luca Berton"
relatedRecipes:
  - "cert-manager-certificates"
  - "kubelet-not-ready-troubleshooting"
---

> 💡 **Quick Answer:** Debug and renew expired Kubernetes certificates for API server, kubelet, and etcd. Covers kubeadm cert renewal, OpenShift auto-rotation, and monitoring expiry.

## The Problem

This is a common issue in Kubernetes security that catches both beginners and experienced operators.

## The Solution

### Step 1: Check Certificate Expiry

```bash
# kubeadm clusters
kubeadm certs check-expiration

# OpenShift
oc get csr | head -20
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates

# Check all certs
find /etc/kubernetes/pki -name "*.crt" -exec sh -c 'echo "=== {} ===" && openssl x509 -in {} -noout -dates' \;
```

### Step 2: Renew Certificates

**kubeadm (Kubernetes):**
```bash
# Renew all certificates
kubeadm certs renew all

# Restart control plane components
systemctl restart kubelet
# Wait for API server, controller-manager, scheduler to restart
```

**OpenShift (auto-rotation):**
```bash
# Approve pending CSRs
oc get csr | grep Pending | awk '{print $1}' | xargs oc adm certificate approve

# Force certificate rotation
oc delete secret kubelet-serving -n openshift-kube-apiserver
```

### Step 3: Monitor Expiry

```yaml
# Prometheus alert
- alert: KubernetesCertExpiringSoon
  expr: |
    apiserver_client_certificate_expiration_seconds_count > 0
    and apiserver_client_certificate_expiration_seconds_bucket{le="604800"} > 0
  for: 1h
  labels:
    severity: warning
  annotations:
    summary: Client certificate expires within 7 days
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
