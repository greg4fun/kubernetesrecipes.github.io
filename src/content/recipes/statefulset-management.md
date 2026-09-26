---
title: "Kubernetes StatefulSet Guide with Examples"
description: "Kubernetes StatefulSet guide: stable pod names and DNS, per-pod PVCs, ordered scaling, partitioned rolling updates, PVC retention and troubleshooting."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
author: "Luca Berton"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags: ["statefulset", "stateful", "storage", "databases", "persistence", "headless-service", "ordered-deployment", "cka"]
relatedRecipes:
  - "kubernetes-statefulset-headless-service-guide"
  - "deployment-vs-statefulset"
  - "statefulset-mysql"
  - "kubernetes-persistent-volume-guide"
  - "kubernetes-graceful-shutdown-guide"
  - "kubernetes-init-containers-patterns-examples"
  - "pod-topology-constraints"
  - "kubernetes-leases"
  - "argocd-presync-postsync-hooks"
  - "kubernetes-blue-green-deployment"
---

> **💡 Quick Answer:** StatefulSet = stable pod names (`web-0`, `web-1`), stable per-pod DNS, one PVC per pod via `volumeClaimTemplates`, and ordered create/scale/update. It needs a headless Service (`clusterIP: None`) named in `spec.serviceName`. Scale with `kubectl scale statefulset web --replicas=5` — pods are added in ordinal order and removed highest-first; PVCs are kept. Use it for databases, Kafka, ZooKeeper, etcd, Elasticsearch — not for stateless apps.

Deployments treat pods as interchangeable. Some workloads can't:

- **Stable hostnames** — replicas need to know who is primary and who is `-1`, `-2`
- **Stable storage** — each pod must reattach to *its own* volume after rescheduling
- **Ordered startup** — `pod-0` must be Ready before `pod-1` joins the quorum
- **Ordered termination** — scale down from the highest ordinal first

## Basic StatefulSet (PostgreSQL)

```yaml
# Headless Service: required for per-pod DNS
apiVersion: v1
kind: Service
metadata:
  name: postgres-headless
spec:
  clusterIP: None
  selector:
    app: postgres
  ports:
    - port: 5432
---
# Optional regular Service for client access (load-balanced across pods)
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres-headless   # must match the headless Service
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: password
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "postgres"]
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "postgres"]
            initialDelaySeconds: 30
            periodSeconds: 10
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 50Gi
```

> Three replicas of the `postgres` image are three **independent** servers, not a replicated cluster. Replication is the application's job — use an operator (CloudNativePG, Zalando, Crunchy) for real HA PostgreSQL.

## Stable Network Identity

```bash
kubectl get pods -l app=postgres
# postgres-0   1/1   Running
# postgres-1   1/1   Running
# postgres-2   1/1   Running

# Per-pod DNS: <pod>.<serviceName>.<namespace>.svc.cluster.local
# postgres-0.postgres-headless.default.svc.cluster.local

kubectl run tmp --image=busybox:1.36 --rm -it --restart=Never -- nslookup postgres-0.postgres-headless
# Address: 10.244.1.5

# The headless Service name itself returns every Ready pod IP (no VIP)
kubectl run tmp --image=busybox:1.36 --rm -it --restart=Never -- nslookup postgres-headless
```

The pod IP changes on reschedule; the DNS name does not. Clients must connect by name, not IP. See [StatefulSet headless Service](/recipes/deployments/kubernetes-statefulset-headless-service-guide/) for DNS details and `publishNotReadyAddresses`.

## Stable Storage

```bash
kubectl get pvc -l app=postgres
# NAME              STATUS   VOLUME      CAPACITY
# data-postgres-0   Bound    pv-abc123   50Gi
# data-postgres-1   Bound    pv-def456   50Gi
# data-postgres-2   Bound    pv-ghi789   50Gi
```

PVC name = `<template name>-<statefulset name>-<ordinal>`. If `postgres-1` is rescheduled, it reattaches to `data-postgres-1`. With zonal block storage (EBS, PD, most CSI RWO volumes) the pod can only reschedule into the volume's zone — use `volumeBindingMode: WaitForFirstConsumer` on the StorageClass and spread replicas across zones.

## Ordering and Pod Management Policy

```bash
# Scale up: adds next ordinals in order (3, then 4)
kubectl scale statefulset postgres --replicas=5

# Scale down: removes highest ordinal first (4, 3, 2)
kubectl scale statefulset postgres --replicas=2
```

```yaml
spec:
  podManagementPolicy: OrderedReady   # default: pod N+1 waits for pod N Running+Ready
  # podManagementPolicy: Parallel     # launch/terminate all pods at once
```

`Parallel` only affects **scaling** (create/delete). Rolling updates still go one pod at a time unless you set `maxUnavailable`. Keep `OrderedReady` for databases and quorum systems; use `Parallel` for peer-independent workloads (e.g. sharded caches) to speed up scale-out.

## Update Strategies

### RollingUpdate (default)

Pods are updated in **reverse ordinal order** (highest first), one at a time, each waiting for the previous to become Ready.

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 0          # update all pods
      maxUnavailable: 1     # needs MaxUnavailableStatefulSet feature gate (alpha since 1.24)
```

### Partitioned rollout (canary)

Only pods with ordinal `>= partition` get the new template:

```bash
# 5 replicas: canary on postgres-4 only
kubectl patch statefulset postgres -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":4}}}}'
kubectl set image statefulset/postgres postgres=postgres:16.4

# Verify, then widen
kubectl patch statefulset postgres -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":2}}}}'
kubectl patch statefulset postgres -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":0}}}}'
```

### OnDelete

```yaml
spec:
  updateStrategy:
    type: OnDelete   # pods pick up the new template only when you delete them
