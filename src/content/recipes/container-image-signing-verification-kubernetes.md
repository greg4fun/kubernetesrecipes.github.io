---
title: "Container Image Signing and Verification on Kubernetes"
description: "Sign container images with Sigstore cosign and verify signatures at admission time with Kyverno or Connaisseur. Supply chain security for Kubernetes"
tags:
  - "cosign"
  - "sigstore"
  - "supply-chain-security"
  - "image-signing"
  - "kyverno"
category: "security"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "oci-container-image-internals-kubernetes"
  - "container-image-security-scanning-kubernetes"
  - "private-container-registry-kubernetes"
  - "kyverno-policy-management"
---

> 💡 **Quick Answer:** Sign images with `cosign sign` (keyless via OIDC or with KMS keys), then enforce signature verification at admission time using Kyverno `verifyImages` policies. This ensures only images from your CI pipeline run in production — preventing supply chain attacks, unauthorized modifications, and unvetted third-party images.

## The Problem

- How do you know the image you're running was actually built by your CI pipeline?
- Compromised registry could serve tampered images with valid tags
- No proof that an image was scanned, tested, or approved before deployment
- Supply chain attacks inject malicious code into base images or dependencies
- Compliance (SLSA, FedRAMP) requires verifiable provenance for all artifacts

## The Solution

### Sign Images in CI

```bash
# Install cosign
go install github.com/sigstore/cosign/v2/cmd/cosign@latest

# Keyless signing (uses OIDC identity — GitHub Actions, GitLab CI)
# Signature + certificate stored in Rekor transparency log
cosign sign registry.example.com/myorg/app@sha256:6db391d1c0cfb...
# No keys to manage! Identity from CI's OIDC token

# Key-based signing (for air-gapped environments)
cosign generate-key-pair --kms awskms:///alias/cosign-key
cosign sign --key awskms:///alias/cosign-key \
  registry.example.com/myorg/app@sha256:6db391d1c0cfb...
```

### GitHub Actions Pipeline

```yaml
name: Build, Sign, Attest
on:
  push:
    tags: ["v*"]
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write              # Required for keyless signing
    steps:
      - uses: actions/checkout@v4

      - name: Build and push
        id: build
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: registry.example.com/myorg/app:${{ github.ref_name }}

      - name: Install cosign
        uses: sigstore/cosign-installer@v3

      - name: Sign image (keyless)
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
        run: |
          cosign sign --yes \
            registry.example.com/myorg/app@${DIGEST}

      - name: Attest SBOM
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
        run: |
          # Generate SBOM
          trivy image --format cyclonedx --output sbom.json \
            registry.example.com/myorg/app@${DIGEST}
          # Attach as signed attestation
          cosign attest --yes \
            --type cyclonedx \
            --predicate sbom.json \
            registry.example.com/myorg/app@${DIGEST}

      - name: Attest SLSA provenance
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
        run: |
          cosign attest --yes \
            --type slsaprovenance \
            --predicate <(cat <<EOF
          {
            "buildType": "https://github.com/actions/runner",
            "builder": {"id": "https://github.com/${{ github.repository }}/actions"},
            "invocation": {
              "configSource": {
                "uri": "git+https://github.com/${{ github.repository }}@${{ github.ref }}",
                "digest": {"sha1": "${{ github.sha }}"}
              }
            }
          }
          EOF
          ) \
            registry.example.com/myorg/app@${DIGEST}
```

