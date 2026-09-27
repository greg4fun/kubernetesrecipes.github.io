---
title: "Helm Sprig Functions Complete Reference"
description: "Complete reference for Helm Sprig template functions including cat, print, join, tostring, add1, trim, quote, default, and more. Examples and common patterns"
tags:
  - "helm"
  - "sprig"
  - "templates"
  - "functions"
  - "go-templates"
category: "helm"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "helm-templating-sprig"
  - "helm-sprig-cat-function"
  - "helm-sprig-join-function"
  - "helm-sprig-print-quote-default-functions"
  - "helm-sprig-add1-trim-merge-functions"
  - "helm-sprig-tostring-function"
  - "helm-hooks-lifecycle"
  - "helm-chart-development-guide"
---

> 💡 **Quick Answer:** Helm uses Sprig template functions for string manipulation, math, and data transformation in charts. The `cat` function concatenates strings with spaces between arguments. Use `print`/`printf` for concatenation without spaces. `join` combines list elements with a separator. `toString` converts values to strings. All Sprig functions are available in `{{ }}` template expressions.

## The Problem

- Helm template functions are poorly documented — official docs link to Sprig but lack Kubernetes-specific examples
- `cat` inserts spaces between arguments unexpectedly when you want direct concatenation
- Converting between types (int to string, list to string) requires knowing the right function
- No single reference covers all commonly-needed Sprig functions with Helm chart examples
- String manipulation patterns differ from other templating languages

## The Solution

### Complete Function List

Every Sprig function commonly used in Helm charts, grouped by category. Functions with their own dedicated recipe link out to the full treatment (edge cases, gotchas, more examples); the rest are documented in full below.

| Function | Purpose | Full guide |
|----------|---------|-------------|
| `cat` | Concatenate values with spaces | [helm-sprig-cat-function](/recipes/helm/helm-sprig-cat-function/) |
| `print` / `printf` | Concatenate / format without spaces | [helm-sprig-print-quote-default-functions](/recipes/helm/helm-sprig-print-quote-default-functions/) |
| `quote` / `squote` | Wrap a value in double/single quotes | [helm-sprig-print-quote-default-functions](/recipes/helm/helm-sprig-print-quote-default-functions/) |
| `default` | Fallback value when input is empty/nil | [helm-sprig-print-quote-default-functions](/recipes/helm/helm-sprig-print-quote-default-functions/) |
| `join` | Combine a list with a separator | [helm-sprig-join-function](/recipes/helm/helm-sprig-join-function/) |
| `toString` / `toStrings` | Convert value(s) to string | [helm-sprig-tostring-function](/recipes/helm/helm-sprig-tostring-function/) |
| `add1` | Increment an integer by 1 | [helm-sprig-add1-trim-merge-functions](/recipes/helm/helm-sprig-add1-trim-merge-functions/) |
| `trim` / `trimAll` / `trimPrefix` / `trimSuffix` | Strip whitespace or a substring | [helm-sprig-add1-trim-merge-functions](/recipes/helm/helm-sprig-add1-trim-merge-functions/) |
| `merge` / `mergeOverwrite` | Combine dictionaries | [helm-sprig-add1-trim-merge-functions](/recipes/helm/helm-sprig-add1-trim-merge-functions/) |
| `upper` / `lower` / `title` / `camelcase` / `snakecase` / `kebabcase` | Case conversion | documented below |
| `replace` / `regexReplaceAll` | Simple / regex string replacement | documented below |
| `trunc` / `abbrev` | Length limiting | documented below |
| `contains` / `hasPrefix` / `hasSuffix` | Substring checks | documented below |
| `indent` / `nindent` | Whitespace control for YAML | documented below |
| `add` / `sub` / `mul` / `div` / `mod` / `max` / `min` / `ceil` / `floor` / `round` | Arithmetic | documented below |
| `int` / `int64` / `float64` / `atoi` / `toJson` / `toYaml` / `fromJson` / `fromYaml` | Numeric/structured conversion | documented below |
| `list` / `first` / `last` / `rest` / `initial` / `append` / `prepend` / `has` / `uniq` / `sortAlpha` / `compact` | List operations | documented below |
| `dict` / `get` / `set` / `unset` / `keys` / `values` / `hasKey` / `pick` / `omit` | Dictionary operations | documented below |
| `now` / `date` / `dateModify` | Date/time | documented below |
| `coalesce` / `ternary` / `empty` / `required` | Flow control / validation | documented below |
| `b64enc` / `b64dec` / `sha256sum` | Encoding/hashing | documented below |

### String Functions

#### cat — Concatenate with Spaces

`cat` joins arguments with a **space** between each — `{{ cat "hello" "world" }}` → `hello world`. It always adds spaces, so image tags (`repo:tag`) need `printf "%s:%s"` instead.

