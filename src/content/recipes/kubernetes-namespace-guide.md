---
title: "Kubernetes Namespaces: Management and Best Practices"
description: "Create and manage Kubernetes namespaces for teams and environments: naming strategy, ResourceQuota, LimitRange, RBAC, NetworkPolicy and a provisioning template."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "namespaces"
  - "multi-tenancy"
  - "rbac"
  - "resource-quotas"
  - "configuration"
  - "best-practices"
  - "organization"
  - "isolation"
relatedRecipes:
  - "kubernetes-resource-quota-limitrange"
  - "namespace-stuck-terminating"
  - "kubernetes-networkpolicy-default-deny"
  - "kubernetes-rbac-role-clusterrole"
  - "kubernetes-multi-tenancy-enterprise"
  - "kubernetes-multitenancy-namespaces"
  - "kubernetes-namespace-template-instant-environments"
  - "service-accounts-rbac"
  - "nfs-tenant-segregation-kubernetes"
  - "kubernetes-labels-best-practices"
  - "kubernetes-resource-requests-limits"
---

> 💡 **Quick Answer:** `kubectl create namespace production` creates a namespace. Use namespaces to separate teams or environments, then give every namespace a `ResourceQuota` (aggregate CPU/memory/object caps), a `LimitRange` (per-container defaults), RBAC `RoleBinding`s, and a default-deny `NetworkPolicy`. Built-in namespaces: `default`, `kube-system`, `kube-public`, `kube-node-lease`.
>
> **Key command:** `kubectl config set-context --current --namespace=production`
>
> **Gotcha:** Namespaces are *logical* isolation only — pods still share nodes, kernel and (without NetworkPolicy) the network. Untrusted tenants need separate clusters or sandboxed runtimes.

## Create and Manage Namespaces

```bash
kubectl create namespace production
kubectl get namespaces
kubectl get pods -A                                   # all namespaces
kubectl config set-context --current --namespace=production   # or: kubens production
kubectl top pods -n production

# Deletes EVERYTHING inside, irreversibly
kubectl delete namespace staging
```

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: team-backend
  labels:
    team: backend
    environment: production
    cost-center: eng-001
    pod-security.kubernetes.io/enforce: restricted    # Pod Security Admission
  annotations:
    owner: "backend-team@example.com"
```

The API server auto-adds `kubernetes.io/metadata.name: <name>` (1.22+) — use that label in `namespaceSelector` instead of inventing a `name:` label.

| Namespace | Purpose |
|-----------|---------|
| `default` | Fallback when no namespace is given — avoid for real workloads |
| `kube-system` | Control plane and cluster add-ons |
| `kube-public` | World-readable (`cluster-info`) |
| `kube-node-lease` | Node heartbeat `Lease` objects |

## Organization Strategy

```text
By environment        By team              Combined (common in prod)
├── dev               ├── team-frontend    ├── prod-frontend
├── staging           ├── team-backend     ├── prod-backend
└── production        ├── team-data        ├── staging
                      └── shared-infra     ├── dev
                                           ├── monitoring / logging
                                           └── ingress / cert-manager
```

- **Namespace per team or team-environment, not per microservice** — most clusters need 5–20 app namespaces, not hundreds.
- **Separate clusters** when trust levels differ, compliance demands hard isolation, tenants need different Kubernetes versions, or tenants are untrusted customers.

## ResourceQuota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-quota
  namespace: team-backend
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    requests.nvidia.com/gpu: "8"     # extended resources: requests.* only
    requests.storage: 100Gi
    persistentvolumeclaims: "20"
    pods: "50"
    services: "10"
    services.loadbalancers: "2"
    configmaps: "30"
    secrets: "30"
```

```bash
kubectl describe resourcequota team-quota -n team-backend
# Resource         Used  Hard
# requests.cpu     3     10
# requests.memory  8Gi   20Gi
# pods             12    50
```

Once a quota covers `requests.cpu`/`limits.memory` etc., every new pod **must** declare those values or be rejected — pair it with a LimitRange that fills in defaults. Deep dive: [ResourceQuota and LimitRange](/recipes/configuration/kubernetes-resource-quota-limitrange/).

## LimitRange (Per-Container Defaults)

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: team-backend
spec:
  limits:
    - type: Container
      default:            # limits if omitted
        cpu: 500m
        memory: 256Mi
      defaultRequest:     # requests if omitted
        cpu: 100m
        memory: 128Mi
      max:
        cpu: "4"
        memory: 8Gi
      min:
        cpu: 50m
        memory: 64Mi
    - type: PersistentVolumeClaim
      max:
        storage: 10Gi
      min:
        storage: 1Gi
```

## RBAC per Namespace

Bind the built-in ClusterRoles (`admin`, `edit`, `view`) with a namespaced `RoleBinding` rather than writing wildcard Roles:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: backend-devs-edit
  namespace: team-backend
subjects:
  - kind: Group
    name: backend-developers
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: edit          # manage workloads + read Secrets; cannot change RBAC or quotas
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: qa-view
  namespace: team-backend
subjects:
  - kind: Group
    name: qa-team
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: view          # read-only, excludes Secrets
  apiGroup: rbac.authorization.k8s.io
```

