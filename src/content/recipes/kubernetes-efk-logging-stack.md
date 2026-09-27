---
title: "Logging in Kubernetes with the EFK Stack"
description: "Set up EFK logging on Kubernetes: Elasticsearch (ECK or StatefulSet), Fluentd DaemonSet with CRI parsing and K8s metadata, Kibana, retention and KQL."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "observability"
difficulty: "advanced"
timeToComplete: "45 minutes"
kubernetesVersion: "1.28+"
tags:
  - "efk"
  - "elasticsearch"
  - "fluentd"
  - "kibana"
  - "logging"
  - "observability"
  - "centralized-logging"
relatedRecipes:
  - "kubernetes-audit-logging-configuration"
  - "kubernetes-logging-elk-stack"
  - "kubernetes-log-aggregation-loki"
  - "kubernetes-logging-fluentbit-guide"
  - "kubernetes-opentelemetry-collector"
  - "kubernetes-prometheus-monitoring-guide"
  - "openclaw-logging-efk"
  - "openclaw-liveness-readiness-probes"
---

> 💡 **Quick Answer:** EFK = **Elasticsearch** (store + full-text index), **Fluentd** DaemonSet (tails `/var/log/containers/*.log` on every node, adds Kubernetes metadata, ships to Elasticsearch) and **Kibana** (search and dashboards). For production run Elasticsearch and Kibana with the **ECK operator**; for a lab, a 3-node StatefulSet works. Parse container logs with the **CRI** parser (containerd/CRI-O don't write Docker JSON), set an ILM retention policy, and search in Kibana with KQL: `kubernetes.namespace_name:"production" and level:"error"`.
>
> **Gotcha:** Elasticsearch is memory-hungry (heap ≈ 50% of container memory, up to ~31 GB) and needs `vm.max_map_count=262144` on nodes. For smaller clusters consider Loki or Fluent Bit + a managed OpenSearch.

## The Problem

Container logs live on the node that ran the pod and vanish with it. You need every pod's stdout/stderr collected cluster-wide, enriched with namespace/pod/labels, retained for weeks and searchable with full-text queries across services.

```mermaid
flowchart LR
    P["Pods<br/>stdout/stderr"] -->|/var/log/containers| FD["Fluentd DaemonSet<br/>CRI parse + k8s metadata"]
    FD -->|bulk API, buffered| ES["Elasticsearch<br/>3 nodes, ILM"]
    ES --> KB["Kibana<br/>Discover / dashboards"]
```

## The Solution

### Step 1: Namespace and Node Settings

```bash
kubectl create namespace logging
# Elasticsearch needs this on every node that may host it (or use a privileged init container / MachineConfig on OpenShift)
sudo sysctl -w vm.max_map_count=262144
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-elasticsearch.conf
```

### Step 2a: Elasticsearch and Kibana with ECK (recommended)

```bash
helm repo add elastic https://helm.elastic.co
helm install elastic-operator elastic/eck-operator -n elastic-system --create-namespace
```

```yaml
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: Elasticsearch
metadata:
  name: logs
  namespace: logging
spec:
  version: 8.17.0
  nodeSets:
    - name: default
      count: 3
      config:
        node.store.allow_mmap: true
      podTemplate:
        spec:
          containers:
            - name: elasticsearch
              resources:
                requests: { memory: 4Gi, cpu: "1" }
                limits: { memory: 4Gi }      # heap auto-sized to 50%
      volumeClaimTemplates:
        - metadata:
            name: elasticsearch-data
          spec:
            accessModes: [ReadWriteOnce]
            resources:
              requests:
                storage: 100Gi
---
apiVersion: kibana.k8s.elastic.co/v1
kind: Kibana
metadata:
  name: logs
  namespace: logging
spec:
  version: 8.17.0
  count: 1
  elasticsearchRef:
    name: logs
```

```bash
kubectl -n logging get elasticsearch,kibana
# Password for user "elastic"
kubectl -n logging get secret logs-es-elastic-user -o jsonpath='{.data.elastic}' | base64 -d
```

ECK enables TLS and authentication by default (service `logs-es-http`, port 9200, HTTPS), handles rolling upgrades and scales node sets safely.

### Step 2b: Or a Plain StatefulSet (lab)

```yaml
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
    - { port: 9200, name: http }
    - { port: 9300, name: transport }
---
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
      securityContext:
        fsGroup: 1000                # instead of a privileged chown init container
      initContainers:
        - name: sysctl
          image: busybox:1.36
          command: ["sysctl", "-w", "vm.max_map_count=262144"]
          securityContext:
            privileged: true
      containers:
        - name: elasticsearch
          image: docker.elastic.co/elasticsearch/elasticsearch:8.17.0
          env:
            - name: cluster.name
              value: k8s-logs
            - name: node.name
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: discovery.seed_hosts
              value: "elasticsearch-0.elasticsearch,elasticsearch-1.elasticsearch,elasticsearch-2.elasticsearch"
            - name: cluster.initial_master_nodes
              value: "elasticsearch-0,elasticsearch-1,elasticsearch-2"
            - name: ES_JAVA_OPTS
              value: "-Xms1g -Xmx1g"     # ~50% of the memory limit
            - name: xpack.security.enabled
              value: "false"             # lab only — enable TLS/auth for anything real
          ports:
            - { containerPort: 9200, name: http }
            - { containerPort: 9300, name: transport }
          resources:
            requests: { memory: 2Gi, cpu: 500m }
            limits: { memory: 2Gi }
          volumeMounts:
            - name: data
              mountPath: /usr/share/elasticsearch/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 50Gi
```

Kibana for this variant: a Deployment of `docker.elastic.co/kibana/kibana:8.17.0` with `ELASTICSEARCH_HOSTS=http://elasticsearch:9200` and a Service on port 5601.

### Step 3: Fluentd RBAC

```yaml
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
    resources: [pods, namespaces]
    verbs: [get, list, watch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: fluentd
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: fluentd
subjects:
  - kind: ServiceAccount
    name: fluentd
    namespace: logging
```

### Step 4: Fluentd Configuration

```yaml
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
      exclude_path ["/var/log/containers/fluentd-*.log"]
      pos_file /var/log/fluentd-containers.log.pos
      tag kubernetes.*
      read_from_head true
      <parse>
        @type cri                      # containerd / CRI-O format: "<time> stdout F <log>"
      </parse>
    </source>

    # Re-join lines split by the runtime (P = partial, F = full)
    <filter kubernetes.**>
      @type concat
      key message
      use_partial_cri_logtag true
      partial_cri_logtag_key logtag
      partial_cri_stream_key stream
    </filter>

    <filter kubernetes.**>
      @type kubernetes_metadata
      skip_labels false
      skip_container_metadata false
      skip_master_url true
    </filter>

    # Parse JSON application logs when present; keep plain text otherwise
    <filter kubernetes.**>
      @type parser
      key_name message
      reserve_data true
      remove_key_name_field false
      emit_invalid_record_to_error false
      <parse>
        @type json
      </parse>
    </filter>

    <match kubernetes.**>
      @type elasticsearch
      host "#{ENV['FLUENT_ELASTICSEARCH_HOST']}"
      port 9200
      scheme "#{ENV['FLUENT_ELASTICSEARCH_SCHEME']}"
      user "#{ENV['FLUENT_ELASTICSEARCH_USER']}"
      password "#{ENV['FLUENT_ELASTICSEARCH_PASSWORD']}"
      ssl_verify false                  # mount the ECK CA and set ca_file instead in prod
      logstash_format true
      logstash_prefix k8s-logs
      include_tag_key true
      <buffer>
        @type file
        path /var/log/fluentd-buffers/kubernetes.buffer
        flush_mode interval
        flush_interval 5s
        retry_type exponential_backoff
        retry_max_interval 30
        chunk_limit_size 8M
        total_limit_size 2G
        overflow_action block
      </buffer>
    </match>
```

### Step 5: Fluentd DaemonSet

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
          image: fluent/fluentd-kubernetes-daemonset:v1.17-debian-elasticsearch8-1
          env:
            - name: FLUENT_ELASTICSEARCH_HOST
              value: logs-es-http.logging.svc      # "elasticsearch" for the StatefulSet variant
            - name: FLUENT_ELASTICSEARCH_SCHEME
              value: https                         # http for the lab StatefulSet
            - name: FLUENT_ELASTICSEARCH_USER
              value: elastic
            - name: FLUENT_ELASTICSEARCH_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: logs-es-elastic-user
                  key: elastic
          resources:
            requests: { memory: 200Mi, cpu: 100m }
            limits: { memory: 512Mi }
          volumeMounts:
            - name: varlog
              mountPath: /var/log
            - name: config
              mountPath: /fluentd/etc/fluent.conf
              subPath: fluent.conf
      volumes:
        - name: varlog
          hostPath:
            path: /var/log                 # /var/log/containers symlinks into /var/log/pods
        - name: config
          configMap:
            name: fluentd-config
```

Use a dedicated Elasticsearch user with only index/create privileges on `k8s-logs-*` rather than `elastic` in production. **Fluent Bit** is a lighter drop-in collector (C, ~10× less memory) with the same outputs — see [Fluent Bit logging](/recipes/observability/kubernetes-logging-fluentbit-guide/).

### Step 6: Retention with ILM

```bash
ES=https://localhost:9200; AUTH="elastic:$(kubectl -n logging get secret logs-es-elastic-user -o jsonpath='{.data.elastic}' | base64 -d)"
kubectl -n logging port-forward svc/logs-es-http 9200 &

curl -sk -u "$AUTH" -X PUT "$ES/_ilm/policy/k8s-logs" -H 'Content-Type: application/json' -d '{
  "policy": { "phases": {
    "hot":    { "actions": { "rollover": { "max_age": "1d", "max_primary_shard_size": "30gb" } } },
    "delete": { "min_age": "14d", "actions": { "delete": {} } }
  } } }'

