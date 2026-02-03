---
title: "How to Scan Container Images for Vulnerabilities"
description: "Implement container image vulnerability scanning with Trivy, Grype, and other tools. Integrate scanning into CI/CD pipelines and admission control."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["security", "vulnerability-scanning", "trivy", "containers", "devsecops"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Use `trivy image <image>` to scan for vulnerabilities. Integrate into CI/CD to block deployments with critical CVEs. Use admission controllers (Kyverno, OPA) to enforce scanning in-cluster. Common tools: **Trivy** (Aqua), **Grype** (Anchore), **Snyk**.
>
> **Key command:** `trivy image --severity HIGH,CRITICAL --exit-code 1 myapp:latest` (fails CI on high/critical vulns).
>
> **Gotcha:** Base image vulnerabilities are inherited—use minimal base images (distroless, Alpine) and rebuild regularly to pick up patches.

# How to Scan Container Images for Vulnerabilities

Container image scanning detects known vulnerabilities (CVEs) in your images before deployment. Integrate scanning into build pipelines and admission control.

## Trivy (Quick Start)

```bash
# Install Trivy
# macOS
brew install trivy

# Linux
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Scan an image
trivy image nginx:latest

# Scan with severity filter
trivy image --severity HIGH,CRITICAL nginx:latest

# Fail on vulnerabilities (for CI)
trivy image --exit-code 1 --severity CRITICAL nginx:latest

# Output as JSON
trivy image --format json --output results.json nginx:latest

# Scan with SBOM generation
trivy image --format spdx-json nginx:latest
```

## Trivy in CI/CD (GitHub Actions)

```yaml
# .github/workflows/scan.yaml
name: Container Security Scan

on:
  push:
    branches: [main]
  pull_request:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build image
        run: docker build -t myapp:${{ github.sha }} .
      
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'myapp:${{ github.sha }}'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'
      
      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'
```

## Grype (Anchore)

```bash
# Install Grype
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin

# Scan an image
grype nginx:latest

# Scan with severity threshold
grype nginx:latest --fail-on high

# Output as JSON
grype nginx:latest -o json > results.json

# Scan a local Dockerfile
grype dir:. --add-cpes-if-none
```

## Scan in Kubernetes (Trivy Operator)

```bash
# Install Trivy Operator
helm repo add aqua https://aquasecurity.github.io/helm-charts/
helm repo update

helm install trivy-operator aqua/trivy-operator \
  --namespace trivy-system \
  --create-namespace

# View vulnerability reports
kubectl get vulnerabilityreports -A

# Detailed report
kubectl describe vulnerabilityreport -n default <report-name>
```

## Admission Control with Kyverno

```yaml
# block-vulnerable-images.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: block-vulnerable-images
spec:
  validationFailureAction: Enforce
  background: false
  rules:
    - name: check-vulnerabilities
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "Images with critical vulnerabilities are not allowed"
        deny:
          conditions:
            any:
              - key: "{{ images.containers.*.vulnerabilities.critical }}"
                operator: GreaterThan
                value: 0
```

## Scan Dockerfile Best Practices

```dockerfile
# Bad: Full OS base image
FROM ubuntu:22.04

# Good: Minimal base image
FROM gcr.io/distroless/static-debian11

# Good: Alpine-based
FROM python:3.11-alpine

# Best practice: Pin versions
FROM nginx:1.25.3-alpine

# Multi-stage to reduce attack surface
FROM golang:1.21 AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -o myapp

FROM gcr.io/distroless/static
COPY --from=builder /app/myapp /
USER nonroot:nonroot
ENTRYPOINT ["/myapp"]
```

## Scan Local Filesystem

```bash
# Scan current directory
trivy fs .

# Scan specific path
trivy fs /path/to/project

# Scan with config file detection
trivy config .

# Scan Kubernetes manifests
trivy config --severity HIGH,CRITICAL ./k8s/
```

## Registry Scanning

```bash
# Scan image in private registry
trivy image --username user --password pass registry.example.com/myapp:latest

# Scan with registry credentials file
trivy image --registry-token $TOKEN registry.example.com/myapp:latest

# Scan entire registry (with tool like Harbor)
# Harbor has built-in Trivy integration
```

## Ignore Vulnerabilities

```yaml
# .trivyignore.yaml
vulnerabilities:
  - id: CVE-2023-12345
    paths:
      - "usr/lib/libfoo.so"
    reason: "False positive, not exploitable in our context"
    expires: 2024-06-01
  
  - id: CVE-2023-67890
    reason: "Accepted risk, no patch available"
```

```bash
# Use ignore file
trivy image --ignorefile .trivyignore.yaml nginx:latest
```

## Vulnerability Report Example

```bash
$ trivy image nginx:latest

nginx:latest (debian 12.1)
===========================
Total: 142 (UNKNOWN: 0, LOW: 85, MEDIUM: 45, HIGH: 10, CRITICAL: 2)

┌──────────────┬────────────────┬──────────┬───────────────────┬─────────────────┬──────────────────────────────────────┐
│   Library    │ Vulnerability  │ Severity │ Installed Version │  Fixed Version  │                Title                 │
├──────────────┼────────────────┼──────────┼───────────────────┼─────────────────┼──────────────────────────────────────┤
│ libssl3      │ CVE-2024-0727  │ CRITICAL │ 3.0.9-1           │ 3.0.13-1~deb12u1│ OpenSSL denial of service            │
│ libcurl4     │ CVE-2024-2379  │ HIGH     │ 7.88.1-10         │ 7.88.1-10+deb12u│ curl: HTTP/2 push headers memory leak│
└──────────────┴────────────────┴──────────┴───────────────────┴─────────────────┴──────────────────────────────────────┘
```

## Best Practices

1. **Scan in CI/CD** - catch vulnerabilities before deployment
2. **Use minimal base images** - distroless, Alpine reduce attack surface
3. **Pin image versions** - avoid `latest` tag, use digests for reproducibility
4. **Rebuild regularly** - pick up base image patches
5. **Set severity thresholds** - block CRITICAL, warn on HIGH
6. **Use admission control** - enforce scanning policy in-cluster
7. **Generate SBOMs** - Software Bill of Materials for supply chain security
