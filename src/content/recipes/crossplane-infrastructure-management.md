---
title: "Crossplane for Cloud Infrastructure Management"
description: "Use Crossplane to provision and manage cloud infrastructure resources like databases, storage, and networking using Kubernetes-native APIs and GitOps workflows"
category: "configuration"
difficulty: "advanced"
timeToComplete: "55 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Understanding of Kubernetes CRDs and operators"
  - "Knowledge of cloud provider services (AWS/GCP/Azure)"
  - "Familiarity with Infrastructure as Code concepts"
relatedRecipes:
  - "custom-resource-definitions"
  - "argocd-gitops"
  - "kubernetes-operators"
tags:
  - crossplane
  - infrastructure-as-code
  - cloud-resources
  - gitops
  - platform-engineering
publishDate: "2026-01-28"
author: "kubernetes-recipes"
---

## Problem

Managing cloud infrastructure separately from Kubernetes workloads creates operational complexity. Different tools, workflows, and access controls for infrastructure vs applications slow down development and increase risk.

## Solution

Use Crossplane to provision and manage cloud infrastructure using the Kubernetes API. Crossplane extends Kubernetes with Custom Resource Definitions (CRDs) for cloud resources, enabling unified management through kubectl, GitOps, and standard Kubernetes tooling.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                Platform Team                         │
│  ┌─────────────────────────────────────────────┐   │
│  │  Define Composite Resources (XRDs)           │   │
│  │  - DatabaseClaim                             │   │
│  │  - NetworkClaim                              │   │
│  │  - StorageBucketClaim                        │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│                Kubernetes Cluster                    │
│  ┌─────────────────────────────────────────────┐   │
│  │           Crossplane                         │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │   AWS    │ │   GCP    │ │  Azure   │   │   │
│  │  │ Provider │ │ Provider │ │ Provider │   │   │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘   │   │
│  └───────┼────────────┼────────────┼─────────┘   │
└──────────┼────────────┼────────────┼─────────────┘
           │            │            │
           ▼            ▼            ▼
┌────────────────┐ ┌──────────┐ ┌──────────────┐
│     AWS        │ │   GCP    │ │    Azure     │
│  - RDS         │ │- Cloud   │ │ - Cosmos DB  │
│  - S3          │ │  SQL     │ │ - Blob       │
│  - VPC         │ │- GCS     │ │ - VNet       │
└────────────────┘ └──────────┘ └──────────────┘
```

### Step 1: Install Crossplane

Install Crossplane using Helm:

```bash
# Add Crossplane Helm repo
helm repo add crossplane-stable https://charts.crossplane.io/stable
helm repo update

# Install Crossplane
helm install crossplane \
  --namespace crossplane-system \
  --create-namespace \
  crossplane-stable/crossplane \
  --set args='{"--enable-composition-revisions"}'

# Verify installation
kubectl get pods -n crossplane-system
kubectl api-resources | grep crossplane
```

### Step 2: Install AWS Provider

Install and configure AWS provider:

```yaml
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws
spec:
  package: xpkg.upbound.io/upbound/provider-aws:v0.47.0
  controllerConfigRef:
    name: provider-aws-config
---
apiVersion: pkg.crossplane.io/v1alpha1
kind: ControllerConfig
metadata:
  name: provider-aws-config
spec:
  args:
  - --debug
  resources:
    limits:
      memory: 512Mi
    requests:
      cpu: 100m
      memory: 256Mi
```

Configure AWS credentials:

```bash
# Create credentials file
cat > aws-credentials.txt <<EOF
[default]
aws_access_key_id = YOUR_ACCESS_KEY
aws_secret_access_key = YOUR_SECRET_KEY
EOF

# Create Kubernetes secret
kubectl create secret generic aws-creds \
  -n crossplane-system \
  --from-file=creds=./aws-credentials.txt

# Clean up
rm aws-credentials.txt
```

Create ProviderConfig:

```yaml
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

### Step 3: Provision AWS RDS Database

Create an RDS instance using Crossplane:

