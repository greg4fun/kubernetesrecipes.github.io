---
title: "How to Configure Kubernetes API Access Control"
description: "Set up secure API server access with authentication and authorization. Configure RBAC, API groups, and audit logging for cluster security."
category: "security"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["api-server", "authentication", "authorization", "rbac", "security"]
---

# How to Configure Kubernetes API Access Control

Secure Kubernetes API access through authentication, authorization, and audit logging. Configure RBAC policies, manage API groups, and implement least-privilege access.

## Authentication Methods

```yaml
# Kubernetes supports multiple authentication strategies:

# 1. X.509 Client Certificates
# 2. Bearer Tokens (ServiceAccount, OIDC, Webhook)
# 3. Basic Auth (deprecated)
# 4. OpenID Connect (OIDC)
# 5. Authentication Proxy

# Check current authentication
kubectl auth whoami  # Kubernetes 1.27+

# Or older method
kubectl config view --minify -o jsonpath='{.contexts[0].context.user}'
```

## X.509 Certificate Auth

```bash
# Generate client certificate
openssl genrsa -out developer.key 2048

openssl req -new -key developer.key -out developer.csr \
  -subj "/CN=developer/O=dev-team"

# Sign with cluster CA (requires cluster admin)
openssl x509 -req -in developer.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out developer.crt -days 365

# Add to kubeconfig
kubectl config set-credentials developer \
  --client-certificate=developer.crt \
  --client-key=developer.key

kubectl config set-context developer-context \
  --cluster=my-cluster \
  --user=developer
```

## ServiceAccount Token Auth

```yaml
# Create ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ci-user
  namespace: default
---
# Create long-lived token (if needed)
apiVersion: v1
kind: Secret
metadata:
  name: ci-user-token
  annotations:
    kubernetes.io/service-account.name: ci-user
type: kubernetes.io/service-account-token
```

```bash
# Get token
kubectl get secret ci-user-token -o jsonpath='{.data.token}' | base64 -d

# Or create short-lived token (preferred)
kubectl create token ci-user --duration=24h
```

## RBAC Components

```yaml
# Role: Namespace-scoped permissions
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-manager
  namespace: development
rules:
  - apiGroups: [""]           # Core API group
    resources: ["pods"]
    verbs: ["get", "list", "watch", "create", "update", "delete"]
  - apiGroups: [""]
    resources: ["pods/log", "pods/exec"]
    verbs: ["get", "create"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
---
# RoleBinding: Grants Role to subjects
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-manager-binding
  namespace: development
subjects:
  - kind: User
    name: developer
    apiGroup: rbac.authorization.k8s.io
  - kind: Group
    name: dev-team
    apiGroup: rbac.authorization.k8s.io
  - kind: ServiceAccount
    name: ci-user
    namespace: default
roleRef:
  kind: Role
  name: pod-manager
  apiGroup: rbac.authorization.k8s.io
```

## ClusterRole and ClusterRoleBinding

```yaml
# ClusterRole: Cluster-wide permissions
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cluster-reader
rules:
  - apiGroups: [""]
    resources: ["nodes", "namespaces", "persistentvolumes"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: cluster-reader-binding
subjects:
  - kind: Group
    name: readonly-users
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: cluster-reader
  apiGroup: rbac.authorization.k8s.io
```

## API Groups and Resources

```bash
# List all API groups
kubectl api-resources --output=wide

# Common API groups:
# ""        (core) - pods, services, configmaps, secrets
# apps      - deployments, statefulsets, daemonsets
# batch     - jobs, cronjobs
# networking.k8s.io - ingresses, networkpolicies
# rbac.authorization.k8s.io - roles, rolebindings

# List resources in group
kubectl api-resources --api-group=apps

# Get API group versions
kubectl api-versions | grep apps
```

## Resource Names and Subresources

```yaml
# Restrict to specific resources by name
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: config-reader
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["app-config", "env-config"]  # Only these
    verbs: ["get"]
---
# Subresources (pods/log, pods/exec, etc.)
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-logs
rules:
  - apiGroups: [""]
    resources: ["pods/log"]  # Subresource
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["create"]  # Exec requires create verb
```

## RBAC Verbs

```yaml
# Available verbs:
# get      - Read single resource
# list     - List resources
# watch    - Watch for changes
# create   - Create resources
# update   - Update existing resources
# patch    - Patch resources
# delete   - Delete single resource
# deletecollection - Delete multiple resources

# Common verb combinations:
rules:
  # Read-only
  - verbs: ["get", "list", "watch"]
  
  # Full CRUD
  - verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  
  # Write-only (rare)
  - verbs: ["create", "update", "delete"]
```

## Aggregated ClusterRoles

```yaml
# Base ClusterRole with label
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: monitoring-rules
  labels:
    rbac.example.com/aggregate-to-monitoring: "true"
rules:
  - apiGroups: ["monitoring.coreos.com"]
    resources: ["prometheusrules", "servicemonitors"]
    verbs: ["get", "list", "watch"]
---
# Aggregating ClusterRole
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: monitoring-admin
aggregationRule:
  clusterRoleSelectors:
    - matchLabels:
        rbac.example.com/aggregate-to-monitoring: "true"
rules: []  # Rules are aggregated from matching ClusterRoles
```

## Test Permissions

```bash
# Check if you can perform action
kubectl auth can-i create pods
kubectl auth can-i delete deployments -n production

# Check as another user
kubectl auth can-i get pods --as=developer
kubectl auth can-i get pods --as=system:serviceaccount:default:ci-user

# List all permissions
kubectl auth can-i --list
kubectl auth can-i --list --as=developer -n development

# Check in specific namespace
kubectl auth can-i create deployments -n production
```

## Audit Logging

```yaml
# audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Don't log read-only requests to certain resources
  - level: None
    resources:
      - group: ""
        resources: ["events", "nodes/status"]
    verbs: ["get", "list", "watch"]
  
  # Log auth failures
  - level: Metadata
    users: ["system:anonymous"]
  
  # Log secrets access at metadata level (no body)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]
  
  # Log everything else at request level
  - level: Request
    omitStages:
      - RequestReceived
```

## Common RBAC Patterns

```yaml
# Developer access
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: developer
rules:
  - apiGroups: ["", "apps", "batch"]
    resources: ["*"]
    verbs: ["*"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list"]  # Read only secrets
---
# CI/CD Pipeline
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ci-deployer
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch", "update"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "create", "update"]
---
# Monitoring
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: monitoring
rules:
  - apiGroups: [""]
    resources: ["nodes", "pods", "services", "endpoints"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["nodes/metrics", "pods/metrics"]
    verbs: ["get"]
```

## Debug RBAC Issues

```bash
# Check why access denied
kubectl describe rolebinding -n namespace
kubectl describe clusterrolebinding

# View role permissions
kubectl describe role pod-manager -n development
kubectl describe clusterrole cluster-reader

# Check subject's bindings
kubectl get rolebindings,clusterrolebindings -A \
  -o jsonpath='{range .items[?(@.subjects[*].name=="developer")]}{.metadata.name}{"\n"}{end}'
```

## Summary

Kubernetes API access control uses authentication (who you are) and authorization (what you can do). Configure RBAC with Roles/ClusterRoles (define permissions) and RoleBindings/ClusterRoleBindings (grant to subjects). Use least-privilege principles - grant minimum necessary permissions. Test access with `kubectl auth can-i`. Enable audit logging to track API access. Common patterns include read-only cluster access, namespace-scoped developer access, and CI/CD deployment permissions.
