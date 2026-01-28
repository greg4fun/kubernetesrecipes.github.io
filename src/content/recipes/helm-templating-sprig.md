---
title: "How to Template Helm Values with Sprig Functions"
description: "Master Helm templating with Sprig functions. Learn string manipulation, conditionals, loops, and advanced templating patterns for dynamic charts."
category: "helm"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["helm", "templating", "sprig", "functions", "charts"]
---

# How to Template Helm Values with Sprig Functions

Helm uses Go templates with Sprig functions for powerful chart templating. Master these patterns to create flexible, reusable charts.

## String Functions

```yaml
# templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  # Convert to lowercase, replace spaces
  name: {{ .Values.name | lower | replace " " "-" }}
data:
  # Trim whitespace
  trimmed: {{ .Values.input | trim | quote }}
  
  # Truncate to 63 chars (K8s name limit)
  shortname: {{ .Values.longName | trunc 63 | trimSuffix "-" }}
  
  # Title case
  title: {{ .Values.text | title }}
  
  # Contains check
  {{- if contains "prod" .Values.environment }}
  production: "true"
  {{- end }}
  
  # Regex replace
  cleaned: {{ regexReplaceAll "[^a-zA-Z0-9]" .Values.input "-" | quote }}
  
  # Split and join
  tags: {{ .Values.tagList | join "," | quote }}
```

## Default Values and Coalesce

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
spec:
  # Default value if not set
  replicas: {{ .Values.replicas | default 3 }}
  
  template:
    spec:
      containers:
        - name: app
          # Coalesce returns first non-empty value
          image: {{ coalesce .Values.image.fullPath (printf "%s:%s" .Values.image.repository .Values.image.tag) "nginx:latest" }}
          
          resources:
            limits:
              # Default with type conversion
              memory: {{ .Values.resources.memory | default "256Mi" | quote }}
              cpu: {{ .Values.resources.cpu | default "100m" | quote }}
```

## Conditionals and Logic

```yaml
# templates/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}
  {{- if and .Values.service.enabled (not .Values.ingress.enabled) }}
  annotations:
    external-dns.alpha.kubernetes.io/hostname: {{ .Values.hostname }}
  {{- end }}
spec:
  # Ternary operator
  type: {{ ternary "LoadBalancer" "ClusterIP" .Values.service.external }}
  
  {{- if or (eq .Values.environment "production") (eq .Values.environment "staging") }}
  externalTrafficPolicy: Local
  {{- end }}
  
  ports:
    - port: {{ .Values.service.port }}
      {{- if ne .Values.service.targetPort 0 }}
      targetPort: {{ .Values.service.targetPort }}
      {{- end }}
```

## Loops and Ranges

```yaml
# templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-config
data:
  # Loop over map
  {{- range $key, $value := .Values.config }}
  {{ $key }}: {{ $value | quote }}
  {{- end }}
  
  # Loop over list with index
  {{- range $index, $host := .Values.hosts }}
  HOST_{{ $index }}: {{ $host | quote }}
  {{- end }}
  
  # Loop with conditional
  {{- range .Values.features }}
  {{- if .enabled }}
  FEATURE_{{ .name | upper }}: "true"
  {{- end }}
  {{- end }}
```

## Dictionary and List Functions

```yaml
# templates/deployment.yaml
spec:
  template:
    spec:
      containers:
        - name: app
          env:
            # Merge dictionaries
            {{- $defaults := dict "LOG_LEVEL" "info" "PORT" "8080" }}
            {{- $merged := merge .Values.env $defaults }}
            {{- range $key, $value := $merged }}
            - name: {{ $key }}
              value: {{ $value | quote }}
            {{- end }}
            
            # Create list dynamically
            {{- $hosts := list "host1" "host2" "host3" }}
            {{- if .Values.extraHost }}
            {{- $hosts = append $hosts .Values.extraHost }}
            {{- end }}
            - name: HOSTS
              value: {{ $hosts | join "," | quote }}
```

## Include and Template Functions

```yaml
# templates/_helpers.tpl
{{- define "mychart.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "mychart.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "mychart.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "mychart.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mychart.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "mychart.fullname" . }}
  labels:
    {{- include "mychart.labels" . | nindent 4 }}
spec:
  selector:
    matchLabels:
      {{- include "mychart.selectorLabels" . | nindent 6 }}
```

## Indent and Nindent

```yaml
# templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-config
data:
  # nindent adds newline then indents
  config.yaml: |
    {{- .Values.configYaml | nindent 4 }}
  
  # toYaml with indent
  settings: |
    {{- toYaml .Values.settings | nindent 4 }}
  
  # Inline indent (no newline)
  inline: {{ .Values.data | indent 4 }}
```

## Type Conversion

```yaml
# templates/deployment.yaml
spec:
  replicas: {{ .Values.replicas | int }}
  
  template:
    spec:
      containers:
        - name: app
          env:
            # Convert to string
            - name: PORT
              value: {{ .Values.port | toString | quote }}
            
            # Convert to int64
            - name: TIMEOUT
              value: {{ .Values.timeout | int64 | quote }}
            
            # Boolean to string
            - name: DEBUG
              value: {{ .Values.debug | toString | quote }}
            
            # Float formatting
            - name: RATIO
              value: {{ .Values.ratio | float64 | printf "%.2f" | quote }}
```

## Date and Time Functions

```yaml
# templates/job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-{{ now | date "20060102-150405" }}
  annotations:
    # Current timestamp
    created: {{ now | unixEpoch | quote }}
    
    # Formatted date
    date: {{ now | date "2006-01-02" | quote }}
    
    # Date math
    expires: {{ now | dateModify "+24h" | date "2006-01-02T15:04:05Z" | quote }}
```

## Required Values and Validation

```yaml
# templates/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: {{ .Release.Name }}-secret
type: Opaque
data:
  # Fail if not provided
  api-key: {{ required "API key is required (.Values.apiKey)" .Values.apiKey | b64enc }}
  
  # Validate format
  {{- if not (regexMatch "^[a-zA-Z0-9]{32}$" .Values.apiKey) }}
  {{- fail "API key must be 32 alphanumeric characters" }}
  {{- end }}
```

## Complex Example

```yaml
# templates/deployment.yaml
{{- $fullName := include "mychart.fullname" . -}}
{{- $svcPort := .Values.service.port -}}

apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $fullName }}
spec:
  template:
    spec:
      containers:
        - name: {{ .Chart.Name }}
          {{- with .Values.securityContext }}
          securityContext:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          
          {{- if .Values.env }}
          env:
            {{- range $name, $value := .Values.env }}
            - name: {{ $name }}
              {{- if kindIs "map" $value }}
              valueFrom:
                {{- toYaml $value | nindent 16 }}
              {{- else }}
              value: {{ $value | quote }}
              {{- end }}
            {{- end }}
          {{- end }}
```

## Summary

Sprig functions make Helm charts dynamic and reusable. Use string functions for name formatting, conditionals for environment-specific config, loops for dynamic resources, and include for DRY templates. Always validate required values.

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