```yaml
apiVersion: rds.aws.upbound.io/v1beta1
kind: Instance
metadata:
  name: production-postgres
  namespace: default
spec:
  forProvider:
    region: us-east-1
    instanceClass: db.t3.micro
    engine: postgres
    engineVersion: "15.4"
    allocatedStorage: 20
    storageType: gp3
    dbName: myapp
    username: admin
    autoMinorVersionUpgrade: true
    backupRetentionPeriod: 7
    backupWindow: "03:00-04:00"
    maintenanceWindow: "Mon:04:00-Mon:05:00"
    publiclyAccessible: false
    skipFinalSnapshot: true
    storageEncrypted: true
    vpcSecurityGroupIds:
    - sg-xxxxxxxxx
    dbSubnetGroupName: my-subnet-group
    passwordSecretRef:
      name: rds-password
      namespace: default
      key: password
  providerConfigRef:
    name: default
  writeConnectionSecretToRef:
    name: rds-connection
    namespace: default
---
apiVersion: v1
kind: Secret
metadata:
  name: rds-password
  namespace: default
type: Opaque
stringData:
  password: "MySecurePassword123!"
```

### Step 4: Create S3 Bucket

Provision an S3 bucket:

```yaml
apiVersion: s3.aws.upbound.io/v1beta1
kind: Bucket
metadata:
  name: app-assets-bucket
spec:
  forProvider:
    region: us-east-1
    tags:
      Environment: production
      Team: platform
  providerConfigRef:
    name: default
---
apiVersion: s3.aws.upbound.io/v1beta1
kind: BucketVersioning
metadata:
  name: app-assets-versioning
spec:
  forProvider:
    region: us-east-1
    bucketRef:
      name: app-assets-bucket
    versioningConfiguration:
    - status: Enabled
  providerConfigRef:
    name: default
---
apiVersion: s3.aws.upbound.io/v1beta1
kind: BucketServerSideEncryptionConfiguration
metadata:
  name: app-assets-encryption
spec:
  forProvider:
    region: us-east-1
    bucketRef:
      name: app-assets-bucket
    rule:
    - applyServerSideEncryptionByDefault:
      - sseAlgorithm: AES256
  providerConfigRef:
    name: default
```

### Step 5: Create Composite Resource Definition (XRD)

Define a reusable database abstraction:

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
    kind: DatabaseClaim
    plural: databaseclaims
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
              parameters:
                type: object
                properties:
                  size:
                    type: string
                    enum: ["small", "medium", "large"]
                    default: "small"
                  engine:
                    type: string
                    enum: ["postgres", "mysql"]
                    default: "postgres"
                  version:
                    type: string
                    default: "15"
                required:
                - size
          status:
            type: object
            properties:
              connectionSecret:
                type: string
              endpoint:
                type: string
```

### Step 6: Create Composition

Define how XDatabase maps to cloud resources:

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: xdatabase-aws
  labels:
    provider: aws
    engine: postgres
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XDatabase
  writeConnectionSecretsToNamespace: crossplane-system
  
  resources:
  # Security Group for RDS
  - name: security-group
    base:
      apiVersion: ec2.aws.upbound.io/v1beta1
      kind: SecurityGroup
      spec:
        forProvider:
          region: us-east-1
          vpcId: vpc-xxxxxxxxx
          description: "Database security group"
        providerConfigRef:
          name: default
    patches:
    - fromFieldPath: metadata.name
      toFieldPath: spec.forProvider.groupName
      transforms:
      - type: string
        string:
          fmt: "%s-db-sg"
  
  # RDS Instance
  - name: rds-instance
    base:
      apiVersion: rds.aws.upbound.io/v1beta1
      kind: Instance
      spec:
        forProvider:
          region: us-east-1
          engine: postgres
          publiclyAccessible: false
          storageEncrypted: true
          skipFinalSnapshot: true
          autoMinorVersionUpgrade: true
          backupRetentionPeriod: 7
          dbSubnetGroupName: default-subnet-group
        providerConfigRef:
          name: default
        writeConnectionSecretToRef:
          namespace: crossplane-system
    patches:
    # Instance class based on size
    - fromFieldPath: spec.parameters.size
      toFieldPath: spec.forProvider.instanceClass
      transforms:
      - type: map
        map:
          small: db.t3.micro
          medium: db.t3.medium
          large: db.r5.large
    # Storage based on size
    - fromFieldPath: spec.parameters.size
      toFieldPath: spec.forProvider.allocatedStorage
      transforms:
      - type: map
        map:
          small: 20
          medium: 100
          large: 500
    # Engine version
    - fromFieldPath: spec.parameters.version
      toFieldPath: spec.forProvider.engineVersion
    # Connection secret name
    - fromFieldPath: metadata.uid
      toFieldPath: spec.writeConnectionSecretToRef.name
      transforms:
      - type: string
        string:
          fmt: "%s-connection"
    connectionDetails:
    - name: endpoint
      fromFieldPath: status.atProvider.endpoint
    - name: port
      fromFieldPath: status.atProvider.port
    - name: username
      fromFieldPath: spec.forProvider.username
    - name: password
      fromConnectionSecretKey: password
```

