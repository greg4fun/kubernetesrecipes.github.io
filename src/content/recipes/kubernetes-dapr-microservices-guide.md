---
title: "Dapr: Microservice Building Blocks on K8s"
description: "Deploy Dapr in Kubernetes for service invocation, state management, pub/sub messaging, and secrets using a language-agnostic sidecar architecture."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "dapr"
  - "microservices"
  - "pub-sub"
  - "state-management"
  - "sidecar"
relatedRecipes:
  - "kubernetes-service-mesh-istio-guide"
  - "kubernetes-linkerd-service-mesh-guide"
  - "kubernetes-sidecar-containers-guide"
  - "kubernetes-nats-messaging-guide"
---

> 💡 **Quick Answer:** Dapr provides microservice building blocks (service invocation, state, pub/sub, secrets) via a sidecar. Install: `helm install dapr dapr/dapr -n dapr-system --create-namespace`. Annotate pods: `dapr.io/enabled: "true"`. Your app calls `localhost:3500` for Dapr APIs — language-agnostic. State stored in Redis/PostgreSQL, pub/sub via Redis/Kafka/RabbitMQ — switch backends without code changes.

## The Problem

Every microservice needs:

- Service-to-service calls with retries and discovery
- State management (sessions, shopping carts)
- Pub/sub messaging between services
- Secret access from Vault/cloud providers
- These cross-cutting concerns repeated in every language

## The Solution

### Install Dapr

```bash
# Install CLI
curl -fsSL https://raw.githubusercontent.com/dapr/cli/master/install/install.sh | bash

# Install on Kubernetes
helm repo add dapr https://dapr.github.io/helm-charts/
helm install dapr dapr/dapr -n dapr-system --create-namespace

# Verify
dapr status -k
kubectl get pods -n dapr-system
# dapr-operator-xxx          Running
# dapr-sentry-xxx            Running  (mTLS)
# dapr-placement-xxx         Running  (actor placement)
# dapr-sidecar-injector-xxx  Running
```

### Enable Dapr on Your App

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-service
spec:
  template:
    metadata:
      annotations:
        dapr.io/enabled: "true"
        dapr.io/app-id: "orders"
        dapr.io/app-port: "8080"
        dapr.io/log-level: "info"
    spec:
      containers:
      - name: orders
        image: myapp/orders:v1
        ports:
        - containerPort: 8080
# Dapr sidecar auto-injected — app calls localhost:3500
```

### Service Invocation

```bash
# Call orders service from any other Dapr-enabled service:
curl http://localhost:3500/v1.0/invoke/orders/method/api/orders
# Dapr handles: service discovery, mTLS, retries, tracing

# From code (any language)
# Python
import requests
resp = requests.get("http://localhost:3500/v1.0/invoke/orders/method/api/orders")

# Node.js
const resp = await fetch("http://localhost:3500/v1.0/invoke/orders/method/api/orders");
```

### State Management

```yaml
# Component: Redis state store
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: statestore
spec:
  type: state.redis
  version: v1
  metadata:
  - name: redisHost
    value: redis-master.default:6379
  - name: redisPassword
    secretKeyRef:
      name: redis-secret
      key: password
```

```bash
# Save state
curl -X POST http://localhost:3500/v1.0/state/statestore \
  -H "Content-Type: application/json" \
  -d '[{"key": "order-123", "value": {"status": "pending", "total": 99.99}}]'

# Get state
curl http://localhost:3500/v1.0/state/statestore/order-123
# {"status": "pending", "total": 99.99}

# Delete state
curl -X DELETE http://localhost:3500/v1.0/state/statestore/order-123
```

### Pub/Sub Messaging

```yaml
# Component: Redis pub/sub (or Kafka, RabbitMQ, NATS)
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: pubsub
spec:
  type: pubsub.redis
  version: v1
  metadata:
  - name: redisHost
    value: redis-master.default:6379
```

```bash
# Publish event
curl -X POST http://localhost:3500/v1.0/publish/pubsub/orders \
  -H "Content-Type: application/json" \
  -d '{"orderId": "123", "status": "created"}'
```

```python
# Subscribe (in your app — Dapr calls YOUR endpoint)
from flask import Flask, request
app = Flask(__name__)

@app.route('/dapr/subscribe', methods=['GET'])
def subscribe():
    return [{"pubsubname": "pubsub", "topic": "orders", "route": "/orders"}]

@app.route('/orders', methods=['POST'])
def handle_order():
    event = request.json
    print(f"Received order: {event['data']['orderId']}")
    return '', 200
```

### Secrets

```yaml
# Component: Kubernetes secrets
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: kubernetes-secrets
spec:
  type: secretstores.kubernetes
  version: v1
```

```bash
# Get secret
curl http://localhost:3500/v1.0/secrets/kubernetes-secrets/db-credentials
# {"username": "admin", "password": "secret123"}

# Also supports: Vault, AWS Secrets Manager, Azure Key Vault
```

### Bindings (Input/Output)

```yaml
# Trigger on new messages in a queue
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: order-queue
spec:
  type: bindings.rabbitmq
  version: v1
  metadata:
  - name: queueName
    value: orders
  - name: host
    value: amqp://rabbitmq.default:5672
```

```python
# Input binding — Dapr calls your app when message arrives
@app.route('/order-queue', methods=['POST'])
def process_queue():
    data = request.json
    # Process message
    return '', 200

# Output binding — send to queue
# curl -X POST http://localhost:3500/v1.0/bindings/order-queue \
#   -d '{"operation": "create", "data": {"orderId": "456"}}'
```

### Observability (Built-in)

```yaml
# Dapr auto-generates traces for all service calls
# Configure exporter
apiVersion: dapr.io/v1alpha1
kind: Configuration
metadata:
  name: tracing
spec:
  tracing:
    samplingRate: "1"
    otel:
      endpointAddress: otel-collector.observability:4317
      isSecure: false
      protocol: grpc
```

## Common Issues

**Sidecar not injected**

Missing annotation `dapr.io/enabled: "true"`. Also check: Dapr sidecar injector pod is running in `dapr-system`.

**"connection refused" to localhost:3500**

Sidecar not ready yet. Add init container or readiness check. Dapr sidecar needs a few seconds to start.

**State store "component not found"**

Component must be in same namespace as the app, or use `dapr.io/components-scopes` annotation.

## Best Practices

- **One component per concern** — separate state, pubsub, secrets components
- **Scoping** — restrict which apps can access which components
- **mTLS automatic** — Dapr Sentry handles certificates
- **Swap backends** — change Redis to PostgreSQL for state without code changes
- **Use SDKs** for type safety (Python, Go, .NET, Java, JavaScript SDKs)

## Key Takeaways

- Dapr provides building blocks (state, pubsub, invocation, secrets) via sidecar
- Language-agnostic — any app calls localhost:3500 HTTP/gRPC
- Components are pluggable — swap Redis for Kafka without code changes
- Built-in mTLS, distributed tracing, and retries
- Simpler than a service mesh for application-level concerns
