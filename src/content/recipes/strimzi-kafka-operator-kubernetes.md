---
title: "Strimzi Kafka Operator on Kubernetes"
description: "Deploy Apache Kafka on Kubernetes with Strimzi operator. Covers Kafka CR, KafkaTopic, KafkaUser, KafkaConnect, KafkaBridge, rack awareness, storage sizing, monitoring with JMX, and production hardening."
tags:
  - "strimzi"
  - "kafka"
  - "operator"
  - "streaming"
  - "messaging"
category: "deployments"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-statefulset-guide"
  - "kubernetes-pod-disruption-budget"
  - "pvc-storageclass-examples"
  - "prometheus-metrics-setup"
---

> 💡 **Quick Answer:** Strimzi (CNCF incubating) is the standard Kafka operator for Kubernetes. Define a `Kafka` CR to deploy brokers + ZooKeeper (or KRaft), manage topics with `KafkaTopic`, users with `KafkaUser`, and connectors with `KafkaConnect` — all as Kubernetes-native CRDs.

## The Problem

Running Kafka on Kubernetes manually is complex:

- StatefulSet management with proper storage and networking
- Broker configuration, rack awareness, replication factors
- TLS between brokers, clients, and ZooKeeper
- Topic and user management outside of Kubernetes
- Rolling upgrades without message loss
- Monitoring with JMX metrics

## The Solution

### Install Strimzi Operator

```bash
helm repo add strimzi https://strimzi.io/charts
helm repo update

helm install strimzi strimzi/strimzi-kafka-operator \
  --namespace kafka \
  --create-namespace \
  --set watchAnyNamespace=true
```

### Deploy Kafka Cluster (KRaft Mode)

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: production
  namespace: kafka
spec:
  kafka:
    version: 3.8.0
    replicas: 3
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: tls
        port: 9093
        type: internal
        tls: true
        authentication:
          type: tls
      - name: external
        port: 9094
        type: nodeport
        tls: true
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
      default.replication.factor: 3
      min.insync.replicas: 2
      inter.broker.protocol.version: "3.8"
      log.retention.hours: 168        # 7 days
      log.segment.bytes: 1073741824   # 1GB segments
      num.partitions: 12
    storage:
      type: jbod
      volumes:
        - id: 0
          type: persistent-claim
          size: 100Gi
          class: fast-ssd
          deleteClaim: false
    rack:
      topologyKey: topology.kubernetes.io/zone
    resources:
      requests:
        memory: 4Gi
        cpu: "2"
      limits:
        memory: 8Gi
        cpu: "4"
    jvmOptions:
      -Xms: 2048m
      -Xmx: 4096m
    metricsConfig:
      type: jmxPrometheusExporter
      valueFrom:
        configMapKeyRef:
          name: kafka-metrics
          key: kafka-metrics-config.yml
    template:
      pod:
        affinity:
          podAntiAffinity:
            requiredDuringSchedulingIgnoredDuringExecution:
              - labelSelector:
                  matchExpressions:
                    - key: strimzi.io/name
                      operator: In
                      values: [production-kafka]
                topologyKey: kubernetes.io/hostname
  # KRaft mode (no ZooKeeper)
  nodePool:
    - name: controller
      replicas: 3
      roles:
        - controller
      storage:
        type: persistent-claim
        size: 10Gi
        class: fast-ssd
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

### KafkaTopic and KafkaUser

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: orders
  namespace: kafka
  labels:
    strimzi.io/cluster: production
spec:
  partitions: 24
  replicas: 3
  config:
    retention.ms: 604800000      # 7 days
    segment.bytes: 1073741824
    min.insync.replicas: 2
    cleanup.policy: delete
---
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata:
  name: order-service
  namespace: kafka
  labels:
    strimzi.io/cluster: production
spec:
  authentication:
    type: tls
  authorization:
    type: simple
    acls:
      - resource:
          type: topic
          name: orders
          patternType: literal
        operations: [Read, Write, Describe]
        host: "*"
      - resource:
          type: group
          name: order-service
          patternType: prefix
        operations: [Read]
        host: "*"
