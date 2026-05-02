---
title: "kubectl explain: API Resource Reference"
description: "Use kubectl explain and api-resources to discover Kubernetes API objects. Field documentation, resource versions, short names, and API group exploration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "6 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "api"
  - "reference"
  - "documentation"
  - "cka"
relatedRecipes:
  - "kubectl-cheat-sheet"
  - "kubectl-get-pods-examples"
  - "kubectl-apply-vs-create"
  - "kubernetes-kubectl-wait-scripting"
  - "kubernetes-kubectl-plugins-guide"
---

> 💡 **Quick Answer:** `kubectl explain pod.spec.containers` shows field documentation inline. `kubectl api-resources` lists all available resource types with short names. `kubectl explain deployment --recursive` shows the full structure. Use `explain` during CKA exam instead of memorizing YAML — it's your built-in reference.

## The Problem

Kubernetes has hundreds of resource fields:

- Can't remember exact YAML structure
- Don't know which fields are required vs optional
- Need to discover API groups and versions
- Want to know field types and valid values

## The Solution

### kubectl explain

```bash
# Top-level resource
kubectl explain pod
# KIND:     Pod
# VERSION:  v1
# DESCRIPTION: Pod is a collection of containers...
# FIELDS:
#   apiVersion   <string>
#   kind         <string>
#   metadata     <ObjectMeta>
#   spec         <PodSpec>
#   status       <PodStatus>

# Drill into fields
kubectl explain pod.spec
kubectl explain pod.spec.containers
kubectl explain pod.spec.containers.resources
kubectl explain pod.spec.containers.resources.limits

# Specific field
kubectl explain pod.spec.containers.livenessProbe.httpGet
# FIELDS:
#   host   <string>
#   httpHeaders  <[]HTTPHeader>
#   path   <string>    - required
#   port   <IntOrString> - required
#   scheme <string>

# Full recursive tree
kubectl explain pod.spec --recursive
# Shows ALL fields in tree format (great for discovering options)

kubectl explain deployment.spec --recursive | head -50
```

### kubectl api-resources

```bash
# All resource types
kubectl api-resources
# NAME                  SHORTNAMES   APIVERSION   NAMESPACED   KIND
# pods                  po           v1           true         Pod
# services              svc          v1           true         Service
# deployments           deploy       apps/v1      true         Deployment
# configmaps            cm           v1           true         ConfigMap
# secrets                            v1           true         Secret
# ...

# Short names save typing
kubectl get po          # pods
kubectl get svc         # services
kubectl get deploy      # deployments
kubectl get cm          # configmaps
kubectl get ns          # namespaces
kubectl get no          # nodes
kubectl get rs          # replicasets
kubectl get ds          # daemonsets
kubectl get sts         # statefulsets
kubectl get pv          # persistentvolumes
kubectl get pvc         # persistentvolumeclaims
kubectl get ing         # ingresses
kubectl get netpol      # networkpolicies
kubectl get sa          # serviceaccounts
kubectl get ep          # endpoints
kubectl get cj          # cronjobs
kubectl get hpa         # horizontalpodautoscalers

# Filter by API group
kubectl api-resources --api-group=apps
kubectl api-resources --api-group=batch
kubectl api-resources --api-group=networking.k8s.io
kubectl api-resources --api-group=rbac.authorization.k8s.io

# Only namespaced resources
kubectl api-resources --namespaced=true

# Only cluster-scoped resources
kubectl api-resources --namespaced=false

# Resources with specific verb
kubectl api-resources --verbs=list,get
```

### kubectl api-versions

```bash
# All API versions
kubectl api-versions
# admissionregistration.k8s.io/v1
# apps/v1
# autoscaling/v1
# autoscaling/v2
# batch/v1
# certificates.k8s.io/v1
# networking.k8s.io/v1
# rbac.authorization.k8s.io/v1
# storage.k8s.io/v1
# v1
# ...

# Useful for knowing correct apiVersion in YAML
```

### CKA Exam Workflow

```bash
# Step 1: "Create a NetworkPolicy" — what's the apiVersion?
kubectl api-resources | grep networkpol
# networkpolicies   netpol   networking.k8s.io/v1   true   NetworkPolicy

# Step 2: What fields are available?
kubectl explain networkpolicy.spec --recursive

# Step 3: What does ingress.from look like?
kubectl explain networkpolicy.spec.ingress.from

# Step 4: Generate starting YAML
kubectl create deployment nginx --image=nginx --dry-run=client -o yaml

# Much faster than memorizing every YAML structure!
```

### Discover CRDs

```bash
# List Custom Resource Definitions
kubectl get crd
# NAME                                    CREATED AT
# certificates.cert-manager.io            2026-01-15
# ingressroutes.traefik.containo.us       2026-01-20

# Explain CRD fields
kubectl explain certificate.spec   # cert-manager Certificate

# API resources includes CRDs
kubectl api-resources | grep cert-manager
```

### Raw API Access

```bash
# Direct API call
kubectl get --raw /api/v1/namespaces/default/pods

# API discovery
kubectl get --raw /apis

# Specific resource API
kubectl get --raw /apis/apps/v1

# OpenAPI spec
kubectl get --raw /openapi/v2 | head -100
```

## Common Issues

**"the server doesn't have a resource type"**

Resource not available in this cluster version, or CRD not installed. Check: `kubectl api-resources | grep <name>`.

**Wrong apiVersion in YAML**

Use `kubectl api-resources` to find the correct API group and version. Common mistake: `extensions/v1beta1` (removed) instead of `networking.k8s.io/v1`.

**Field not found in explain**

May be in a newer K8s version. Check: `kubectl version` and K8s release notes.

## Best Practices

- **Use `explain` instead of Google** during CKA — faster and always accurate
- **`--recursive`** for discovering available fields
- **Short names** for speed — `po`, `svc`, `deploy`, `cm`
- **`api-resources | grep`** to find the right apiVersion
- **`--dry-run=client -o yaml`** to generate starting templates

## Key Takeaways

- `kubectl explain <resource.field>` is your inline documentation
- `kubectl api-resources` lists all resources with short names and API groups
- Use `--recursive` to see the full field tree
- Short names (`po`, `svc`, `deploy`) save typing
- Essential CKA skill — explain + dry-run = no memorization needed