### Verify Signatures at Admission (Kyverno)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
spec:
  validationFailureAction: Enforce
  webhookTimeoutSeconds: 30
  rules:
    # Verify keyless signatures (OIDC identity)
    - name: verify-keyless-signature
      match:
        any:
          - resources:
              kinds: ["Pod"]
      verifyImages:
        - imageReferences:
            - "registry.example.com/myorg/*"
          attestors:
            - entries:
                - keyless:
                    subject: "https://github.com/myorg/*"
                    issuer: "https://token.actions.githubusercontent.com"
                    rekor:
                      url: https://rekor.sigstore.dev
          mutateDigest: true           # Replace tags with verified digests
          verifyDigest: true

    # Verify KMS-based signatures (air-gapped)
    - name: verify-kms-signature
      match:
        any:
          - resources:
              kinds: ["Pod"]
              namespaces: ["production"]
      verifyImages:
        - imageReferences:
            - "registry.airgap.example.com/*"
          attestors:
            - entries:
                - keys:
                    kms: awskms:///alias/cosign-key

    # Require SBOM attestation
    - name: require-sbom
      match:
        any:
          - resources:
              kinds: ["Pod"]
              namespaces: ["production"]
      verifyImages:
        - imageReferences:
            - "registry.example.com/myorg/*"
          attestations:
            - type: https://cyclonedx.org/bom
              attestors:
                - entries:
                    - keyless:
                        subject: "https://github.com/myorg/*"
                        issuer: "https://token.actions.githubusercontent.com"
```

### Verify Manually

```bash
# Verify signature exists and is valid
cosign verify \
  --certificate-identity "https://github.com/myorg/app/.github/workflows/build.yml@refs/tags/v2.1.0" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  registry.example.com/myorg/app@sha256:6db391d1c0cfb...

# Verify SBOM attestation
cosign verify-attestation \
  --type cyclonedx \
  --certificate-identity "https://github.com/myorg/app/.github/workflows/build.yml@refs/tags/v2.1.0" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  registry.example.com/myorg/app@sha256:6db391d1c0cfb...

# View transparency log entry
rekor-cli get --uuid <log-entry-uuid>
```

### Where Signatures are Stored

```text
Registry Storage (OCI artifacts alongside the image):

registry.example.com/myorg/app:v2.1.0          ← Image
registry.example.com/myorg/app:sha256-6db3...sig  ← Signature
registry.example.com/myorg/app:sha256-6db3...att  ← Attestation (SBOM)
registry.example.com/myorg/app:sha256-6db3...att  ← Attestation (SLSA)

Transparency Log (Rekor — public, append-only):
- Records WHO signed WHAT and WHEN
- Enables detection of unauthorized signatures
- Provides non-repudiation
```

## Common Issues

### Kyverno webhook timeout during verification
- **Cause**: Rekor/registry slow to respond; or complex policy evaluation
- **Fix**: Increase `webhookTimeoutSeconds`; cache verification results

### Keyless signing fails in CI
- **Cause**: OIDC token not available; `id-token: write` permission missing
- **Fix**: Add `permissions.id-token: write` to GitHub Actions job

### Old images fail verification after key rotation
- **Cause**: New key doesn't match signature made with old key
- **Fix**: Keep old public key in policy OR re-sign old images with new key

### Air-gapped environment can't reach Rekor
- **Cause**: Keyless signing requires transparency log access
- **Fix**: Use KMS key-based signing for air-gapped; or run private Rekor instance

## Best Practices

1. **Keyless in CI, key-based for air-gap** — keyless is easier; KMS when disconnected
2. **Sign by digest, never by tag** — tags are mutable; signatures bind to immutable content
3. **Enforce at admission** — Kyverno `verifyImages` blocks unsigned images
4. **`mutateDigest: true`** — replace tags with verified digests in pod specs
5. **Attest everything** — signatures prove origin; attestations prove properties (scanned, tested)
6. **SLSA provenance** — proves the build came from your repo + CI system
7. **Monitor Rekor** — detect unauthorized signatures on your images

## Key Takeaways

- `cosign sign` creates cryptographic proof of image origin (who built it, when)
- Keyless signing uses OIDC identity (GitHub Actions, GitLab CI) — no keys to manage
- Signatures stored as OCI artifacts alongside the image in the registry
- Kyverno enforces signature verification at Pod admission — unsigned = rejected
- Attestations go beyond signatures: SBOM, vulnerability scan results, SLSA provenance
- Transparency log (Rekor) provides public, append-only record of all signing events
- Supply chain security: build → sign → attest → verify → admit → run
