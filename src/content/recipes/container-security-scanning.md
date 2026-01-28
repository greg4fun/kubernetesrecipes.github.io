---
title: "How to Implement Container Security Scanning"
description: "Scan container images for vulnerabilities before deployment. Integrate Trivy and other tools into CI/CD pipelines and runtime admission control."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["security", "scanning", "vulnerabilities", "trivy", "admission-control"]
---

# How to Implement Container Security Scanning

Container security scanning identifies vulnerabilities in images before deployment. Integrate scanning into CI/CD pipelines and use admission controllers to block vulnerable images.

## Install Trivy

```bash
# macOS
brew install trivy

# Linux
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Verify
trivy --version
```

## Basic Image Scanning

```bash
# Scan an image
trivy image nginx:latest

# Scan with severity filter
trivy image --severity HIGH,CRITICAL nginx:latest

# JSON output
trivy image --format json --output results.json nginx:latest

# Only show fixable vulnerabilities
trivy image --ignore-unfixed nginx:latest

# Scan local image
docker build -t myapp:latest .
trivy image myapp:latest
```

## Scan in CI/CD Pipeline

```yaml
# .github/workflows/scan.yaml
name: Security Scan

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
      
      - name: Run Trivy scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: myapp:${{ github.sha }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'  # Fail on vulnerabilities
      
      - name: Upload scan results
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'
```

## GitLab CI Integration

```yaml
# .gitlab-ci.yml
stages:
  - build
  - scan
  - deploy

build:
  stage: build
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

scan:
  stage: scan
  image: aquasec/trivy:latest
  script:
    - trivy image --exit-code 1 --severity HIGH,CRITICAL $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  allow_failure: false
```

## Kubernetes Admission with Trivy

```yaml
# trivy-operator.yaml
# Install Trivy Operator for in-cluster scanning
apiVersion: v1
kind: Namespace
metadata:
  name: trivy-system
---
# Install via Helm
# helm repo add aqua https://aquasecurity.github.io/helm-charts/
# helm install trivy-operator aqua/trivy-operator \
#   --namespace trivy-system \
#   --set trivy.ignoreUnfixed=true
```

## View Vulnerability Reports

```bash
# After Trivy Operator is installed, view reports
kubectl get vulnerabilityreports -A

# Detailed report
kubectl get vulnerabilityreport -n production -o yaml

# Summary
kubectl get vulnerabilityreports -A -o custom-columns=\
'NAMESPACE:.metadata.namespace,NAME:.metadata.name,CRITICAL:.report.summary.criticalCount,HIGH:.report.summary.highCount'
```

## Admission Controller with Kyverno

```yaml
# kyverno-scan-policy.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: check-vulnerabilities
spec:
  validationFailureAction: Enforce
  background: true
  rules:
    - name: check-critical-vulnerabilities
      match:
        resources:
          kinds:
            - Pod
      validate:
        message: "Image has critical vulnerabilities"
        deny:
          conditions:
            any:
              - key: "{{ images.*.vulnerabilities[?severity=='CRITICAL'] | length(@) }}"
                operator: GreaterThan
                value: 0
```

## Block Unscanned Images

```yaml
# require-scan-policy.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-image-scan
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-vulnerability-scan
      match:
        resources:
          kinds:
            - Pod
      validate:
        message: "Image must be scanned before deployment"
        pattern:
          metadata:
            annotations:
              security.scan/passed: "true"
```

## Scan Kubernetes Manifests

```bash
# Scan for misconfigurations
trivy config ./manifests/

# Scan Helm charts
trivy config ./charts/myapp/

# Scan with specific checks
trivy config --severity HIGH,CRITICAL --exit-code 1 ./manifests/
```

## Scan Running Cluster

```bash
# Scan all images in cluster
trivy k8s --report summary cluster

# Scan specific namespace
trivy k8s --namespace production --report all

# Generate compliance report
trivy k8s --compliance k8s-nsa --report summary cluster
```

## Custom Scanning Policy

```yaml
# .trivyignore
# Ignore specific CVEs
CVE-2021-44228
CVE-2022-22965

# Ignore by package
golang.org/x/text
```

```yaml
# trivy.yaml - Custom config
severity:
  - CRITICAL
  - HIGH

vulnerability:
  ignore-unfixed: true
  
scan:
  skip-dirs:
    - node_modules
    - vendor
```

## Integration with Image Registry

```bash
# Scan images in registry
trivy image --server https://trivy-server:4954 myregistry/myapp:v1

# Harbor integration (built-in Trivy)
# Configure in Harbor admin: Interrogation Services > Vulnerability

# AWS ECR scanning
aws ecr start-image-scan \
  --repository-name myapp \
  --image-id imageTag=latest

aws ecr describe-image-scan-findings \
  --repository-name myapp \
  --image-id imageTag=latest
```

## SBOM Generation

```bash
# Generate Software Bill of Materials
trivy image --format cyclonedx --output sbom.json nginx:latest

# SPDX format
trivy image --format spdx-json --output sbom-spdx.json nginx:latest

# Scan existing SBOM
trivy sbom sbom.json
```

## Scheduled Cluster Scanning

```yaml
# scan-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: security-scan
  namespace: security
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: scanner
              image: aquasec/trivy:latest
              command:
                - /bin/sh
                - -c
                - |
                  trivy k8s --report summary cluster > /tmp/report.txt
                  # Send report via webhook or email
                  curl -X POST -d @/tmp/report.txt https://alerts.example.com/security
          restartPolicy: OnFailure
          serviceAccountName: trivy-scanner
```

## Security Scan Dashboard

```yaml
# Prometheus metrics from Trivy Operator
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: trivy-operator
  namespace: trivy-system
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: trivy-operator
  endpoints:
    - port: metrics
---
# Grafana dashboard for vulnerability metrics
# Dashboard ID: 16337 (Trivy Operator)
```

## Best Practices

```markdown
1. Scan in CI/CD pipeline
   - Block builds with critical vulnerabilities
   - Generate SBOM for compliance

2. Use admission control
   - Prevent unscanned images from deploying
   - Enforce vulnerability thresholds

3. Schedule regular scans
   - New CVEs discovered daily
   - Re-scan deployed images periodically

4. Keep base images updated
   - Use minimal base images (distroless, alpine)
   - Rebuild images when base updates

5. Monitor and alert
   - Dashboard for vulnerability trends
   - Alert on new critical CVEs
```

## Summary

Container security scanning identifies vulnerabilities before they reach production. Use Trivy for local and CI/CD scanning, integrating into GitHub Actions or GitLab CI. Deploy Trivy Operator for in-cluster scanning with vulnerability reports as Kubernetes resources. Implement admission controllers with Kyverno to block vulnerable images. Generate SBOMs for compliance and schedule regular scans to catch new CVEs. Combine build-time, deploy-time, and runtime scanning for defense in depth.

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
