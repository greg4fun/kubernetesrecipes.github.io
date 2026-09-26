---
title: "Kubernetes ConfigMaps and Secrets Management"
description: "Create, mount and update Kubernetes ConfigMaps and Secrets: env vs volume, immutable config, auto-reload with Reloader, RBAC, and encryption at rest."
category: "configuration"
difficulty: "beginner"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "kubernetes-configmap-guide"
  - "secrets-management-best-practices"
  - "kubernetes-configmap-hot-reload"
  - "kubernetes-envfrom-configmap-environment-variables"
  - "kubernetes-configmap-secret-immutable"
  - "configmap-too-large-error"
  - "external-secrets-operator"
  - "kubernetes-sealed-secrets-management"
  - "environment-variables-configmaps"
  - "kubernetes-kustomize-guide"
  - "kubernetes-downward-api-guide"
  - "kubernetes-admission-controllers-guide"
  - "crashloopbackoff-troubleshooting"
tags:
  - configmap
  - secrets
  - configuration
  - environment-variables
  - volume-mounts
  - immutable
  - reloader
publishDate: "2026-01-21"
author: "Luca Berton"
---

> **💡 Quick Answer:** ConfigMaps hold non-sensitive config as plain text; Secrets hold sensitive data base64-encoded (encoding, **not** encryption) with separate RBAC and optional encryption at rest. Create: `kubectl create configmap myconfig --from-file=config.yaml` / `kubectl create secret generic mysecret --from-literal=password=mypass`. Consume via `envFrom` (`configMapRef` / `secretRef`) or as volume files. Volume mounts update in ~60s; env vars only change on pod restart.
>
> **Gotcha:** Both are capped at **1 MiB** and must live in the same namespace as the pod.

## ConfigMaps

```bash
kubectl create configmap app-config \
  --from-literal=APP_ENV=production \
  --from-literal=LOG_LEVEL=info

kubectl create configmap nginx-config --from-file=nginx.conf     # key = filename
kubectl create configmap app-configs --from-file=config/         # one key per file
kubectl create configmap env-config --from-env-file=app.env      # KEY=VALUE lines
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_ENV: "production"
  LOG_LEVEL: "info"
  config.yaml: |
    database:
      host: postgres.default.svc
      port: 5432
    cache:
      ttl: 3600
```

ConfigMap `data` is stored as plain UTF-8; only `binaryData` is base64. Deep dive on creation and mounting: [ConfigMap guide](/recipes/configuration/kubernetes-configmap-guide/).

## Secrets

```bash
kubectl create secret generic db-creds \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!'
kubectl create secret tls my-tls --cert=tls.crt --key=tls.key
kubectl create secret docker-registry quay-pull \
  --docker-server=quay.example.com \
  --docker-username=robot --docker-password=token
```

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-creds
type: Opaque
stringData:              # plain text in, stored base64 in .data
  username: admin
  password: "S3cur3P@ss!"
```

```bash
kubectl get secret db-creds -o jsonpath='{.data.password}' | base64 -d
```

## Consume Both in a Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  template:
    spec:
      containers:
        - name: app
          image: myapp:v1
          env:
            - name: LOG_LEVEL                 # single ConfigMap key
              valueFrom:
                configMapKeyRef: { name: app-config, key: LOG_LEVEL }
            - name: DB_PASSWORD               # single Secret key
              valueFrom:
                secretKeyRef: { name: db-creds, key: password }
          envFrom:                            # every key as env vars
            - configMapRef: { name: app-config }
            - secretRef: { name: db-creds }
          volumeMounts:
            - name: config-vol
              mountPath: /etc/app/config
              readOnly: true
            - name: secret-vol
              mountPath: /etc/app/secrets
              readOnly: true
      volumes:
        - name: config-vol
          configMap:
            name: app-config
        - name: secret-vol
          secret:
            secretName: db-creds
            defaultMode: 0400
```

| | Env var / envFrom | Volume mount | Volume + `subPath` |
|---|---|---|---|
| Picks up changes | No (restart) | Yes, ~60–90s | **No** |
| Good for | Simple scalar settings | Config files, certs, rotating creds | Dropping one file into an existing dir |

## Immutable ConfigMaps and Secrets

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config-v2
immutable: true
data:
  LOG_LEVEL: debug
```

Immutable objects can't be edited (only deleted/recreated), kubelet stops watching them — a real API-server saving at thousands of pods — and you're forced into versioned names (`app-config-v1`, `-v2`) that roll out and roll back cleanly. Kustomize `configMapGenerator` / `secretGenerator` produce hash-suffixed names that do this automatically. See [immutable ConfigMaps and Secrets](/recipes/configuration/kubernetes-configmap-secret-immutable/).

## Reload Pods When Config Changes

```bash
kubectl rollout restart deployment/app        # manual
```

```bash
helm repo add stakater https://stakater.github.io/stakater-charts
helm install reloader stakater/reloader -n reloader --create-namespace
```

```yaml
metadata:
  annotations:
    reloader.stakater.com/auto: "true"                 # any referenced CM/Secret
    # or explicit:
    # configmap.reloader.stakater.com/reload: "app-config"
    # secret.reloader.stakater.com/reload: "db-creds"
```

Other patterns (checksum annotations in Helm, file watchers, sidecars): [ConfigMap hot reload](/recipes/configuration/kubernetes-configmap-hot-reload/).

## Secure the Secrets

- **Encryption at rest** — base64 is readable by anyone with etcd or `get secrets`; configure `EncryptionConfiguration` (KMS v2 preferred). Walkthrough in [Secrets management best practices](/recipes/security/secrets-management-best-practices/).
- **RBAC** — Secrets are namespace-scoped; grant `get` on named Secrets only:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: secret-reader
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["db-creds"]
    verbs: ["get"]
```

- **Nothing sensitive in Git** — [External Secrets Operator](/recipes/security/external-secrets-operator/), [Sealed Secrets](/recipes/security/kubernetes-sealed-secrets-management/), or SOPS.
- **`defaultMode: 0400`** on secret volumes and never log values.

## Common Issues

**`configmap "x" not found` / `secret "x" not found` in pod events** — object missing or in another namespace; pods can only reference same-namespace objects. Mark optional references with `optional: true` if the pod should start without them.

**Env vars not updating** — expected; they're resolved at container start. Restart or switch to a volume mount.

**Mounted file never updates** — you used `subPath`. Mount the whole directory instead.

**`ConfigMap ... is too long` / 1 MiB exceeded** — split it, compress into `binaryData`, or move the payload to a volume. See [ConfigMap too large](/recipes/troubleshooting/configmap-too-large-error/).

**`envFrom` skips some keys** — keys that aren't valid env var names (e.g. `config.yaml`) are skipped and reported as an event; use a volume for those.

## Frequently Asked Questions

### What is the difference between a ConfigMap and a Secret?

A ConfigMap stores non-sensitive configuration as plain text. A Secret stores sensitive values base64-encoded, can be encrypted at rest in etcd, is kept in tmpfs on nodes when mounted, and is usually governed by stricter RBAC. The API shape and consumption methods are nearly identical.

### Are Kubernetes Secrets encrypted?

No, not by default — they're only base64-encoded. Enable encryption at rest on the API server and restrict RBAC, or keep the values in an external secret manager.

### Do pods pick up ConfigMap changes automatically?

Volume-mounted ConfigMaps and Secrets are refreshed by the kubelet within about a minute (unless mounted with `subPath`). Environment variables never change in a running container, so you need a rollout restart or a tool like Reloader.

### What is the maximum size of a ConfigMap or Secret?

1 MiB per object, enforced by the API server (etcd request limit).

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
