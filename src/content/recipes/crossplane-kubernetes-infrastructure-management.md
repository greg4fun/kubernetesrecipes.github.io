---
title: "Crossplane Kubernetes Infrastructure Management"
description: "Manage cloud infrastructure as Kubernetes resources with Crossplane. Provision AWS, GCP, and Azure resources using custom resource"
tags:
  - "crossplane"
  - "infrastructure-as-code"
  - "multi-cloud"
  - "gitops"
  - "compositions"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "argocd-gitops-deployment"
  - "kustomize-vs-helm-comparison"
---

> 💡 **Quick Answer:** Crossplane extends Kubernetes with CRDs for cloud resources (RDS, S3, VPCs, etc.). Install Crossplane + a Provider (AWS/GCP/Azure), define Compositions for your infrastructure patterns, then teams claim resources with simple CRs — just like requesting a PVC. GitOps-friendly: `kubectl get managed` shows all cloud resources.

## The Problem

- Infrastructure provisioning is disconnected from application deployment
- Terraform state management is complex in team environments
- Developers need cloud resources but shouldn't have direct cloud console access
- Multi-cloud requires different tools (Terraform, Pulumi, CloudFormation)
- No single control plane for both infrastructure and applications

## The Solution

### Install Crossplane

```bash
helm repo add crossplane-stable https://charts.crossplane.io/stable
helm repo update

helm install crossplane crossplane-stable/crossplane \
  --namespace crossplane-system \
  --create-namespace \
  --wait

# Verify
kubectl get pods -n crossplane-system
kubectl get crds | grep crossplane
```

### Install AWS Provider

```yaml
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws
spec:
  package: xpkg.upbound.io/upbound/provider-family-aws:v1.7.0
---
# Provider credentials
apiVersion: v1
kind: Secret
metadata:
  name: aws-credentials
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
      name: aws-credentials
      key: credentials
```

### Provision Cloud Resources

```yaml
# Create an S3 bucket
apiVersion: s3.aws.upbound.io/v1beta1
kind: Bucket
metadata:
  name: my-app-data
spec:
  forProvider:
    region: us-east-1
    tags:
      Environment: production
      ManagedBy: crossplane
  providerConfigRef:
    name: default
---
# Create an RDS instance
apiVersion: rds.aws.upbound.io/v1beta2
kind: Instance
metadata:
  name: my-app-database
spec:
  forProvider:
    region: us-east-1
    instanceClass: db.t3.medium
    engine: postgres
    engineVersion: "15"
    allocatedStorage: 50
    dbName: myapp
    masterUsername: admin
    masterPasswordSecretRef:
      name: db-master-password
      namespace: crossplane-system
      key: password
    skipFinalSnapshot: true
    publiclyAccessible: false
    vpcSecurityGroupIdRefs:
      - name: db-security-group
  providerConfigRef:
    name: default
  writeConnectionSecretToRef:
    name: db-connection
    namespace: my-app
```

### Define Compositions (Platform API)

```yaml
# Composition: reusable infrastructure template
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
                size:
                  type: string
                  enum: ["small", "medium", "large"]
                engine:
                  type: string
                  enum: ["postgres", "mysql"]
              required: ["size", "engine"]
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
  resources:
    - name: rds-instance
      base:
        apiVersion: rds.aws.upbound.io/v1beta2
        kind: Instance
        spec:
          forProvider:
            region: us-east-1
            skipFinalSnapshot: true
            publiclyAccessible: false
      patches:
        - type: FromCompositeFieldPath
          fromFieldPath: spec.engine
          toFieldPath: spec.forProvider.engine
        - type: FromCompositeFieldPath
          fromFieldPath: spec.size
          toFieldPath: spec.forProvider.instanceClass
          transforms:
            - type: map
              map:
                small: db.t3.micro
                medium: db.t3.medium
                large: db.r6g.xlarge
```

### Team Claims (Simple Interface)

```yaml
# Developers request a database — no cloud knowledge needed
apiVersion: platform.example.com/v1alpha1
kind: Database
metadata:
  name: user-service-db
  namespace: user-service
spec:
  size: medium
  engine: postgres
```

### Check Status

```bash
# View all managed cloud resources
kubectl get managed
# NAME                                    READY   SYNCED   AGE
# bucket.s3.aws/my-app-data              True    True     5m
# instance.rds.aws/my-app-database       True    True     10m

# View claims
kubectl get databases -A
# NAMESPACE      NAME               READY   CONNECTION-SECRET   AGE
# user-service   user-service-db    True    db-connection       3m

# Debug resource
kubectl describe instance.rds.aws my-app-database
```

## Common Issues

### Resource stuck in "Creating" / not syncing
- **Cause**: Provider credentials incorrect or insufficient IAM permissions
- **Fix**: Check provider pod logs: `kubectl logs -n crossplane-system -l pkg.crossplane.io/revision`

### "cannot compose resources: referenced field not found"
- **Cause**: Patch path doesn't match actual resource spec
- **Fix**: Verify field paths against provider CRD schema; use `kubectl explain`

### Composition not selected for claim
- **Cause**: No matching Composition for the CompositeResourceDefinition
- **Fix**: Ensure Composition's `compositeTypeRef` matches XRD; check label selectors

## Best Practices

1. **Use Compositions** — abstract cloud details; expose simple claims to teams
2. **GitOps with ArgoCD** — manage Crossplane resources in Git like any other K8s resource
3. **IRSA/Workload Identity** — avoid static credentials; use cloud-native identity
4. **Separate provider configs** — different credentials for dev/staging/prod
5. **Write connection secrets** — auto-inject credentials into application namespaces
6. **Monitor with `kubectl get managed`** — single view of all cloud resources

## Key Takeaways

- Crossplane makes cloud resources into Kubernetes CRDs — managed via `kubectl`
- Compositions create platform APIs — teams claim resources without cloud expertise
- Providers support AWS, GCP, Azure, and 100+ services
- GitOps-native: store infrastructure as YAML in Git, deploy via ArgoCD
- Connection secrets automatically provide credentials to applications
- `kubectl get managed` shows all cloud resources across all providers
