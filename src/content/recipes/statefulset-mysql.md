---
title: "How to Deploy MySQL with StatefulSet"
description: "Deploy a production-ready MySQL database on Kubernetes using StatefulSet. Learn persistent storage, headless services, and backup strategies."
category: "storage"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "A StorageClass for dynamic provisioning"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "pvc-storageclass-examples"
  - "configmap-secrets-management"
tags:
  - statefulset
  - mysql
  - database
  - persistent-storage
  - headless-service
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You need to run MySQL on Kubernetes with persistent storage, stable network identity, and ordered deployment/scaling.

## The Solution

Use a StatefulSet with PersistentVolumeClaims to deploy MySQL with stable storage and predictable pod names.

## Understanding StatefulSets

StatefulSets provide:
- Stable, unique network identifiers
- Stable, persistent storage
- Ordered deployment and scaling
- Ordered, automated rolling updates

## Step 1: Create a Secret for MySQL Password

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mysql-secret
type: Opaque
stringData:
  mysql-root-password: "YourSecurePassword123!"
  mysql-password: "AppPassword456!"
```

Apply it:

```bash
kubectl apply -f mysql-secret.yaml
```

## Step 2: Create a ConfigMap for MySQL Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mysql-config
data:
  my.cnf: |
    [mysqld]
    default-authentication-plugin=mysql_native_password
    max_connections=200
    innodb_buffer_pool_size=256M
    innodb_log_file_size=64M
    slow_query_log=1
    slow_query_log_file=/var/log/mysql/slow.log
    long_query_time=2
```

## Step 3: Create a Headless Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql
  labels:
    app: mysql
spec:
  ports:
  - port: 3306
    name: mysql
  clusterIP: None  # Headless service
  selector:
    app: mysql
```

## Step 4: Create the StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql
  replicas: 1
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      terminationGracePeriodSeconds: 30
      containers:
      - name: mysql
        image: mysql:8.0
        ports:
        - containerPort: 3306
          name: mysql
        env:
        - name: MYSQL_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: mysql-root-password
        - name: MYSQL_DATABASE
          value: "myapp"
        - name: MYSQL_USER
          value: "appuser"
        - name: MYSQL_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: mysql-password
        volumeMounts:
        - name: data
          mountPath: /var/lib/mysql
        - name: config
          mountPath: /etc/mysql/conf.d
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "1"
        livenessProbe:
          exec:
            command:
            - mysqladmin
            - ping
            - -h
            - localhost
            - -u
            - root
            - -p${MYSQL_ROOT_PASSWORD}
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
        readinessProbe:
          exec:
            command:
            - mysql
            - -h
            - localhost
            - -u
            - root
            - -p${MYSQL_ROOT_PASSWORD}
            - -e
            - "SELECT 1"
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 2
      volumes:
      - name: config
        configMap:
          name: mysql-config
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: "standard"  # Use your StorageClass
      resources:
        requests:
          storage: 10Gi
```

## Step 5: Create a Service for External Access

For applications to connect:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-external
spec:
  type: ClusterIP
  ports:
  - port: 3306
    targetPort: 3306
  selector:
    app: mysql
```

## Connecting to MySQL

### From Within the Cluster

DNS name: `mysql-0.mysql.<namespace>.svc.cluster.local`

```bash
mysql -h mysql-0.mysql.default.svc.cluster.local -u root -p
```

### Using kubectl

```bash
kubectl exec -it mysql-0 -- mysql -u root -p
```

### From Your Application

```yaml
env:
- name: DATABASE_HOST
  value: "mysql-0.mysql"
- name: DATABASE_PORT
  value: "3306"
- name: DATABASE_NAME
  value: "myapp"
```

## Backup Strategy

### Manual Backup

```bash
kubectl exec mysql-0 -- mysqldump -u root -p${MYSQL_ROOT_PASSWORD} --all-databases > backup.sql
```

### CronJob for Automated Backups

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mysql-backup
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: mysql:8.0
            command:
            - /bin/sh
            - -c
            - |
              mysqldump -h mysql-0.mysql -u root -p${MYSQL_ROOT_PASSWORD} \
                --all-databases | gzip > /backup/mysql-$(date +%Y%m%d).sql.gz
            env:
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secret
                  key: mysql-root-password
            volumeMounts:
            - name: backup
              mountPath: /backup
          restartPolicy: OnFailure
          volumes:
          - name: backup
            persistentVolumeClaim:
              claimName: mysql-backup-pvc
```

## Scaling Considerations

### Single Instance
For simple applications, one replica is sufficient.

### MySQL Replication
For high availability, consider:
- MySQL Group Replication
- Percona XtraDB Cluster
- MySQL Operator

## Monitoring MySQL

Add Prometheus exporter:

```yaml
- name: exporter
  image: prom/mysqld-exporter:latest
  ports:
  - containerPort: 9104
    name: metrics
  env:
  - name: DATA_SOURCE_NAME
    value: "exporter:exporterpassword@(localhost:3306)/"
```

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -l app=mysql
kubectl describe pod mysql-0
```

### View Logs

```bash
kubectl logs mysql-0
```

### Check PVC

```bash
kubectl get pvc
kubectl describe pvc data-mysql-0
```

### Access MySQL Shell

```bash
kubectl exec -it mysql-0 -- mysql -u root -p
```

## Best Practices

1. **Use Secrets** for passwords
2. **Set resource limits** to prevent resource starvation
3. **Configure backups** before going to production
4. **Use PodDisruptionBudget** for maintenance windows
5. **Monitor disk usage** to avoid running out of space

## Key Takeaways

- StatefulSets provide stable identity and storage
- Headless services enable direct pod DNS
- PersistentVolumeClaims retain data across restarts
- Always implement backup strategies
- Consider operators for production deployments