Avoid `resources: ["*"], verbs: ["*"]` Roles for tenants — they include `roles`/`rolebindings` and let the team escalate within the namespace. See [service accounts and RBAC](/recipes/security/service-accounts-rbac/).

## Network Isolation

```yaml
# Default deny all ingress + egress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: team-backend
spec:
  podSelector: {}
  policyTypes: ["Ingress", "Egress"]
---
# Allow same-namespace traffic + DNS
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: team-backend
spec:
  podSelector: {}
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - podSelector: {}
  egress:
    - to:
        - podSelector: {}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - { port: 53, protocol: UDP }
        - { port: 53, protocol: TCP }
---
# Allow Prometheus from the monitoring namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-monitoring
  namespace: team-backend
spec:
  podSelector: {}
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
```

More patterns: [default deny NetworkPolicy](/recipes/security/kubernetes-networkpolicy-default-deny/).

## Namespace Provisioning Template

Stamp out identical tenant namespaces from one file (or better, from GitOps / Kyverno generate rules / [namespace templates](/recipes/configuration/kubernetes-namespace-template-instant-environments/)):

```yaml
# namespace-template.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ${TEAM}
  labels:
    team: ${TEAM}
    pod-security.kubernetes.io/enforce: restricted
---
apiVersion: v1
kind: ResourceQuota
metadata: { name: default-quota, namespace: ${TEAM} }
spec:
  hard: { requests.cpu: "8", requests.memory: 32Gi, limits.cpu: "16", limits.memory: 64Gi, pods: "30" }
---
apiVersion: v1
kind: LimitRange
metadata: { name: default-limits, namespace: ${TEAM} }
spec:
  limits:
    - type: Container
      default: { cpu: 500m, memory: 256Mi }
      defaultRequest: { cpu: 100m, memory: 128Mi }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny-ingress, namespace: ${TEAM} }
spec:
  podSelector: {}
  policyTypes: ["Ingress"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: team-edit, namespace: ${TEAM} }
subjects:
  - { kind: Group, name: "${TEAM}-devs", apiGroup: rbac.authorization.k8s.io }
roleRef: { kind: ClusterRole, name: edit, apiGroup: rbac.authorization.k8s.io }
```

```bash
TEAM=backend envsubst < namespace-template.yaml | kubectl apply -f -
```

## Cross-Namespace Communication

```bash
# <service>.<namespace>.svc.cluster.local
curl http://api.production.svc.cluster.local:8080
curl http://api.production:8080          # short form works via DNS search path
```

Services are reachable across namespaces by default; NetworkPolicies decide whether traffic is allowed. ConfigMaps, Secrets and PVCs **cannot** be referenced across namespaces.

## Common Issues

**`forbidden: exceeded quota`** — quota exhausted: `kubectl describe resourcequota -n <ns>`; raise it or right-size requests.

**`failed quota: must specify limits.cpu`** — a quota covers that resource and the pod omits it. Add requests/limits or a LimitRange.

**"No resources found in default namespace"** — wrong namespace. Use `-n`, `-A`, or set the context namespace.

**Namespace stuck in `Terminating`** — a finalizer or an unavailable APIService is blocking deletion. See [namespace stuck terminating](/recipes/troubleshooting/namespace-stuck-terminating/).

**`kubectl delete all --all -n ns` left things behind** — `all` only covers core workload types; ConfigMaps, Secrets, PVCs, Roles, Ingresses and CRs remain. Delete the namespace or list types explicitly.

## Best Practices

1. Never run production workloads in `default`
2. Every namespace gets ResourceQuota + LimitRange + default-deny NetworkPolicy + RoleBindings — no "naked" namespaces
3. Label namespaces (`team`, `environment`, `cost-center`, Pod Security level) for policy engines and cost attribution
4. Bind built-in `admin`/`edit`/`view` ClusterRoles instead of wildcard Roles
5. Automate provisioning via GitOps or a policy engine so every tenant is identical
6. Use separate clusters for hard multi-tenancy or compliance boundaries

## Frequently Asked Questions

### What is a Kubernetes namespace used for?

A namespace is a named scope for resources inside one cluster. It prevents name collisions and is the unit you attach quotas, RBAC bindings, NetworkPolicies and Pod Security levels to, so it's how teams and environments share a cluster safely.

### How many namespaces should a cluster have?

Typically one per team or team-environment plus infrastructure namespaces (monitoring, ingress, cert-manager) — usually tens, not hundreds. One namespace per microservice creates management overhead without adding isolation.

### Do namespaces isolate network traffic?

No. By default any pod can reach any other pod in any namespace. You need NetworkPolicies (and a CNI that enforces them) to isolate namespaces.

### Namespaces or separate clusters for multi-tenancy?

Namespaces are enough for teams with the same trust level. Use separate clusters (or virtual clusters) when tenants are untrusted, need different Kubernetes versions or cluster-scoped resources such as CRDs, or when compliance requires hard isolation.

### How do I switch the default namespace in kubectl?

`kubectl config set-context --current --namespace=<name>`, or install `kubens` and run `kubens <name>`.
