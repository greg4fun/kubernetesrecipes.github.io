---
title: "cert-manager v1.21.2: Security Patch Release Notes and Upgrade Guide"
description: "cert-manager v1.21.2 fixes ACME/Vault response-body leaks, webhook panics, and bumps Go/gRPC for security CVEs. All users should upgrade."
publishDate: "2026-10-11"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.27+"
tags:
  - "cert-manager"
  - "security"
  - "acme"
  - "vault"
  - "gateway-api"
  - "webhook"
  - "upgrade"
---
> 💡 **Quick Answer:** cert-manager v1.21.2 is a bug-fix and security release that stops ACME/Vault response bodies from leaking into Issuer status and Events, fixes a validating-webhook panic and several controller panics/races, and bumps Go and gRPC to patch known CVEs — all users should upgrade.

## The Problem

Prior cert-manager versions had several issues operators should care about:

- ACME and Vault issuers could copy arbitrary (and potentially untrusted) HTTP response bodies into `Issuer`/`ClusterIssuer` status conditions and Kubernetes Events, risking information disclosure and unbounded body sizes (DoS vector).
- The validating webhook could panic on malformed `AdmissionReview` requests that omitted optional fields, and in some cases could silently allow requests it should have denied.
- The controller could panic when a `CertificateRequest` had a failure time but no `Ready` condition.
- HTTP-01 solver cleanup failed with `NotFound` errors if the ingress/pod/service was already deleted.
- A namespaced `Issuer` of type `vault` could incorrectly use the controller's ambient AWS credentials for IAM auth.
- Go, gRPC, and `golang.org/x/crypto` had known CVEs that needed patching.

## The Solution

Upgrade to cert-manager **v1.21.2**, which addresses all of the above. This is a patch release — no CRD schema changes are introduced, but behavior around error reporting and request validation does change (see Common Issues).

## What's New

**Security / hardening**
- ACME Issuer response bodies no longer reflected into status conditions or Events; only bounded ACME problem documents are surfaced, otherwise just the HTTP status code (full body still in controller logs). (#9239)
- ACME server response bodies capped at 16 MiB to prevent unbounded-body DoS. (#9222)
- Vault Issuer no longer copies non-Vault HTTP response bodies into its `Ready` condition/Events; only status code + truncated Vault error message. (#9262)
- ACME HTTP-01 self-check no longer reflects the fetched response body in `Challenge.status.reason` (prevents disclosure via redirects). (#9232)
- Namespaced `vault` `Issuer` no longer uses ambient AWS credentials for IAM auth unless `--issuer-ambient-credentials` is explicitly set on the controller. `ClusterIssuer` and `serviceAccountRef` (IRSA) are unaffected. (#9231)

**Bug fixes**
- Validating webhook panic fixed for `AdmissionReview` requests missing optional fields; validation now routes on always-present Resource/SubResource fields and **denies** unset/mismatched resource requests instead of silently allowing them. Note: this also now enforces validation for equivalent-converted requests on non-v1 API versions that previously could skip it. (#9235)
- Fixed panic in the certificates-issuing controller when a `CertificateRequest` has a failure time but no `Ready` condition. (#9238)
- HTTP-01 solver cleanup no longer fails with `NotFound` when the ingress/pod/service was already deleted. (#9278)
- Fixed `replaces` field being populated against the wrong issuer on issuer changes. (#9236)
- Fixed data race in ACME HTTP-01 self-check with custom DNS servers. (#9313)
- Fixed scheduler race where a fired timer's cleanup could cancel a newer timer, silently dropping a rescheduled poll. (#9312)
- De-duplicate `dnsNames` when multiple Gateway/ListenerSet listeners share a Secret. (#9234)
- Fixed certificate renewal windows miscalculating on Feb 29 cron schedules across non-leap century years. (#9240)
- `ingress-shim` no longer strips the applyset label from cached Ingress/Gateway objects. (#9314)

**Dependencies**
- Go upgraded to 1.26.6 then 1.26.8 (security fixes in go command, crypto/tls, encoding/asn1, encoding/xml, html/template, net, net/http, net/url). (#9151, #9323)
- `google.golang.org/grpc` bumped to v1.83.2 for reported CVEs. (#9255, #9317)
- `golang.org/x/crypto` bumped to v0.56.0 for reported CVEs. (#9265)

## Upgrade Steps

This release has no previous known version tracked in this cookbook, so treat it as a standard in-place patch upgrade from any 1.21.x release.

**Via Helm:**

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm upgrade cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --version v1.21.2 \
  --reuse-values
```

**Via static manifests:**

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml
```

If you rely on ambient AWS credentials for a namespaced Vault `Issuer`, explicitly re-enable the old behavior on the controller Deployment:

```bash
kubectl -n cert-manager set args deployment/cert-manager \
  --containers=cert-manager-controller \
  -- --issuer-ambient-credentials=true
```

(Prefer migrating to `ClusterIssuer` or `serviceAccountRef`/IRSA instead of re-enabling ambient credentials.)

## Verify

```bash
kubectl get pods -n cert-manager
kubectl -n cert-manager exec deploy/cert-manager -- cert-manager-controller version
# or
kubectl get deployment cert-manager -n cert-manager -o jsonpath='{.spec.template.spec.containers[0].image}'
```

Confirm image tags read `v1.21.2`, then check that existing Certificates are still being issued/renewed normally:

```bash
kubectl get certificates -A
kubectl describe certificaterequest <name> -n <namespace>
```

## Common Issues

- **Webhook now rejects requests it previously allowed**: the webhook panic fix (#9235) also closes a gap where equivalent-converted requests on non-v1 API versions could skip validation. If you have tooling submitting non-v1 `AdmissionReview` requests against cert-manager CRDs, re-test after upgrade — some previously-accepted malformed requests will now be denied.
- **Vault Issuer auth failures after upgrade**: if a namespaced `Issuer` (not `ClusterIssuer`) was relying on ambient AWS credentials for Vault IAM auth, it will stop authenticating unless `--issuer-ambient-credentials` is set, or you switch to `serviceAccountRef`/IRSA.
- **Shorter error messages in Events/status**: ACME and Vault error Events/conditions now show only HTTP status codes or truncated messages instead of full response bodies — check controller logs (`kubectl logs -n cert-manager deploy/cert-manager`) for full diagnostic detail.

## Best Practices

- Upgrade promptly — this release fixes DoS and information-disclosure issues plus multiple CVE-patched dependencies.
- Prefer `ClusterIssuer` or `serviceAccountRef` (IRSA) over ambient credentials for Vault issuers going forward.
- After upgrading, review controller logs rather than Events/status for full ACME/Vault error detail, since bodies are now truncated/omitted there by design.
- Pin the Helm chart `--version` explicitly in CI/CD to avoid unplanned drift on future releases.
- For full details and any edge cases not covered here, see the [release page](https://github.com/cert-manager/cert-manager/releases/tag/v1.21.2).
