---
title: "Kubernetes Service Account Token Guide"
description: "Create and manage Kubernetes service account tokens. TokenRequest API, projected volumes, long-lived tokens, and RBAC binding for pod-to-API authentication."
category: "security"
publishDate: "2026-04-20"
author: "Luca Berton"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.24+"
tags: ["service-account", "token", "rbac", "authentication", "security", "tokenrequest"]
relatedRecipes:
  - kubernetes-rbac-configuration
  - kubernetes-secrets-management
  - kubernetes-user-onboarding-offboarding-automation
---

> 💡 **Quick Answer:** Since Kubernetes 1.24, service account tokens are no longer auto-created as Secrets. Use `kubectl create token <sa>` for short-lived tokens or projected volumes for pod authentication. Long-lived tokens require explicit Secret creation.

## The Problem

After Kubernetes 1.24:
- Auto-generated Secret-based tokens were removed (KEP-2799)
- Pods still need API authentication for controllers, operators, and sidecar access
- External systems (CI/CD, monitoring) need tokens to access the cluster
- Token rotation and expiry must be managed explicitly

## The Solution

### Short-Lived Token (TokenRequest API)

```bash
# Create a 1-hour token (default)
kubectl create token my-service-account

# Custom expiration (max depends on cluster config)
kubectl create token my-service-account --duration=24h

# For a specific namespace
kubectl create token my-service-account -n production

# With specific audience
kubectl create token my-service-account --audience=https://vault.example.com
```

### Create a Service Account

```yaml
# service-account.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-controller
  namespace: production
  annotations:
    description: "Used by app-controller deployment for API access"
automountServiceAccountToken: false  # Don't auto-mount in pods
```

### Bind RBAC Permissions

```yaml
# role-binding.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-controller-role
  namespace: production
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch"]
  - apiGroups: [""]
    resources: ["pods", "services"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-controller-binding
  namespace: production
subjects:
  - kind: ServiceAccount
    name: app-controller
    namespace: production
roleRef:
  kind: Role
  name: app-controller-role
  apiGroup: rbac.authorization.k8s.io
```

### Projected Volume Token (Recommended for Pods)

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-controller
spec:
  template:
    spec:
      serviceAccountName: app-controller
      automountServiceAccountToken: false
      containers:
        - name: controller
          image: myapp:1.0.0
          volumeMounts:
            - name: sa-token
              mountPath: /var/run/secrets/kubernetes.io/serviceaccount
              readOnly: true
      volumes:
        - name: sa-token
          projected:
            sources:
              - serviceAccountToken:
                  path: token
                  expirationSeconds: 3600   # Auto-rotated before expiry
                  audience: "https://kubernetes.default.svc"
              - configMap:
                  name: kube-root-ca.crt
                  items:
                    - key: ca.crt
                      path: ca.crt
              - downwardAPI:
                  items:
                    - path: namespace
                      fieldRef:
                        fieldPath: metadata.namespace
```

### Long-Lived Token (Legacy / External Use)

```yaml
# long-lived-token.yaml
# Only use when TokenRequest API isn't an option
apiVersion: v1
kind: Secret
metadata:
  name: app-controller-token
  namespace: production
  annotations:
    kubernetes.io/service-account.name: app-controller
type: kubernetes.io/service-account-token
```

```bash
# Retrieve the token
kubectl get secret app-controller-token -n production -o jsonpath='{.data.token}' | base64 -d
```

### Architecture

```mermaid
graph TD
    A[Service Account] --> B{Token Type}
    B -->|Short-lived| C[TokenRequest API]
    B -->|Pod auth| D[Projected Volume]
    B -->|External/Legacy| E[Secret-based Token]
    C --> F[kubectl create token]
    C --> G[1h default, auto-expires]
    D --> H[Auto-rotated by kubelet]
    D --> I[Bound to pod lifetime]
    E --> J[Never expires]
    E --> K[Must manually rotate]
    
    A --> L[RoleBinding]
    L --> M[Role/ClusterRole]
    M --> N[API Access]
```

### Use Token from Application Code

```python
# Python example — reading projected token
import requests
from pathlib import Path

TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
NAMESPACE = Path("/var/run/secrets/kubernetes.io/serviceaccount/namespace").read_text()

token = Path(TOKEN_PATH).read_text()
api_url = "https://kubernetes.default.svc"

# List pods in current namespace
resp = requests.get(
    f"{api_url}/api/v1/namespaces/{NAMESPACE}/pods",
    headers={"Authorization": f"Bearer {token}"},
    verify=CA_PATH
)
print(resp.json()["items"])
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "no service account token" in pod | `automountServiceAccountToken: false` without projected volume | Add projected volume or set `true` |
| Token expired error | TokenRequest token expired | Use projected volume (auto-rotates) |
| 403 Forbidden | Missing RBAC binding | Create Role + RoleBinding for the SA |
| Secret not populated | SA doesn't exist yet | Create ServiceAccount before Secret |
| Token works locally, fails in pod | Wrong audience claim | Match audience in TokenRequest and API server |

## Best Practices

1. **Use projected volumes over Secret-based tokens** — auto-rotated, bound to pod lifetime
2. **Set `automountServiceAccountToken: false`** on ServiceAccount — opt-in per deployment
3. **Scope RBAC minimally** — only the verbs and resources actually needed
4. **Avoid long-lived tokens** — use TokenRequest API or OIDC federation for external access
5. **Set token expiration** — `expirationSeconds: 3600` in projected volumes

## Key Takeaways

- Kubernetes 1.24+ no longer auto-creates Secret-based tokens
- `kubectl create token` generates short-lived tokens (default 1h)
- Projected volumes are the recommended pod authentication method — auto-rotated by kubelet
- Long-lived tokens still work via explicit Secret creation but should be avoided
- Always pair service accounts with least-privilege RBAC bindings
