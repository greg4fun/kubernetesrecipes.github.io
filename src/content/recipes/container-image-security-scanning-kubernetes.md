---
title: "Container Image Security Scanning on Kubernetes"
description: "Implement container image security scanning in Kubernetes CI/CD pipelines. Trivy, Grype, and admission controllers to prevent vulnerable images from running. Layer-level vulnerability analysis and runtime scanning."
tags:
  - "security"
  - "container-images"
  - "trivy"
  - "vulnerability-scanning"
  - "admission-controller"
category: "security"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "oci-container-image-internals-kubernetes"
  - "private-container-registry-kubernetes"
  - "pod-security-standards-kubernetes"
  - "trivy-vulnerability-scanning-kubernetes"
---

> 💡 **Quick Answer:** Scan container images at three points: build time (CI pipeline), admission time (Kyverno/OPA blocking unscanned images), and runtime (periodic rescanning for newly discovered CVEs). Trivy scans each layer independently, maps vulnerabilities to specific packages, and produces SBOM for compliance. Block images with Critical/High CVEs from reaching production.

## The Problem

- Vulnerable base images deployed without anyone knowing
- New CVEs discovered after images are already running in production
- No visibility into which layer introduced a vulnerable package
- Developers pull unvetted images from public registries
- Compliance requires SBOM (Software Bill of Materials) for all production images

## The Solution

### CI Pipeline Scanning (Build Time)

```yaml
# GitHub Actions — scan before pushing to registry
name: Build and Scan
on: push
jobs:
  build-scan-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t registry.example.com/myorg/app:${{ github.sha }} .

      - name: Scan with Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: registry.example.com/myorg/app:${{ github.sha }}
          format: table
          exit-code: 1                    # Fail pipeline on findings
          severity: CRITICAL,HIGH
          ignore-unfixed: true            # Skip CVEs with no patch available

      - name: Generate SBOM
        run: |
          trivy image \
            --format cyclonedx \
            --output sbom.json \
            registry.example.com/myorg/app:${{ github.sha }}

      - name: Push (only if scan passes)
        run: docker push registry.example.com/myorg/app:${{ github.sha }}
```

### Kubernetes Admission Controller (Deploy Time)

```yaml
# Kyverno policy — block unscanned or vulnerable images
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-image-scan
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-vulnerabilities
      match:
        any:
          - resources:
              kinds: ["Pod"]
      verifyImages:
        - imageReferences: ["registry.example.com/*"]
          attestations:
            - type: https://cosign.sigstore.dev/attestation/vuln/v1
              conditions:
                - all:
                    - key: "{{ scanner }}"
                      operator: Equals
                      value: "trivy"
                    - key: "{{ critical_count }}"
                      operator: Equals
                      value: "0"
                    - key: "{{ high_count }}"
                      operator: LessThanOrEquals
                      value: "5"
---
# Block images from untrusted registries
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: restrict-image-registries
spec:
  validationFailureAction: Enforce
  rules:
    - name: validate-registries
      match:
        any:
          - resources:
              kinds: ["Pod"]
      validate:
        message: "Images must come from approved registries"
        pattern:
          spec:
            containers:
              - image: "registry.example.com/* | gcr.io/distroless/*"
```

### Runtime Scanning (Continuous)

```yaml
# Trivy Operator — scans running workloads continuously
# Install via Helm
# helm install trivy-operator aquasecurity/trivy-operator \
#   --namespace trivy-system --create-namespace

# VulnerabilityReport generated per container
apiVersion: aquasecurity.github.io/v1alpha1
kind: VulnerabilityReport
metadata:
  name: pod-myapp-container-app
  namespace: production
spec:
  scanner:
    name: Trivy
    version: 0.51.0
  registry:
    server: registry.example.com
  artifact:
    repository: myorg/app
    tag: v2.1.0
    digest: sha256:6db391d1c0cfb...
  summary:
    criticalCount: 0
    highCount: 2
    mediumCount: 8
    lowCount: 15
  vulnerabilities:
    - vulnerabilityID: CVE-2026-1234
      severity: HIGH
      resource: libssl3
      installedVersion: "3.0.12"
      fixedVersion: "3.0.13"
      publishedDate: "2026-05-01T00:00:00Z"
      primaryLink: https://nvd.nist.gov/vuln/detail/CVE-2026-1234
      # Which layer contains this package:
      layer:
        digest: sha256:a480a496ba95a...
        diffID: sha256:c6f988f4874bb0...
```

