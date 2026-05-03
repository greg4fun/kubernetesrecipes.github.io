---
title: "SPIFFE/SPIRE: Workload Identity for K8s"
description: "Deploy SPIRE for Kubernetes workload identity using SPIFFE standards. Automatic mTLS certificate issuance, cross-cluster identity federation."
publishDate: "2026-05-03"
author: "Luca Berton"
category: "security"
difficulty: "advanced"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "spiffe"
  - "spire"
  - "identity"
  - "zero-trust"
  - "mtls"
relatedRecipes:
  - "kubernetes-cert-manager-guide"
  - "kubernetes-rbac-role-rolebinding"
  - "kubernetes-service-mesh-istio-guide"
  - "kubernetes-linkerd-service-mesh-guide"
---

> 💡 **Quick Answer:** SPIFFE defines workload identity (URI: `spiffe://trust-domain/workload`). SPIRE implements it — auto-issues X.509 SVIDs (certificates) and JWT tokens to workloads. Install: `helm install spire spire/spire -n spire-system --create-namespace`. Workloads get cryptographic identity without managing secrets. Enables zero-trust mTLS between services, cross-cluster and cross-cloud identity federation.

## The Problem

Workloads need identity for mTLS and authorization:

- Kubernetes ServiceAccount tokens are cluster-scoped — useless cross-cluster
- Manual certificate management doesn't scale
- Service mesh provides mTLS but ties you to one mesh
- Need identity that works across K8s, VMs, and cloud services
- Zero-trust requires every workload to prove its identity

## The Solution

### Install SPIRE

```bash
helm repo add spire https://spiffe.github.io/helm-charts-hardened/
helm install spire spire/spire \
  -n spire-system --create-namespace \
  --set global.spire.trustDomain=example.com \
  --set spire-server.controllerManager.enabled=true

# Verify
kubectl get pods -n spire-system
# spire-server-0              Running
# spire-agent-xxx (DaemonSet) Running on each node

# Install SPIRE CLI
kubectl exec -n spire-system spire-server-0 -- \
  /opt/spire/bin/spire-server healthcheck
# Server is healthy
```

### SPIFFE IDs

```bash
# SPIFFE ID format:
# spiffe://trust-domain/path

# Examples:
# spiffe://example.com/ns/production/sa/api-server
# spiffe://example.com/ns/production/sa/database
# spiffe://example.com/cluster/east/ns/production/sa/frontend

# Each workload gets an SVID (SPIFFE Verifiable Identity Document)
# - X.509 certificate with SPIFFE ID in SAN
# - Short-lived (1 hour default), auto-rotated
```

### Automatic Registration

```yaml
# SPIRE Controller Manager auto-registers pods
# based on Kubernetes metadata

# ClusterSPIFFEID — auto-assign identities
apiVersion: spire.spiffe.io/v1alpha1
kind: ClusterSPIFFEID
metadata:
  name: production-workloads
spec:
  spiffeIDTemplate: "spiffe://example.com/ns/{{ .PodMeta.Namespace }}/sa/{{ .PodSpec.ServiceAccountName }}"
  podSelector:
    matchLabels: {}
  namespaceSelector:
    matchLabels:
      spire-enabled: "true"

---
# Label namespace for auto-registration
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    spire-enabled: "true"
```

### Using SPIFFE in Workloads

```yaml
# Mount SPIFFE workload API socket
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: production
spec:
  template:
    spec:
      serviceAccountName: api-server
      containers:
      - name: api
        image: myapp/api:v1
        volumeMounts:
        - name: spiffe-workload-api
          mountPath: /spiffe-workload-api
          readOnly: true
        env:
        - name: SPIFFE_ENDPOINT_SOCKET
          value: unix:///spiffe-workload-api/spire-agent.sock
      volumes:
      - name: spiffe-workload-api
        csi:
          driver: csi.spiffe.io
          readOnly: true
```

```go
// Go: Automatic mTLS with SPIFFE
package main

import (
    "github.com/spiffe/go-spiffe/v2/spiffetls/tlsconfig"
    "github.com/spiffe/go-spiffe/v2/workloadapi"
)

func main() {
    ctx := context.Background()
    
    // Get X.509 source (auto-rotated)
    source, _ := workloadapi.NewX509Source(ctx)
    defer source.Close()
    
    // mTLS server
    tlsConfig := tlsconfig.MTLSServerConfig(
        source, source,
        tlsconfig.AuthorizeID(
            spiffeid.RequireIDFromString("spiffe://example.com/ns/production/sa/frontend"),
        ),
    )
    
    server := &http.Server{
        Addr:      ":8443",
        TLSConfig: tlsConfig,
    }
    server.ListenAndServeTLS("", "")
}
```

### Federation (Cross-Cluster/Cross-Cloud)

```bash
# Cluster A trusts Cluster B's identities
# On Cluster A's SPIRE server:
spire-server bundle show -format spiffe > cluster-a-bundle.json

# Exchange bundles between clusters
spire-server bundle set \
  -id spiffe://cluster-b.example.com \
  -path cluster-b-bundle.json

# Now workloads in Cluster A can verify
# spiffe://cluster-b.example.com/ns/production/sa/api
```

```yaml
# Federation configuration
apiVersion: spire.spiffe.io/v1alpha1
kind: ClusterFederatedTrustDomain
metadata:
  name: cluster-b
spec:
  trustDomain: cluster-b.example.com
  bundleEndpointURL: https://spire-server.cluster-b:8443
  bundleEndpointProfile:
    type: https_spiffe
    endpointSPIFFEID: spiffe://cluster-b.example.com/spire/server
```

### Integrations

```bash
# SPIRE works with:
# - Envoy proxy (SDS — Secret Discovery Service)
# - Istio (custom CA via SPIRE)
# - Cilium (mutual auth via SPIFFE)
# - AWS IAM Roles Anywhere (SPIFFE certs → AWS credentials)
# - HashiCorp Vault (SPIFFE auth method)
# - PostgreSQL / MySQL (client certificate auth)
```

## Common Issues

**Agent not attesting workloads**

Node attestation failed. Check: SPIRE agent logs, ensure node attestor matches your platform (k8s-sat, aws-iid, etc.).

**SVID not issued to pod**

No matching registration entry. Check: `spire-server entry list`. Ensure ClusterSPIFFEID selector matches pod.

**Certificate expired**

SPIRE auto-rotates SVIDs. If app caches certs, it must watch for rotations via workload API.

## Best Practices

- **Auto-registration** via ClusterSPIFFEID — don't manually register entries
- **Short-lived SVIDs** (1h) — reduces blast radius of compromise
- **Federation for multi-cluster** — exchange trust bundles, not credentials
- **CSI driver** for socket mount — simpler than hostPath
- **Authorize by SPIFFE ID** in app code — not just IP or namespace

## Key Takeaways

- SPIFFE: universal workload identity standard (URI-based)
- SPIRE: auto-issues short-lived X.509 certs to workloads
- No secrets to manage — identity derived from workload attributes
- Federation enables cross-cluster/cross-cloud identity verification
- Foundation for zero-trust: every service proves its identity cryptographically
