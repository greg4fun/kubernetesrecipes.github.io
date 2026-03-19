---
title: "OpenClaw on OpenShift with SCCs and Routes"
description: "Deploy OpenClaw on OpenShift with Security Context Constraints, Routes for TLS termination, and OpenShift-specific considerations for non-root containers."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - openclaw
  - openshift
  - scc
  - routes
  - enterprise
relatedRecipes:
  - "openclaw-kubernetes-deployment"
  - "openclaw-security-hardening-pod"
  - "openclaw-ingress-tls-kubernetes"
  - "openshift-acs-kubernetes"
---

> 💡 **Quick Answer:** OpenClaw's official manifests are already OpenShift-compatible — `nonroot-v2` SCC, UID 1000, read-only root FS. Create a Route instead of Ingress for TLS termination, and use OpenShift's built-in image registry for air-gapped deployments.

## The Problem

OpenShift adds security layers beyond standard Kubernetes: Security Context Constraints (SCCs), restricted UID ranges, and Routes instead of Ingress. Deploying OpenClaw requires understanding which SCC to use and how to adapt the manifests for OpenShift's opinionated security model.

## The Solution

### SCC Compatibility

OpenClaw's security context already meets `restricted-v2` SCC:

```yaml
# OpenClaw's securityContext matches restricted-v2
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  seccompProfile:
    type: RuntimeDefault
  capabilities:
    drop: ["ALL"]
```

Verify compatibility:

```bash
# Check which SCC the pod uses
oc get pod -n openclaw -l app=openclaw -o jsonpath='{.items[0].metadata.annotations.openshift\.io/scc}'
# Expected: restricted-v2
```

### Deploy on OpenShift

```bash
# Create project (namespace)
oc new-project openclaw

# Deploy using the standard script
export ANTHROPIC_API_KEY="sk-ant-..."
./scripts/k8s/deploy.sh

# Or apply manifests directly
oc apply -k scripts/k8s/manifests -n openclaw
```

### Create Route for External Access

Instead of Kubernetes Ingress, use OpenShift Routes:

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: openclaw
  namespace: openclaw
spec:
  host: openclaw.apps.cluster.example.com
  to:
    kind: Service
    name: openclaw
    weight: 100
  port:
    targetPort: 18789
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
  wildcardPolicy: None
```

```bash
oc apply -f route.yaml
oc get route openclaw -n openclaw
# NAME       HOST                                    PATH   SERVICES   PORT
# openclaw   openclaw.apps.cluster.example.com               openclaw   18789
```

> ⚠️ **Remember:** Change gateway bind from `loopback` to `0.0.0.0` in the ConfigMap when using Routes.

```mermaid
graph LR
    A[Browser] -->|HTTPS| B[OpenShift Router]
    B -->|TLS Edge Termination| C[Route: openclaw]
    C -->|HTTP| D[Service: openclaw]
    D --> E[Pod with restricted-v2 SCC]
    E --> F[PVC: openclaw-home]
```

### Air-Gapped Deployment

Use OpenShift's internal registry:

```bash
# Mirror OpenClaw image to internal registry
oc import-image openclaw:slim \
  --from=ghcr.io/openclaw/openclaw:slim \
  --confirm -n openclaw

# Update deployment to use internal image
# image: image-registry.openshift-image-registry.svc:5000/openclaw/openclaw:slim
```

Or use IDMS for transparent mirroring:

```yaml
apiVersion: config.openshift.io/v1
kind: ImageDigestMirrorSet
metadata:
  name: openclaw-mirror
spec:
  imageDigestMirrors:
    - source: ghcr.io/openclaw
      mirrors:
        - registry.example.com/openclaw
```

### OpenShift-Specific Considerations

| Feature | Kubernetes | OpenShift |
|---------|-----------|-----------|
| External access | Ingress | Route |
| Security | PSA labels | SCCs |
| UID | Fixed 1000 | Arbitrary (restricted SCC assigns random UID) |
| Image registry | External only | Built-in |
| TLS certs | cert-manager | Built-in via Router |

### UID Range Handling

OpenShift's `restricted-v2` SCC assigns a random UID from the namespace range. OpenClaw specifies `runAsUser: 1000`, which works with `nonroot-v2` SCC. If your cluster enforces namespace UID ranges:

```bash
# Check namespace UID range
oc get namespace openclaw -o jsonpath='{.metadata.annotations.openshift\.io/sa\.scc\.uid-range}'
# e.g., 1000700000/10000

# Option 1: Use nonroot-v2 SCC (allows any non-root UID)
oc adm policy add-scc-to-user nonroot-v2 -z default -n openclaw

# Option 2: Remove runAsUser from deployment (let OpenShift assign)
```

## Common Issues

### Pod Fails with SCC Violation

```bash
oc describe pod -n openclaw -l app=openclaw | grep -i scc
# If using wrong SCC, adjust:
oc adm policy add-scc-to-user nonroot-v2 -z default -n openclaw
```

### Route Returns 503

The gateway binds to loopback by default. Update ConfigMap:

```json
{
  "gateway": {
    "bind": "0.0.0.0"
  }
}
```

### PVC StorageClass Not Found

OpenShift uses `gp3-csi` (AWS), `managed-premium` (Azure), or `thin-csi` (vSphere):

```bash
oc get sc
# Use the default StorageClass or specify explicitly
```

## Best Practices

- **Use Routes, not Ingress** — native TLS with auto-renewed certificates
- **Stick with restricted-v2 SCC** — OpenClaw manifests are already compliant
- **IDMS for disconnected clusters** — transparent image mirroring
- **Don't grant privileged SCC** — OpenClaw doesn't need it
- **Use OpenShift monitoring** — leverage built-in Prometheus for pod metrics
- **NetworkPolicy** — OpenShift's OVN-Kubernetes supports native network policies

## Key Takeaways

- OpenClaw manifests work on OpenShift out of the box with restricted-v2 SCC
- Use Routes for external access with built-in TLS termination
- Air-gapped deployments use IDMS or `oc import-image` for image mirroring
- Change gateway bind to `0.0.0.0` when exposing via Route
- OpenShift's security model is stricter — OpenClaw already meets the requirements