### Layer-Level Analysis

```bash
# Identify which layer introduced a vulnerability
trivy image --format json registry.example.com/myorg/app:v2.1.0 | \
  jq '.Results[] | select(.Vulnerabilities != null) |
      {Target: .Target, Layer: .Layer,
       Vulns: [.Vulnerabilities[] | select(.Severity == "CRITICAL") | .VulnerabilityID]}'

# Output:
# {
#   "Target": "usr/lib/x86_64-linux-gnu/libssl.so.3",
#   "Layer": {
#     "Digest": "sha256:a480a496ba95a...",
#     "DiffID": "sha256:c6f988f4874bb0...",
#     "CreatedBy": "RUN apt-get install -y openssl"
#   },
#   "Vulns": ["CVE-2026-1234"]
# }

# Now you know: Layer 0 (base image) has the vuln
# Fix: update base image or add `apt-get upgrade openssl` in a later layer
```

### SBOM Generation and Storage

```bash
# Generate CycloneDX SBOM
trivy image --format cyclonedx \
  --output sbom-app-v2.1.0.json \
  registry.example.com/myorg/app:v2.1.0

# Attach SBOM to image as OCI artifact (cosign)
cosign attach sbom \
  --sbom sbom-app-v2.1.0.json \
  registry.example.com/myorg/app:v2.1.0

# Verify SBOM exists before deploying
cosign verify-attestation \
  --type cyclonedx \
  registry.example.com/myorg/app:v2.1.0
```

### Alerting on New CVEs

```yaml
# PrometheusRule — alert when critical vulns appear in running workloads
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: image-vulnerability-alerts
  namespace: monitoring
spec:
  groups:
    - name: image-security
      rules:
        - alert: CriticalVulnerabilityInProduction
          expr: trivy_image_vulnerabilities{severity="Critical",namespace="production"} > 0
          for: 1h
          labels:
            severity: critical
          annotations:
            summary: "Critical CVE in {{ $labels.image_repository }}:{{ $labels.image_tag }}"
            description: "Image has {{ $value }} critical vulnerabilities. Patch immediately."

        - alert: HighVulnerabilityCount
          expr: trivy_image_vulnerabilities{severity="High",namespace="production"} > 10
          for: 24h
          labels:
            severity: warning
```

## Common Issues

### False positives from OS packages not used at runtime
- **Cause**: Scanner finds vuln in installed package that app never calls
- **Fix**: Use distroless base; or add to `.trivyignore` with justification

### Scan timeout on large images (>5GB)
- **Cause**: Downloading all layers + analyzing takes too long
- **Fix**: Scan in CI where image is already local; increase Trivy timeout

### New CVE appears after image deployed
- **Cause**: Vulnerability databases update daily; image was clean at deploy time
- **Fix**: Trivy Operator rescans continuously; alert + redeploy with patched base

## Best Practices

1. **Scan at all three points** — build, admit, runtime
2. **Fail CI on Critical** — never push images with critical unpatched CVEs
3. **Pin base image digests** — know exactly which layers you're inheriting
4. **Use distroless/scratch** — fewer packages = fewer vulnerabilities
5. **Generate SBOM** — required for compliance (EO 14028, EU CRA)
6. **Layer awareness** — know which Dockerfile instruction introduced the vuln
7. **Ignore unfixed** — don't block deployments for CVEs with no available patch

## Key Takeaways

- Container images have per-layer vulnerability tracking (Trivy maps CVE → layer → Dockerfile instruction)
- Three scanning gates: CI pipeline (build), admission controller (deploy), Trivy Operator (runtime)
- Kyverno/OPA can enforce "no Critical CVEs" policy at admission time
- SBOM (CycloneDX/SPDX) attaches to images as OCI artifacts via cosign
- Content-addressable storage means you can verify image integrity by digest
- New CVEs appear daily — continuous rescanning catches post-deploy vulnerabilities
- Distroless bases drastically reduce vulnerability surface (50-90% fewer packages)
