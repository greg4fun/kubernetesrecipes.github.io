---
title: "How to Configure Service Accounts and RBAC"
description: "Secure your Kubernetes workloads with service accounts and role-based access control. Create roles, bindings, and implement least-privilege access patterns."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["rbac", "service-accounts", "security", "authorization", "least-privilege"]
---

# How to Configure Service Accounts and RBAC

Service accounts provide identity for pods, while RBAC (Role-Based Access Control) controls what actions they can perform. Together they implement the principle of least privilege.

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
kubectl get serviceaccounts -n production
```

## Use Service Account in Pod

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

## Summary

Service accounts provide pod identity, while RBAC controls authorization. Create dedicated service accounts per application, define minimal Roles with specific permissions, and bind them appropriately. Use `kubectl auth can-i` to verify permissions and regularly audit your RBAC configuration for security compliance.
