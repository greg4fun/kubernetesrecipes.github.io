---
title: "K8s Custom Resources: CRD Development"
description: "Create Kubernetes Custom Resource Definitions with schema validation, additional printer columns, subresources, and conversion webhooks."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "crd"
  - "custom-resources"
  - "api"
  - "operators"
  - "cka"
relatedRecipes:
  - "kubernetes-admission-webhooks-guide"
  - "kubernetes-api-resources-explain"
  - "kubernetes-rbac-role-rolebinding"
  - "kubernetes-1-36-declarative-validation"
---

> 💡 **Quick Answer:** `CustomResourceDefinition` extends the Kubernetes API with your own resource types. Define a CRD with `kubectl apply`, then create instances with `kubectl apply`. CRDs support schema validation, status subresource, additional printer columns, and versioning. Use CRDs + controllers for the operator pattern — automated management of complex applications.

## The Problem

Kubernetes built-in resources don't cover application-specific needs:

- Representing a database cluster (replicas, backup schedule, version)
- Managing certificates (issuer, renewal, domains)
- Defining network policies at higher abstraction levels
- Application-specific configuration as first-class Kubernetes objects

## The Solution

### Define a CRD

```yaml
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
    categories:
    - all                    # Shows in kubectl get all
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
            required: ["engine", "version", "replicas"]
            properties:
              engine:
                type: string
                enum: ["postgresql", "mysql", "mariadb"]
              version:
                type: string
                pattern: '^\d+\.\d+(\.\d+)?$'
              replicas:
                type: integer
                minimum: 1
                maximum: 7
              storage:
                type: object
                properties:
                  size:
                    type: string
                    pattern: '^\d+Gi$'
                  storageClass:
                    type: string
              backup:
                type: object
                properties:
                  schedule:
                    type: string
                  retention:
                    type: string
                    default: "7d"
          status:
            type: object
            properties:
              phase:
                type: string
              readyReplicas:
                type: integer
              message:
                type: string
    
    # Extra columns in kubectl get
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
    - name: Status
      type: string
      jsonPath: .status.phase
    - name: Age
      type: date
      jsonPath: .metadata.creationTimestamp
    
    # Enable status subresource
    subresources:
      status: {}
      # scale:                  # Optional: enable kubectl scale
      #   specReplicasPath: .spec.replicas
      #   statusReplicasPath: .status.readyReplicas
```

### Create Custom Resources

```yaml
apiVersion: example.com/v1
kind: Database
metadata:
  name: production-db
  namespace: production
spec:
  engine: postgresql
  version: "16.2"
  replicas: 3
  storage:
    size: 100Gi
    storageClass: fast-ssd
  backup:
    schedule: "0 2 * * *"
    retention: "30d"
```

```bash
# Apply CRD first
kubectl apply -f database-crd.yaml

# Then create instances
kubectl apply -f production-db.yaml

# Use short name
kubectl get db
# NAME            ENGINE       VERSION   REPLICAS   STATUS   AGE
# production-db   postgresql   16.2      3          Ready    5m

# Describe
kubectl describe db production-db

# Delete
kubectl delete db production-db

# kubectl explain works too
kubectl explain database.spec
```

### Status Subresource

```bash
# Status is updated separately from spec
# Controller updates status:
kubectl patch database production-db --type=merge --subresource=status \
  -p '{"status":{"phase":"Ready","readyReplicas":3,"message":"All replicas healthy"}}'

# Users update spec:
kubectl patch database production-db --type=merge \
  -p '{"spec":{"replicas":5}}'

# Status can't be changed with regular kubectl apply
# Only --subresource=status can modify .status
```

### RBAC for Custom Resources

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: database-operator
  namespace: production
rules:
- apiGroups: ["example.com"]
  resources: ["databases"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["example.com"]
  resources: ["databases/status"]
  verbs: ["get", "update", "patch"]
```

### Validation Patterns

```yaml
# String validation
properties:
  name:
    type: string
    minLength: 3
    maxLength: 63
    pattern: '^[a-z][a-z0-9-]*$'

# Enum validation
  engine:
    type: string
    enum: ["postgresql", "mysql", "mariadb"]

# Number validation
  replicas:
    type: integer
    minimum: 1
    maximum: 7
    default: 1

# Nested required fields
  spec:
    type: object
    required: ["engine", "version"]

# Additional properties blocked
  spec:
    type: object
    additionalProperties: false    # Rejects unknown fields
```

### CRD Versioning

```yaml
versions:
- name: v1
  served: true
  storage: true       # Only ONE version can be storage
  schema: ...

- name: v2
  served: true
  storage: false
  schema: ...         # v2 has different/extended schema

# With conversion webhook for v1 ↔ v2
conversion:
  strategy: Webhook
  webhook:
    clientConfig:
      service:
        name: database-converter
        namespace: webhook-system
        path: /convert
      caBundle: <base64-CA>
    conversionReviewVersions: ["v1"]
```

### List CRDs

```bash
# All CRDs in cluster
kubectl get crd
# NAME                           CREATED AT
# databases.example.com          2026-05-02
# certificates.cert-manager.io   2026-01-15

# CRD details
kubectl describe crd databases.example.com

# API resources includes CRDs
kubectl api-resources | grep example.com
# databases   db   example.com/v1   true   Database

# Delete CRD (DELETES ALL custom resources!)
kubectl delete crd databases.example.com
```

## Common Issues

**"no matches for kind" after CRD apply**

CRD not yet established. Wait: `kubectl wait --for=condition=Established crd/databases.example.com`.

**Validation errors on create**

Schema doesn't match. Check: `kubectl explain database.spec`. Ensure required fields present and types match.

**Deleting CRD deletes all instances**

By design. Use `kubectl delete crd` with extreme caution. Consider setting `metadata.finalizers` on CRs for protection.

## Best Practices

- **Always define OpenAPI schema** — prevents invalid resources
- **Enable status subresource** — separates user intent (spec) from controller state (status)
- **Use additionalPrinterColumns** — better `kubectl get` output
- **Set categories** — `["all"]` makes CRs appear in `kubectl get all`
- **Version from the start** — plan for v1→v2 migration
- **RBAC on custom resources** — don't leave them open to everyone

## Key Takeaways

- CRDs extend the Kubernetes API with custom resource types
- Schema validation enforces field types, required fields, and patterns
- Status subresource separates spec (user) from status (controller)
- Additional printer columns improve `kubectl get` output
- CRDs + controllers = operator pattern for automated application management
