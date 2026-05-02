---
title: "K8s ServiceAccount: Pod Identity Guide"
description: "Create Kubernetes ServiceAccounts for pod authentication. Token projection, RBAC binding, workload identity, automountServiceAccountToken, and OIDC federation."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "service-accounts"
  - "security"
  - "rbac"
  - "authentication"
  - "cka"
relatedRecipes:
  - "kubernetes-rbac-role-rolebinding"
  - "oidc-authentication-kubernetes"
  - "image-pull-secrets"
  - "kubernetes-secret-types-guide"
  - "kubernetes-security-context-guide"
---

> 💡 **Quick Answer:** `kubectl create serviceaccount my-app -n production` creates a ServiceAccount. Assign it to pods with `spec.serviceAccountName: my-app`. Bind RBAC permissions with a RoleBinding. Since K8s 1.24, tokens are projected (short-lived, auto-rotated) — no more auto-created Secrets. Disable token mounting with `automountServiceAccountToken: false` for pods that don't need API access.

## The Problem

Pods need identity to:

- Authenticate to the Kubernetes API (watch ConfigMaps, manage resources)
- Pull images from private registries
- Authenticate to cloud services (AWS IAM, GCP Workload Identity)
- Enable fine-grained RBAC per workload

Default `default` ServiceAccount has minimal permissions but is shared by all pods.

## The Solution

### Create and Use ServiceAccount

```bash
# Create ServiceAccount
kubectl create serviceaccount app-sa -n production

# Use in pod
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: my-app
  namespace: production
spec:
  serviceAccountName: app-sa
  containers:
  - name: app
    image: myapp:v2
EOF
```

### Projected Token (K8s 1.24+)

```yaml
# Token is automatically mounted at /var/run/secrets/kubernetes.io/serviceaccount/
# - token: JWT, short-lived (1h), auto-rotated
# - ca.crt: cluster CA certificate
# - namespace: pod's namespace

# Access from inside pod:
# TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
# curl -H "Authorization: Bearer $TOKEN" https://kubernetes.default.svc/api/v1/namespaces
```

### Disable Token Mount

```yaml
# Pod doesn't need API access? Don't mount the token
apiVersion: v1
kind: ServiceAccount
metadata:
  name: no-api-access
automountServiceAccountToken: false

---
# Or per-pod override
apiVersion: v1
kind: Pod
metadata:
  name: web
spec:
  serviceAccountName: no-api-access
  automountServiceAccountToken: false   # Explicit per-pod
  containers:
  - name: web
    image: nginx:1.27
```

### RBAC + ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: configmap-reader
  namespace: production

---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: configmap-reader-role
  namespace: production
rules:
- apiGroups: [""]
  resources: ["configmaps"]
  verbs: ["get", "list", "watch"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: configmap-reader-binding
  namespace: production
subjects:
- kind: ServiceAccount
  name: configmap-reader
  namespace: production
roleRef:
  kind: Role
  name: configmap-reader-role
  apiGroup: rbac.authorization.k8s.io
```

### Image Pull Secrets

```yaml
# Attach image pull secrets to ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: production
imagePullSecrets:
- name: regcred    # All pods using this SA auto-pull with these creds
```

```bash
# Or imperatively
kubectl patch serviceaccount app-sa -n production \
  -p '{"imagePullSecrets": [{"name": "regcred"}]}'
```

### Create Long-Lived Token (When Needed)

```bash
# Short-lived token (recommended, 1h default)
kubectl create token app-sa -n production

# With custom expiration
kubectl create token app-sa -n production --duration=24h

# Long-lived token Secret (legacy pattern, avoid if possible)
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: app-sa-token
  namespace: production
  annotations:
    kubernetes.io/service-account.name: app-sa
type: kubernetes.io/service-account-token
EOF

kubectl get secret app-sa-token -n production -o jsonpath='{.data.token}' | base64 -d
```

### Cloud Workload Identity

```yaml
# GKE Workload Identity
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gcs-reader
  annotations:
    iam.gke.io/gcp-service-account: gcs-reader@project.iam.gserviceaccount.com

---
# AWS IRSA (IAM Roles for Service Accounts)
apiVersion: v1
kind: ServiceAccount
metadata:
  name: s3-reader
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789:role/s3-reader-role
```

## Common Issues

**"forbidden" when accessing API from pod**

ServiceAccount lacks RBAC permissions. Create a Role + RoleBinding. Check: `kubectl auth can-i --as=system:serviceaccount:production:app-sa get pods`.

**Token file empty or missing in pod**

`automountServiceAccountToken: false` set on SA or pod. Remove it or explicitly set to `true`.

**Legacy token Secret not auto-created (K8s 1.24+)**

By design — projected tokens replaced auto-created Secrets. Use `kubectl create token` or create a Secret manually if long-lived token needed.

## Best Practices

- **One ServiceAccount per workload** — not the shared `default`
- **Disable token mount when not needed** — `automountServiceAccountToken: false`
- **Use projected tokens** (short-lived) over long-lived Secret tokens
- **Bind minimal RBAC** — only the verbs and resources the workload needs
- **Use Workload Identity** on cloud — no static credentials, auto-rotating

## Key Takeaways

- ServiceAccounts provide pod identity for API authentication and RBAC
- K8s 1.24+ uses projected tokens (short-lived, auto-rotated) by default
- Bind RBAC permissions via RoleBinding to the ServiceAccount
- Disable token mounting for pods that don't need Kubernetes API access
- Cloud workload identity (GKE, EKS, AKS) maps K8s SAs to cloud IAM roles
