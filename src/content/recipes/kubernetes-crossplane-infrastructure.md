---
title: "Crossplane Infrastructure as Code on Kubernetes"
description: "Provision AWS, GCP and Azure resources from Kubernetes with Crossplane: providers, ProviderConfig, XRDs, pipeline Compositions, claims and GitOps."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
tags:
  - "crossplane"
  - "infrastructure-as-code"
  - "cloud"
  - "compositions"
  - "multi-cloud"
  - "gitops"
  - "platform-engineering"
relatedRecipes:
  - "cluster-api-infrastructure-as-code"
  - "argocd-gitops"
  - "flux-gitops"
  - "kubernetes-crd-guide"
  - "kubernetes-operator-pattern"
  - "multi-cluster-management-kubernetes"
  - "kubernetes-api-versions-explained"
  - "backstage-kubernetes-developer-portal"
---

> 💡 **Quick Answer:** Crossplane turns cloud resources (RDS, S3, VPCs, GKE clusters) into Kubernetes objects and continuously reconciles them. Install Crossplane with Helm, install a Provider (AWS/GCP/Azure) plus a `ProviderConfig` with credentials, then either create managed resources directly or build a platform API: a `CompositeResourceDefinition` (XRD, the schema) + a `Composition` (the implementation). Teams `kubectl apply` a small claim like `kind: Database` and Crossplane provisions the cloud resources and writes a connection Secret into their namespace.
>
> **Key command:** `kubectl get managed` — every cloud resource Crossplane owns, with `READY`/`SYNCED` status.
>
> **Gotcha:** Crossplane v2 removed the old `spec.resources` Composition mode. Write Compositions in `mode: Pipeline` with `function-patch-and-transform` — it works on Crossplane 1.14+ and 2.x.

## The Problem

Terraform/Pulumi run outside the cluster: separate state, separate pipelines, drift only fixed when someone runs `apply`. Developers need databases and buckets but shouldn't have cloud console access. Crossplane brings infrastructure into the Kubernetes API — same RBAC, same GitOps, same reconciliation loop (drift from manual console changes is reverted automatically).

```mermaid
flowchart TB
    DEV["Developer"] -->|"kubectl apply"| CLAIM["Claim<br/>kind: Database"]
    CLAIM --> XRD["XRD<br/>schema / platform API"]
    XRD --> COMP["Composition<br/>per-cloud implementation"]
    COMP --> PROVIDER["Provider<br/>AWS / GCP / Azure"]
    PROVIDER --> RDS["RDS / CloudSQL / Flexible Server"]
    COMP --> SECRET["Connection Secret<br/>in team namespace"]
```

## The Solution

### Install Crossplane

```bash
helm repo add crossplane-stable https://charts.crossplane.io/stable
helm repo update
helm install crossplane crossplane-stable/crossplane \
  --namespace crossplane-system --create-namespace --wait

kubectl get pods -n crossplane-system
# crossplane-7b8f4d-abc12                1/1  Running
# crossplane-rbac-manager-9c8f5e-def34   1/1  Running
```

### Install Providers and Credentials

Use the per-service Upbound providers (`provider-aws-s3`, `provider-aws-rds`, …) rather than the old monolithic provider — far fewer CRDs and lower API server memory. Pin versions.

```yaml
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws-rds
spec:
  package: xpkg.upbound.io/upbound/provider-aws-rds:v1.14.0
---
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws-s3
spec:
  package: xpkg.upbound.io/upbound/provider-aws-s3:v1.14.0
# GCP / Azure equivalents: upbound/provider-gcp-sql, upbound/provider-azure-dbforpostgresql
```

```yaml
# Static keys shown for brevity — prefer IRSA / EKS Pod Identity / Workload Identity in production
apiVersion: v1
kind: Secret
metadata:
  name: aws-creds
  namespace: crossplane-system
type: Opaque
stringData:
  credentials: |
    [default]
    aws_access_key_id = AKIAIOSFODNN7EXAMPLE
    aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
---
apiVersion: aws.upbound.io/v1beta1
kind: ProviderConfig
metadata:
  name: default
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: aws-creds
      key: credentials
```

```bash
kubectl get providers
# NAME               INSTALLED   HEALTHY   PACKAGE                                           AGE
# provider-aws-rds   True        True      xpkg.upbound.io/upbound/provider-aws-rds:v1.14.0  5m
```

Use one `ProviderConfig` per environment/account (`dev`, `prod`) and reference it with `providerConfigRef`.

### Managed Resources (Direct)