```

### KafkaConnect for CDC

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnect
metadata:
  name: debezium
  namespace: kafka
  annotations:
    strimzi.io/use-connector-resources: "true"
spec:
  version: 3.8.0
  replicas: 2
  bootstrapServers: production-kafka-bootstrap:9093
  tls:
    trustedCertificates:
      - secretName: production-cluster-ca-cert
        certificate: ca.crt
  config:
    group.id: debezium-connect
    offset.storage.topic: connect-offsets
    config.storage.topic: connect-configs
    status.storage.topic: connect-status
    config.storage.replication.factor: 3
    offset.storage.replication.factor: 3
    status.storage.replication.factor: 3
  build:
    output:
      type: docker
      image: registry.example.com/kafka-connect-debezium:latest
    plugins:
      - name: debezium-postgres
        artifacts:
          - type: tgz
            url: https://repo1.maven.org/maven2/io/debezium/debezium-connector-postgres/2.7.0.Final/debezium-connector-postgres-2.7.0.Final-plugin.tar.gz
---
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnector
metadata:
  name: postgres-source
  namespace: kafka
  labels:
    strimzi.io/cluster: debezium
spec:
  class: io.debezium.connector.postgresql.PostgresConnector
  tasksMax: 1
  config:
    database.hostname: postgres.production.svc
    database.port: 5432
    database.user: debezium
    database.password: ${secrets:kafka/debezium-credentials:password}
    database.dbname: orders
    topic.prefix: cdc
    schema.include.list: public
    plugin.name: pgoutput
```

### Client Application Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-processor
  template:
    metadata:
      labels:
        app: order-processor
    spec:
      containers:
        - name: processor
          image: registry.example.com/order-processor:latest
          env:
            - name: KAFKA_BOOTSTRAP
              value: "production-kafka-bootstrap.kafka.svc:9093"
            - name: KAFKA_TOPIC
              value: "orders"
            - name: KAFKA_GROUP
              value: "order-service-processor"
          volumeMounts:
            - name: kafka-user-cert
              mountPath: /certs
              readOnly: true
      volumes:
        - name: kafka-user-cert
          secret:
            secretName: order-service     # Created by KafkaUser
```

### Monitoring with Prometheus

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kafka-metrics
  namespace: kafka
data:
  kafka-metrics-config.yml: |
    lowercaseOutputName: true
    rules:
      - pattern: "kafka.server<type=(.+), name=(.+), clientId=(.+), topic=(.+), partition=(.*)><>Value"
        name: kafka_server_$1_$2
        labels:
          clientId: "$3"
          topic: "$4"
          partition: "$5"
      - pattern: "kafka.server<type=(.+), name=(.+)><>Value"
        name: kafka_server_$1_$2
      - pattern: "kafka.controller<type=(.+), name=(.+)><>Value"
        name: kafka_controller_$1_$2
```

```bash
# Key metrics to monitor
# kafka_server_brokertopicmetrics_messagesinpersec     — throughput
# kafka_server_replicamanager_underreplicatedpartitions — replication health
# kafka_controller_kafkacontroller_offlinepartitionscount — CRITICAL if > 0
# kafka_server_replicafetchermanager_maxlag            — consumer lag
```

## Common Issues

### Broker Pods stuck in CrashLoopBackOff
- **Cause**: Storage full or JVM OOM
- **Fix**: Increase PVC size; tune JVM heap (`-Xmx`)

### Under-replicated partitions after rolling update
- **Cause**: Replication can't keep up during restart
- **Fix**: Increase `default.replication.factor`; use PDB with `maxUnavailable: 1`

### KafkaTopic changes not applied
- **Cause**: Topic operator can't decrease partitions (Kafka limitation)
- **Fix**: Partition count can only increase; for decrease, recreate topic

## Best Practices

1. **KRaft mode** for new clusters — ZooKeeper is deprecated in Kafka 4.0
2. **3 replicas minimum** with `min.insync.replicas: 2`
3. **JBOD storage** with fast SSDs for high-throughput clusters
4. **Rack awareness** — spread brokers across availability zones
5. **Pod anti-affinity** — never co-locate brokers on same node
6. **KafkaUser for ACLs** — per-service credentials with least privilege
7. **Monitor under-replicated partitions** — early warning for data loss risk

## Key Takeaways

- Strimzi manages Kafka lifecycle on Kubernetes via CRDs
- `Kafka` CR defines brokers, listeners, storage, rack awareness
- `KafkaTopic` and `KafkaUser` for declarative topic/ACL management
- `KafkaConnect` builds connector images with plugin system
- KRaft mode eliminates ZooKeeper dependency (Kafka 3.7+)
- JMX metrics export to Prometheus via built-in exporter
- JBOD + fast-ssd StorageClass for production throughput
- Pod anti-affinity + rack awareness for high availability
