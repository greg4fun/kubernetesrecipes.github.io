---
title: "Helm Sprig add1 trim merge Functions"
description: "Use Helm Sprig add1 for incrementing, trim for whitespace cleanup, and merge for combining dictionaries. Practical Kubernetes Helm template examples."
publishDate: "2026-04-12"
author: "Luca Berton"
category: "helm"
tags:
  - "helm"
  - "sprig"
  - "templating"
  - "functions"
  - "math"
difficulty: "beginner"
timeToComplete: "10 minutes"
relatedRecipes:
  - "helm-sprig-print-quote-default-functions"
  - "helm-sprig-cat-function"
  - "helm-sprig-tostring-function"
  - "helm-sprig-join-function"
  - "helm-templating-sprig"
---

> 💡 **Quick Answer:** \`add1\` increments an integer by 1 (useful for port offsets and index shifting), \`trim\` removes leading/trailing whitespace from strings, and \`merge\` combines multiple dictionaries with first-wins precedence. These utility functions solve common Helm templating edge cases.

## The Problem

Helm templates often need small transformations — incrementing a port number, cleaning up whitespace from multi-line values, or merging default configurations with user overrides. Without these utility functions, you end up with verbose workarounds and fragile templates.

## The Solution

### The \`add1\` Function

\`add1\` increments an integer by 1:

```yaml
# Basic increment
{{ add1 8080 }}    # → 8081
{{ add1 0 }}       # → 1

# Port offset patterns
ports:
  - name: http
    containerPort: {{ .Values.port }}
  - name: metrics
    containerPort: {{ add1 .Values.port }}
  - name: admin
    containerPort: {{ add .Values.port 2 }}

# Loop index (range is 0-based, but some configs need 1-based)
{{- range $i, $worker := .Values.workers }}
  worker-{{ add1 $i }}:   # worker-1, worker-2, worker-3...
    replicas: {{ $worker.replicas }}
{{- end }}

# Retry count (retries = attempts - 1)
backoffLimit: {{ add1 .Values.maxRetries }}
```

#### Related Math Functions

```yaml
{{ add 5 3 }}       # → 8
{{ sub 10 3 }}      # → 7
{{ mul 4 3 }}       # → 12
{{ div 10 3 }}      # → 3 (integer division)
{{ mod 10 3 }}      # → 1
{{ max 5 10 3 }}    # → 10
{{ min 5 10 3 }}    # → 3

# Calculate resource limits
memory: {{ mul .Values.workersPerNode 256 }}Mi
# 4 workers × 256Mi = 1024Mi
```

### The \`trim\` Function

\`trim\` removes leading and trailing whitespace:

```yaml
# Basic trim
{{ trim "  hello  " }}           # → "hello"
{{ trim "\n  hello\n  " }}       # → "hello"

# Clean up values that might have whitespace
image: {{ trim .Values.image.repository }}:{{ trim .Values.image.tag }}

# Trim variants
{{ trimPrefix "v" .Values.version }}   # "v1.2.3" → "1.2.3"
{{ trimSuffix "/" .Values.baseUrl }}    # "https://api.example.com/" → "https://api.example.com"
{{ trimAll "/" "/path/to/thing/" }}     # → "path/to/thing"

# Common pattern: clean name for label (max 63 chars)
metadata:
  labels:
    app: {{ .Values.name | trim | trunc 63 | trimSuffix "-" | quote }}
```

#### \`trim\` Expects String Error

```yaml
# ERROR: trim expects a string, got int
{{ trim .Values.port }}  # fails if port is 8080 (int)

# FIX: convert first
{{ .Values.port | toString | trim }}

# Or use printf
{{ printf "%d" .Values.port | trim }}
```

### The \`merge\` Function

\`merge\` combines dictionaries. First dictionary wins on conflicts:

```yaml
# merge syntax: merge $dest $source1 $source2 ...
# $dest values take precedence

# Default annotations + user overrides
{{- $defaultAnnotations := dict
  "app.kubernetes.io/managed-by" "Helm"
  "prometheus.io/scrape" "true"
  "prometheus.io/port" "9090"
-}}
{{- $annotations := merge (.Values.annotations | default dict) $defaultAnnotations -}}
metadata:
  annotations:
    {{- toYaml $annotations | nindent 4 }}

# Default resource limits + overrides
{{- $defaultResources := dict
  "limits" (dict "cpu" "500m" "memory" "256Mi")
  "requests" (dict "cpu" "200m" "memory" "128Mi")
-}}
{{- $resources := merge (.Values.resources | default dict) $defaultResources -}}
resources:
  {{- toYaml $resources | nindent 2 }}
```

#### \`merge\` vs \`mergeOverwrite\`

```yaml
# merge: first dict wins (user values preserved)
{{ merge (dict "a" "user") (dict "a" "default" "b" "default") }}
# → {"a": "user", "b": "default"}

# mergeOverwrite: last dict wins
{{ mergeOverwrite (dict "a" "user") (dict "a" "override" "b" "new") }}
# → {"a": "override", "b": "new"}
```

### Practical Example: Complete Deployment

```yaml
{{- $defaults := dict
  "replicas" 1
  "port" 8080
  "image" (dict "tag" .Chart.AppVersion "pullPolicy" "IfNotPresent")
-}}
{{- $config := merge .Values $defaults -}}

apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ printf "%s-%s" .Release.Name .Chart.Name | trim | trunc 63 | trimSuffix "-" }}
  labels:
    app: {{ .Chart.Name | quote }}
    version: {{ default .Chart.AppVersion .Values.image.tag | quote }}
spec:
  replicas: {{ $config.replicas }}
  template:
    spec:
      containers:
        - name: {{ .Chart.Name }}
          ports:
            - name: http
              containerPort: {{ $config.port }}
            - name: metrics
              containerPort: {{ add1 $config.port }}
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| \`add1\` on string | Port passed as string | Use \`int\` first: \`{{ .Values.port \| int \| add1 }}\` |
| \`trim\` on non-string | Integer or bool value | Convert first: \`{{ toString .Values.x \| trim }}\` |
| \`merge\` not deep | Nested dicts not merged | Use \`mergeOverwrite\` for deep override behavior |
| Whitespace in output | Template indentation | Use \`{{-\` and \`-}}\` trim markers |

## Best Practices

- **Use \`add1\` for port offsets** — cleaner than \`{{ add .port 1 }}\`
- **Always \`trim\` external inputs** — values from files or external sources may have whitespace
- **Use \`merge\` for defaults** — keeps user values, fills gaps with defaults
- **\`trimSuffix "-"\` after \`trunc\`** — prevents labels ending in \`-\`
- **Chain functions** — \`{{ .Values.name | trim | lower | trunc 63 | trimSuffix "-" }}\`

## Key Takeaways

- \`add1\` increments integers — common for port offsets and 1-based indexing
- \`trim\`, \`trimPrefix\`, \`trimSuffix\` clean strings — essential for YAML-safe output
- \`merge\` combines dicts with first-wins precedence — perfect for default values
- \`mergeOverwrite\` uses last-wins — for when overrides should take priority
- Always check types — \`trim\` expects strings, \`add1\` expects integers