```yaml
apiVersion: s3.aws.upbound.io/v1beta2
kind: Bucket
metadata:
  name: my-app-data
spec:
  forProvider:
    region: us-east-1
    tags:
      ManagedBy: crossplane
  providerConfigRef:
    name: default
---
apiVersion: rds.aws.upbound.io/v1beta2
kind: Instance
metadata:
  name: my-app-database
spec:
  forProvider:
    region: us-east-1
    engine: postgres
    engineVersion: "16"
    instanceClass: db.t3.medium
    allocatedStorage: 50
    dbName: myapp
    username: dbadmin
    autoGeneratePassword: true
    passwordSecretRef:
      name: my-app-db-master
      namespace: crossplane-system
      key: password
    skipFinalSnapshot: false
    publiclyAccessible: false
  deletionPolicy: Orphan          # keep the DB if the CR is deleted
  providerConfigRef:
    name: default
  writeConnectionSecretToRef:
    name: db-connection
    namespace: my-app
```

Field names differ between provider API versions — always check with `kubectl explain instance.spec.forProvider --api-version=rds.aws.upbound.io/v1beta2`.

### Platform API: XRD

The XRD is the only API your developers see. `claimNames` gives them a namespaced kind (`Database`) backed by a cluster-scoped composite (`XDatabase`).

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xdatabases.platform.example.com
spec:
  group: platform.example.com
  names:
    kind: XDatabase
    plural: xdatabases
  claimNames:
    kind: Database
    plural: databases
  connectionSecretKeys: [username, password, endpoint, port]
  versions:
    - name: v1alpha1
      served: true
      referenceable: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                engine:
                  type: string
                  enum: [postgres, mysql]
                size:
                  type: string
                  enum: [small, medium, large]
                region:
                  type: string
                  default: us-east-1
              required: [engine, size]
```

> **Crossplane v2:** `apiextensions.crossplane.io/v2` XRDs add `scope: Namespaced`, so the XR itself lives in the team namespace and claims are no longer needed (v1 XRDs with claims still work). Namespaced XRs can only compose namespaced managed resources (the `*.m.upbound.io` API groups of v2 providers).

### Composition (Pipeline Mode)

```yaml
apiVersion: pkg.crossplane.io/v1beta1
kind: Function
metadata:
  name: function-patch-and-transform
spec:
  package: xpkg.crossplane.io/crossplane-contrib/function-patch-and-transform:v0.8.2
---
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: database-aws
  labels:
    provider: aws
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XDatabase
  writeConnectionSecretsToNamespace: crossplane-system
  mode: Pipeline
  pipeline:
    - step: patch-and-transform
      functionRef:
        name: function-patch-and-transform
      input:
        apiVersion: pt.fn.crossplane.io/v1beta1
        kind: Resources
        resources:
          - name: rds-instance
            base:
              apiVersion: rds.aws.upbound.io/v1beta2
              kind: Instance
              spec:
                forProvider:
                  allocatedStorage: 20
                  engineVersion: "16"
                  username: dbadmin
                  autoGeneratePassword: true
                  publiclyAccessible: false
                  skipFinalSnapshot: false
            patches:
              - type: FromCompositeFieldPath
                fromFieldPath: spec.engine
                toFieldPath: spec.forProvider.engine
              - type: FromCompositeFieldPath
                fromFieldPath: spec.region
                toFieldPath: spec.forProvider.region
              - type: FromCompositeFieldPath
                fromFieldPath: spec.size
                toFieldPath: spec.forProvider.instanceClass
                transforms:
                  - type: map
                    map:
                      small: db.t3.micro
                      medium: db.t3.medium
                      large: db.r6g.xlarge
            connectionDetails:
              - name: endpoint
                fromConnectionSecretKey: endpoint
              - name: username
                fromConnectionSecretKey: username
              - name: password
                fromConnectionSecretKey: attribute.password
              - name: port
                fromConnectionSecretKey: port
```

Real Compositions usually add a `SubnetGroup` and `SecurityGroup` as extra entries in `resources` and wire them with `...IdSelector.matchControllerRef: true`. For logic beyond patches (loops, conditionals) add a `function-go-templating`, `function-kcl` or `function-python` step to the pipeline.

### Multi-Cloud: Same API, Different Composition

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: database-gcp
  labels:
    provider: gcp
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XDatabase
  mode: Pipeline
  pipeline:
    - step: patch-and-transform
      functionRef:
        name: function-patch-and-transform
      input:
        apiVersion: pt.fn.crossplane.io/v1beta1
        kind: Resources
        resources:
          - name: cloudsql-instance
            base:
              apiVersion: sql.gcp.upbound.io/v1beta2
              kind: DatabaseInstance
              spec:
                forProvider:
                  region: us-central1
                  databaseVersion: POSTGRES_16
                  deletionProtection: true
                  settings:
                    - tier: db-f1-micro
            patches:
              - type: FromCompositeFieldPath
                fromFieldPath: spec.size
                toFieldPath: spec.forProvider.settings[0].tier
                transforms:
                  - type: map
                    map:
                      small: db-f1-micro
                      medium: db-custom-2-7680
                      large: db-custom-8-30720
```

### Teams Claim Infrastructure

