---
title: "Crossplane K8s Infrastructure Management"
description: "Manage cloud infrastructure from Kubernetes with Crossplane. Providers, Compositions, Claims, XRDs, and GitOps-driven infrastructure as code for AWS, GCP."
publishDate: "2026-04-12"
author: "Luca Berton"
category: "deployments"
tags:
  - "crossplane"
  - "infrastructure-as-code"
  - "cloud-providers"
  - "gitops"
  - "platform-engineering"
difficulty: "advanced"
timeToComplete: "30 minutes"
relatedRecipes:
  - "cluster-api-infrastructure-as-code"
  - "argocd-gitops-deployment"
  - "flux-gitops-continuous-delivery"
  - "terraform-kubernetes-integration"
  - "platform-engineering-kubernetes"
---

> 💡 **Quick Answer:** Crossplane extends Kubernetes with CRDs that manage cloud infrastructure (databases, networks, clusters) using the same kubectl/GitOps workflows as your workloads. Define an XRD (schema), build a Composition (implementation), and users claim resources via simple YAML — no cloud console or Terraform needed.

## The Problem

Platform teams need to provision cloud infrastructure (RDS databases, S3 buckets, VPCs, GKE clusters) for application teams. Traditional approaches require Terraform expertise, cloud console access, or custom tooling. Crossplane lets you manage everything through Kubernetes — same API, same GitOps, same RBAC.

```mermaid
flowchart TB
    DEV["Developer"] -->|"kubectl apply"| CLAIM["Claim (XRC)<br/>Simple request YAML"]
    CLAIM --> XRD["XRD<br/>Schema definition"]
    XRD --> COMP["Composition<br/>Cloud implementation"]
    COMP --> PROVIDER["Provider<br/>(AWS/GCP/Azure)"]
    PROVIDER --> RDS["RDS Database"]
    PROVIDER --> S3["S3 Bucket"]
    PROVIDER --> VPC["VPC Network"]
```

## The Solution

### Install Crossplane

```bash
# Add Helm repo
helm repo add crossplane-stable https://charts.crossplane.io/stable
helm repo update

# Install Crossplane
helm install crossplane crossplane-stable/crossplane \
  --namespace crossplane-system \
  --create-namespace \
  --set args='{"--enable-usages"}'

# Verify
kubectl get pods -n crossplane-system
# NAME                                      READY   STATUS
# crossplane-7b8f4d-abc12                   1/1     Running
# crossplane-rbac-manager-9c8f5e-def34      1/1     Running
```

### Install a Provider

```yaml
# AWS Provider
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws-s3
spec:
  package: xpkg.upbound.io/upbound/provider-aws-s3:v1.14.0
---
# GCP Provider  
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-gcp-storage
spec:
  package: xpkg.upbound.io/upbound/provider-gcp-storage:v1.8.0
---
# Azure Provider
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-azure-storage
spec:
  package: xpkg.upbound.io/upbound/provider-azure-storage:v1.5.0
```

```bash
# Check provider status
kubectl get providers
# NAME                   INSTALLED   HEALTHY   PACKAGE                                          AGE
# provider-aws-s3        True        True      xpkg.upbound.io/upbound/provider-aws-s3:v1.14   5m

# Check managed resources available
kubectl get managed
```

### Configure Provider Credentials

```yaml
# AWS credentials
apiVersion: v1
kind: Secret
metadata:
  name: aws-creds
  namespace: crossplane-system
type: Opaque
stringData:
  creds: |
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
      key: creds
```

### Managed Resource (Direct)

Create a cloud resource directly:

```yaml
# Create an S3 bucket
apiVersion: s3.aws.upbound.io/v1beta2
kind: Bucket
metadata:
  name: my-app-bucket
spec:
  forProvider:
    region: us-east-1
    tags:
      Environment: production
      ManagedBy: crossplane
  providerConfigRef:
    name: default
```

