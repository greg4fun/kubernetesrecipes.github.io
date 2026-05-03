---
title: "Knative: Serverless Workloads on Kubernetes"
description: "Run serverless containers with Knative Serving and Eventing on Kubernetes. Auto-scaling to zero, traffic splitting, revision management."
publishDate: "2026-05-03"
author: "Luca Berton"
category: "deployments"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "knative"
  - "serverless"
  - "scale-to-zero"
  - "event-driven"
  - "autoscaling"
relatedRecipes:
  - "kubernetes-keda-autoscaling-guide"
  - "kubernetes-gateway-api-guide"
---

> 💡 **Quick Answer:** Knative runs serverless containers on Kubernetes — auto-scales to zero, manages revisions, splits traffic. Install Serving: `kubectl apply -f https://github.com/knative/serving/releases/download/knative-v1.14.0/serving-crds.yaml && serving-core.yaml`. Deploy: create a `Service` with just an image. Knative handles scaling, routing, HTTPS, and revision management. No Dockerfile changes needed — any container that listens on a port works.

## The Problem

You want serverless benefits on Kubernetes:

- Scale to zero when idle (save costs)
- Auto-scale based on concurrent requests
- Traffic splitting between versions (canary/blue-green)
- Revision management without manual Deployments
- Event-driven workloads without custom plumbing

## The Solution

### Install Knative Serving

```bash
# Install CRDs
kubectl apply -f https://github.com/knative/serving/releases/download/knative-v1.14.0/serving-crds.yaml

# Install core
kubectl apply -f https://github.com/knative/serving/releases/download/knative-v1.14.0/serving-core.yaml

# Install networking layer (Kourier — lightweight)
kubectl apply -f https://github.com/knative/net-kourier/releases/download/knative-v1.14.0/kourier.yaml

# Configure Knative to use Kourier
kubectl patch configmap/config-network \
  --namespace knative-serving \
  --type merge \
  --patch '{"data":{"ingress-class":"kourier.ingress.networking.knative.dev"}}'

# Configure DNS (magic DNS for testing)
kubectl apply -f https://github.com/knative/serving/releases/download/knative-v1.14.0/serving-default-domain.yaml

# Verify
kubectl get pods -n knative-serving
```

### Deploy a Knative Service

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: hello
  namespace: default
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/min-scale: "0"    # Scale to zero
        autoscaling.knative.dev/max-scale: "10"
    spec:
      containers:
      - image: gcr.io/knative-samples/helloworld-go
        ports:
        - containerPort: 8080
        env:
        - name: TARGET
          value: "World"
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
```

```bash
# Deploy
kubectl apply -f hello.yaml

# Get URL
kubectl get ksvc hello
# NAME    URL                                  READY
# hello   http://hello.default.example.com     True

# Test (after a few seconds of inactivity, pods scale to 0)
curl http://hello.default.example.com
# Hello World!

# Watch scaling
kubectl get pods -w
# hello-00001-xxx   Running   ← pod created on request
# (after ~60s idle)
# hello-00001-xxx   Terminating  ← scale to zero
```

### Traffic Splitting (Canary)

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: hello
spec:
  template:
    metadata:
      name: hello-v2              # Named revision
    spec:
      containers:
      - image: gcr.io/knative-samples/helloworld-go
        env:
        - name: TARGET
          value: "Knative v2"
  traffic:
  - revisionName: hello-v1
    percent: 80
  - revisionName: hello-v2
    percent: 20                    # 20% canary
  - revisionName: hello-v2
    percent: 0
    tag: canary                    # Direct URL: canary-hello.default.example.com
```

```bash
# List revisions
kubectl get revisions
# NAME        READY   REASON
# hello-v1    True
# hello-v2    True

# Gradually shift traffic
kubectl patch ksvc hello --type merge -p '
  {"spec":{"traffic":[
    {"revisionName":"hello-v1","percent":50},
    {"revisionName":"hello-v2","percent":50}
  ]}}'

# Full rollout to v2
kubectl patch ksvc hello --type merge -p '
  {"spec":{"traffic":[
    {"revisionName":"hello-v2","percent":100}
  ]}}'
```

