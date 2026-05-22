---
title: "Private Container Registry on Kubernetes"
description: "Deploy a private OCI container registry on Kubernetes with persistent storage, TLS, authentication, garbage collection, and high availability. Self-hosted alternative to Docker Hub with full control over image distribution."
tags:
  - "registry"
  - "oci"
  - "container-images"
  - "storage"
  - "security"
category: "deployments"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "oci-container-image-internals-kubernetes"
  - "kubernetes-image-pull-secrets"
  - "kubernetes-tls-certificates-cert-manager"
  - "harbor-container-registry-kubernetes"
---

> 💡 **Quick Answer:** Deploy the CNCF Distribution registry (the reference OCI registry implementation) on Kubernetes with a Deployment, PVC for blob storage, TLS via cert-manager, htpasswd authentication, and a CronJob for garbage collection. This gives you a self-hosted registry for air-gapped clusters or when you need full control over image distribution.

## The Problem

- Docker Hub rate limits (100 pulls/6h for anonymous, 200 for free accounts)
- Can't use public registries in air-gapped or regulated environments
- Need to store proprietary images without external dependencies
- Want image caching/mirroring to reduce egress costs and improve pull speeds
- Require audit trails and access control over who pushes/pulls which images

## The Solution

### Deploy CNCF Distribution Registry

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: registry
---
# Registry configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: registry-config
  namespace: registry
data:
  config.yml: |
    version: 0.1
    log:
      level: info
      formatter: json
    storage:
      filesystem:
        rootdirectory: /var/lib/registry
      delete:
        enabled: true
      cache:
        blobdescriptor: inmemory
    http:
      addr: :5000
      headers:
        X-Content-Type-Options: [nosniff]
    health:
      storagedriver:
        enabled: true
        interval: 10s
        threshold: 3
    # Garbage collection removes unreferenced blobs
    # Run via: registry garbage-collect /etc/docker/registry/config.yml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: registry
  namespace: registry
spec:
  replicas: 1
  selector:
    matchLabels:
      app: registry
  template:
    metadata:
      labels:
        app: registry
    spec:
      containers:
        - name: registry
          image: registry:2.8
          ports:
            - containerPort: 5000
          env:
            - name: REGISTRY_AUTH
              value: "htpasswd"
            - name: REGISTRY_AUTH_HTPASSWD_REALM
              value: "Registry Realm"
            - name: REGISTRY_AUTH_HTPASSWD_PATH
              value: "/auth/htpasswd"
          volumeMounts:
            - name: data
              mountPath: /var/lib/registry
            - name: config
              mountPath: /etc/docker/registry
            - name: auth
              mountPath: /auth
              readOnly: true
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
          readinessProbe:
            httpGet:
              path: /v2/
              port: 5000
            initialDelaySeconds: 5
          livenessProbe:
            httpGet:
              path: /v2/
              port: 5000
            initialDelaySeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: registry-data
        - name: config
          configMap:
            name: registry-config
        - name: auth
          secret:
            secretName: registry-htpasswd
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: registry-data
  namespace: registry
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 100Gi
---
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: registry
spec:
  selector:
    app: registry
  ports:
    - port: 5000
      targetPort: 5000
---
# TLS Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: registry
  namespace: registry
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "0"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "600"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - registry.example.com
      secretName: registry-tls
  rules:
    - host: registry.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: registry
                port:
                  number: 5000
```

### Create Authentication

```bash
# Generate htpasswd file
htpasswd -Bbn admin "$(openssl rand -base64 24)" > htpasswd
htpasswd -Bbn ci-bot "$(openssl rand -base64 24)" >> htpasswd

# Create secret
kubectl create secret generic registry-htpasswd \
  --from-file=htpasswd \
  -n registry
```

### Garbage Collection CronJob

```yaml
# Remove unreferenced blobs (layers no longer pointed to by any manifest)
apiVersion: batch/v1
kind: CronJob
metadata:
  name: registry-gc
  namespace: registry
spec:
  schedule: "0 3 * * 0"              # Weekly Sunday 3 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: gc
              image: registry:2.8
              command:
                - /bin/registry
                - garbage-collect
                - /etc/docker/registry/config.yml
                - --delete-untagged=true
              volumeMounts:
                - name: data
                  mountPath: /var/lib/registry
                - name: config
                  mountPath: /etc/docker/registry
          restartPolicy: OnFailure
          volumes:
            - name: data
              persistentVolumeClaim:
                claimName: registry-data
            - name: config
              configMap:
                name: registry-config
```

### Configure Kubernetes to Pull from Private Registry

```bash
# Create image pull secret
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=ci-bot \
  --docker-password=<password> \
  -n default

# Use in pod spec
# imagePullSecrets:
#   - name: regcred
```

### Mirror Public Images (Pull-Through Cache)

```yaml
# Add to registry config.yml
data:
  config.yml: |
    proxy:
      remoteurl: https://registry-1.docker.io
      username: ""
      password: ""
    # Now: docker pull registry.example.com/library/nginx:1.27
    # First pull → fetches from Docker Hub, caches locally
    # Subsequent pulls → served from local storage
```

## Common Issues

### Push fails with "blob unknown"
- **Cause**: Layer upload interrupted; registry doesn't have the referenced blob
- **Fix**: Retry push; or increase proxy timeouts for large images

### Disk usage grows unbounded
- **Cause**: Garbage collection not running; deleted tags leave orphaned blobs
- **Fix**: Enable delete + run `registry garbage-collect` via CronJob

### 413 Request Entity Too Large
- **Cause**: Ingress/proxy body size limit too small for large layers
- **Fix**: Set `proxy-body-size: "0"` (unlimited) on ingress annotations

## Best Practices

1. **TLS always** — containerd/CRI-O reject insecure registries by default
2. **Garbage collect weekly** — blobs accumulate fast in CI/CD pipelines
3. **Use S3 storage backend** — for HA and unlimited capacity (MinIO or AWS S3)
4. **Separate read/write credentials** — CI pushes, nodes only pull
5. **Monitor disk usage** — alert at 80% PVC capacity
6. **Pull-through cache** — reduces Docker Hub rate limit hits and egress

## Key Takeaways

- CNCF Distribution = reference OCI registry implementation (the `registry:2` image)
- Content-addressable: blobs stored by SHA-256, manifests reference blobs by digest
- Garbage collection required — deleted tags don't free disk until GC runs
- Pull-through cache mode mirrors public registries transparently
- TLS + htpasswd/token auth for secure access; imagePullSecrets for Kubernetes
- For production: consider Harbor (adds vulnerability scanning, RBAC, replication)
