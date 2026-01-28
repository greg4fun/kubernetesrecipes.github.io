---
title: "How to Create and Use Helm Charts"
description: "Master Helm, the Kubernetes package manager. Learn to create charts, manage releases, and template your deployments for reusability."
category: "helm"
difficulty: "beginner"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "Helm 3 installed"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "helm-chart-best-practices"
  - "helmfile-multi-environment"
tags:
  - helm
  - charts
  - package-manager
  - templating
  - deployment
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You need to package, version, and deploy your Kubernetes applications consistently across multiple environments.

## The Solution

Use Helm charts to template and package your Kubernetes manifests, making deployments repeatable and configurable.

## Installing Helm

```bash
# macOS
brew install helm

# Linux
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify installation
helm version
```

## Using Existing Charts

### Add a Repository

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

### Search for Charts

```bash
helm search repo nginx
helm search hub wordpress
```

### Install a Chart

```bash
helm install my-nginx bitnami/nginx
```

### List Releases

```bash
helm list
helm list --all-namespaces
```

### Uninstall a Release

```bash
helm uninstall my-nginx
```

## Creating Your Own Chart

### Generate Chart Scaffold

```bash
helm create myapp
```

This creates:

```
myapp/
├── Chart.yaml          # Chart metadata
├── values.yaml         # Default configuration values
├── charts/             # Dependencies
├── templates/          # Kubernetes manifest templates
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── serviceaccount.yaml
│   ├── _helpers.tpl    # Template helpers
│   ├── NOTES.txt       # Post-install notes
│   └── tests/
└── .helmignore
```

## Chart.yaml

```yaml
apiVersion: v2
name: myapp
description: A Helm chart for my application
type: application
version: 0.1.0
appVersion: "1.0.0"
keywords:
  - myapp
  - web
maintainers:
  - name: Your Name
    email: your@email.com
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
```

## values.yaml

```yaml
replicaCount: 2

image:
  repository: myapp
  pullPolicy: IfNotPresent
  tag: "1.0.0"

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: false
  className: nginx
  hosts:
    - host: myapp.example.com
      paths:
        - path: /
          pathType: Prefix

resources:
  limits:
    cpu: 500m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80

postgresql:
  enabled: true
  auth:
    username: myapp
    database: myapp
```

## Template Examples

### deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "myapp.fullname" . }}
  labels:
    {{- include "myapp.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "myapp.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "myapp.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          livenessProbe:
            httpGet:
              path: /health
              port: http
          readinessProbe:
            httpGet:
              path: /ready
              port: http
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          env:
            {{- if .Values.postgresql.enabled }}
            - name: DATABASE_HOST
              value: {{ include "myapp.fullname" . }}-postgresql
            - name: DATABASE_USER
              value: {{ .Values.postgresql.auth.username }}
            - name: DATABASE_NAME
              value: {{ .Values.postgresql.auth.database }}
            {{- end }}
```

### _helpers.tpl

```yaml
{{/*
Expand the name of the chart.
*/}}
{{- define "myapp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "myapp.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "myapp.labels" -}}
helm.sh/chart: {{ include "myapp.chart" . }}
{{ include "myapp.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "myapp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "myapp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

## Working with Charts

### Lint Your Chart

```bash
helm lint myapp/
```

### Dry Run / Template

```bash
# See rendered templates
helm template myapp ./myapp

# Dry run against cluster
helm install myapp ./myapp --dry-run --debug
```

### Install Your Chart

```bash
helm install myapp ./myapp -f custom-values.yaml
```

### Upgrade a Release

```bash
helm upgrade myapp ./myapp --set image.tag=2.0.0
```

### Rollback

```bash
helm rollback myapp 1
```

### Package for Distribution

```bash
helm package myapp/
# Creates myapp-0.1.0.tgz
```

## Environment-Specific Values

Create separate value files:

```bash
# values-dev.yaml
replicaCount: 1
image:
  tag: "dev"

# values-prod.yaml
replicaCount: 3
image:
  tag: "1.0.0"
resources:
  limits:
    memory: 512Mi
```

Deploy:

```bash
helm install myapp ./myapp -f values-prod.yaml
```

## Common Template Functions

```yaml
# Default value
{{ .Values.foo | default "bar" }}

# Required value
{{ required "A valid .Values.image.tag is required!" .Values.image.tag }}

# Conditional
{{- if .Values.ingress.enabled }}
# ingress manifest
{{- end }}

# Range/Loop
{{- range .Values.ingress.hosts }}
- host: {{ .host | quote }}
{{- end }}

# Quote strings
value: {{ .Values.name | quote }}

# ToYaml
{{- toYaml .Values.resources | nindent 12 }}
```

## Best Practices

1. **Use helpers** for repeated labels and names
2. **Validate inputs** with `required`
3. **Set defaults** for optional values
4. **Quote strings** to avoid YAML issues
5. **Document values.yaml** with comments
6. **Version your charts** semantically

## Key Takeaways

- Helm simplifies Kubernetes deployments
- Charts are reusable, versioned packages
- values.yaml configures templates
- Use `helm template` to debug
- Create separate values files per environment

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
