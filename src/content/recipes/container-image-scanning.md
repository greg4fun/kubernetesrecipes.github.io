---
title: "How to Scan Container Images for Vulnerabilities"
description: "Implement container image scanning in Kubernetes using Trivy. Learn to scan images in CI/CD, admission controllers, and runtime."
category: "security"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
  - "Basic understanding of container security"
relatedRecipes:
  - "pod-security-standards"
  - "rbac-service-accounts"
tags:
  - security
  - trivy
  - scanning
  - vulnerabilities
  - cve
  - images
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You need to detect security vulnerabilities in container images before and after deploying them to Kubernetes.

## The Solution

Use Trivy, a comprehensive security scanner, to scan images in CI/CD pipelines and as an admission controller in Kubernetes.

## Installing Trivy

### Local Installation

```bash
# macOS
brew install trivy

# Linux
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Verify
trivy version
```

## Scanning Images Locally

### Basic Scan

```bash
trivy image nginx:latest
```

### Scan with Severity Filter

```bash
trivy image --severity HIGH,CRITICAL nginx:latest
```

### Scan with Exit Code (for CI/CD)

```bash
trivy image --exit-code 1 --severity CRITICAL nginx:latest
```

### Output Formats

```bash
# JSON output
trivy image -f json nginx:latest > results.json

# Table output
trivy image -f table nginx:latest

# SARIF for GitHub Security
trivy image -f sarif nginx:latest > results.sarif
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Scan Container Image

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

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
    
    - name: Upload Trivy scan results
      uses: github/codeql-action/upload-sarif@v2
      with:
        sarif_file: 'trivy-results.sarif'
```

### GitLab CI

```yaml
scan:
  image:
    name: aquasec/trivy:latest
    entrypoint: [""]
  script:
    - trivy image --exit-code 1 --severity CRITICAL $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  only:
    - main
```

## Kubernetes Admission Controller

### Install Trivy Operator

```bash
helm repo add aqua https://aquasecurity.github.io/helm-charts/
helm repo update

helm install trivy-operator aqua/trivy-operator \
  --namespace trivy-system \
  --create-namespace \
  --set trivy.ignoreUnfixed=true
```

### VulnerabilityReports

The operator automatically creates VulnerabilityReports:

```bash
# List all vulnerability reports
kubectl get vulnerabilityreports -A

# View detailed report
kubectl describe vulnerabilityreport -n default myapp-pod-myapp
```

### View Vulnerabilities

```bash
# Get summary
kubectl get vulnerabilityreports -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: Critical={.report.summary.criticalCount}, High={.report.summary.highCount}{"\n"}{end}'
```

## Scan Kubernetes Cluster

### Scan Running Pods

```bash
# Scan all images in a namespace
trivy k8s --namespace default

# Scan entire cluster
trivy k8s --all-namespaces

# Generate report
trivy k8s --report summary
```

### Scan with CIS Benchmarks

```bash
trivy k8s --compliance k8s-cis
```

## Block Vulnerable Images

### Using Kyverno Policy

```yaml
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
    verifyImages:
    - imageReferences:
      - "*"
      attestations:
      - type: https://trivy.dev/scan/v1
        conditions:
        - all:
          - key: "{{ criticalCount }}"
            operator: Equals
            value: "0"
```

### Using OPA Gatekeeper

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos
metadata:
  name: require-scanned-images
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
  parameters:
    repos:
    - "gcr.io/verified-images/"
    - "docker.io/library/"
```

## Scan Filesystem and Config

### Scan IaC Files

```bash
# Scan Kubernetes manifests
trivy config ./kubernetes/

# Scan Terraform
trivy config ./terraform/

# Scan Dockerfile
trivy config ./Dockerfile
```

### Example Output

```
Dockerfile (dockerfile)
=======================
Tests: 23 (SUCCESSES: 21, FAILURES: 2)
Failures: 2 (UNKNOWN: 0, LOW: 0, MEDIUM: 2, HIGH: 0, CRITICAL: 0)

MEDIUM: Specify version tag for image
════════════════════════════════════
Using latest tag can cause unexpected behavior
```

## Create Scan Job

Run as a Kubernetes Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: image-scan
spec:
  template:
    spec:
      containers:
      - name: trivy
        image: aquasec/trivy:latest
        args:
        - image
        - --exit-code
        - "1"
        - --severity
        - CRITICAL,HIGH
        - nginx:latest
      restartPolicy: Never
  backoffLimit: 0
```

## Ignore Specific CVEs

Create `.trivyignore`:

```
# Ignore specific CVEs
CVE-2023-12345
CVE-2023-67890

# With expiration
CVE-2023-11111 exp:2024-01-01
```

Use it:

```bash
trivy image --ignorefile .trivyignore nginx:latest
```

## Best Practices

### 1. Scan in CI/CD Pipeline

Block deployments with critical vulnerabilities.

### 2. Use Fixed Image Tags

```yaml
# Bad
image: nginx:latest

# Good  
image: nginx:1.25.3-alpine
```

### 3. Regular Re-scanning

New CVEs are discovered daily. Rescan deployed images regularly.

### 4. Use Minimal Base Images

```dockerfile
# Instead of
FROM ubuntu:22.04

# Use
FROM alpine:3.19
# Or
FROM gcr.io/distroless/static-debian12
```

### 5. Update Dependencies Regularly

Set up automated dependency updates with Dependabot or Renovate.

## Key Takeaways

- Scan images before deploying to production
- Integrate scanning in CI/CD pipelines
- Use admission controllers to block vulnerable images
- Run periodic scans on deployed workloads
- Keep base images minimal and updated

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
