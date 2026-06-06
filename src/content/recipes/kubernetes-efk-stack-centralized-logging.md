---
title: "Kubernetes EFK Stack Centralized Logging"
description: "Deploy the EFK stack (Elasticsearch, Fluentd, Kibana) on Kubernetes for centralized log collection, processing, and visualization. DaemonSet log"
tags:
  - "efk"
  - "elasticsearch"
  - "fluentd"
  - "kibana"
  - "logging"
category: "observability"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "opentelemetry-kubernetes-observability"
  - "prometheus-monitoring-kubernetes-guide"
  - "kubernetes-audit-logging-configuration"
---

> 💡 **Quick Answer:** The EFK stack collects logs from all pods via Fluentd DaemonSets, stores them in Elasticsearch, and visualizes them in Kibana. Deploy Elasticsearch as a StatefulSet with persistent storage, Fluentd as a DaemonSet mounting `/var/log/containers`, and Kibana as a Deployment with Ingress access.

## The Problem

- Container logs are ephemeral — lost when pods restart or are evicted
- `kubectl logs` only shows one pod at a time, no cross-service correlation
- No built-in search, filtering, or alerting on log content
- Log volume from hundreds of pods overwhelms manual inspection
- Compliance requires log retention beyond pod lifecycle

## The Solution

### Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ Every Node                                                       │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                         │
│ │  Pod A   │ │  Pod B   │ │  Pod C   │   (stdout/stderr)       │
│ └────┬─────┘ └────┬─────┘ └────┬─────┘                         │
│      └─────────────┴─────────────┘                               │
│                    │                                              │
│      /var/log/containers/*.log                                   │
│                    │                                              │
│  ┌─────────────────────────────────┐                            │
│  │ Fluentd DaemonSet               │  (tail + parse + enrich)   │
│  └─────────────────┬───────────────┘                            │
│                    │                                              │
└────────────────────┼────────────────────────────────────────────┘
                     │ HTTPS
          ┌──────────▼──────────┐
          │   Elasticsearch      │  (index + search + retain)
          │   (StatefulSet)      │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │   Kibana             │  (visualize + alert + dashboard)
          │   (Deployment)       │
          └─────────────────────┘
```

### Deploy Elasticsearch

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: elasticsearch
  namespace: logging
spec:
  serviceName: elasticsearch
  replicas: 3
  selector:
    matchLabels:
      app: elasticsearch
  template:
    metadata:
      labels:
        app: elasticsearch
    spec:
      initContainers:
        - name: sysctl
          image: busybox
          command: ["sysctl", "-w", "vm.max_map_count=262144"]
          securityContext:
            privileged: true
      containers:
        - name: elasticsearch
          image: docker.elastic.co/elasticsearch/elasticsearch:8.13.0
          env:
            - name: cluster.name
              value: "k8s-logs"
            - name: node.name
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: discovery.seed_hosts
              value: "elasticsearch-0.elasticsearch,elasticsearch-1.elasticsearch,elasticsearch-2.elasticsearch"
            - name: cluster.initial_master_nodes
              value: "elasticsearch-0,elasticsearch-1,elasticsearch-2"
            - name: ES_JAVA_OPTS
              value: "-Xms2g -Xmx2g"
            - name: xpack.security.enabled
              value: "false"    # Enable in production with certs
          ports:
            - containerPort: 9200
              name: http
            - containerPort: 9300
              name: transport
          resources:
            requests:
              cpu: "1"
              memory: "4Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
          volumeMounts:
            - name: data
              mountPath: /usr/share/elasticsearch/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 100Gi
---
apiVersion: v1
kind: Service
metadata:
  name: elasticsearch
  namespace: logging
spec:
  clusterIP: None
  selector:
    app: elasticsearch
  ports:
    - port: 9200
      name: http
    - port: 9300
      name: transport
```

### Deploy Fluentd DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: logging
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    metadata:
      labels:
        app: fluentd
    spec:
      serviceAccountName: fluentd
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          effect: NoSchedule
      containers:
        - name: fluentd
          image: fluent/fluentd-kubernetes-daemonset:v1.16-debian-elasticsearch8-1
          env:
            - name: FLUENT_ELASTICSEARCH_HOST
              value: "elasticsearch.logging.svc"
            - name: FLUENT_ELASTICSEARCH_PORT
              value: "9200"
            - name: FLUENT_ELASTICSEARCH_SCHEME
              value: "http"
            - name: FLUENT_ELASTICSEARCH_LOGSTASH_PREFIX
              value: "k8s"
            - name: FLUENT_ELASTICSEARCH_LOGSTASH_FORMAT
              value: "true"
          resources:
            requests:
              cpu: "200m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          volumeMounts:
            - name: varlog
              mountPath: /var/log
              readOnly: true
            - name: containers
              mountPath: /var/lib/docker/containers
              readOnly: true
            - name: fluentd-config
              mountPath: /fluentd/etc/fluent.conf
              subPath: fluent.conf
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
        - name: containers
          hostPath:
            path: /var/lib/docker/containers
        - name: fluentd-config
          configMap:
            name: fluentd-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluentd-config
  namespace: logging
data:
  fluent.conf: |
    <source>
      @type tail
      path /var/log/containers/*.log
      exclude_path ["/var/log/containers/fluentd-*"]
      pos_file /var/log/fluentd-containers.log.pos
      tag kubernetes.*
      read_from_head true
      <parse>
        @type json
        time_key time
        time_format %Y-%m-%dT%H:%M:%S.%NZ
      </parse>
    </source>

    <filter kubernetes.**>
      @type kubernetes_metadata
      @id filter_kube_metadata
    </filter>

    <filter kubernetes.**>
      @type record_transformer
      <record>
        cluster_name "production"
      </record>
    </filter>

    <match kubernetes.**>
      @type elasticsearch
      host elasticsearch.logging.svc
      port 9200
      logstash_format true
      logstash_prefix k8s
      include_tag_key true
      <buffer>
        @type file
        path /var/log/fluentd-buffers/kubernetes.system.buffer
        flush_mode interval
        flush_interval 5s
        retry_type exponential_backoff
        chunk_limit_size 8M
        total_limit_size 1G
      </buffer>
    </match>
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fluentd
  namespace: logging
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: fluentd
rules:
  - apiGroups: [""]
    resources: ["pods", "namespaces"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: fluentd
roleRef:
  kind: ClusterRole
  name: fluentd
  apiGroup: rbac.authorization.k8s.io
subjects:
  - kind: ServiceAccount
    name: fluentd
    namespace: logging
```

### Deploy Kibana

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kibana
  namespace: logging
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kibana
  template:
    metadata:
      labels:
        app: kibana
    spec:
      containers:
        - name: kibana
          image: docker.elastic.co/kibana/kibana:8.13.0
          env:
            - name: ELASTICSEARCH_HOSTS
              value: "http://elasticsearch.logging.svc:9200"
            - name: SERVER_BASEPATH
              value: ""
          ports:
            - containerPort: 5601
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "1"
              memory: "2Gi"
---
apiVersion: v1
kind: Service
metadata:
  name: kibana
  namespace: logging
spec:
  selector:
    app: kibana
  ports:
    - port: 5601
      targetPort: 5601
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kibana
  namespace: logging
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - kibana.example.com
      secretName: kibana-tls
  rules:
    - host: kibana.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: kibana
                port:
                  number: 5601
```

### Index Lifecycle Management

```bash
# Create ILM policy for automatic cleanup
curl -X PUT "http://elasticsearch:9200/_ilm/policy/k8s-logs-policy" \
  -H "Content-Type: application/json" -d '{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_size": "50gb",
            "max_age": "1d"
          }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "shrink": { "number_of_shards": 1 },
          "forcemerge": { "max_num_segments": 1 }
        }
      },
      "delete": {
        "min_age": "30d",
        "actions": { "delete": {} }
      }
    }
  }
}'
```

## Common Issues

### Fluentd buffer overflow — logs dropped
- **Cause**: Elasticsearch can't ingest fast enough; buffer fills up
- **Fix**: Increase `total_limit_size`; scale Elasticsearch data nodes; add buffer flush threads

### Elasticsearch out of disk space
- **Cause**: No ILM policy; indices grow indefinitely
- **Fix**: Configure ILM with retention policy (e.g., delete after 30 days); add `curator` CronJob

### Container log format not parsed correctly
- **Cause**: Container runtime uses CRI format (not Docker JSON)
- **Fix**: Use `@type cri` parser or multi-format parser; check `/var/log/containers/*.log` format

### Kibana shows "no results found"
- **Cause**: Index pattern not created; or wrong time range selected
- **Fix**: Create index pattern `k8s-*` in Kibana Management; set time range to "Last 15 minutes"

## Best Practices

1. **Set resource limits on Fluentd** — unbounded Fluentd can consume node resources
2. **Buffer to disk** — prevents log loss during Elasticsearch outages
3. **Use ILM policies** — automatic index rollover and deletion
4. **Exclude system logs** — filter out kube-system noise unless needed
5. **Add Kubernetes metadata** — namespace, pod, labels enrich searchability
6. **Separate hot/warm/cold nodes** — cost-effective for large clusters
7. **Monitor EFK itself** — Fluentd metrics, ES cluster health, disk usage
8. **Consider Fluent Bit** — lighter alternative to Fluentd for the DaemonSet layer

## Key Takeaways

- EFK = Elasticsearch (store) + Fluentd (collect) + Kibana (visualize)
- Fluentd runs as DaemonSet on every node, tails `/var/log/containers/*.log`
- Elasticsearch needs `vm.max_map_count=262144` and persistent storage
- ILM policies prevent disk exhaustion — set retention (7/30/90 days)
- Add Kubernetes metadata filter for namespace/pod/label enrichment
- Buffer to disk (not memory) for durability during outages
- Alternative: Fluent Bit (lighter collector) → Elasticsearch → Kibana
