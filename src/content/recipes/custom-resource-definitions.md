---
title: "How to Create Custom Resource Definitions (CRDs)"
description: "Extend Kubernetes API with Custom Resource Definitions. Define custom objects, configure validation schemas, and manage CRD lifecycle."
category: "configuration"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["crd", "custom-resources", "api", "extensions", "operators"]
---

# How to Create Custom Resource Definitions (CRDs)

Custom Resource Definitions (CRDs) extend the Kubernetes API with your own resource types. CRDs are the foundation for building operators and managing application-specific configurations.

## Basic CRD Structure

```yaml
# basic-crd.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: databases.example.com  # plural.group
spec:
  group: example.com
  names:
    kind: Database
    listKind: DatabaseList
    plural: databases
    singular: database
    shortNames:
      - db
  scope: Namespaced  # or Cluster
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
```

## CRD with Full Schema

```yaml
# database-crd.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: databases.example.com
spec:
  group: example.com
  names:
    kind: Database
    listKind: DatabaseList
    plural: databases
    singular: database
    shortNames:
      - db
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          required:
            - spec
          properties:
            spec:
              type: object
              required:
                - engine
                - version
              properties:
                engine:
                  type: string
                  enum:
                    - postgres
                    - mysql
                    - mongodb
                  description: "Database engine type"
                version:
                  type: string
                  pattern: '^\d+\.\d+(\.\d+)?$'
                  description: "Database version (e.g., 14.1)"
                replicas:
                  type: integer
                  minimum: 1
                  maximum: 7
                  default: 1
                storage:
                  type: object
                  properties:
                    size:
                      type: string
                      pattern: '^\d+(Gi|Mi|Ti)$'
                      default: "10Gi"
                    storageClass:
                      type: string
                backup:
                  type: object
                  properties:
                    enabled:
                      type: boolean
                      default: true
                    schedule:
                      type: string
                      default: "0 2 * * *"
                    retention:
                      type: integer
                      default: 7
            status:
              type: object
              properties:
                phase:
                  type: string
                replicas:
                  type: integer
                conditions:
                  type: array
                  items:
                    type: object
                    properties:
                      type:
                        type: string
                      status:
                        type: string
                      lastTransitionTime:
                        type: string
                        format: date-time
                      reason:
                        type: string
                      message:
                        type: string
      subresources:
        status: {}  # Enable status subresource
      additionalPrinterColumns:
        - name: Engine
          type: string
          jsonPath: .spec.engine
        - name: Version
          type: string
          jsonPath: .spec.version
        - name: Replicas
          type: integer
          jsonPath: .spec.replicas
        - name: Phase
          type: string
          jsonPath: .status.phase
        - name: Age
          type: date
          jsonPath: .metadata.creationTimestamp
```

## Create Custom Resource

```yaml
# my-database.yaml
apiVersion: example.com/v1
kind: Database
metadata:
  name: my-postgres
  namespace: default
spec:
  engine: postgres
  version: "14.5"
  replicas: 3
  storage:
    size: "50Gi"
    storageClass: "fast-ssd"
  backup:
    enabled: true
    schedule: "0 3 * * *"
    retention: 14
```

```bash
# Apply CRD first
kubectl apply -f database-crd.yaml

# Then create custom resource
kubectl apply -f my-database.yaml

# List databases
kubectl get databases
kubectl get db  # Using shortName

# Describe
kubectl describe database my-postgres

# Delete
kubectl delete database my-postgres
```

## CRD with Validation

```yaml
# validated-crd.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: applications.example.com
spec:
  group: example.com
  names:
    kind: Application
    plural: applications
    singular: application
    shortNames:
      - app
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required:
                - name
                - image
              properties:
                name:
                  type: string
                  minLength: 1
                  maxLength: 63
                  pattern: '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$'
                image:
                  type: string
                  minLength: 1
                replicas:
                  type: integer
                  minimum: 0
                  maximum: 100
                  default: 1
                env:
                  type: array
                  items:
                    type: object
                    required:
                      - name
                      - value
                    properties:
                      name:
                        type: string
                      value:
                        type: string
                resources:
                  type: object
                  properties:
                    cpu:
                      type: string
                      pattern: '^\d+m?$'
                    memory:
                      type: string
                      pattern: '^\d+(Ki|Mi|Gi)?$'
                  x-kubernetes-preserve-unknown-fields: false
```

