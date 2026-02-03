---
title: "How to Manage StatefulSets"
description: "Deploy stateful applications with StatefulSets. Configure stable network identities, persistent storage, ordered deployment, and graceful scaling."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["statefulset", "stateful", "storage", "databases", "persistence"]
---

> **💡 Quick Answer:** StatefulSet = stable pod names (`web-0`, `web-1`), persistent storage per pod, and ordered deployment. Requires a headless Service (`clusterIP: None`). Each pod gets its own PVC via `volumeClaimTemplates`. Scale carefully: `kubectl scale statefulset web --replicas=5`. Pods are created/deleted in order. Use for databases, Kafka, ZooKeeper—not for stateless apps.

# How to Manage StatefulSets

StatefulSets manage stateful applications requiring stable network identities, persistent storage, and ordered deployment. They're essential for databases, distributed systems, and applications with strict ordering requirements.

## Basic StatefulSet

```yaml
# basic-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: web-headless
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:latest
          ports:
            - containerPort: 80
          volumeMounts:
            - name: data
              mountPath: /usr/share/nginx/html
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 1Gi
---
# Headless service for stable DNS
apiVersion: v1
kind: Service
metadata:
  name: web-headless
spec:
  clusterIP: None
  selector:
    app: web
  ports:
    - port: 80
```

## Stable Network Identity

```bash
# Pods get stable DNS names:
# <pod-name>.<service-name>.<namespace>.svc.cluster.local
# web-0.web-headless.default.svc.cluster.local
# web-1.web-headless.default.svc.cluster.local
# web-2.web-headless.default.svc.cluster.local

# Test DNS resolution
kubectl run tmp --image=busybox --rm -it -- nslookup web-0.web-headless
```

## Database StatefulSet (PostgreSQL)

```yaml
# postgres-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres-headless
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
          image: postgres:15
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
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
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
        name: postgres-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 10Gi
---
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
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
```

## Update Strategies

### Rolling Update (Default)

```yaml
# rolling-update.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 0  # All pods will be updated
      maxUnavailable: 1  # K8s 1.24+
  # ...
```

### Partitioned Rolling Update

```yaml
# partitioned-update.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  replicas: 5
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 3  # Only pods with ordinal >= 3 will be updated
  # ...
```

```bash
# Canary update: Update partition to test on subset
kubectl patch statefulset web -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":4}}}}'

# Then gradually lower partition to roll out
kubectl patch statefulset web -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":2}}}}'
kubectl patch statefulset web -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":0}}}}'
```

### OnDelete Update

```yaml
# ondelete-update.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: database
spec:
  updateStrategy:
    type: OnDelete  # Only update when pod is manually deleted
  # ...
```

## Pod Management Policy

### OrderedReady (Default)

```yaml
# ordered-ready.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: zookeeper
spec:
  podManagementPolicy: OrderedReady
  # Pods are created/deleted sequentially
  # Pod N+1 waits for Pod N to be Running and Ready
```

### Parallel

```yaml
# parallel.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web-parallel
spec:
  podManagementPolicy: Parallel
  # All pods are created/deleted in parallel
  # Useful when pods don't depend on each other
```

## Scaling StatefulSets

```bash
# Scale up (pods added in order: 3, 4, 5...)
kubectl scale statefulset web --replicas=5

# Scale down (pods removed in reverse: 4, 3, 2...)
kubectl scale statefulset web --replicas=2

# Note: PVCs are NOT deleted when scaling down
kubectl get pvc  # PVCs persist for potential scale-up
```

## PVC Retention Policy (K8s 1.27+)

```yaml
# pvc-retention.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  persistentVolumeClaimRetentionPolicy:
    whenDeleted: Retain    # Keep PVCs when StatefulSet is deleted
    whenScaled: Delete     # Delete PVCs when scaling down
  # Options: Retain (default), Delete
```

## Init Containers for Initialization

```yaml
# statefulset-init.yaml
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
              # Generate server-id from pod ordinal
              [[ $HOSTNAME =~ -([0-9]+)$ ]] || exit 1
              ordinal=${BASH_REMATCH[1]}
              echo "[mysqld]" > /mnt/conf.d/server-id.cnf
              echo "server-id=$((100 + $ordinal))" >> /mnt/conf.d/server-id.cnf
              
              # Copy appropriate config based on ordinal
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

## Headless Service for Discovery

```yaml
# headless-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: redis-headless
spec:
  clusterIP: None  # Headless - no load balancing
  selector:
    app: redis
  ports:
    - port: 6379
      name: redis
---
# Regular service for client access
apiVersion: v1
kind: Service
metadata:
  name: redis
spec:
  selector:
    app: redis
  ports:
    - port: 6379
```

## Check StatefulSet Status

```bash
# View StatefulSet
kubectl get statefulsets
kubectl describe statefulset web

# Check pods with ordinals
kubectl get pods -l app=web

# View PVCs
kubectl get pvc -l app=web

# Check update status
kubectl rollout status statefulset web

# View history
kubectl rollout history statefulset web
```

## Debugging StatefulSets

```bash
# Check pod events
kubectl describe pod web-0

# Check PVC binding
kubectl get pvc data-web-0 -o yaml

# Verify DNS
kubectl run tmp --image=busybox --rm -it -- nslookup web-headless

# Test connectivity between pods
kubectl exec web-0 -- ping web-1.web-headless

# Check volume mounts
kubectl exec web-0 -- df -h
kubectl exec web-0 -- ls -la /data
```

## Delete StatefulSet

```bash
# Delete StatefulSet only (pods and PVCs persist)
kubectl delete statefulset web --cascade=orphan

# Delete StatefulSet and pods (PVCs persist)
kubectl delete statefulset web

# Delete everything including PVCs
kubectl delete statefulset web
kubectl delete pvc -l app=web
```

## Best Practices

```yaml
# production-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: database
spec:
  serviceName: database-headless
  replicas: 3
  podManagementPolicy: OrderedReady
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 0
  selector:
    matchLabels:
      app: database
  template:
    metadata:
      labels:
        app: database
    spec:
      terminationGracePeriodSeconds: 120  # Allow time for graceful shutdown
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: database
              topologyKey: kubernetes.io/hostname
      containers:
        - name: database
          image: postgres:15
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "1000m"
          readinessProbe:
            exec:
              command: ["pg_isready"]
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            exec:
              command: ["pg_isready"]
            initialDelaySeconds: 30
            periodSeconds: 10
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 100Gi
```

## Summary

StatefulSets provide stable identities, ordered deployment, and persistent storage for stateful applications. Use headless services for DNS-based discovery, volumeClaimTemplates for per-pod storage, and appropriate update strategies for safe rollouts. Remember that PVCs persist after scale-down for data safety.

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
