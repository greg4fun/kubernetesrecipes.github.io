---
title: "Kyverno AI Workload Provenance Verification"
description: "Use Kyverno to verify software and content provenance for AI workloads: SBOM validation, model signing with Sigstore, dataset integrity, and supply chain security for ML pipelines."
tags:
  - "kyverno"
  - "supply-chain"
  - "ai-security"
  - "sigstore"
  - "sbom"
category: "security"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kyverno-cel-policy-model"
  - "kyverno-llm-inference-guardrails"
  - "kubernetes-cosign-image-verification"
  - "kubernetes-kyverno-policy-guide"
---

> 💡 **Quick Answer:** Kyverno can enforce AI workload provenance by verifying container image signatures, SBOM attestations, model file integrity (via cosign), and dataset provenance — ensuring only trusted, auditable AI artifacts run in your cluster.

## The Problem

AI workloads introduce unique supply chain risks:

- Model weights can be poisoned (backdoored during training)
- Training datasets may contain malicious content
- Base images with GPU drivers/CUDA may be tampered
- No standard provenance chain from training → inference
- Regulatory requirements (EU AI Act) mandate traceability

## The Solution

### Image Signature Verification for AI Containers

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-ai-images
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-model-server-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaceSelector:
                matchLabels:
                  purpose: ai-inference
      verifyImages:
        - imageReferences:
            - "registry.example.com/ml/*"
            - "nvcr.io/nim/*"
          attestors:
            - entries:
                - keyless:
                    issuer: "https://accounts.google.com"
                    subject: "ml-team@example.com"
                    rekor:
                      url: "https://rekor.sigstore.dev"
          attestations:
            - type: https://slsa.dev/provenance/v1
              conditions:
                all:
                  - key: "{{ builder.id }}"
                    operator: Equals
                    value: "https://github.com/actions/runner"
```

### SBOM Verification for CUDA/GPU Images

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-gpu-image-sbom
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-sbom-attestation
      match:
        any:
          - resources:
              kinds:
                - Pod
              selector:
                matchLabels:
                  nvidia.com/gpu: "true"
      verifyImages:
        - imageReferences:
            - "*"
          attestations:
            - type: https://spdx.dev/Document
              conditions:
                all:
                  - key: "{{ spdxVersion }}"
                    operator: NotEquals
                    value: ""
            - type: https://cyclonedx.org/bom
              conditions:
                all:
                  - key: "{{ components[?type=='library'] | length(@) }}"
                    operator: GreaterThan
                    value: "0"
```

### Model Provenance Verification

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-model-provenance
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-model-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
              selector:
                matchLabels:
                  app.kubernetes.io/component: inference
      validate:
        message: "Model volume must reference signed model artifact"
        pattern:
          metadata:
            annotations:
              model.ai/signed: "true"
              model.ai/signature-verified: "true"
              model.ai/training-pipeline: "?*"

    - name: require-model-card
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaceSelector:
                matchLabels:
                  purpose: ai-inference
      validate:
        cel:
          expressions:
            - expression: |
                has(object.metadata.annotations) &&
                'model.ai/model-card-url' in object.metadata.annotations &&
                object.metadata.annotations['model.ai/model-card-url'].startsWith('https://')
              message: "AI inference Pods must include a model card URL annotation"
```

### Dataset Integrity Policy

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-dataset-integrity
spec:
  rules:
    - name: require-dataset-checksum
      match:
        any:
          - resources:
              kinds:
                - Pod
              selector:
                matchLabels:
                  workload-type: training
      validate:
        cel:
          expressions:
            - expression: |
                object.spec.containers.all(c,
                  c.env.exists(e, e.name == 'DATASET_SHA256') &&
                  c.env.exists(e, e.name == 'DATASET_SOURCE_URL')
                )
              message: "Training Pods must specify DATASET_SHA256 and DATASET_SOURCE_URL"

            - expression: |
                object.spec.containers.all(c,
                  c.env.filter(e, e.name == 'DATASET_SHA256').all(e,
                    e.value.matches('^[a-f0-9]{64}$')
                  )
                )
              message: "DATASET_SHA256 must be a valid SHA-256 hash"
```

### Signing Models with Cosign

```bash
# Sign model artifact stored as OCI artifact
cosign sign --key cosign.key \
  registry.example.com/models/mistral-small:v1.0

# Attach SLSA provenance attestation
cosign attest --predicate provenance.json \
  --type slsaprovenance \
  --key cosign.key \
  registry.example.com/models/mistral-small:v1.0

# Attach model card as attestation
cosign attest --predicate model-card.json \
  --type https://mlcommons.org/model-card/v1 \
  --key cosign.key \
  registry.example.com/models/mistral-small:v1.0

# Verify before deployment
cosign verify --key cosign.pub \
  registry.example.com/models/mistral-small:v1.0
```

## Common Issues

### Signature verification timeout on large AI images
- **Cause**: AI images are 10-50GB; signature fetch adds latency
- **Fix**: Increase webhook timeout; pre-verify and cache results

### Model stored on PVC (not OCI) — can't verify
- **Cause**: Cosign only works with OCI registries
- **Fix**: Use init container that verifies checksum before model load

### SBOM missing for NVIDIA base images
- **Cause**: Not all NVIDIA images ship with SBOM attestations yet
- **Fix**: Generate SBOM at build time with Syft/Trivy; attest during CI

## Best Practices

1. **Sign everything**: images, models, datasets, configs
2. **Use keyless signing** (Sigstore) for CI pipelines — no key management
3. **Require SLSA provenance** for production AI workloads
4. **Model cards as attestations** — machine-readable metadata
5. **Verify in admission** (Kyverno) AND at runtime (init containers)
6. **Audit first** — AI teams move fast; don't block without warning

## Key Takeaways

- Kyverno `verifyImages` supports signature and attestation checks
- AI workloads need provenance for: images, models, datasets, training pipelines
- SLSA provenance tracks who built what, when, and how
- Model poisoning prevention requires end-to-end verification chain
- CEL expressions validate annotation-based provenance metadata
- EU AI Act will require this level of traceability for high-risk AI
- Combine admission-time (Kyverno) + runtime (init container) verification
