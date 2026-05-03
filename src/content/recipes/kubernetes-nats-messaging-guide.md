---
title: "NATS: Lightweight Messaging for Kubernetes"
description: "Deploy NATS messaging in Kubernetes for pub/sub, request/reply, and JetStream persistent streaming. High-performance alternative to Kafka for cloud-native microservices."
publishDate: "2026-05-03"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "nats"
  - "messaging"
  - "pub-sub"
  - "streaming"
  - "microservices"
relatedRecipes:
  - "kubernetes-dapr-microservices-guide"
  - "kubernetes-keda-autoscaling-guide"
  - "kubernetes-knative-serverless-guide"
---

> 💡 **Quick Answer:** NATS is an ultra-lightweight messaging system — 10MB binary, sub-millisecond latency, 10M+ msgs/sec. Install: `helm install nats nats/nats -n nats --create-namespace`. Use core NATS for ephemeral pub/sub, JetStream for persistent streaming (like Kafka but simpler). Client libraries for every language. Perfect for microservice communication in Kubernetes.

## The Problem

Microservices need messaging but:

- Kafka is powerful but operationally complex (ZooKeeper, partitions, ISR)
- RabbitMQ adds significant resource overhead
- You need sub-millisecond latency for real-time communication
- Simple pub/sub shouldn't require a PhD in message brokers
- Want both ephemeral and persistent messaging in one system

## The Solution

### Install NATS

```bash
helm repo add nats https://nats-io.github.io/k8s/helm/charts/
helm install nats nats/nats \
  -n nats --create-namespace \
  --set config.jetstream.enabled=true \
  --set config.jetstream.fileStore.pvc.size=10Gi \
  --set config.cluster.enabled=true \
  --set config.cluster.replicas=3

# Verify
kubectl get pods -n nats
# nats-0   Running
# nats-1   Running
# nats-2   Running

# Install NATS CLI
curl -L https://github.com/nats-io/natscli/releases/latest/download/nats-linux-amd64.zip -o nats.zip
unzip nats.zip && mv nats /usr/local/bin/

# Port-forward for testing
kubectl port-forward svc/nats -n nats 4222:4222 &

# Check server info
nats server info
```

### Pub/Sub (Core NATS)

```bash
# Subscribe (terminal 1)
nats sub orders.created
# Listening on [orders.created]

# Publish (terminal 2)
nats pub orders.created '{"orderId": "123", "total": 99.99}'
# Published 38 bytes to "orders.created"

# Subscriber sees:
# [#1] Received on "orders.created"
# {"orderId": "123", "total": 99.99}

# Wildcard subscriptions
nats sub "orders.*"              # orders.created, orders.updated, etc.
nats sub "orders.>"              # Any depth: orders.us.east.created
```

### Request/Reply

```bash
# Responder (service)
nats reply orders.get '{"orderId": "{{.Id}}", "status": "shipped"}'
# Listening on [orders.get]

# Requester (client)
nats request orders.get '{"orderId": "123"}'
# Received: {"orderId": "123", "status": "shipped"}
# Round-trip: 1.2ms
```

### JetStream (Persistent Streaming)

```bash
# Create a stream (like a Kafka topic)
nats stream add ORDERS \
  --subjects "orders.>" \
  --retention limits \
  --max-msgs -1 \
  --max-bytes 1GB \
  --max-age 7d \
  --replicas 3 \
  --storage file

# Create a consumer (like a Kafka consumer group)
nats consumer add ORDERS order-processor \
  --ack explicit \
  --deliver all \
  --max-deliver 3 \
  --filter "orders.created" \
  --pull

# Publish to stream
nats pub orders.created '{"orderId": "456"}'
# Message stored in ORDERS stream

# Consume from stream
nats consumer next ORDERS order-processor --count 10
```

### Application Code (Go Example)

```go
package main

import (
    "fmt"
    "github.com/nats-io/nats.go"
)

func main() {
    nc, _ := nats.Connect("nats://nats.nats:4222")
    defer nc.Close()

    // Pub/Sub
    nc.Subscribe("orders.created", func(m *nats.Msg) {
        fmt.Printf("Received: %s\n", string(m.Data))
    })

    nc.Publish("orders.created", []byte(`{"orderId": "789"}`))

    // Request/Reply
    msg, _ := nc.Request("orders.get", []byte(`{"id":"789"}`), time.Second)
    fmt.Printf("Reply: %s\n", string(msg.Data))

    // JetStream
    js, _ := nc.JetStream()
    js.Publish("orders.created", []byte(`{"orderId": "101"}`))

    sub, _ := js.PullSubscribe("orders.created", "processor")
    msgs, _ := sub.Fetch(10, nats.MaxWait(5*time.Second))
    for _, msg := range msgs {
        fmt.Printf("JS: %s\n", string(msg.Data))
        msg.Ack()
    }
}
```

### Python Client

```python
import nats
import asyncio

async def main():
    nc = await nats.connect("nats://nats.nats:4222")
    
    # Subscribe
    async def handler(msg):
        print(f"Received: {msg.data.decode()}")
    
    await nc.subscribe("orders.created", cb=handler)
    
    # Publish
    await nc.publish("orders.created", b'{"orderId": "123"}')
    
    # JetStream
    js = nc.jetstream()
    await js.publish("orders.created", b'{"orderId": "456"}')
    
    psub = await js.pull_subscribe("orders.created", "processor")
    msgs = await psub.fetch(10, timeout=5)
    for msg in msgs:
        print(f"JS: {msg.data.decode()}")
        await msg.ack()

asyncio.run(main())
```

### Key-Value Store

```bash
# NATS KV (built on JetStream)
nats kv add CONFIG --replicas 3

nats kv put CONFIG database.host "postgres.production"
nats kv put CONFIG database.port "5432"

nats kv get CONFIG database.host
# database.host: postgres.production

# Watch for changes (real-time config updates)
nats kv watch CONFIG
# Config changed → app gets notified
```

### Monitoring

```bash
# NATS server stats
nats server report connections
nats server report accounts
nats server report jetstream

# Stream info
nats stream info ORDERS
# Messages: 15,234
# Bytes: 12MB
# Consumers: 3

# Consumer info
nats consumer info ORDERS order-processor
# Pending: 42 messages
# Redelivered: 0
```

## Common Issues

**JetStream "insufficient resources"**

Storage PVC full. Increase `fileStore.pvc.size` or set retention policy (max-age, max-bytes).

**Consumer falling behind**

Not enough consumers. Use pull consumers with multiple workers, or increase `--max-ack-pending`.

**Messages lost (core NATS)**

Core NATS is fire-and-forget — if no subscriber is listening, messages are dropped. Use JetStream for guaranteed delivery.

## Best Practices

- **Core NATS for ephemeral** — real-time updates, notifications where loss is OK
- **JetStream for persistent** — orders, events, anything that must not be lost
- **3 replicas** for production JetStream streams
- **Pull consumers** over push — better backpressure control
- **KV store** for distributed configuration — simpler than etcd for app config

## Key Takeaways

- NATS: 10MB binary, sub-millisecond latency, 10M+ msgs/sec
- Core NATS for fast pub/sub, JetStream for persistent streaming
- Simpler than Kafka — no ZooKeeper, no partition management
- Built-in Key-Value and Object Store on top of JetStream
- Client libraries for Go, Python, Java, .NET, Rust, JavaScript, and more