```yaml
apiVersion: platform.example.com/v1alpha1
kind: Database
metadata:
  name: orders-db
  namespace: team-alpha
spec:
  engine: postgres
  size: medium
  compositionSelector:          # omit to let Crossplane pick any matching Composition
    matchLabels:
      provider: aws
  writeConnectionSecretToRef:
    name: orders-db-conn         # lands in team-alpha
```

```bash
kubectl get databases -n team-alpha
# NAME        SYNCED   READY   CONNECTION-SECRET   AGE
# orders-db   True     True    orders-db-conn      6m

kubectl get managed
# NAME                                              READY   SYNCED
# instance.rds.aws.upbound.io/orders-db-x7k2p-abc   True    True

crossplane beta trace database orders-db -n team-alpha   # full claim -> XR -> MR tree
```

RBAC: give developers verbs on `databases.platform.example.com` only, never on the provider's `instances.rds.aws.upbound.io`.

### GitOps

XRDs, Compositions, Functions, ProviderConfigs and claims are all plain YAML — put them in Git and let Argo CD or Flux sync them:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: platform-infrastructure
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/infrastructure
    path: crossplane/
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - SkipDryRunOnMissingResource=true   # XRD-generated CRDs don't exist on first sync
```

Order installs with sync waves: Providers/Functions → ProviderConfigs → XRDs → Compositions → claims.

## Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| Provider `HEALTHY=False` / `cannot resolve package` | Wrong package path or version | Check the package on marketplace.upbound.io; `kubectl describe providerrevision` |
| MR stuck `SYNCED=False` | Bad credentials / missing IAM permission / cloud API error | `kubectl describe <kind> <name>` events; `kubectl logs -n crossplane-system -l pkg.crossplane.io/revision` |
| `cannot compose resources: ... field not found` | Patch path doesn't match the MR schema | Verify with `kubectl explain`; watch for API version bumps (`v1beta1` → `v1beta2`) |
| Claim created, nothing provisioned | No Composition matches `compositeTypeRef` (group + kind + version) | Fix `compositeTypeRef`; add `compositionSelector`/`compositionRef` when several match |
| Composition rejected after upgrading to v2 | Uses `spec.resources` (native P&T) | Convert: `crossplane beta convert pipeline-composition old.yaml` |
| Cloud resource not deleted | Cloud-side deletion protection, or `deletionPolicy: Orphan` | Disable protection first; default `deletionPolicy` is `Delete` |
| Drift keeps reverting console edits | Working as designed — Crossplane reconciles to spec | Change the YAML in Git instead |

## Best Practices

- **Expose claims/XRs, not managed resources** — platform team owns Compositions, developers own tiny claims
- **Pipeline Compositions only** — forward-compatible with Crossplane v2
- **Per-service providers, pinned versions** — `provider-aws-rds:v1.14.0`, not the monolith, never `latest`
- **Workload identity over static keys** — IRSA / Pod Identity (AWS), Workload Identity (GCP/Azure)
- **`deletionPolicy: Orphan`** on stateful production resources; use Usages to block deleting in-use resources
- **One ProviderConfig per account/environment**
- **GitOps everything**, ordered with sync waves

## Frequently Asked Questions

### Crossplane vs Terraform — which should I use?

Terraform is a CLI that applies a plan once and stores state in a file/backend; drift persists until the next `apply`. Crossplane is a set of controllers: desired state lives in the Kubernetes API (etcd), reconciliation is continuous, and access is governed by Kubernetes RBAC. Crossplane fits platform teams offering self-service infrastructure through the same GitOps flow as apps; Terraform fits one-off or non-Kubernetes-centric estates. Many teams run both — Crossplane even has a Terraform provider.

### What is the difference between an XRD, a Composition and a claim?

The XRD defines the schema of your custom API (like a CRD). The Composition defines which managed resources get created for it and how fields map. A claim (or, in Crossplane v2, a namespaced XR) is the instance a developer creates. One XRD can have many Compositions — one per cloud or tier.

### How does Crossplane reconciliation handle drift?

Each provider controller periodically observes the external resource (default poll ~1 minute, configurable with `--poll-interval`) and updates it back to `spec.forProvider` if it differs. Set `spec.managementPolicies: ["Observe"]` to import a resource read-only instead.

### How do I import an existing cloud resource?

Create the managed resource with the cloud ID in the `crossplane.io/external-name` annotation and `managementPolicies: ["Observe"]` to start, then switch to full management once `spec.forProvider` matches reality.

### What are EnvironmentConfigs?

Cluster-scoped key/value objects (e.g. VPC IDs, account IDs per environment) that Compositions can read — via `function-environment-configs` in pipeline mode — so claims don't need to carry environment details.

## Key Takeaways

- Crossplane manages cloud infrastructure as Kubernetes resources with continuous drift correction
- XRDs define the platform API, Compositions implement it per cloud, claims consume it
- Use pipeline-mode Compositions — native `resources` mode is gone in Crossplane v2
- Connection details land as Secrets in the consuming namespace
- Integrates with Argo CD/Flux for GitOps-driven infrastructure
