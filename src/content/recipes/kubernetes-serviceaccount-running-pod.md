---
title: "ServiceAccount for Running Pods"
description: "Configure Kubernetes ServiceAccounts for Pods: token mounting, RBAC permissions, workload identity, automountServiceAccountToken control, and least-privilege patterns for production workloads."
tags:
  - "serviceaccount"
  - "rbac"
  - "security"
  - "pod-identity"
  - "authentication"
category: "security"
publishDate: "2026-05-07"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-serviceaccount-guide"
  - "kubernetes-rbac-role-clusterrole"
  - "openshift-user-account-management"
  - "openshift-scc-security-context-constraints"
---

> 💡 **Quick Answer:** Every Pod runs as a ServiceAccount (default: `default`). To give a Pod specific API permissions, create a dedicated ServiceAccount, bind a Role to it, and reference it in `spec.serviceAccountName`. Disable auto-mounted tokens for Pods that don't need API access.

## The Problem

- Pods using the `default` ServiceAccount may have unintended permissions
- Applications need to call the Kubernetes API (list Pods, read Secrets)
- Token auto-mounting exposes credentials to containers that don't need them
- No audit trail when all Pods share the same ServiceAccount

## The Solution

### Create a Dedicated ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-reader
  namespace: production
  labels:
    app: my-application
