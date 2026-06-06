---
title: "Backstage: K8s Developer Portal and Catalog"
description: "Deploy the Backstage developer portal on Kubernetes for a service catalog, API docs, software templates, and TechDocs documentation."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "backstage"
  - "developer-portal"
  - "platform-engineering"
  - "service-catalog"
  - "developer-experience"
relatedRecipes:
  - "kubernetes-argocd-gitops-guide"
  - "kubernetes-crossplane-infrastructure-guide"
  - "kubernetes-tekton-pipelines-guide"
---

> 💡 **Quick Answer:** Backstage is the CNCF developer portal — software catalog, API docs, scaffolding, and TechDocs in one place. Deploy: build a custom Backstage Docker image with your plugins, deploy as a Kubernetes Deployment + PostgreSQL. Register services via `catalog-info.yaml` in each repo. Teams discover services, create new ones from templates, and read docs — all in one portal.

## The Problem

As microservices grow:

- Nobody knows what services exist or who owns them
- API docs are scattered across wikis, READMEs, Confluence
- Creating a new service requires tribal knowledge
- No single pane of glass for the developer experience
- Each team reinvents project scaffolding

## The Solution

### Create Backstage App

```bash
# Scaffold new Backstage app
npx @backstage/create-app@latest
# Name: my-backstage
cd my-backstage

# Configure for PostgreSQL (production)
# app-config.production.yaml
```

```yaml
# app-config.production.yaml
app:
  title: My Platform Portal
  baseUrl: https://backstage.example.com

backend:
  baseUrl: https://backstage.example.com
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: ${POSTGRES_PORT}
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}

catalog:
  locations:
  - type: url
    target: https://github.com/myorg/backstage-catalog/blob/main/all.yaml

integrations:
  github:
  - host: github.com
    token: ${GITHUB_TOKEN}
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backstage
  namespace: backstage
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backstage
  template:
    metadata:
      labels:
        app: backstage
    spec:
      containers:
      - name: backstage
        image: registry.example.com/backstage:latest
        ports:
        - containerPort: 7007
        env:
        - name: POSTGRES_HOST
          value: backstage-postgresql
        - name: POSTGRES_PORT
          value: "5432"
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: backstage-db
              key: username
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: backstage-db
              key: password
        - name: GITHUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: backstage-github
              key: token
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: "2"
            memory: 2Gi

---
apiVersion: v1
kind: Service
metadata:
  name: backstage
  namespace: backstage
spec:
  ports:
  - port: 80
    targetPort: 7007
  selector:
    app: backstage
```

### Register Services (catalog-info.yaml)

```yaml
# Place in root of each service repo
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: orders-service
  description: Handles order processing and fulfillment
  annotations:
    backstage.io/kubernetes-id: orders-service
    backstage.io/techdocs-ref: dir:.
    github.com/project-slug: myorg/orders-service
    pagerduty.com/service-id: P1234567
  tags:
  - python
  - grpc
  - production
  links:
  - url: https://grafana.example.com/d/orders
    title: Grafana Dashboard
  - url: https://argocd.example.com/applications/orders
    title: ArgoCD
spec:
  type: service
  lifecycle: production
  owner: team-commerce
  system: ecommerce
  providesApis:
  - orders-api
  consumesApis:
  - payments-api
  - inventory-api
  dependsOn:
  - resource:orders-database

---
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: orders-api
  description: REST API for order management
spec:
  type: openapi
  lifecycle: production
  owner: team-commerce
  definition:
    $text: ./openapi.yaml

---
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: orders-database
  description: PostgreSQL database for orders
spec:
  type: database
  owner: team-commerce
  system: ecommerce
```

### Software Templates (Scaffolding)

```yaml
# Create new service from template
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: python-service
  title: Python Microservice
  description: Create a new Python service with CI/CD, monitoring, and K8s manifests
spec:
  owner: platform-team
  type: service
  
  parameters:
  - title: Service Info
    required: [name, owner]
    properties:
      name:
        title: Service Name
        type: string
        pattern: '^[a-z0-9-]+$'
      owner:
        title: Owner Team
        type: string
        ui:field: OwnerPicker
      description:
        title: Description
        type: string
  
  - title: Infrastructure
    properties:
      database:
        title: Needs Database?
        type: boolean
        default: false
      monitoring:
        title: Enable Prometheus Metrics
        type: boolean
        default: true
  
  steps:
  - id: fetch
    name: Fetch Template
    action: fetch:template
    input:
      url: ./skeleton
      values:
        name: ${{ parameters.name }}
        owner: ${{ parameters.owner }}
        database: ${{ parameters.database }}
  
  - id: publish
    name: Create GitHub Repo
    action: publish:github
    input:
      repoUrl: github.com?owner=myorg&repo=${{ parameters.name }}
      defaultBranch: main
  
  - id: register
    name: Register in Catalog
    action: catalog:register
    input:
      repoContentsUrl: ${{ steps.publish.output.repoContentsUrl }}
      catalogInfoPath: /catalog-info.yaml
  
  output:
    links:
    - title: Repository
      url: ${{ steps.publish.output.remoteUrl }}
    - title: Catalog
      url: /catalog/default/component/${{ parameters.name }}
```

### Kubernetes Plugin

```yaml
# Show K8s pods/deployments in Backstage UI
# Install plugin: @backstage/plugin-kubernetes

# backstage ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: backstage
  namespace: backstage

---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: backstage-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: view
subjects:
- kind: ServiceAccount
  name: backstage
  namespace: backstage
```

```yaml
# app-config.yaml
kubernetes:
  serviceLocatorMethod:
    type: multiTenant
  clusterLocatorMethods:
  - type: config
    clusters:
    - url: https://kubernetes.default.svc
      name: production
      authProvider: serviceAccount
      serviceAccountToken: ${K8S_SA_TOKEN}
```

## Common Issues

**Catalog not discovering services**

Check GitHub integration token has repo read access. Verify catalog location URL is correct.

**Template scaffolding fails**

GitHub token needs repo create permissions. Check: Backstage logs for detailed error.

**Kubernetes plugin shows no pods**

Annotation `backstage.io/kubernetes-id` must match a label on the pod/deployment. Check ServiceAccount RBAC.

## Best Practices

- **catalog-info.yaml in every repo** — auto-discovery via GitHub integration
- **Templates for golden paths** — standardize how teams create services
- **TechDocs for documentation** — docs-as-code rendered in Backstage
- **Kubernetes plugin** — show pod status, logs directly in catalog
- **Start with catalog** — add templates and plugins incrementally

## Key Takeaways

- Backstage is the CNCF developer portal for service catalog and scaffolding
- catalog-info.yaml registers services with ownership, APIs, dependencies
- Software Templates create new services from golden path patterns
- Kubernetes plugin shows real-time pod/deployment status per service
- Central hub: discover services, read docs, create projects, view dashboards
