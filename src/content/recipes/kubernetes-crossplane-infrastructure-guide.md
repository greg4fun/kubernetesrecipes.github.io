---
title: "Crossplane: Provision Cloud from Kubernetes"
description: "Manage cloud infrastructure with Crossplane in Kubernetes. Provision AWS RDS, S3, Azure databases, and GCP resources using manifests and compositions."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "crossplane"
  - "infrastructure"
  - "cloud"
  - "iac"
  - "platform-engineering"
relatedRecipes:
  - "kubernetes-operator-pattern-guide"
  - "kubernetes-crd-guide"
  - "kubernetes-argocd-gitops-guide"
---

> 💡 **Quick Answer:** Crossplane extends Kubernetes to provision cloud resources. Install: `helm install crossplane crossplane-stable/crossplane -n crossplane-system --create-namespace`. Install a provider (AWS/Azure/GCP), then create cloud resources with `kubectl apply`. Define `Compositions` to build platform APIs — developers create a `Database` claim, Crossplane provisions RDS + security group + subnet automatically.

## The Problem

Managing infrastructure alongside applications:

- Terraform/Pulumi are separate workflows from K8s
- Developers need databases, caches, queues — but can't self-service
- No unified API for multi-cloud resources
- Infrastructure state lives outside the cluster
- GitOps can't manage cloud resources natively

## The Solution

### Install Crossplane

```bash
helm repo add crossplane-stable https://charts.crossplane.io/stable
helm install crossplane crossplane-stable/crossplane \
  -n crossplane-system --create-namespace

# Verify
kubectl get pods -n crossplane-system
# crossplane-xxx                Running
# crossplane-rbac-manager-xxx   Running
```

### Install AWS Provider

```yaml
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws
spec:
  package: xpkg.upbound.io/upbound/provider-aws-s3:v1.2.0
# Also: provider-aws-rds, provider-aws-ec2, etc.

---
# Provider credentials
apiVersion: v1
kind: Secret
metadata:
  name: aws-creds
  namespace: crossplane-system
type: Opaque
stringData:
  credentials: |
    [default]
    aws_access_key_id = AKIAXXXXXXXX
    aws_secret_access_key = xxxxxxxxxx

---
apiVersion: aws.upbound.io/v1beta1
kind: ProviderConfig
metadata:
  name: default
spec:
  credentials:
    source: Secret
    secretRef:
      name: aws-creds
      namespace: crossplane-system
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

---
# Create an RDS instance
apiVersion: rds.aws.upbound.io/v1beta1
kind: Instance
metadata:
  name: production-db
spec:
  forProvider:
    region: us-east-1
    engine: postgres
    engineVersion: "16"
    instanceClass: db.t3.medium
    allocatedStorage: 100
    dbName: myapp
    masterUsername: admin
    masterPasswordSecretRef:
      name: db-master-password
      namespace: production
      key: password
    skipFinalSnapshot: false
    publiclyAccessible: false
    vpcSecurityGroupIdRefs:
    - name: db-security-group
  writeConnectionSecretToRef:
    name: db-connection
    namespace: production
```

```bash
# Check status
kubectl get bucket,instance
# NAME                      READY   SYNCED
# bucket/my-app-data        True    True
# instance/production-db    True    True

# Connection details auto-written to Secret
kubectl get secret db-connection -n production -o yaml
```

### Compositions (Platform API)

```yaml
# Define a platform API — developers only see this
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
  - name: v1
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
                enum: [small, medium, large]
              engine:
                type: string
                enum: [postgres, mysql]

---
# Composition — maps claim to actual cloud resources
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: database-aws
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1
    kind: XDatabase
  resources:
  - name: rds-instance
    base:
      apiVersion: rds.aws.upbound.io/v1beta1
      kind: Instance
      spec:
        forProvider:
          region: us-east-1
          engine: postgres
          skipFinalSnapshot: false
    patches:
    - type: FromCompositeFieldPath
      fromFieldPath: spec.size
      toFieldPath: spec.forProvider.instanceClass
      transforms:
      - type: map
        map:
          small: db.t3.micro
          medium: db.t3.medium
          large: db.r6g.xlarge
  
  - name: security-group
    base:
      apiVersion: ec2.aws.upbound.io/v1beta1
      kind: SecurityGroup
      spec:
        forProvider:
          region: us-east-1
          description: Database security group

---
# Developer creates this — simple claim!
apiVersion: platform.example.com/v1
kind: Database
metadata:
  name: orders-db
  namespace: production
spec:
  size: medium
  engine: postgres
# Crossplane creates: RDS instance + security group + subnet group
```

### Multi-Cloud

```yaml
# Same claim, different composition per cloud
# Composition selection via label:
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: database-azure
  labels:
    provider: azure
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1
    kind: XDatabase
  resources:
  - name: azure-db
    base:
      apiVersion: dbforpostgresql.azure.upbound.io/v1beta1
      kind: FlexibleServer
      # Azure-specific config...

# Select composition:
apiVersion: platform.example.com/v1
kind: Database
metadata:
  name: orders-db
spec:
  compositionSelector:
    matchLabels:
      provider: azure
  size: medium
```

## Common Issues

**Resource stuck "Syncing"**

Provider credentials invalid or IAM permissions missing. Check: `kubectl describe <resource>` for error events.

**Composition not selected**

Multiple compositions match — add `compositionSelector` or `compositionRef` to the claim.

**Deleted resource not cleaned up**

Cloud resource has deletion protection. Disable it first, or set `deletionPolicy: Delete` (default is `Delete`).

## Best Practices

- **Compositions for platform APIs** — abstract cloud complexity for developers
- **GitOps with ArgoCD** — manage Crossplane resources like any K8s resource
- **Use ProviderConfig per environment** — separate credentials for dev/staging/prod
- **Connection secrets** — auto-write connection details to K8s Secrets
- **Start small** — one provider, one composition, iterate

## Key Takeaways

- Crossplane provisions cloud resources using Kubernetes manifests
- Compositions create platform APIs — developers see simple claims
- Supports AWS, Azure, GCP, and 100+ providers
- GitOps-native — ArgoCD can manage infrastructure and apps together
- Alternative to Terraform with unified Kubernetes-native workflow
