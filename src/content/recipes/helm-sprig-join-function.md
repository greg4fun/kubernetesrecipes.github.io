---
title: "Helm Sprig join Function: List to String"
description: "Convert lists to delimited strings in Helm templates using the Sprig join function. CSV outputs, label values, annotation lists, and multi-value configurations."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "helm"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - helm
  - sprig
  - join
  - list-functions
  - templates
relatedRecipes:
  - "helm-sprig-cat-function"
  - "helm-sprig-tostring-function"
  - "helm-chart-development"
  - "helm-hooks-lifecycle"
---

> 💡 **Quick Answer:** The Sprig `join` function converts a list to a delimited string: `{{ list "a" "b" "c" | join "," }}` outputs `a,b,c`. Use it for CSV annotations, comma-separated env vars, multi-value labels, and anywhere Kubernetes needs a single string from multiple values.

## The Problem

Kubernetes manifests often need comma-separated or delimited strings — CORS origins, allowed methods, host lists, toleration keys — but Helm `values.yaml` naturally uses YAML lists. You need to convert `["a", "b", "c"]` to `"a,b,c"` cleanly in templates.

## The Solution

### Basic Syntax

```yaml
# Join a list with comma
{{ list "a" "b" "c" | join "," }}
# Output: a,b,c

# Join with custom delimiter
{{ list "app" "web" "v2" | join "-" }}
# Output: app-web-v2

# Join with space
{{ list "hello" "world" | join " " }}
# Output: hello world

# Join values from values.yaml
{{ .Values.cors.origins | join "," }}
# Input: ["https://a.com", "https://b.com"]
# Output: https://a.com,https://b.com
```

### Common Patterns

#### CORS Origins Annotation

```yaml
# values.yaml
cors:
  origins:
    - https://app.example.com
    - https://admin.example.com
    - https://api.example.com

# templates/ingress.yaml
annotations:
  nginx.ingress.kubernetes.io/cors-allow-origin: {{ .Values.cors.origins | join "," | quote }}
  # Output: "https://app.example.com,https://admin.example.com,https://api.example.com"
```

#### Environment Variable from List

```yaml
# values.yaml
allowedHosts:
  - host1.example.com
  - host2.example.com

# templates/deployment.yaml
env:
  - name: ALLOWED_HOSTS
    value: {{ .Values.allowedHosts | join "," | quote }}
```

#### Node Affinity Labels

```yaml
# values.yaml
nodeZones:
  - us-east-1a
  - us-east-1b

# templates/deployment.yaml
annotations:
  scheduler.alpha.kubernetes.io/preferred-zones: {{ .Values.nodeZones | join "," | quote }}
```

#### ConfigMap with Joined Values

```yaml
# values.yaml
redis:
  sentinels:
    - redis-sentinel-0.redis:26379
    - redis-sentinel-1.redis:26379
    - redis-sentinel-2.redis:26379

# templates/configmap.yaml
data:
  REDIS_SENTINELS: {{ .Values.redis.sentinels | join ";" | quote }}
  # Output: "redis-sentinel-0.redis:26379;redis-sentinel-1.redis:26379;redis-sentinel-2.redis:26379"
```

### join vs cat vs printf

| Function | Input | Output | Delimiter |
|----------|-------|--------|-----------|
| `join ","` | `list "a" "b"` | `a,b` | Custom |
| `cat` | `"a" "b"` | `a b` | Space (fixed) |
| `printf` | `"%s-%s" "a" "b"` | `a-b` | Custom (2 args) |

### Building Lists Dynamically

```yaml
# Conditional list building with append
{{- $features := list -}}
{{- if .Values.metrics.enabled }}
  {{- $features = append $features "metrics" -}}
{{- end }}
{{- if .Values.tracing.enabled }}
  {{- $features = append $features "tracing" -}}
{{- end }}
annotations:
  features: {{ $features | join "," | quote }}
```

## Common Issues

### Empty List Produces Empty String

```yaml
{{ list | join "," }}
# Output: "" (empty)

# Add a default
{{ .Values.origins | default (list "http://localhost") | join "," }}
```

### Numeric List Items

```yaml
# values.yaml
ports:
  - 8080
  - 9090

# join works but items stay as numbers
{{ .Values.ports | join "," }}
# Output: 8080,9090 (works fine)
```

### Nested Lists (Not Supported)

```yaml
# join only works on flat lists
# For nested structures, use range + join:
{{- $hosts := list -}}
{{- range .Values.ingress.hosts }}
  {{- $hosts = append $hosts .host -}}
{{- end }}
{{ $hosts | join "," }}
```

## Best Practices

- **Always `quote` after `join`** — YAML annotations and values need quoting
- **Use `","` for standard CSV** — most K8s annotations expect comma-separated
- **Use `";"` for URLs** — URLs contain commas, so use semicolons
- **Build lists with `append`** — for conditional list construction
- **Provide `default` for empty lists** — avoid empty annotation values

## Key Takeaways

- `join` converts YAML lists to delimited strings with any separator
- Essential for annotations (CORS origins, allowed methods, host lists)
- Always pipe through `quote` for proper YAML output
- Build conditional lists with `append` then `join` for dynamic configuration
- Use `default (list "fallback")` to handle potentially empty lists