> Full syntax, `nospace`, auto type conversion, and the nil-value gotcha: [Helm Sprig cat Function](/recipes/helm/helm-sprig-cat-function/).

#### print / printf — Formatted String Output

`print` concatenates with **no separator** (like Go's `fmt.Sprint`); `printf` takes a Go format string for precise control — `{{ printf "%s-%s" .Release.Name .Chart.Name }}` → `myrelease-mychart`.

> Full syntax, padding, and common Kubernetes image/URL patterns: [Helm Sprig print/quote/default Functions](/recipes/helm/helm-sprig-print-quote-default-functions/).

#### toString / toStrings — Type Conversion

`toString` converts any value (int, bool, float) to a string — required because Kubernetes annotations and env values must be strings: `{{ .Values.replicas | toString }}` → `"3"`. `toStrings` does the same across every item in a list.

> Full syntax, nil handling, and the `toString`-vs-`join` list gotcha: [Helm Sprig toString Function Guide](/recipes/helm/helm-sprig-tostring-function/).

#### join — Combine List Elements

`join` combines list elements with a separator: `{{ list "a" "b" "c" | join "," }}` → `a,b,c` — the standard way to turn a `values.yaml` list into a CSV annotation or env value.

> Full syntax, CORS/env/ConfigMap patterns, and empty-list handling: [Helm Sprig join Function](/recipes/helm/helm-sprig-join-function/).

#### trim / trimAll / trimPrefix / trimSuffix

`trim` strips leading/trailing whitespace; `trimPrefix` / `trimSuffix` / `trimAll` strip a specific string from the ends — `{{ "  hello  " | trim }}` → `hello`.

> Full syntax, the "trim expects a string" gotcha, and the `merge` dictionary function: [Helm Sprig add1 trim merge Functions](/recipes/helm/helm-sprig-add1-trim-merge-functions/).

#### quote / squote — Add Quotes

`quote` wraps a value in double quotes (escaping special characters); `squote` uses single quotes — `{{ .Values.name | quote }}` → `"myapp"`. Essential for annotations and labels that must stay strings.

> Full syntax, the "when to quote" table, and the `default` fallback function: [Helm Sprig print/quote/default Functions](/recipes/helm/helm-sprig-print-quote-default-functions/).

#### upper / lower / title / camelcase / snakecase / kebabcase

```yaml
{{ "hello world" | upper }}        # HELLO WORLD
{{ "HELLO WORLD" | lower }}        # hello world
{{ "hello world" | title }}        # Hello World
{{ "hello world" | camelcase }}    # HelloWorld
{{ "HelloWorld" | snakecase }}     # hello_world
{{ "HelloWorld" | kebabcase }}     # hello-world

# Common: normalize labels
metadata:
  labels:
    app.kubernetes.io/name: {{ .Values.name | lower | trunc 63 | trimSuffix "-" }}
```

#### replace / regexReplaceAll

```yaml
# replace (simple string replacement)
{{ "hello world" | replace " " "-" }}
# Output: hello-world

# regexReplaceAll (regex replacement)
{{ "foo-bar_baz" | regexReplaceAll "[^a-zA-Z0-9]" "-" }}
# Output: foo-bar-baz

# Common: sanitize names for Kubernetes
{{ .Values.name | regexReplaceAll "[^a-z0-9-]" "-" | trunc 63 }}
```

#### trunc / abbrev — Length Limiting

```yaml
# trunc truncates to N characters
{{ "a-very-long-name-that-exceeds-kubernetes-limits" | trunc 63 }}

# Kubernetes name compliance:
{{ include "mychart.fullname" . | trunc 63 | trimSuffix "-" }}

# abbrev truncates with ellipsis
{{ "a very long description" | abbrev 20 }}
# Output: a very long descr...
```

#### contains / hasPrefix / hasSuffix

```yaml
# contains checks if string contains substring
{{ if contains "gpu" .Values.nodeSelector.accelerator }}
  # GPU-specific config
{{ end }}

# hasPrefix / hasSuffix
{{ if hasPrefix "https" .Values.endpoint }}
  # TLS endpoint
{{ end }}

{{ if hasSuffix ".internal" .Values.domain }}
  # Internal domain
{{ end }}
```

#### indent / nindent — Whitespace Control

```yaml
# indent adds N spaces to every line
{{ .Values.extraConfig | indent 4 }}

# nindent adds newline + indent (most common in Helm)
metadata:
  labels:
    {{- include "mychart.labels" . | nindent 4 }}
  annotations:
    {{- toYaml .Values.annotations | nindent 4 }}

# Difference:
#   indent 4  → adds 4 spaces to current position
#   nindent 4 → newline, then 4 spaces from column 0
```

### Math Functions

#### add / add1 / sub / mul / div / mod

```yaml
# add1 increments by 1 (common for ports)
containerPort: {{ add1 .Values.service.port }}
# If port=8080 → 8081

# add (multiple arguments)
{{ add 1 2 3 }}
# Output: 6

# sub / mul / div / mod
{{ sub .Values.maxReplicas 1 }}     # maxReplicas - 1
{{ mul .Values.cpu 1000 }}          # Convert cores to millicores
{{ div .Values.memory 1024 }}       # Convert MiB to GiB
{{ mod .Values.index 3 }}           # Modulo for distribution

# Common: calculate resource limits
resources:
  requests:
    memory: {{ printf "%dMi" (div .Values.memoryMb 2) }}
  limits:
    memory: {{ printf "%dMi" .Values.memoryMb }}
```

> `add1` has dedicated port-offset and 1-based-index patterns: [Helm Sprig add1 trim merge Functions](/recipes/helm/helm-sprig-add1-trim-merge-functions/).

#### max / min / ceil / floor / round

```yaml
{{ max 1 5 3 }}     # 5
{{ min 1 5 3 }}     # 1
{{ ceil 1.5 }}      # 2
{{ floor 1.5 }}     # 1
{{ round 3.1415 2 }}  # 3.14

# Common: ensure minimum replicas
replicas: {{ max .Values.replicas 1 }}
```

### Type Conversion Functions

```yaml
# int / int64 / float64 — convert to numeric
{{ "3" | int }}           # string "3" → int 3
{{ .Values.port | int }}  # ensure numeric for arithmetic

# atoi — string to int (alias)
{{ "8080" | atoi }}       # 8080

# toJson / toPrettyJson / toYaml / toToml
{{ .Values.config | toJson }}
{{ .Values.config | toPrettyJson }}
{{ .Values.config | toYaml }}

# fromJson / fromYaml — parse strings
{{ $data := .Values.jsonString | fromJson }}
{{ $data.key }}
```

### List Functions

```yaml
# list — create a list
{{ $items := list "a" "b" "c" }}

# first / last / rest / initial
{{ list "a" "b" "c" | first }}    # a
{{ list "a" "b" "c" | last }}     # c
{{ list "a" "b" "c" | rest }}     # [b c]
{{ list "a" "b" "c" | initial }}  # [a b]

# append / prepend
{{ $items := append .Values.args "--verbose" }}
{{ $items := prepend .Values.args "--config=/etc/app.yaml" }}

# has — check if list contains value
{{ if has "gpu" .Values.features }}
resources:
  limits:
    nvidia.com/gpu: "1"
{{ end }}

# uniq — deduplicate
{{ .Values.hosts | uniq | join "," }}

# sortAlpha — alphabetical sort
{{ .Values.labels | keys | sortAlpha }}

# compact — remove empty strings
{{ list "a" "" "b" "" "c" | compact | join "," }}
# Output: a,b,c
```

### Dict/Map Functions

```yaml
# dict — create a dictionary
{{ $labels := dict "app" .Values.name "version" .Chart.AppVersion }}

# get / set / unset
{{ get .Values.config "key" }}
{{ $_ := set .Values.config "newkey" "value" }}
{{ $_ := unset .Values.config "oldkey" }}

# keys / values
{{ .Values.labels | keys | join "," }}

# merge / mergeOverwrite — see the dedicated guide for precedence rules
{{- $defaults := dict "replicas" 1 "port" 8080 }}
{{- $merged := mergeOverwrite $defaults .Values.overrides }}

# hasKey
{{ if hasKey .Values.config "database" }}
  # database config present
{{ end }}

# pick / omit — select/exclude keys
{{ pick .Values.labels "app" "version" }}
{{ omit .Values.annotations "internal.example.com/managed" }}
```

> Full `merge` vs `mergeOverwrite` precedence rules and default-dict patterns: [Helm Sprig add1 trim merge Functions](/recipes/helm/helm-sprig-add1-trim-merge-functions/).

### Date/Time Functions

```yaml
# now — current time
{{ now | date "2006-01-02" }}
# Output: 2026-06-01

# date — format time (Go reference time layout)
{{ now | date "2006-01-02T15:04:05Z07:00" }}

# dateModify — add/subtract duration
{{ now | dateModify "+24h" | date "2006-01-02" }}
# Output: tomorrow's date

# Common: certificate expiry annotation
annotations:
  cert-generated: {{ now | date "2006-01-02T15:04:05Z" | quote }}
```

### Flow Control Functions

`default` provides a fallback for empty/nil/zero/false values — full "what triggers default" table and chart patterns: [Helm Sprig print/quote/default Functions](/recipes/helm/helm-sprig-print-quote-default-functions/).

```yaml
# coalesce — first non-empty value
{{ coalesce .Values.override .Values.default "fallback" }}

# ternary — if-else in one line
{{ ternary "true" "false" .Values.enabled }}
# .Values.enabled=true → "true"

# empty — check if value is zero/nil/empty
{{ if not (empty .Values.customConfig) }}
  # customConfig is set
{{ end }}

# required — fail if value is empty
image: {{ required "image.repository is required" .Values.image.repository }}
```

### Encoding Functions

```yaml
# b64enc / b64dec — Base64
{{ "secret-value" | b64enc }}
# Output: c2VjcmV0LXZhbHVl

# Used in Secrets:
apiVersion: v1
kind: Secret
data:
  password: {{ .Values.password | b64enc }}

# sha256sum — hash
{{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}

# Common: trigger rollout on config change
annotations:
  checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
```

### Common Helm Patterns Using Sprig

```yaml
# Pattern 1: Full image reference
image: {{ printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}

# Pattern 2: Name truncation for K8s compliance
{{- define "mychart.fullname" -}}
{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

# Pattern 3: Labels helper
{{- define "mychart.labels" -}}
app.kubernetes.io/name: {{ include "mychart.name" . | quote }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 }}
{{- end }}

# Pattern 4: Conditional annotations merge
metadata:
  annotations:
    {{- with .Values.annotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
    {{- if .Values.metrics.enabled }}
    prometheus.io/scrape: "true"
    prometheus.io/port: {{ .Values.metrics.port | toString | quote }}
    {{- end }}

# Pattern 5: Environment variable from map
env:
  {{- range $key, $value := .Values.env }}
  - name: {{ $key | upper | replace "." "_" | replace "-" "_" }}
    value: {{ $value | toString | quote }}
  {{- end }}

# Pattern 6: Resource requests with defaults
resources:
  requests:
    cpu: {{ .Values.resources.requests.cpu | default "100m" | quote }}
    memory: {{ .Values.resources.requests.memory | default "128Mi" | quote }}
  limits:
    cpu: {{ .Values.resources.limits.cpu | default "500m" | quote }}
    memory: {{ .Values.resources.limits.memory | default "256Mi" | quote }}
```

## Common Issues

### `cat` inserting unwanted spaces in image tags
- **Cause**: `cat` always separates arguments with spaces
- **Fix**: Use `printf "%s:%s" repo tag` or `print repo ":" tag` instead

### Template rendering error: "can't evaluate field X"
- **Cause**: Accessing a map key that doesn't exist
- **Fix**: Use `hasKey` check or `default` function: `{{ .Values.config.key | default "" }}`

### Integer arithmetic returning wrong type
- **Cause**: YAML parses `port: 8080` as int but template returns string
- **Fix**: Pipe through `| int` before arithmetic: `{{ add1 (.Values.port | int) }}`

### `nindent` vs `indent` producing wrong YAML
- **Cause**: `indent` adds spaces relative to current position; `nindent` starts fresh line
- **Fix**: Use `{{- ... | nindent N }}` (with dash to trim preceding whitespace)

### `toYaml` adding trailing newline
- **Cause**: `toYaml` includes trailing `\n`
- **Fix**: Use `{{- toYaml .Values.x | nindent 4 }}` — the dash trims it

### `required` error not showing in `helm template`
- **Cause**: `helm template` doesn't validate required by default
- **Fix**: Test with `helm install --dry-run --debug`

## Best Practices

1. **Use `printf` for concatenation** — `cat` adds spaces; `printf "%s%s"` doesn't
2. **Always `quote` annotation values** — Kubernetes requires string annotations
3. **`trunc 63 | trimSuffix "-"`** — standard pattern for K8s name compliance
4. **`default` over `if/else`** — cleaner for simple fallbacks
5. **`nindent` over `indent`** — more predictable whitespace behavior
6. **`toYaml` with `nindent`** — standard pattern for embedding structured values
7. **`required` for mandatory values** — fail fast with clear error messages
8. **`sha256sum` for rollout triggers** — ensures pods restart on config changes
9. **`| int` before arithmetic** — avoid type mismatch errors
10. **Test with `helm template`** — renders locally without cluster access

## Key Takeaways

- `cat` concatenates **with spaces** — use `printf`/`print` for no-space joining
- `join` combines list elements with a custom separator
- `toString` + `quote` is essential for annotations (must be quoted strings)
- `add1` increments integers — useful for port offsets and index calculations
- `default` provides fallback values — cleaner than `if/else` blocks
- `nindent` is the standard for embedding multi-line content at correct indentation
- `trunc 63 | trimSuffix "-"` ensures Kubernetes name length compliance
- `required` makes charts fail fast with clear messages for missing values
- All Sprig functions documented at <https://masterminds.github.io/sprig/>
- Helm adds a few extra: `include`, `toYaml`, `fromYaml`, `lookup`, `tpl`