## Multiple Versions

```yaml
# multi-version-crd.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: configs.example.com
spec:
  group: example.com
  names:
    kind: Config
    plural: configs
  scope: Namespaced
  versions:
    - name: v1beta1
      served: true
      storage: false  # Not the storage version
      deprecated: true
      deprecationWarning: "example.com/v1beta1 Config is deprecated; use v1"
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                setting:
                  type: string
    - name: v1
      served: true
      storage: true  # Storage version
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                settings:  # Changed from 'setting' to 'settings'
                  type: object
                  additionalProperties:
                    type: string
  conversion:
    strategy: None  # or Webhook for conversion
```

## CRD with Defaulting

```yaml
# defaulting-crd.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: caches.example.com
spec:
  group: example.com
  names:
    kind: Cache
    plural: caches
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              default: {}
              properties:
                size:
                  type: string
                  default: "1Gi"
                replicas:
                  type: integer
                  default: 1
                evictionPolicy:
                  type: string
                  default: "lru"
                  enum:
                    - lru
                    - lfu
                    - random
                ttl:
                  type: integer
                  default: 3600
```

## Printer Columns

```yaml
# Additional columns for kubectl get
additionalPrinterColumns:
  - name: Status
    type: string
    description: "Current status"
    jsonPath: .status.phase
  - name: Replicas
    type: integer
    jsonPath: .spec.replicas
  - name: Ready
    type: string
    jsonPath: .status.readyReplicas
  - name: Age
    type: date
    jsonPath: .metadata.creationTimestamp
  - name: Message
    type: string
    priority: 1  # Only shown with -o wide
    jsonPath: .status.message
```

## Scale Subresource

```yaml
# CRD with scale subresource
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: workers.example.com
spec:
  group: example.com
  names:
    kind: Worker
    plural: workers
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      subresources:
        status: {}
        scale:
          specReplicasPath: .spec.replicas
          statusReplicasPath: .status.replicas
          labelSelectorPath: .status.selector
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                replicas:
                  type: integer
            status:
              type: object
              properties:
                replicas:
                  type: integer
                selector:
                  type: string
```

```bash
# Scale using kubectl
kubectl scale worker my-worker --replicas=5
```

## Finalizers

```yaml
# Custom resource with finalizer
apiVersion: example.com/v1
kind: Database
metadata:
  name: my-db
  finalizers:
    - databases.example.com/cleanup
spec:
  engine: postgres
  version: "14.5"
```

## View and Manage CRDs

```bash
# List all CRDs
kubectl get crds

# Describe CRD
kubectl describe crd databases.example.com

# View CRD schema
kubectl get crd databases.example.com -o yaml

# Delete CRD (deletes all instances!)
kubectl delete crd databases.example.com

# Get resources of custom type
kubectl get databases -A
kubectl get databases -o wide
kubectl get databases -o yaml
```

## RBAC for CRDs

```yaml
# rbac.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: database-admin
rules:
  - apiGroups: ["example.com"]
    resources: ["databases"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["example.com"]
    resources: ["databases/status"]
    verbs: ["get", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: database-admin-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: database-admin
subjects:
  - kind: ServiceAccount
    name: database-operator
    namespace: default
```

## Best Practices

```yaml
# 1. Use descriptive group names
group: mycompany.io  # Not just "example"

# 2. Include validation
schema:
  openAPIV3Schema:
    type: object
    required:
      - spec

# 3. Enable status subresource
subresources:
  status: {}

# 4. Add printer columns
additionalPrinterColumns:
  - name: Status
    jsonPath: .status.phase

# 5. Document with descriptions
properties:
  replicas:
    type: integer
    description: "Number of desired replicas"
```

## Summary

CRDs extend Kubernetes with custom resource types. Define schemas with OpenAPI validation, use subresources for status and scale, and add printer columns for better kubectl output. CRDs are the foundation for operators that manage complex applications. Always include proper validation, set defaults where appropriate, and configure RBAC to control access to custom resources.
