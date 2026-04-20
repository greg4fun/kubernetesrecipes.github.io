---
title: "Helm Sprig toString Function Guide"
description: "Convert values to strings in Helm templates using the Sprig toString function. Handle integers, booleans, lists, and nil values safely in Kubernetes manifests."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "helm"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - helm
  - sprig
  - tostring
  - type-conversion
  - templates
relatedRecipes:
  - "helm-sprig-cat-function"
  - "helm-sprig-join-function"
  - "helm-chart-development"
  - "helm-hooks-lifecycle"
---

> 💡 **Quick Answer:** The Sprig `toString` function converts any value to its string representation: `{{ .Values.port | toString }}` converts the integer `8080` to the string `"8080"`. Essential when Helm values are numbers but YAML fields require strings — like container ports in annotations or ConfigMap data.

## The Problem

Helm values in `values.yaml` can be integers, booleans, or other types, but many Kubernetes fields (annotations, ConfigMap data, environment variables) require strings. Without explicit conversion, Helm renders numbers as `8080` instead of `"8080"`, causing YAML parsing errors or unexpected behavior.

## The Solution

### Basic Syntax

```yaml
# Convert integer to string
{{ .Values.port | toString }}
# Input: 8080 → Output: "8080"

# Convert boolean to string
{{ .Values.debug | toString }}
# Input: true → Output: "true"

# Convert float to string
{{ .Values.ratio | toString }}
# Input: 0.75 → Output: "0.75"
```

### Common Use Cases

#### ConfigMap Data (Must Be Strings)

```yaml
# values.yaml
config:
  port: 8080
  workers: 4
  debug: true

# templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-config
data:
  PORT: {{ .Values.config.port | toString | quote }}
  WORKERS: {{ .Values.config.workers | toString | quote }}
  DEBUG: {{ .Values.config.debug | toString | quote }}
```

#### Annotations (Always Strings)

```yaml
metadata:
  annotations:
    prometheus.io/port: {{ .Values.metrics.port | toString | quote }}
    app.kubernetes.io/version: {{ .Chart.AppVersion | toString | quote }}
    replicas: {{ .Values.replicaCount | toString | quote }}
```

#### Environment Variables

```yaml
env:
  - name: SERVER_PORT
    value: {{ .Values.port | toString | quote }}
  - name: MAX_CONNECTIONS
    value: {{ .Values.maxConn | toString | quote }}
  - name: ENABLE_TLS
    value: {{ .Values.tls.enabled | toString | quote }}
```

### toString vs Other Conversion Functions

| Function | Input | Output | Use Case |
|----------|-------|--------|----------|
| `toString` | `8080` | `"8080"` | Any type → string |
| `int` | `"8080"` | `8080` | String → integer |
| `float64` | `"3.14"` | `3.14` | String → float |
| `toJson` | `{a: 1}` | `{"a":1}` | Object → JSON string |
| `quote` | `hello` | `"hello"` | Wrap in YAML quotes |

### Handling Nil Values

```yaml
# If .Values.optional is nil, toString returns ""
{{ .Values.optional | toString }}
# Output: ""

# Use default to provide fallback BEFORE toString
{{ .Values.optional | default 3000 | toString }}
# Output: "3000"
```

### Real-World Example: Ingress Annotations

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: {{ .Values.ingress.maxBodySize | toString | quote }}
    nginx.ingress.kubernetes.io/proxy-read-timeout: {{ .Values.ingress.readTimeout | toString | quote }}
    nginx.ingress.kubernetes.io/limit-rps: {{ .Values.ingress.rateLimit | toString | quote }}
```

```yaml
# values.yaml
ingress:
  maxBodySize: 50  # Will become "50"
  readTimeout: 120  # Will become "120"
  rateLimit: 10  # Will become "10"
```

## Common Issues

### "cannot convert nil to string"

```yaml
# Problem: value doesn't exist
{{ .Values.missing | toString }}

# Fix: always provide a default
{{ .Values.missing | default "" | toString }}
```

### Double Quoting

```yaml
# Wrong: toString + quote on a value that's already a string
# Produces: '"already-a-string"' (double quoted)

# Right: use quote OR toString, check the type
{{ if kindIs "string" .Values.port }}
  {{ .Values.port | quote }}
{{ else }}
  {{ .Values.port | toString | quote }}
{{ end }}
```

### List to String

```yaml
# toString on a list produces Go syntax: [a b c]
{{ .Values.tags | toString }}
# Output: "[tag1 tag2 tag3]"

# Better: use join for lists
{{ .Values.tags | join "," }}
# Output: "tag1,tag2,tag3"
```

## Best Practices

- **Always `toString` before `quote`** for numeric values in annotations
- **Use `default` before `toString`** — handle nil values gracefully
- **Prefer `join` for lists** — `toString` on lists produces ugly Go syntax
- **Check types with `kindIs`** — avoid double conversion
- **Use `toJson` for complex objects** — maps and nested structures

## Key Takeaways

- `toString` converts integers, booleans, and floats to string representation
- Essential for ConfigMap data, annotations, and environment variables
- Always pair with `quote` for proper YAML output: `| toString | quote`
- Use `default` before `toString` to handle nil values
- For lists, prefer `join` over `toString`
