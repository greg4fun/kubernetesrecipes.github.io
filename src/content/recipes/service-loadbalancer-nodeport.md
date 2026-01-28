---
title: "How to Expose Services with LoadBalancer and NodePort"
description: "Learn different ways to expose Kubernetes services externally using LoadBalancer, NodePort, and ExternalIPs. Compare options for various environments."
category: "networking"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "nginx-ingress-tls-cert-manager"
  - "networkpolicy-deny-all"
tags:
  - service
  - loadbalancer
  - nodeport
  - networking
  - expose
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You need to expose your Kubernetes application to external traffic, but you're unsure which service type to use.

## Service Types Comparison

| Type | Use Case | External Access | Port Range |
|------|----------|-----------------|------------|
| ClusterIP | Internal only | No | Any |
| NodePort | Development/Testing | Node IP:Port | 30000-32767 |
| LoadBalancer | Production (cloud) | External IP | Any |
| ExternalName | DNS alias | N/A | N/A |

## ClusterIP (Default)

Internal access only:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  type: ClusterIP  # Default, can be omitted
  ports:
  - port: 80
    targetPort: 8080
  selector:
    app: myapp
```

Access from within cluster:
```bash
curl http://myapp.default.svc.cluster.local
```

## NodePort

Exposes service on each node's IP at a static port:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-nodeport
spec:
  type: NodePort
  ports:
  - port: 80           # Service port (internal)
    targetPort: 8080   # Container port
    nodePort: 30080    # External port (optional, auto-assigned if omitted)
  selector:
    app: myapp
```

Access from external:
```bash
curl http://<node-ip>:30080
```

Get node IPs:
```bash
kubectl get nodes -o wide
```

### NodePort Considerations

✅ **Pros:**
- Works without cloud provider
- Simple to set up

❌ **Cons:**
- Limited port range (30000-32767)
- Need to know node IPs
- No load balancing across nodes

## LoadBalancer

Provisions an external load balancer (cloud providers):

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-lb
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 8080
  selector:
    app: myapp
```

Check external IP:
```bash
kubectl get svc myapp-lb
# NAME       TYPE           EXTERNAL-IP     PORT(S)
# myapp-lb   LoadBalancer   34.123.45.67    80:31234/TCP
```

### Cloud-Specific Annotations

**AWS:**
```yaml
metadata:
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: nlb
    service.beta.kubernetes.io/aws-load-balancer-internal: "true"
```

**GCP:**
```yaml
metadata:
  annotations:
    cloud.google.com/load-balancer-type: Internal
```

**Azure:**
```yaml
metadata:
  annotations:
    service.beta.kubernetes.io/azure-load-balancer-internal: "true"
```

### LoadBalancer on Bare Metal

Use MetalLB for LoadBalancer support on bare metal:

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.13.12/config/manifests/metallb-native.yaml
```

Configure IP pool:
```yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: default-pool
  namespace: metallb-system
spec:
  addresses:
  - 192.168.1.240-192.168.1.250
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: default
  namespace: metallb-system
```

## ExternalName

Creates a DNS alias:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  type: ExternalName
  externalName: database.example.com
```

Now pods can access `external-db` which resolves to `database.example.com`.

## External IPs

Expose on specific external IPs:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-external
spec:
  ports:
  - port: 80
    targetPort: 8080
  externalIPs:
  - 192.168.1.100
  selector:
    app: myapp
```

## Multiple Ports

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-multi
spec:
  type: LoadBalancer
  ports:
  - name: http
    port: 80
    targetPort: 8080
  - name: https
    port: 443
    targetPort: 8443
  - name: grpc
    port: 9090
    targetPort: 9090
  selector:
    app: myapp
```

## Session Affinity

Route same client to same pod:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-sticky
spec:
  type: LoadBalancer
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 3600
  ports:
  - port: 80
    targetPort: 8080
  selector:
    app: myapp
```

## Health Check Configuration

For LoadBalancer health checks:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-lb
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-path: /health
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-interval: "30"
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 8080
  selector:
    app: myapp
```

## Troubleshooting

### LoadBalancer Stuck in Pending

```bash
kubectl describe svc myapp-lb
```

Common causes:
- No cloud provider configured
- Quota exceeded
- Network misconfiguration

### Service Not Reachable

```bash
# Check endpoints
kubectl get endpoints myapp

# Should show pod IPs
# NAME    ENDPOINTS
# myapp   10.1.0.5:8080,10.1.0.6:8080
```

If empty, check selector labels:
```bash
kubectl get pods --show-labels
```

### Test from Inside Cluster

```bash
kubectl run test --rm -it --image=curlimages/curl -- curl http://myapp
```

## Decision Flow

```
Need external access?
├─ No → ClusterIP
└─ Yes
   ├─ Cloud provider available?
   │  ├─ Yes → LoadBalancer
   │  └─ No → NodePort or Ingress + MetalLB
   └─ Development/Testing?
      └─ Yes → NodePort
```

## Key Takeaways

- Use ClusterIP for internal services
- NodePort for quick testing (limited ports)
- LoadBalancer for production with cloud providers
- Consider Ingress for HTTP/HTTPS routing
- Use MetalLB for LoadBalancer on bare metal

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