curl -sk -u "$AUTH" -X PUT "$ES/_index_template/k8s-logs" -H 'Content-Type: application/json' -d '{
  "index_patterns": ["k8s-logs-*"],
  "template": { "settings": {
    "number_of_shards": 1, "number_of_replicas": 1,
    "index.lifecycle.name": "k8s-logs" } } }'
```

For larger clusters add a `warm` phase (`"min_age": "7d"`, `forcemerge` to 1 segment, `allocate` to warm-tier nodes) before delete to cut heap and disk cost on older indices.

With `logstash_format` (daily indices) the delete phase is what matters; for true rollover write to a data stream instead (`data_stream_name` in fluent-plugin-elasticsearch).

### Step 7: Access Kibana and Search

```bash
kubectl -n logging port-forward svc/logs-kb-http 5601    # https://localhost:5601, user elastic
```

Create a data view for `k8s-logs-*` with `@timestamp`, then in Discover:

```text
kubernetes.namespace_name : "production" and level : "error"
kubernetes.pod_name : myapp-* and message : "timeout"
kubernetes.container_name : "nginx" and status >= 500
kubernetes.labels.app : "checkout" and not message : "healthz"
```

Expose Kibana through an Ingress/Route with TLS and SSO (Kibana has its own login when security is enabled). Emit structured JSON from applications (`{"level":"error","msg":"...","trace_id":"..."}`) so fields are queryable without grok.

## Common Issues

**No logs / `pattern not matched` warnings** — the source uses `@type json` on containerd/CRI-O nodes. Use the `cri` parser (Docker-JSON logs only exist on dockershim-era nodes).

**Multi-line stack traces split into many documents** — add `fluent-plugin-concat` with `multiline_start_regexp` for your language, after the CRI partial-line concat.

**Elasticsearch pods `CrashLoopBackOff`: `max virtual memory areas vm.max_map_count [65530] is too low`** — set the sysctl on nodes (or the privileged init container; on OpenShift, a MachineConfig/Tuned profile).

**Cluster `yellow`/`red`** — replicas can't be allocated (fewer nodes than replicas + 1, or disk watermark reached at 85/90%). `GET _cluster/allocation/explain`.

**Fluentd `buffer space has too many data`** — Elasticsearch is slower than ingest. Scale ES, raise `total_limit_size`, drop noisy namespaces with a `grep` filter.

**Kibana Discover shows "No results"** — no data view for `k8s-logs-*`, the wrong timestamp field, or a time picker window older than the first indexed log. Check `GET _cat/indices/k8s-logs-*?v` first to confirm documents exist.

**Mapping conflicts (`mapper_parsing_exception`)** — the same JSON field has different types across apps. Namespace app fields (`app.*`), or use separate indices per team.

## Best Practices

- **ECK for Elasticsearch/Kibana** — TLS, auth and safe upgrades out of the box
- **CRI parser + Kubernetes metadata filter** on every node
- **ILM retention** (7–30 days hot) and snapshot to S3 for long-term compliance
- **Dedicated ES nodes** (taints/affinity) with fast SSD storage; heap ≤ 50% of memory
- **Least-privilege writer user** for Fluentd
- **Consider Fluent Bit** for collection and **Loki** if you don't need full-text indexing

## Frequently Asked Questions

### What is the EFK stack?

Elasticsearch, Fluentd and Kibana: Fluentd collects and enriches logs from every node, Elasticsearch indexes and stores them, Kibana searches and visualises them. ELK is the same idea with Logstash as the processing layer; many clusters now use Fluent Bit in place of Fluentd (sometimes called EFK too).

### EFK vs Loki — which should I use?

EFK indexes full text, so arbitrary searches and field analytics are fast, but it costs far more CPU, RAM and disk. Loki indexes only labels and greps compressed chunks in object storage — much cheaper, ideal if you already use Grafana. See [Loki log aggregation](/recipes/observability/kubernetes-log-aggregation-loki/).

### Fluentd or Fluent Bit?

Fluent Bit (C) uses a fraction of the memory and is the usual node-level collector today; Fluentd (Ruby) has a larger plugin ecosystem and is often used as a central aggregator. Both can write straight to Elasticsearch.

### What about OpenShift?

OpenShift Logging 6 uses the Cluster Logging Operator with Vector as collector and LokiStack as the default store; forwarding to an external Elasticsearch is supported via `ClusterLogForwarder`.

### How much storage do I need?

Roughly daily log volume × retention days × (1 + replicas) × ~1.1 for index overhead. 20 GB/day, 14 days, 1 replica ≈ 620 GB across the cluster.

## Key Takeaways

- Fluentd DaemonSet → Elasticsearch → Kibana gives cluster-wide full-text log search
- Use the CRI parser on containerd/CRI-O nodes and enrich with Kubernetes metadata
- Run Elasticsearch/Kibana with ECK, set ILM retention, and size heap and disk deliberately
- For lower cost, Fluent Bit and Loki are lighter alternatives
