---
title: "Migrate from externalIPs in Kubernetes 1.36"
description: "Service externalIPs are deprecated in Kubernetes 1.36 due to CVE-2020-8554. Migrate to Gateway API, LoadBalancer services, or MetalLB for external access."
tags:
  - "kubernetes-1.36"
  - "deprecation"
  - "networking"
  - "gateway-api"
  - "migration"
category: "networking"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-1-36-oci-volume-source"
  - "kubernetes-1-36-selinux-mount-labeling"
  - "kubernetes-gateway-api-guide"
  - "kubernetes-service-types"
  - "kubernetes-load-balancing"
---

> 💡 **Quick Answer:** `.spec.externalIPs` on Services is **deprecated in Kubernetes 1.36** due to CVE-2020-8554 (man-in-the-middle vulnerability). Migrate to Gateway API, LoadBalancer Services, or MetalLB for external traffic routing.

## The Problem

`externalIPs` allows any user with Service create permissions to **hijack traffic to any IP address** in the cluster. This is CVE-2020-8554:

```yaml
# ❌ DEPRECATED - Security vulnerability
apiVersion: v1
kind: Service
metadata:
  name: hijack-service
spec:
  externalIPs:
    - "10.0.0.1"    # Could be any cluster IP, including the API server!
  ports:
    - port: 443
  selector:
    app: attacker-pod
```

An attacker with Service creation rights can redirect traffic meant for `10.0.0.1` to their own Pod. This has been a known vulnerability since 2020.

## The Solution

### Option 1: Gateway API (Recommended)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: external-gateway
spec:
  gatewayClassName: cilium    # or istio, nginx, etc.
  listeners:
    - name: http
      port: 80
      protocol: HTTP
      allowedRoutes:
        namespaces:
          from: Same
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app-route
spec:
  parentRefs:
    - name: external-gateway
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: app-service
          port: 8080
```

### Option 2: LoadBalancer Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: app-service
  annotations:
    # Cloud-specific annotations for static IP
    service.beta.kubernetes.io/aws-load-balancer-eip-allocations: "eipalloc-abc123"
    # Or for GKE:
    # networking.gke.io/load-balancer-ip-addresses: "my-static-ip"
spec:
  type: LoadBalancer
  # loadBalancerIP: 203.0.113.10    # Static IP (deprecated but still works)
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: my-app
```

### Option 3: MetalLB (Bare Metal)

```yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: external-pool
  namespace: metallb-system
spec:
  addresses:
    - 192.168.1.200-192.168.1.250
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: external-l2
  namespace: metallb-system
spec:
  ipAddressPools:
    - external-pool
---
apiVersion: v1
kind: Service
metadata:
  name: app-service
spec:
  type: LoadBalancer
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: my-app
```

### Find Affected Services

```bash
# Find services using externalIPs
kubectl get svc -A -o json | jq -r '
  .items[] |
  select(.spec.externalIPs != null and (.spec.externalIPs | length > 0)) |
  "\(.metadata.namespace)/\(.metadata.name): \(.spec.externalIPs)"'

# Search in manifests
grep -rn "externalIPs:" manifests/ charts/ k8s/
```

## Common Issues

### No LoadBalancer controller in bare-metal clusters
- **Cause**: LoadBalancer type requires a controller (cloud LB or MetalLB)
- **Fix**: Install MetalLB or use Gateway API with an ingress controller

### Deprecation warning in logs
- **Cause**: Services still using externalIPs field
- **Fix**: Migrate to alternatives above; field will be removed in a future release

## Best Practices

1. **Audit all Services** for `externalIPs` usage before upgrading
2. **Use Gateway API** — it's the Kubernetes-native successor to Ingress and externalIPs
3. **Deploy MetalLB** for bare-metal clusters needing external IP assignment
4. **Restrict Service creation** with RBAC — mitigate CVE-2020-8554 risk in older clusters
5. **Use admission webhooks** to block externalIPs until fully migrated

## Key Takeaways

- `externalIPs` is **deprecated in Kubernetes 1.36** due to CVE-2020-8554
- Any user with Service creation rights could hijack cluster traffic
- Gateway API is the recommended migration path
- MetalLB replaces externalIPs for bare-metal LoadBalancer services
- Search your manifests for `externalIPs:` before upgrading to 1.36