### Autoscaling Configuration

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: api
spec:
  template:
    metadata:
      annotations:
        # Scale based on concurrent requests (default)
        autoscaling.knative.dev/metric: "concurrency"
        autoscaling.knative.dev/target: "100"       # 100 concurrent per pod
        
        # Or scale based on RPS
        # autoscaling.knative.dev/metric: "rps"
        # autoscaling.knative.dev/target: "200"
        
        # Scale bounds
        autoscaling.knative.dev/min-scale: "1"      # Always keep 1 (no cold start)
        autoscaling.knative.dev/max-scale: "50"
        
        # Scale-down delay
        autoscaling.knative.dev/scale-down-delay: "5m"
        
        # Initial scale on creation
        autoscaling.knative.dev/initial-scale: "3"
    spec:
      containers:
      - image: myapp:v1
        ports:
        - containerPort: 8080
      containerConcurrency: 0      # Unlimited concurrency per container
```

### Knative Eventing

```bash
# Install Eventing
kubectl apply -f https://github.com/knative/eventing/releases/download/knative-v1.14.0/eventing-crds.yaml
kubectl apply -f https://github.com/knative/eventing/releases/download/knative-v1.14.0/eventing-core.yaml

# Install in-memory channel (dev) or Kafka channel (prod)
kubectl apply -f https://github.com/knative/eventing/releases/download/knative-v1.14.0/in-memory-channel.yaml
```

```yaml
# Event source → Broker → Trigger → Service
apiVersion: eventing.knative.dev/v1
kind: Broker
metadata:
  name: default
  namespace: production

---
# Trigger: route events to service based on filter
apiVersion: eventing.knative.dev/v1
kind: Trigger
metadata:
  name: order-trigger
  namespace: production
spec:
  broker: default
  filter:
    attributes:
      type: com.example.order.created
  subscriber:
    ref:
      apiVersion: serving.knative.dev/v1
      kind: Service
      name: order-processor

---
# Send events to broker
# curl -X POST http://broker-ingress.knative-eventing/production/default \
#   -H "Ce-Id: 123" \
#   -H "Ce-Specversion: 1.0" \
#   -H "Ce-Type: com.example.order.created" \
#   -H "Ce-Source: /orders" \
#   -H "Content-Type: application/json" \
#   -d '{"orderId": "456"}'
```

### Private Services

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: internal-api
  labels:
    networking.knative.dev/visibility: cluster-local  # Internal only
spec:
  template:
    spec:
      containers:
      - image: internal-api:v1
# Accessible only within cluster, not via external ingress
```

## Common Issues

**Cold start too slow**

Set `autoscaling.knative.dev/min-scale: "1"` to keep at least one pod warm. Use `initial-scale` for new revisions.

**"no healthy upstream" 503 errors**

Container not ready fast enough. Increase `timeoutSeconds` in Service spec and optimize container startup.

**DNS not resolving**

Configure real DNS or use magic DNS (`sslip.io`). For production, set up a proper domain with wildcard DNS.

## Best Practices

- **min-scale=1 for user-facing** — avoid cold starts
- **min-scale=0 for batch/event** — save costs when idle
- **Named revisions** for traffic splitting — easier to reference
- **Concurrency limits** for resource-heavy apps (ML inference)
- **Eventing for async** — Serving for sync request/response

## Key Takeaways

- Knative Serving: serverless containers with auto-scale to zero
- Traffic splitting between revisions for canary deployments
- Scales on concurrent requests or RPS — not just CPU/memory
- Knative Eventing: CloudEvents routing with Brokers and Triggers
- Any container that listens on a port works — no framework lock-in
