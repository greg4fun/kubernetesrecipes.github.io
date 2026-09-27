---
title: "Kubernetes Service Account: YAML, RBAC, Tokens"
description: "Create a Kubernetes ServiceAccount, attach it to a Deployment, grant least-privilege RBAC with Roles and bindings, and test it with kubectl auth can-i."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
author: "Luca Berton"
tags: ["rbac", "service-accounts", "security", "authorization", "least-privilege", "role", "clusterrole", "tokens"]
relatedRecipes:
  - "kubernetes-rbac-role-clusterrole"
  - "kubernetes-rbac-least-privilege"
  - "kubernetes-service-account-token"
  - "kubernetes-service-accounts-workload-identity"
  - "pod-security-standards"
  - "kubernetes-namespace-guide"
  - "openshift-acs-rhacs-security-guide"
  - "kubernetes-security-context-guide"
  - "workload-identity-cloud-access"
  - "networkpolicy-deny-default-gpu"
---

> 💡 **Quick Answer:** Create a `ServiceAccount` (`kubectl create sa my-app-sa -n production`), then create `Role` (namespace-scoped) or `ClusterRole` (cluster-wide) with verb/resource permissions, then bind with `RoleBinding` or `ClusterRoleBinding`. Reference ServiceAccount in pod spec with `serviceAccountName`. Use `automountServiceAccountToken: false` when not needed.
>
> **Key command:** `kubectl auth can-i --as=system:serviceaccount:<ns>:<sa> --list` shows SA permissions.
>
> **Gotcha:** Every namespace's `default` ServiceAccount is auto-mounted into pods that don't name one. It has no RBAC grants out of the box, but any binding someone adds to it is inherited by every pod in the namespace — use dedicated SAs per workload.


Service accounts provide identity for pods, while RBAC (Role-Based Access Control) controls what actions they can perform. Together they implement the principle of least privilege.

| Resource | Scope | Purpose |
|----------|-------|---------|
| `ServiceAccount` | Namespace | Identity for pods: `system:serviceaccount:<ns>:<name>` |
| `Role` | Namespace | Permissions within one namespace |
| `ClusterRole` | Cluster | Permissions on cluster-scoped resources, or a reusable template |
| `RoleBinding` | Namespace | Grants a Role **or ClusterRole** inside one namespace |
| `ClusterRoleBinding` | Cluster | Grants a ClusterRole in every namespace |

## Create a Service Account

```yaml
# service-account.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app-sa
  namespace: production
automountServiceAccountToken: false  # Don't auto-mount unless needed
```

```bash
kubectl apply -f service-account.yaml
# or imperatively
kubectl create serviceaccount my-app-sa -n production
kubectl get serviceaccounts -n production
```

## Use Service Account in a Pod or Deployment

`serviceAccountName` lives in the pod spec (`spec.template.spec` for a Deployment). It's immutable on a running pod — changing it on a Deployment triggers a rollout.

```yaml
# pod-with-sa.yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
  namespace: production
spec:
  serviceAccountName: my-app-sa
  automountServiceAccountToken: true  # Enable if pod needs API access
  containers:
    - name: app
      image: myapp:v1
```

## Create a Role (Namespace-Scoped)

```yaml
# role.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

With Helm, most charts expose this as values:

```yaml
serviceAccount:
  create: true
  name: my-app-sa
  automount: false
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/my-app   # AWS IRSA
    # iam.gke.io/gcp-service-account: my-app@project.iam.gserviceaccount.com  # GCP Workload Identity
```

## Create a ClusterRole (Cluster-Wide)

```yaml
# clusterrole.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: secret-reader
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
```

## Bind Role to Service Account

```yaml
# rolebinding.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: production
subjects:
  - kind: ServiceAccount
    name: my-app-sa
    namespace: production
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

## ClusterRoleBinding

Bound with a `ClusterRoleBinding`, `list secrets` means every Secret in the cluster — only grant this to trusted system components. To reuse a ClusterRole in a single namespace, reference it from a `RoleBinding` instead.

```yaml
# clusterrolebinding.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: read-secrets-global
subjects:
  - kind: ServiceAccount
    name: monitoring-sa
    namespace: monitoring
roleRef:
  kind: ClusterRole
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io
```

## Common RBAC Patterns

### Read-Only Access to Namespace

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: namespace-reader
  namespace: production
rules:
  - apiGroups: ["", "apps", "batch"]
    resources: ["*"]
    verbs: ["get", "list", "watch"]
```

### Deployment Manager

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployment-manager
  namespace: production
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments/scale"]
    verbs: ["update", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
```