---
# Grant specific permissions
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["pods", "services"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-reader-binding
  namespace: production
subjects:
  - kind: ServiceAccount
    name: app-reader
    namespace: production
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

### Assign ServiceAccount to Pod

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-application
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-application
  template:
    metadata:
      labels:
        app: my-application
    spec:
      serviceAccountName: app-reader    # Use dedicated SA
      automountServiceAccountToken: true  # Needs API access
      containers:
        - name: app
          image: registry.example.com/my-app:1.0
          env:
            - name: KUBERNETES_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
```

### Disable Token Mounting (No API Access Needed)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-frontend
spec:
  template:
    spec:
      serviceAccountName: web-frontend
      automountServiceAccountToken: false   # No API calls needed
      containers:
        - name: nginx
          image: nginx:1.27
          # This container has NO Kubernetes API token
          # More secure: can't be exploited to access the API
```

### Check Which ServiceAccount a Pod Uses

```bash
# Find the ServiceAccount of running Pods
kubectl get pods -n production -o custom-columns=\
'POD:.metadata.name,SA:.spec.serviceAccountName,AUTOMOUNT:.spec.automountServiceAccountToken'

# Check what permissions a ServiceAccount has
kubectl auth can-i --list --as=system:serviceaccount:production:app-reader

# Test specific permissions
kubectl auth can-i get pods \
  --as=system:serviceaccount:production:app-reader -n production
# yes

kubectl auth can-i delete pods \
  --as=system:serviceaccount:production:app-reader -n production
# no
```

### Token Projection (Bound, Time-Limited Tokens)

```yaml
# Modern approach: projected service account tokens (K8s 1.22+)
# Automatically rotated, audience-bound, time-limited
apiVersion: v1
kind: Pod
metadata:
  name: app-with-projected-token
spec:
  serviceAccountName: app-reader
  containers:
    - name: app
      image: registry.example.com/my-app:1.0
      volumeMounts:
        - name: token
          mountPath: /var/run/secrets/tokens
          readOnly: true
  volumes:
    - name: token
      projected:
        sources:
          - serviceAccountToken:
              path: api-token
              expirationSeconds: 3600    # 1 hour (auto-rotated)
              audience: "https://kubernetes.default.svc"
```

### Use Token from Inside a Pod

```bash
# Inside the Pod — default token location
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
CACERT=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

# Call Kubernetes API
curl -s --cacert $CACERT \
  -H "Authorization: Bearer $TOKEN" \
  "https://kubernetes.default.svc/api/v1/namespaces/${NAMESPACE}/pods"

# Using kubectl (if available in container)
# kubectl automatically uses the mounted token
kubectl get pods -n $NAMESPACE
```

### Common Patterns

```yaml
# Pattern 1: Operator/controller that manages resources
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-operator
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: my-operator-role
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["create", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: my-operator-binding
subjects:
  - kind: ServiceAccount
    name: my-operator
    namespace: operators
roleRef:
  kind: ClusterRole
  name: my-operator-role
  apiGroup: rbac.authorization.k8s.io
```

```yaml
# Pattern 2: CronJob that cleans up old resources
apiVersion: v1
kind: ServiceAccount
metadata:
  name: cleanup-job
  namespace: maintenance
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cleanup-role
  namespace: maintenance
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "list", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "delete"]
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cleanup-old-jobs
  namespace: maintenance
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: cleanup-job
          containers:
            - name: cleanup
              image: bitnami/kubectl:1.31
              command:
                - /bin/sh
                - -c
                - |
                  kubectl delete jobs --field-selector status.successful=1 \
                    --namespace maintenance
          restartPolicy: OnFailure
```

```yaml
# Pattern 3: Image pull from private registry
apiVersion: v1
kind: ServiceAccount
metadata:
  name: private-registry-sa
  namespace: production
imagePullSecrets:
  - name: registry-credentials
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      serviceAccountName: private-registry-sa
      # imagePullSecrets inherited from ServiceAccount
      containers:
        - name: app
          image: registry.example.com/private/my-app:latest
```

### Audit ServiceAccount Usage

```bash
# Find Pods still using 'default' ServiceAccount
kubectl get pods -A -o json | jq -r '
  .items[] |
  select(.spec.serviceAccountName == "default" or .spec.serviceAccountName == null) |
  "\(.metadata.namespace)/\(.metadata.name)"'

# Find ServiceAccounts with cluster-admin
kubectl get clusterrolebindings -o json | jq -r '
  .items[] |
  select(.roleRef.name == "cluster-admin") |
  .subjects[] |
  select(.kind == "ServiceAccount") |
  "\(.namespace)/\(.name)"'

# Find ServiceAccounts with automount enabled (potential risk)
kubectl get sa -A -o json | jq -r '
  .items[] |
  select(.automountServiceAccountToken != false) |
  "\(.metadata.namespace)/\(.metadata.name)"'
```

## Common Issues

### Pod can't access API ("forbidden")
- **Cause**: ServiceAccount doesn't have required Role/ClusterRole
- **Fix**: Create RoleBinding granting needed permissions; test with `kubectl auth can-i`

### Token not mounted in container
- **Cause**: `automountServiceAccountToken: false` on Pod or ServiceAccount
- **Fix**: Set to `true` on the Pod spec (Pod-level overrides SA-level)

### "no service account token found" after upgrade
- **Cause**: K8s 1.24+ no longer auto-creates long-lived Secret tokens
- **Fix**: Use projected tokens (auto-mounted); or create manual Secret if needed for external systems

### Wrong ServiceAccount (still using default)
- **Cause**: Typo in `serviceAccountName` or field placed at wrong level
- **Fix**: Must be under `spec.template.spec` in Deployments (not `spec.template.metadata`)

## Best Practices

1. **One ServiceAccount per workload** — never share across apps
2. **`automountServiceAccountToken: false`** by default — enable only when needed
3. **Least privilege** — grant only exact verbs and resources needed
4. **Namespace-scoped Roles** over ClusterRoles when possible
5. **Audit `default` SA usage** — every Pod should have a dedicated SA
6. **Use projected tokens** — auto-rotated, audience-bound, time-limited
7. **imagePullSecrets on SA** — cleaner than per-Pod configuration

## Key Takeaways

- Every Pod runs as a ServiceAccount (`default` if not specified)
- Create dedicated ServiceAccounts with specific RBAC for each workload
- `automountServiceAccountToken: false` for Pods that don't call the K8s API
- K8s 1.24+: tokens are projected (rotated, 1h TTL) — no more long-lived Secrets
- `kubectl auth can-i --as=system:serviceaccount:ns:name` to test permissions
- ServiceAccount `imagePullSecrets` inherited by all Pods using that SA
- Audit: find Pods on `default` SA and over-privileged ServiceAccounts
