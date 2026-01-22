---
title: "NetworkPolicy: Default Deny All Traffic"
description: "Implement a zero-trust network security model in Kubernetes by creating a default deny-all NetworkPolicy. Learn how to block all ingress and egress traffic and selectively allow what you need."
category: "networking"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.25+"
prerequisites:
  - "A Kubernetes cluster with a CNI that supports NetworkPolicies (Calico, Cilium, Weave)"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "nginx-ingress-tls-cert-manager"
tags:
  - networkpolicy
  - security
  - zero-trust
  - networking
publishDate: "2026-01-20"
author: "Luca Berton"
---

## The Problem

By default, Kubernetes allows all pods to communicate with each other without restrictions. This violates the principle of least privilege and can be a security risk.

## The Solution

Create a default deny-all NetworkPolicy in each namespace, then explicitly allow only the traffic you need.

## Step 1: Verify NetworkPolicy Support

First, check if your cluster's CNI supports NetworkPolicies:

```bash
# Check the CNI being used
kubectl get pods -n kube-system | grep -E "calico|cilium|weave"
```

> **Note:** Some CNIs like Flannel do NOT support NetworkPolicies. Consider using Calico or Cilium.

## Step 2: Create Default Deny-All Policy

This policy denies all ingress AND egress traffic for pods in the namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: my-namespace
spec:
  podSelector: {}  # Applies to all pods in namespace
  policyTypes:
    - Ingress
    - Egress
```

Apply it:

```bash
kubectl apply -f default-deny-all.yaml
```

## Step 3: Allow Specific Traffic

Now create policies to allow only necessary traffic.

### Allow DNS (Required)

Pods need to reach CoreDNS for name resolution:

```yaml
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

### Allow Traffic Between Specific Pods

Allow frontend pods to reach backend pods:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: my-namespace
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

### Allow External Egress

Allow pods to reach external services:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-external-egress
  namespace: my-namespace
spec:
  podSelector:
    matchLabels:
      app: api-gateway
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - protocol: TCP
          port: 443
```

## Testing NetworkPolicies

### Deploy Test Pods

```bash
# Create a test namespace
kubectl create namespace netpol-test

# Deploy test pods
kubectl run client --image=busybox -n netpol-test -- sleep 3600
kubectl run server --image=nginx -n netpol-test
kubectl expose pod server --port=80 -n netpol-test
```

### Test Connectivity Before Policy

```bash
kubectl exec -n netpol-test client -- wget -qO- --timeout=2 http://server
# Should return nginx welcome page
```

### Apply Deny-All and Test Again

```bash
# Apply default deny
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: netpol-test
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
EOF

# Test again - should timeout
kubectl exec -n netpol-test client -- wget -qO- --timeout=2 http://server
# wget: download timed out
```

## Common Issues

### Pods can't resolve DNS

You forgot to allow DNS egress. Apply the "allow-dns" policy.

### Policy not being enforced

Check if your CNI supports NetworkPolicies:

```bash
# Create a test policy and verify
kubectl describe networkpolicy default-deny-all -n my-namespace
```

### Need to allow traffic from Ingress Controller

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-controller
  namespace: my-namespace
spec:
  podSelector:
    matchLabels:
      app: my-web-app
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
```

## Complete Example

Here's a complete setup for a typical 3-tier application:

```yaml
---
# 1. Default deny all
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: my-app
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
# 2. Allow DNS for all pods
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: my-app
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
---
# 3. Allow ingress to frontend from ingress controller
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-to-frontend
  namespace: my-app
spec:
  podSelector:
    matchLabels:
      tier: frontend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
---
# 4. Allow frontend to backend
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: my-app
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              tier: frontend
      ports:
        - protocol: TCP
          port: 8080
---
# 5. Allow backend to database
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backend-to-database
  namespace: my-app
spec:
  podSelector:
    matchLabels:
      tier: database
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              tier: backend
      ports:
        - protocol: TCP
          port: 5432
```

## Summary

You've learned how to:

1. Create a default deny-all NetworkPolicy
2. Allow DNS resolution for pods
3. Allow specific pod-to-pod communication
4. Test NetworkPolicy enforcement

Always start with deny-all and add allow rules incrementally.

## References

- [Kubernetes NetworkPolicy Documentation](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Network Policy Editor](https://editor.networkpolicy.io/)
