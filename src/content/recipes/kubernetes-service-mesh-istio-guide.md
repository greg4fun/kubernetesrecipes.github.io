---
title: "Istio Service Mesh: Traffic Management"
description: "Deploy Istio service mesh in Kubernetes for traffic management, mTLS, observability, and canary deployments. VirtualService, DestinationRule, and Gateway configuration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "istio"
  - "service-mesh"
  - "networking"
  - "traffic-management"
  - "mtls"
relatedRecipes:
  - "kubernetes-networkpolicy-guide"
  - "kubernetes-ingress-nginx-guide"
  - "kubernetes-cert-manager-guide"
  - "kubernetes-linkerd-service-mesh-guide"
  - "kubernetes-cilium-networking-guide"
---

> 💡 **Quick Answer:** Istio injects sidecar proxies (Envoy) alongside your containers to handle traffic management, security (mTLS), and observability. Install: `istioctl install --set profile=demo`. Enable injection: `kubectl label namespace default istio-injection=enabled`. Route traffic with `VirtualService`, configure load balancing with `DestinationRule`, expose externally with `Gateway`.

## The Problem

Microservices communication needs:

- Encrypted traffic between services (mTLS)
- Canary deployments and traffic splitting
- Circuit breaking and retries
- Distributed tracing and metrics
- Rate limiting and access control

All without changing application code.

## The Solution

### Install Istio

```bash
# Download istioctl
curl -L https://istio.io/downloadIstio | sh -
export PATH=$PWD/istio-1.21.0/bin:$PATH

# Install with demo profile
istioctl install --set profile=demo -y
# Profiles: minimal, default, demo, empty

# Enable sidecar injection for namespace
kubectl label namespace default istio-injection=enabled

# Verify
kubectl get pods -n istio-system
# istiod-xxx             Running   (control plane)
# istio-ingressgateway   Running   (ingress)

# Deploy test app
kubectl apply -f samples/bookinfo/platform/kube/bookinfo.yaml
# Pods will have 2/2 containers (app + Envoy sidecar)
```

### Gateway (External Traffic)

```yaml
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: app-gateway
spec:
  selector:
    istio: ingressgateway
  servers:
  - port:
      number: 80
      name: http
      protocol: HTTP
    hosts:
    - app.example.com
  - port:
      number: 443
      name: https
      protocol: HTTPS
    tls:
      mode: SIMPLE
      credentialName: app-tls    # K8s Secret with TLS cert
    hosts:
    - app.example.com
```

### VirtualService (Traffic Routing)

```yaml
# Route traffic to different versions
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews                      # K8s Service name
  http:
  # Canary: 90% v1, 10% v2
  - route:
    - destination:
        host: reviews
        subset: v1
      weight: 90
    - destination:
        host: reviews
        subset: v2
      weight: 10

---
# Header-based routing
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  # Beta users get v2
  - match:
    - headers:
        x-user-type:
          exact: beta
    route:
    - destination:
        host: reviews
        subset: v2
  # Everyone else gets v1
  - route:
    - destination:
        host: reviews
        subset: v1

---
# Fault injection (testing)
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: ratings
spec:
  hosts:
  - ratings
  http:
  - fault:
      delay:
        percentage:
          value: 10              # 10% of requests
        fixedDelay: 5s           # 5 second delay
      abort:
        percentage:
          value: 5               # 5% get 500 error
        httpStatus: 500
    route:
    - destination:
        host: ratings
```

### DestinationRule (Load Balancing)

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: reviews
spec:
  host: reviews
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: DEFAULT
        http1MaxPendingRequests: 100
        http2MaxRequests: 1000
    
    outlierDetection:            # Circuit breaker
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
  
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
    trafficPolicy:
      connectionPool:
        http:
          http2MaxRequests: 500  # v2 gets lower limit
```

### mTLS (Mutual TLS)

```yaml
# Enable strict mTLS for namespace
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: production
spec:
  mtls:
    mode: STRICT                 # All traffic must be mTLS
    # PERMISSIVE = accept both plain and mTLS
    # DISABLE = no mTLS

---
# Authorization policy
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-frontend
  namespace: production
spec:
  selector:
    matchLabels:
      app: backend
  rules:
  - from:
    - source:
        principals:
        - "cluster.local/ns/production/sa/frontend"
    to:
    - operation:
        methods: ["GET", "POST"]
        paths: ["/api/*"]
```

### Observability

```bash
# Install addons (Kiali, Grafana, Jaeger, Prometheus)
kubectl apply -f samples/addons/

# Kiali dashboard (service mesh visualization)
istioctl dashboard kiali

# Grafana dashboards
istioctl dashboard grafana

# Jaeger tracing
istioctl dashboard jaeger

# Prometheus metrics
istioctl dashboard prometheus

# Check proxy status
istioctl proxy-status
# Shows sync status of all Envoy sidecars

# Analyze configuration
istioctl analyze -n production
```

### Canary Deployment Pattern

```bash
# Step 1: Deploy v2 alongside v1
kubectl apply -f deployment-v2.yaml

# Step 2: Route 5% to v2
kubectl apply -f - <<EOF
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
spec:
  hosts: [my-app]
  http:
  - route:
    - destination: {host: my-app, subset: v1}
      weight: 95
    - destination: {host: my-app, subset: v2}
      weight: 5
EOF

# Step 3: Monitor error rates in Kiali/Grafana

# Step 4: Gradually increase (25%, 50%, 100%)
# Step 5: Remove v1
```

## Common Issues

**Sidecar not injected**

Namespace not labeled: `kubectl label ns default istio-injection=enabled`. Or pod has `sidecar.istio.io/inject: "false"` annotation.

**503 errors after enabling mTLS**

Some pods don't have sidecars. Use `PERMISSIVE` mode first, then switch to `STRICT` after all pods have sidecars.

**High latency after Istio**

Envoy proxy adds ~1ms per hop. Check: `istioctl proxy-config` for misconfigurations. Ensure resource limits on sidecar.

## Best Practices

- **Start with PERMISSIVE mTLS** — migrate to STRICT gradually
- **Use Kiali** for service mesh visualization — see traffic flows
- **Canary with VirtualService** — safer than pure K8s rolling updates
- **Set sidecar resource limits** — prevent proxy from starving app
- **Use `istioctl analyze`** — catches configuration errors

## Key Takeaways

- Istio adds traffic management, security, and observability via sidecar proxies
- VirtualService controls routing (canary, header-based, fault injection)
- DestinationRule configures load balancing and circuit breaking
- PeerAuthentication enables mTLS between all services
- Built-in dashboards: Kiali (mesh), Grafana (metrics), Jaeger (traces)
