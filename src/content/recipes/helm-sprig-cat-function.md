---
title: "Helm Sprig cat Function: Concatenate Strings"
description: "Use the Helm Sprig cat function to concatenate strings in templates. Syntax, spaces between arguments, conditionals, and real examples."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "helm"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - helm
  - sprig
  - cat
  - string-functions
  - templates
relatedRecipes:
  - "helm-sprig-tostring-function"
  - "helm-sprig-join-function"
  - "helm-chart-development"
  - "helm-hooks-lifecycle"
---

> 💡 **Quick Answer:** The Sprig `cat` function concatenates multiple values into a single space-separated string: `{{ cat "hello" "world" }}` outputs `hello world`. It automatically converts non-string types to strings, making it ideal for building dynamic labels, annotations, and resource names in Helm templates.

## The Problem

When writing Helm templates, you often need to combine multiple values — variables, defaults, and conditionals — into a single string for labels, annotations, or resource names. Standard Go template syntax for string concatenation is verbose (`printf "%s-%s"`) and doesn't handle type conversion. You need a simpler way to join values together.

## The Solution

### Basic Syntax

```yaml
# cat joins values with spaces
{{ cat "hello" "world" }}
# Output: hello world

# Works with variables
{{ cat .Release.Name .Chart.Name }}
# Output: my-release my-chart

# Handles multiple arguments
{{ cat "app" .Release.Name "v1" }}
# Output: app my-release v1
```

### Common Patterns in Kubernetes Manifests

#### Dynamic Labels

```yaml
# templates/deployment.yaml
metadata:
  labels:
    app.kubernetes.io/name: {{ cat .Chart.Name | replace " " "-" }}
    app.kubernetes.io/instance: {{ cat .Release.Name "-" .Chart.Name | nospace }}
```

#### Conditional String Building

```yaml
# Build annotation string conditionally
annotations:
  description: {{ cat "Managed by Helm" (ternary "in production" "in development" .Values.production) }}
  # Output: "Managed by Helm in production" or "Managed by Helm in development"
```

#### Combining with Other Functions

```yaml
# cat + lower + replace for safe resource names
metadata:
  name: {{ cat .Release.Name .Values.component | lower | replace " " "-" | trunc 63 }}

# cat + quote for annotation values
annotations:
  config: {{ cat .Values.region .Values.zone | quote }}
  # Output: "us-east-1 us-east-1a"
```

### cat vs printf vs Other String Functions

| Function | Syntax | Output | Best For |
|----------|--------|--------|----------|
| `cat` | `{{ cat "a" "b" }}` | `a b` | Space-separated joining |
| `printf` | `{{ printf "%s-%s" "a" "b" }}` | `a-b` | Custom separators |
| `join` | `{{ list "a" "b" \| join "-" }}` | `a-b` | List joining with delimiter |
| `nospace` | `{{ cat "a" "b" \| nospace }}` | `ab` | No-space concatenation |

### Auto Type Conversion

`cat` automatically converts non-string types:

```yaml
# Numbers to strings
{{ cat "replicas" .Values.replicaCount }}
# Output: "replicas 3"

# Booleans to strings
{{ cat "debug" .Values.debug }}
# Output: "debug true"

# Nested values
{{ cat "version" .Chart.AppVersion "build" .Values.buildNumber }}
# Output: "version 1.0.0 build 42"
```

### Real-World Example: ConfigMap Generator

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-config
data:
  APP_NAME: {{ cat .Chart.Name .Values.env | quote }}
  APP_VERSION: {{ cat "v" .Chart.AppVersion | nospace | quote }}
  CLUSTER_INFO: {{ cat .Values.region .Values.zone .Values.cluster | quote }}
  LOG_PREFIX: {{ cat "[" .Release.Name "]" | nospace | quote }}
```

## Common Issues

### Extra Spaces in Output

`cat` adds spaces between arguments. To remove them:

```yaml
# Problem: "my - release" (unwanted spaces around dash)
{{ cat .Release.Name "-" .Values.suffix }}

# Solution 1: nospace
{{ cat .Release.Name "-" .Values.suffix | nospace }}
# Output: "myrelease-mysuffix" (removes ALL spaces)

# Solution 2: printf for precise control
{{ printf "%s-%s" .Release.Name .Values.suffix }}
# Output: "myrelease-mysuffix"
```

### Nil Values Cause Empty Segments

```yaml
# If .Values.optional is nil:
{{ cat "prefix" .Values.optional "suffix" }}
# Output: "prefix  suffix" (double space)

# Fix: use default
{{ cat "prefix" (default "none" .Values.optional) "suffix" }}
```

## Best Practices

- **Use `cat` for human-readable strings** — annotations, descriptions, comments
- **Use `printf` for resource names** — when you need exact formatting with dashes/dots
- **Pipe through `quote`** — always quote annotation and label values: `{{ cat ... | quote }}`
- **Pipe through `trunc 63`** — Kubernetes names must be ≤63 chars
- **Combine with `lower` and `replace`** — ensure DNS-safe resource names

## Key Takeaways

- `cat` concatenates values with spaces — simplest way to join strings in Helm
- Automatically converts numbers, booleans, and other types to strings
- Combine with `nospace`, `lower`, `replace`, `trunc` for Kubernetes-safe output
- Use `printf` when you need custom separators (dashes, dots, slashes)
- Always `quote` the output when used in YAML values