```

Use `OnDelete` when an operator or runbook must control failover order (e.g. update replicas first, primary last).

## PVC Retention Policy

```yaml
spec:
  persistentVolumeClaimRetentionPolicy:   # beta/on-by-default 1.27, GA 1.32
    whenDeleted: Retain   # keep PVCs when the StatefulSet is deleted
    whenScaled: Delete    # delete PVCs of pods removed by scale-down
  # Both default to Retain
```

## Per-Ordinal Configuration with an Init Container

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql-headless
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      initContainers:
        - name: init-mysql
          image: mysql:8.0
          command:
            - bash
            - -c
            - |
              set -ex
              [[ $HOSTNAME =~ -([0-9]+)$ ]] || exit 1
              ordinal=${BASH_REMATCH[1]}
              echo "[mysqld]" > /mnt/conf.d/server-id.cnf
              echo "server-id=$((100 + ordinal))" >> /mnt/conf.d/server-id.cnf
              if [[ $ordinal -eq 0 ]]; then
                cp /mnt/config-map/primary.cnf /mnt/conf.d/
              else
                cp /mnt/config-map/replica.cnf /mnt/conf.d/
              fi
          volumeMounts:
            - name: conf
              mountPath: /mnt/conf.d
            - name: config-map
              mountPath: /mnt/config-map
      containers:
        - name: mysql
          image: mysql:8.0
          volumeMounts:
            - name: data
              mountPath: /var/lib/mysql
            - name: conf
              mountPath: /etc/mysql/conf.d
      volumes:
        - name: conf
          emptyDir: {}
        - name: config-map
          configMap:
            name: mysql-config
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

Since 1.28 (GA 1.31) pods also carry the label `apps.kubernetes.io/pod-index`, so you can read the ordinal via the Downward API instead of parsing `$HOSTNAME`.

## Production Hardening

```yaml
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 120      # time to flush/checkpoint
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: postgres
              topologyKey: kubernetes.io/hostname
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: postgres
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: postgres
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: postgres
```

## Status, History and Debugging

```bash
kubectl get statefulset postgres
kubectl describe statefulset postgres
kubectl rollout status statefulset postgres
kubectl rollout history statefulset postgres
kubectl rollout undo statefulset postgres        # rolls back the template, not the data

kubectl describe pod postgres-0                  # scheduling / probe events
kubectl get pvc data-postgres-0 -o yaml          # binding, storage class, zone
kubectl exec postgres-0 -- df -h /var/lib/postgresql/data
```

## Deleting a StatefulSet

```bash
# Ordered, graceful teardown: scale to 0 first (deletion itself gives no ordering guarantee)
kubectl scale statefulset postgres --replicas=0
kubectl delete statefulset postgres

# Keep pods running, remove only the controller
kubectl delete statefulset postgres --cascade=orphan

# PVCs survive by default — delete explicitly when the data is no longer needed
kubectl delete pvc -l app=postgres
```

## StatefulSet vs Deployment

| Feature | Deployment | StatefulSet |
|---------|-----------|-------------|
| Pod names | Random suffix | Ordinal (`-0`, `-1`, `-2`) |
| DNS per pod | No | Yes (via headless Service) |
| Storage | Shared PVC (or none) | One PVC per pod |
| Startup order | Parallel | Sequential (default) |
| Scale-down order | Arbitrary | Highest ordinal first |
| Rolling update | `maxSurge`/`maxUnavailable`, new pods first | One pod at a time, highest ordinal first, no surge |
| Use case | Stateless apps | Databases, brokers, quorum systems |

Details: [Deployment vs StatefulSet](/recipes/deployments/deployment-vs-statefulset/).

## Common Issues

**Pods stuck in Pending** — PVC can't be provisioned or bound. `kubectl describe pvc data-postgres-0`; check the StorageClass exists and its zone matches a schedulable node.

**`postgres-1` never starts** — with `OrderedReady`, it waits for `postgres-0` to be Ready. Fix pod 0 first (`kubectl describe pod postgres-0`).

**Rollout stuck on a broken pod** — a known StatefulSet behaviour: after you fix the template, a pod that never became Ready may not be replaced automatically. Delete it (`kubectl delete pod postgres-2`) to force recreation with the new revision.

**PVCs left behind after delete/scale-down** — by design. Set `persistentVolumeClaimRetentionPolicy` or delete them manually.

**Split-brain after a network partition** — Kubernetes doesn't prevent it. Use the database's native replication/consensus or leader election via [Leases](/recipes/deployments/kubernetes-leases/).

## Frequently Asked Questions

### Why does a StatefulSet need a headless Service?

The headless Service (`clusterIP: None`) is what creates the per-pod DNS records (`postgres-0.postgres-headless`). `spec.serviceName` must name it. Without it pods still run, but they get no stable network identity.

### When should I use a StatefulSet instead of a Deployment?

When pods need a stable name, their own persistent volume, or ordered startup: databases, Kafka, ZooKeeper, etcd, Elasticsearch, Redis with persistence. For stateless web/API workloads use a Deployment.

### Are PVCs deleted when I scale down or delete a StatefulSet?

No, not by default. Both `whenScaled` and `whenDeleted` default to `Retain`. Scaling back up reattaches the old PVCs to the same ordinals.

### How do I do a canary update on a StatefulSet?

Set `updateStrategy.rollingUpdate.partition` to N: only ordinals `>= N` are updated. Lower the partition step by step to 0 to finish the rollout.

### Can StatefulSet pods start in parallel?

Yes — `podManagementPolicy: Parallel` creates and deletes pods without waiting. It doesn't change rolling updates, which remain one at a time.