### Step 7: Create Database Claim

Developers can now request databases using simple claims:

```yaml
apiVersion: platform.example.com/v1alpha1
kind: DatabaseClaim
metadata:
  name: myapp-database
  namespace: production
spec:
  parameters:
    size: medium
    engine: postgres
    version: "15"
  compositionSelector:
    matchLabels:
      provider: aws
      engine: postgres
  writeConnectionSecretToRef:
    name: myapp-db-connection
```

### Step 8: Use Database in Application

Reference the provisioned database:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: app
        image: myapp:v1.0
        env:
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: myapp-db-connection
              key: endpoint
        - name: DB_PORT
          valueFrom:
            secretKeyRef:
              name: myapp-db-connection
              key: port
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: myapp-db-connection
              key: username
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: myapp-db-connection
              key: password
```

### Step 9: Multi-Cloud Composition

Support multiple cloud providers:

```yaml
# GCP Composition
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: xdatabase-gcp
  labels:
    provider: gcp
    engine: postgres
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XDatabase
  resources:
  - name: cloudsql-instance
    base:
      apiVersion: sql.gcp.upbound.io/v1beta1
      kind: DatabaseInstance
      spec:
        forProvider:
          region: us-central1
          databaseVersion: POSTGRES_15
          settings:
          - tier: db-f1-micro
            ipConfiguration:
            - ipv4Enabled: false
              privateNetworkRef:
                name: my-vpc
        providerConfigRef:
          name: gcp-default
    patches:
    - fromFieldPath: spec.parameters.size
      toFieldPath: spec.forProvider.settings[0].tier
      transforms:
      - type: map
        map:
          small: db-f1-micro
          medium: db-n1-standard-2
          large: db-n1-standard-8
```

## Verification

Check Crossplane resources:

```bash
# List all Crossplane providers
kubectl get providers

# Check provider health
kubectl get provider.pkg provider-aws -o yaml

# List managed resources
kubectl get managed

# Check specific resource status
kubectl describe instance.rds.aws production-postgres

# View composite resources
kubectl get xdatabases
kubectl get databaseclaims -A
```

Debug provisioning:

```bash
# Check Crossplane controller logs
kubectl logs -n crossplane-system -l app=crossplane

# Check provider logs
kubectl logs -n crossplane-system -l pkg.crossplane.io/provider=provider-aws

# View events
kubectl get events --sort-by='.lastTimestamp'

# Describe claim for status
kubectl describe databaseclaim myapp-database -n production
```

Verify connection secrets:

```bash
# Check connection secret was created
kubectl get secret myapp-db-connection -n production

# View secret keys (don't decode in production!)
kubectl get secret myapp-db-connection -n production -o jsonpath='{.data}' | jq 'keys'
```

## Best Practices

1. **Use Compositions** for reusable infrastructure patterns
2. **Implement XRDs** to abstract cloud-specific details
3. **Store credentials securely** using external secret managers
4. **Version your Compositions** for safe upgrades
5. **Use GitOps** to manage Crossplane resources
6. **Implement RBAC** for claim namespaces
7. **Monitor resource status** and sync health
8. **Use ProviderConfigs** per environment/account
9. **Test Compositions** in non-production first
10. **Document self-service offerings** for developers

## Common Issues

**Resource stuck in creating:**
- Check provider credentials
- Verify cloud permissions (IAM)
- Check provider logs for API errors

**Composition not selecting:**
- Verify compositionSelector labels match
- Check XRD is properly defined
- Ensure Composition references correct XRD

**Connection secret missing:**
- Verify writeConnectionSecretToRef is configured
- Check secret namespace permissions
- Ensure managed resource is ready

## Related Resources

- [Crossplane Documentation](https://docs.crossplane.io/)
- [Upbound Marketplace](https://marketplace.upbound.io/)
- [Crossplane Compositions](https://docs.crossplane.io/latest/concepts/compositions/)
- [Provider AWS](https://marketplace.upbound.io/providers/upbound/provider-aws/)

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
