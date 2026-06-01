---
title: "Kubernetes Labels and Annotations Best Practices"
description: "Implement Kubernetes labels and annotations following best practices. Recommended label keys, organizational conventions, selectors, annotations vs labels differences, and naming standards for production clusters."
tags:
  - "labels"
  - "annotations"
  - "metadata"
  - "best-practices"
  - "organization"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-resource-management"
  - "kubernetes-namespace-best-practices"
---

> 💡 **Quick Answer:** Labels are for identifying and selecting resources (used by services, deployments, scheduling). Annotations are for non-identifying metadata (build info, descriptions, tool config). Use the recommended `app.kubernetes.io/*` label keys. Labels are queryable with selectors; annotations are not.

## The Problem

- No standard for labeling resources — inconsistent across teams
- Can't select resources effectively without proper labels
- Confusion between when to use labels vs annotations
- Services can't find pods without matching label selectors
- Hard to identify resource ownership, version, and purpose in large clusters

## The Solution

### Labels vs Annotations

```text
Labels:                              Annotations:
├── Used by selectors               ├── NOT used by selectors
├── Identify resources              ├── Attach non-identifying metadata
├── Max 63 chars value              ├── Max 256KB total size
├── Used by: Services, Deployments, ├── Used by: tools, humans, automation
│   HPA, NetworkPolicy, scheduling  │
├── Examples:                       ├── Examples:
│   app: frontend                   │   description: "Main API service"
│   version: v2.1.0                 │   build.url: "https://ci.example.com/123"
│   environment: production         │   kubectl.kubernetes.io/last-applied
│   tier: backend                   │   prometheus.io/scrape: "true"
└───────────────────────────────────└──────────────────────────────────────
```

### Recommended Labels (app.kubernetes.io)

```yaml
metadata:
  labels:
    # Standard Kubernetes recommended labels
    app.kubernetes.io/name: "api-server"          # Application name
    app.kubernetes.io/instance: "api-server-prod" # Unique instance
    app.kubernetes.io/version: "2.1.0"            # Application version
    app.kubernetes.io/component: "backend"        # Component within app
    app.kubernetes.io/part-of: "e-commerce"       # Higher-level application
    app.kubernetes.io/managed-by: "helm"          # Tool managing this

    # Helm standard labels
    helm.sh/chart: "api-server-1.5.0"

    # Custom organizational labels
    team: "platform"
    cost-center: "engineering"
    environment: "production"
```

### Common Label Patterns

```yaml
# Service selector (must match pod labels)
apiVersion: v1
kind: Service
metadata:
  name: api-server
spec:
  selector:
    app.kubernetes.io/name: api-server
    app.kubernetes.io/instance: api-server-prod

---
# Deployment with recommended labels
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  labels:
    app.kubernetes.io/name: api-server
    app.kubernetes.io/version: "2.1.0"
    app.kubernetes.io/managed-by: helm
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: api-server
      app.kubernetes.io/instance: api-server-prod
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api-server
        app.kubernetes.io/instance: api-server-prod
        app.kubernetes.io/version: "2.1.0"
        app.kubernetes.io/component: backend
    spec:
      containers:
        - name: api
          image: registry.example.com/api:2.1.0
```

### Common Annotations

```yaml
metadata:
  annotations:
    # Informational
    description: "Main customer-facing API service"
    owner: "platform-team@example.com"
    documentation: "https://wiki.example.com/api-server"

    # CI/CD
    build.url: "https://ci.example.com/builds/12345"
    git.commit: "abc123def456"
    git.branch: "main"

    # Prometheus scraping
    prometheus.io/scrape: "true"
    prometheus.io/port: "9090"
    prometheus.io/path: "/metrics"

    # Ingress configuration
    nginx.ingress.kubernetes.io/rewrite-target: /
    cert-manager.io/cluster-issuer: letsencrypt-prod

    # Deployment rollout trigger
    checksum/config: "sha256:abc123..."

    # Linkerd/Istio injection
    linkerd.io/inject: enabled
    sidecar.istio.io/inject: "true"
```

### Query with Label Selectors

```bash
# Equality-based
kubectl get pods -l app.kubernetes.io/name=api-server
kubectl get pods -l environment=production,tier=backend

# Set-based
kubectl get pods -l 'environment in (production, staging)'
kubectl get pods -l 'tier notin (frontend)'
kubectl get pods -l '!canary'  # Pods WITHOUT canary label

# Combine with output
kubectl get pods -l app.kubernetes.io/part-of=e-commerce \
  --show-labels -o wide

# Count resources by label
kubectl get pods -l team=platform --no-headers | wc -l

# Add/remove labels
kubectl label pods my-pod-xxx environment=production
kubectl label pods my-pod-xxx environment-   # Remove label
kubectl label pods --all tier=backend -n production  # All pods

# Add annotation
kubectl annotate deployment api-server description="Main API"
```

### Label Naming Rules

```text
Key format: [prefix/]name
├── prefix: optional DNS subdomain (max 253 chars)
├── name: required (max 63 chars, alphanumeric + - _ .)
├── Must start and end with alphanumeric

Value format:
├── Max 63 characters
├── Alphanumeric + - _ .
├── Can be empty string
├── Must start and end with alphanumeric (if non-empty)

Reserved prefixes:
├── kubernetes.io/ — Kubernetes core components
├── k8s.io/ — Kubernetes SIG projects
├── app.kubernetes.io/ — Recommended application labels
└── *.example.com/ — Your organization

Examples:
✅ app: frontend
✅ app.kubernetes.io/name: api-server
✅ mycompany.com/team: platform
✅ version: 2.1.0-beta.1
❌ app: "this value is way too long and exceeds sixty-three characters limit"
❌ 123-invalid: (can't start with number for key name)
```

## Common Issues

### Service has no endpoints (selector doesn't match)
- **Cause**: Service selector labels don't match pod labels exactly
- **Fix**: Compare `kubectl get svc -o yaml` selector with `kubectl get pods --show-labels`

### Deployment can't be updated — selector is immutable
- **Cause**: `spec.selector.matchLabels` can't be changed after creation
- **Fix**: Delete and recreate deployment; or create new deployment with different name

### Too many labels causing etcd storage issues
- **Cause**: Hundreds of labels per object exceeding etcd object size limit
- **Fix**: Move non-identifying data to annotations; limit labels to what's needed for selection

## Best Practices

1. **Use `app.kubernetes.io/*` labels** — industry standard, tool-compatible
2. **Labels for selection, annotations for everything else** — if you won't select on it, annotate it
3. **Keep labels stable** — selectors (Services, Deployments) break if labels change
4. **Use prefixed keys for custom labels** — `mycompany.com/team` avoids collisions
5. **Include environment, team, version** — enables filtering and cost attribution
6. **Don't put secrets in annotations** — they're readable by anyone with get access
7. **Document your labeling convention** — publish a team/org standard

## Key Takeaways

- Labels: identify + select resources (used by Services, HPA, NetworkPolicy, scheduling)
- Annotations: non-identifying metadata (tool config, descriptions, build info)
- Use `app.kubernetes.io/*` recommended labels for interoperability
- Label values max 63 chars; annotation values max 256KB
- Service selectors MUST match pod labels exactly — no endpoints otherwise
- `spec.selector` is immutable — plan labels before creating Deployments
- Labels are queryable (`-l key=value`); annotations are not