```bash
kubectl apply -f bucket.yaml
kubectl get bucket my-app-bucket
# NAME            READY   SYNCED   EXTERNAL-NAME     AGE
# my-app-bucket   True    True     my-app-bucket     2m
```

### Platform API: XRD + Composition + Claim

The real power — create self-service abstractions:

#### 1. CompositeResourceDefinition (XRD)

Defines the API schema your developers will use:

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
                  enum: ["postgres", "mysql"]
                  description: "Database engine"
                size:
                  type: string
                  enum: ["small", "medium", "large"]
                  description: "Instance size"
                region:
                  type: string
                  default: "us-east-1"
              required:
                - engine
                - size
```

#### 2. Composition

Maps the abstract API to real cloud resources:

```yaml
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
  resources:
    - name: rds-instance
      base:
        apiVersion: rds.aws.upbound.io/v1beta2
        kind: Instance
        spec:
          forProvider:
            region: us-east-1
            engine: postgres
            engineVersion: "16"
            instanceClass: db.t3.medium
            allocatedStorage: 20
            skipFinalSnapshot: true
            publiclyAccessible: false
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
                small: db.t3.small
                medium: db.t3.medium
                large: db.r6g.large
```

#### 3. Claim (Developer Experience)

Developers submit simple claims:

```yaml
# This is all a developer needs to write:
apiVersion: platform.example.com/v1alpha1
kind: Database
metadata:
  name: my-app-db
  namespace: team-alpha
spec:
  engine: postgres
  size: medium
  region: us-east-1
```

```bash
kubectl apply -f claim.yaml
kubectl get databases -n team-alpha
# NAME        SYNCED   READY   AGE
# my-app-db   True     True    5m
```

### GitOps with Crossplane

```yaml
# ArgoCD Application for infrastructure
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: infrastructure
spec:
  source:
    repoURL: https://github.com/org/infrastructure
    path: crossplane/
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
  syncPolicy:
    automated:
      selfHeal: true
      prune: true
```

### Check Status

```bash
# All managed resources
kubectl get managed
# NAME                                           READY   SYNCED
# bucket.s3.aws.upbound.io/my-app-bucket         True    True
# instance.rds.aws.upbound.io/my-app-db-abc12    True    True

# Crossplane events
kubectl describe database my-app-db -n team-alpha

# Provider logs
kubectl logs -n crossplane-system -l pkg.crossplane.io/revision
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Provider not healthy | Missing credentials | Check ProviderConfig and Secret |
| Resource stuck in \`SYNCED=False\` | Cloud API error | Check \`kubectl describe\` for events |
| Claim not creating resources | No matching Composition | Verify compositeTypeRef matches XRD |
| \`cannot resolve package\` | Wrong provider package URL | Check <https://marketplace.upbound.io> for correct package name |
| Permission denied in cloud | IAM role insufficient | Add required permissions to provider credentials |
| Drift detected | Manual cloud console change | Crossplane will reconcile back — let it |

## Best Practices

- **Use Claims, not direct ManagedResources** — abstractions hide cloud complexity from developers
- **One Composition per cloud per XRD** — \`database-aws\`, \`database-gcp\` for the same XRD
- **Pin provider versions** — avoid breaking changes from auto-updates
- **Use Upbound Marketplace** — granular providers (per-service) instead of monolithic
- **GitOps everything** — XRDs, Compositions, and Claims all in Git
- **RBAC on Claims** — developers get \`database\` access, not \`bucket\` or \`instance\`

## Key Takeaways

- Crossplane manages cloud infrastructure through Kubernetes CRDs and controllers
- XRDs define your platform API, Compositions implement them, Claims consume them
- Developers write simple Claims — platform team controls the implementation
- Supports AWS, GCP, Azure, and 200+ providers via Upbound Marketplace
- Integrates with ArgoCD/Flux for GitOps-driven infrastructure management
- \`kubectl get managed\` shows all cloud resources managed by Crossplane