### ConfigMap and Secret Manager

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: config-manager
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["configmaps", "secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
```

### CI/CD Pipeline Account

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cicd-deployer
  namespace: production
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  - apiGroups: [""]
    resources: ["services", "configmaps", "secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
```

### CronJob Operator

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cronjob-operator
  namespace: batch-jobs
rules:
  - apiGroups: ["batch"]
    resources: ["cronjobs", "jobs"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
```

## Aggregated ClusterRoles

```yaml
# aggregated-role.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: monitoring-endpoints
  labels:
    rbac.example.com/aggregate-to-monitoring: "true"
rules:
  - apiGroups: [""]
    resources: ["endpoints", "services"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: monitoring
aggregationRule:
  clusterRoleSelectors:
    - matchLabels:
        rbac.example.com/aggregate-to-monitoring: "true"
rules: []  # Rules are automatically filled by aggregation
```

## Resource Names (Specific Resources)

```yaml
# specific-resource-role.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: specific-configmap-reader
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["app-config", "feature-flags"]  # Only these ConfigMaps
    verbs: ["get", "watch"]
```

## Service Account Token

Since Kubernetes 1.24, no long-lived token Secret is created automatically. For short-lived tokens (CI jobs, debugging) use the TokenRequest API:

```bash
kubectl create token ci-deployer -n production --duration=1h
```

Only if an external system truly needs a non-expiring token, create a legacy token Secret explicitly (and rotate it):

```yaml
# sa-with-token.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ci-deployer
  namespace: production
---
apiVersion: v1
kind: Secret
metadata:
  name: ci-deployer-token
  namespace: production
  annotations:
    kubernetes.io/service-account.name: ci-deployer
type: kubernetes.io/service-account-token
```

```bash
# Get token for external use
kubectl get secret ci-deployer-token -n production -o jsonpath='{.data.token}' | base64 -d
```

## Test RBAC Permissions

The service account's username is `system:serviceaccount:<namespace>:<name>`; impersonate it with `--as`:

```bash
# Check if service account can perform action
kubectl auth can-i get pods --as=system:serviceaccount:production:my-app-sa -n production

# Check all permissions for service account
kubectl auth can-i --list --as=system:serviceaccount:production:my-app-sa -n production

# Test with impersonation
kubectl get pods -n production --as=system:serviceaccount:production:my-app-sa
```

## View RBAC Configuration

```bash
# List roles and bindings
kubectl get roles,rolebindings -n production
kubectl get clusterroles,clusterrolebindings

# Describe role
kubectl describe role pod-reader -n production

# Find who has access to a resource
kubectl get rolebindings,clusterrolebindings -A -o json | \
  jq '.items[] | select(.roleRef.name=="cluster-admin") | .subjects'
```

## Disable Service Account Token Auto-Mount

```yaml
# secure-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secure-app
spec:
  template:
    spec:
      serviceAccountName: my-app-sa
      automountServiceAccountToken: false  # Disable unless needed
      containers:
        - name: app
          image: myapp:v1
```

## Projected Service Account Token

```yaml
# projected-token.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-projected-token
spec:
  serviceAccountName: my-app-sa
  containers:
    - name: app
      image: myapp:v1
      volumeMounts:
        - name: token
          mountPath: /var/run/secrets/tokens
          readOnly: true
  volumes:
    - name: token
      projected:
        sources:
          - serviceAccountToken:
              path: token
              expirationSeconds: 3600  # 1 hour
              audience: api.example.com
```

## Complete Example: Controller Service Account

```yaml
# controller-rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-controller
  namespace: controllers
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: my-controller
rules:
  # Read pods across all namespaces
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  # Manage our custom resources
  - apiGroups: ["mycompany.io"]
    resources: ["myresources"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Update status subresource
  - apiGroups: ["mycompany.io"]
    resources: ["myresources/status"]
    verbs: ["update", "patch"]
  # Create events
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["create", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: my-controller
subjects:
  - kind: ServiceAccount
    name: my-controller
    namespace: controllers
roleRef:
  kind: ClusterRole
  name: my-controller
  apiGroup: rbac.authorization.k8s.io
```

## Common Verbs Reference

| Verb | HTTP | Notes |
|------|------|-------|
| `get` | GET (single) | Read one named object |
| `list` | GET (collection) | Returns full objects — `list secrets` exposes all values |
| `watch` | GET `?watch` | Stream changes |
| `create` | POST | |
| `update` / `patch` | PUT / PATCH | |
| `delete` / `deletecollection` | DELETE | |
| `impersonate`, `bind`, `escalate` | — | Privilege-escalation verbs; grant sparingly |

## Best Practices

```yaml
# 1. Use namespace-scoped Roles when possible
# 2. Avoid using cluster-admin
# 3. Don't grant wildcard (*) permissions
# 4. Regularly audit RBAC configurations
# 5. Use separate service accounts per application

# Good: Specific permissions
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list"]

# Bad: Overly broad
rules:
  - apiGroups: ["*"]
    resources: ["*"]
    verbs: ["*"]
```

## Frequently Asked Questions

### What is a Kubernetes service account?

A ServiceAccount is a namespaced identity for processes running in pods. The kubelet mounts a short-lived, auto-rotated token for it (unless automounting is disabled), and the API server authenticates the pod as `system:serviceaccount:<ns>:<name>`, which RBAC then authorizes.

### How do I add a service account to a Deployment?

Set `spec.template.spec.serviceAccountName: my-app-sa` in the Deployment. The ServiceAccount must exist in the same namespace; the change rolls out new pods.

### How do I check a service account's permissions?

`kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa> -n <ns>` lists everything; `kubectl auth can-i create deployments --as=system:serviceaccount:<ns>:<sa> -n <ns>` checks one action.

### Should I disable automountServiceAccountToken?

Yes for any workload that doesn't call the Kubernetes API. Set `automountServiceAccountToken: false` on the ServiceAccount or pod spec; this also satisfies scanners that flag "bind this resource's automounted service account to RBAC or disable automounting".

### How do I get a token for a service account?

`kubectl create token <sa> -n <ns>` issues a time-bound token (1.24+). Long-lived token Secrets still work but must be created manually and are discouraged.

## Summary

Service accounts provide pod identity, while RBAC controls authorization. Create dedicated service accounts per application, define minimal Roles with specific permissions, and bind them appropriately. Use `kubectl auth can-i` to verify permissions and regularly audit your RBAC configuration for security compliance.

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
