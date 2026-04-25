---
title: "Deploy a New App in 5 Minutes on Kubernetes"
description: "Deploy a production-ready application in 5 minutes on an existing Kubernetes cluster. Deployment, Service, Ingress, TLS, autoscaling."
publishDate: "2026-04-19"
author: "Luca Berton"
category: "deployments"
tags:
  - "quick-start"
  - "deployment"
  - "developer-experience"
  - "production-ready"
difficulty: "beginner"
timeToComplete: "15 minutes"
relatedRecipes:
  - "kubernetes-rolling-update-zero-downtime"
  - "kubernetes-gateway-api"
---

> 💡 **Quick Answer:** On a properly configured cluster, deploying a new production-ready app takes one file and one command. This manifest includes: Deployment (with health checks), Service, Ingress/Route (with TLS), HPA (autoscaling), and PDB (availability guarantee). `kubectl apply -f app.yaml` — done in under 5 minutes.

## The Problem

People say "Kubernetes is slow to deploy to." That's true if you're building the cluster. But once the cluster exists, deploying a new service is faster than configuring a VM, installing dependencies, setting up a reverse proxy, configuring TLS, and writing systemd units. It's one file.

## The Solution: One-File Production Deployment

```yaml
# app.yaml — Complete production-ready deployment
# Apply with: kubectl apply -f app.yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-api
  namespace: production
  labels:
    app: my-api
    version: v1
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0        # Zero-downtime deployments
  template:
    metadata:
      labels:
        app: my-api
        version: v1
    spec:
      containers:
        - name: api
          image: registry.example.com/my-api:1.2.3
          ports:
            - containerPort: 8080
              name: http
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: my-api-secrets
                  key: database-url
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: "1"
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
          startupProbe:
            httpGet:
              path: /healthz
              port: http
            failureThreshold: 30
            periodSeconds: 2
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: my-api
---
apiVersion: v1
kind: Service
metadata:
  name: my-api
  namespace: production
spec:
  selector:
    app: my-api
  ports:
    - port: 80
      targetPort: http
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-api
  namespace: production
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts: [api.example.com]
      secretName: my-api-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-api
                port:
                  number: 80
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-api
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-api
  namespace: production
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: my-api
```

### Deploy

```bash
# That's it. One command.
kubectl apply -f app.yaml

# What you get:
# ✅ 3 replicas spread across nodes
# ✅ Zero-downtime rolling updates
# ✅ Auto-TLS via cert-manager
# ✅ Autoscaling 3→20 pods on CPU
# ✅ Health checks (liveness + readiness + startup)
# ✅ PDB guarantees 2 pods always running
# ✅ Resource limits prevent noisy neighbor

# Check status
kubectl get deploy,svc,ingress,hpa,pdb -n production -l app=my-api
```

### Next App? Same Pattern

```bash
# Copy, change image + name + host. Deploy.
sed 's/my-api/my-frontend/g; s/api.example.com/app.example.com/g' app.yaml | kubectl apply -f -

# That's the leverage. Your 50th service deploys the same way as your first.
```

## Compare: VM vs Kubernetes

| Step | Traditional VM | Kubernetes (with platform) |
|------|---------------|---------------------------|
| Provision server | 10-30 min (cloud) / days (on-prem) | Already exists |
| Install runtime | 5-15 min | Already exists (container) |
| Configure reverse proxy | 15-30 min | 3 lines (Ingress) |
| Set up TLS | 10-20 min (certbot) | Automatic (cert-manager) |
| Configure autoscaling | 30-60 min (ASG/scripts) | 8 lines (HPA) |
| Set up monitoring | 30-60 min | Already exists (Prometheus scrapes) |
| Rolling deploys | Custom scripts | Built-in |
| **Total for new app** | **2-4 hours** | **5 minutes** |

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "I don't know what YAML to write" | No templates | Use this recipe as your starting template |
| Image pull fails | Registry auth not configured | Create `imagePullSecrets` once per namespace |
| TLS not provisioning | cert-manager not installed | Platform team installs it once, all apps benefit |
| HPA not scaling | metrics-server not deployed | Install metrics-server (one-time cluster setup) |

## Best Practices

- **Template this file** — use Helm or Kustomize for parameterization
- **Store in Git** — ArgoCD deploys on push
- **One manifest per service** — keep it simple and self-contained
- **Always set resource requests** — scheduler needs them, HPA needs them
- **Always add health checks** — K8s self-heals only if it knows what healthy means

## Key Takeaways

- Kubernetes is "hard" on day 1 (cluster setup) but trivial on day 100 (app deploys)
- One YAML file gives you: deployment, TLS, autoscaling, self-healing, zero-downtime updates
- The same pattern works for your 1st and 100th service — that's the leverage
- Compare: 2-4 hours per app on VMs vs 5 minutes on K8s
- The initial platform investment pays dividends on every subsequent deploy
