---
title: "Trivy: K8s Security Scanning and SBOM"
description: "Scan Kubernetes clusters with Trivy for vulnerabilities, misconfigurations, and secrets. Trivy Operator for continuous scanning, SBOM generation, and compliance reports."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "trivy"
  - "vulnerability-scanning"
  - "security"
  - "sbom"
  - "compliance"
relatedRecipes:
  - "kubernetes-harbor-registry-guide"
  - "kubernetes-falco-runtime-security"
  - "kubernetes-pod-security-admission"
---

> 💡 **Quick Answer:** Trivy scans images, IaC, K8s clusters for vulnerabilities, misconfigs, and secrets. CLI: `trivy image nginx:latest`. Kubernetes Operator: `helm install trivy-operator aqua/trivy-operator -n trivy-system --create-namespace`. Operator continuously scans all running workloads and creates `VulnerabilityReport` CRDs per pod. SBOM generation: `trivy image --format spdx-json nginx:latest`.

## The Problem

You need to know:

- Which running containers have known CVEs?
- Are Kubernetes manifests misconfigured (privileged, no limits, etc.)?
- Are secrets accidentally embedded in images?
- Do you have an SBOM for compliance?
- Is your cluster CIS benchmark compliant?

## The Solution

### CLI Scanning

```bash
# Install Trivy
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh

# Scan container image
trivy image nginx:1.25
# CRITICAL: 2, HIGH: 5, MEDIUM: 12, LOW: 8

# Scan with severity filter
trivy image --severity CRITICAL,HIGH nginx:1.25

# Scan Kubernetes manifest
trivy config deployment.yaml
# Checks for: privileged containers, missing resource limits,
# runAsRoot, no readOnlyRootFilesystem, etc.

# Scan entire directory of YAML
trivy config ./k8s-manifests/

# Scan Helm chart
trivy config ./mychart/

# Scan filesystem for secrets
trivy fs --scanners secret ./src/

# Scan running K8s cluster
trivy k8s --report summary cluster
```

### Generate SBOM

```bash
# SPDX format
trivy image --format spdx-json -o sbom.spdx.json nginx:1.25

# CycloneDX format
trivy image --format cyclonedx -o sbom.cdx.json nginx:1.25

# Scan existing SBOM for vulnerabilities
trivy sbom sbom.spdx.json
```

### Trivy Operator (Continuous Scanning)

```bash
# Install operator
helm repo add aqua https://aquasecurity.github.io/helm-charts/
helm install trivy-operator aqua/trivy-operator \
  -n trivy-system --create-namespace \
  --set trivy.ignoreUnfixed=true

# Operator automatically scans all workloads
# Creates VulnerabilityReport per pod

# View reports
kubectl get vulnerabilityreports -A
# NAMESPACE    NAME                    IMAGE              CRITICAL  HIGH  MEDIUM  LOW
# production   deploy-myapp-xxx        myapp:v2           0         2     5       3
# kube-system  deploy-coredns-xxx      coredns:1.11       0         0     1       0

# Detailed report
kubectl get vulnerabilityreport -n production deploy-myapp-xxx -o yaml

# Config audit reports (misconfigurations)
kubectl get configauditreports -A
# NAMESPACE    NAME          SCANNER   CRITICAL  HIGH  MEDIUM  LOW
# production   deploy-myapp  Trivy     0         1     3       2

# Exposed secrets reports
kubectl get exposedsecretreports -A

# RBAC assessment
kubectl get rbacassessmentreports -A

# Cluster compliance (CIS, NSA)
kubectl get clustercompliancereports
```

### VulnerabilityReport Example

```yaml
apiVersion: aquasecurity.github.io/v1alpha1
kind: VulnerabilityReport
metadata:
  name: deploy-myapp-container
  namespace: production
  labels:
    trivy-operator.resource.kind: Deployment
    trivy-operator.resource.name: myapp
spec:
  report:
    artifact:
      repository: myapp
      tag: v2.0.0
    registry:
      server: registry.example.com
    scanner:
      name: Trivy
      version: 0.50.0
    summary:
      criticalCount: 0
      highCount: 2
      mediumCount: 5
      lowCount: 3
    vulnerabilities:
    - vulnerabilityID: CVE-2024-1234
      severity: HIGH
      resource: libssl3
      installedVersion: 3.1.0
      fixedVersion: 3.1.1
      title: "OpenSSL buffer overflow"
      primaryLink: https://nvd.nist.gov/vuln/detail/CVE-2024-1234
```

### Prometheus Metrics

```bash
# Trivy Operator exposes metrics
# Add ServiceMonitor for Prometheus scraping

# Key metrics:
# trivy_image_vulnerabilities{severity="Critical"} — critical CVE count
# trivy_resource_configaudits{severity="High"} — misconfig count
# trivy_image_info — image metadata

# Grafana dashboard: import ID 17813
```

### Policy Enforcement

```yaml
# Use with Kyverno to block deployments with critical CVEs
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: block-critical-vulnerabilities
spec:
  validationFailureAction: Enforce
  rules:
  - name: check-vulnerabilities
    match:
      any:
      - resources:
          kinds:
          - Pod
    preconditions:
      all:
      - key: "{{request.operation}}"
        operator: In
        value: ["CREATE", "UPDATE"]
    validate:
      message: "Image has critical vulnerabilities. Fix before deploying."
      deny:
        conditions:
          any:
          - key: "{{ images.containers.*.registry }}"
            operator: AnyIn
            value: ["*"]
# Note: Full integration requires admission webhook or
# checking VulnerabilityReports in CI pipeline
```

### CI/CD Integration

```yaml
# GitHub Actions
- name: Trivy vulnerability scan
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'myapp:${{ github.sha }}'
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'
    exit-code: '1'                 # Fail pipeline on findings

- name: Upload Trivy scan results
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-results.sarif'
```

## Common Issues

**Operator not scanning new deployments**

Check operator logs and RBAC. Operator needs permissions to list/watch workloads in all namespaces.

**"db download failed"**

Network policy blocking Trivy from downloading vulnerability database. Allow egress to `ghcr.io`.

**Too many reports cluttering the cluster**

Set `trivy.reportTTL` in Helm values to auto-delete old reports. Default keeps all.

## Best Practices

- **Scan in CI/CD** (fail on Critical) AND **continuously in cluster** (Operator)
- **Generate SBOMs** for compliance — SPDX or CycloneDX format
- **Ignore unfixed** vulnerabilities — focus on actionable findings
- **Prometheus alerts** on new Critical findings
- **Combine with Harbor** — scan on push + continuous scanning in cluster

## Key Takeaways

- Trivy scans images, configs, filesystems, and K8s clusters
- Trivy Operator creates VulnerabilityReport CRDs per running workload
- Continuous scanning — new CVEs caught even for deployed images
- SBOM generation for supply chain compliance
- Integrates with Prometheus, Grafana, and CI/CD pipelines
