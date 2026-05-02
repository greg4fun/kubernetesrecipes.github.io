---
title: "GKE OIDC Issuer Workload Identity"
description: "Enable OIDC issuer on GKE with --enable-oidc-issuer. Configure workload identity federation for cross-cloud auth and external IdP integration."
publishDate: "2026-04-30"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "gke"
  - "oidc"
  - "workload-identity"
  - "security"
  - "google-cloud"
  - "authentication"
relatedRecipes:
  - "kubernetes-rbac-role-clusterrole"
---

> 💡 **Quick Answer:** Enable the OIDC issuer on GKE with `gcloud container clusters create --enable-oidc-issuer` (or update existing clusters). This exposes a public OIDC discovery endpoint for your cluster's ServiceAccount tokens, enabling workload identity federation — pods authenticate to external services (AWS, Azure, Vault) using Kubernetes ServiceAccount tokens without static credentials.

## The Problem

GKE pods need to authenticate to external services:

- AWS resources from GKE pods (cross-cloud)
- HashiCorp Vault with Kubernetes auth
- Azure services via federated identity
- Other Kubernetes clusters (multi-cluster auth)
- CI/CD systems verifying cluster identity

Without OIDC issuer, you need static credentials (service account keys) which are a security risk.

## The Solution

### Enable OIDC Issuer

```bash
# New cluster with OIDC issuer
gcloud container clusters create my-cluster \
  --region us-central1 \
  --enable-oidc-issuer \
  --workload-pool=my-project.svc.id.goog

# Enable on existing cluster
gcloud container clusters update my-cluster \
  --region us-central1 \
  --enable-oidc-issuer

# Verify OIDC issuer URL
gcloud container clusters describe my-cluster \
  --region us-central1 \
  --format='value(selfLink)'

# Get the OIDC discovery endpoint
ISSUER=$(kubectl get --raw /.well-known/openid-configuration | jq -r '.issuer')
echo $ISSUER
# https://container.googleapis.com/v1/projects/my-project/locations/us-central1/clusters/my-cluster

# Verify discovery document
curl -s "${ISSUER}/.well-known/openid-configuration" | jq .
```

### GKE Workload Identity Federation

```bash
# Enable Workload Identity on the cluster
gcloud container clusters update my-cluster \
  --region us-central1 \
  --workload-pool=my-project.svc.id.goog

# Create a Google Service Account (GSA)
gcloud iam service-accounts create gke-app-sa \
  --display-name="GKE Application SA"

# Grant GSA permissions to GCP resources
gcloud projects add-iam-policy-binding my-project \
  --member="serviceAccount:gke-app-sa@my-project.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"

# Bind Kubernetes SA → Google SA
gcloud iam service-accounts add-iam-policy-binding \
  gke-app-sa@my-project.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:my-project.svc.id.goog[my-namespace/my-ksa]"
```

```yaml
# Annotate the Kubernetes ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-ksa
  namespace: my-namespace
  annotations:
    iam.gke.io/gcp-service-account: gke-app-sa@my-project.iam.gserviceaccount.com

---
# Pod using the annotated ServiceAccount
apiVersion: v1
kind: Pod
metadata:
  name: gcp-app
  namespace: my-namespace
spec:
  serviceAccountName: my-ksa
  containers:
  - name: app
    image: google/cloud-sdk:slim
    command: ["gsutil", "ls", "gs://my-bucket/"]
    # No credentials needed — Workload Identity provides them
```

### Cross-Cloud Federation (GKE → AWS)

```bash
# In AWS: Create OIDC identity provider
aws iam create-open-id-connect-provider \
  --url "${ISSUER}" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "$(openssl s_client -connect container.googleapis.com:443 2>/dev/null | openssl x509 -fingerprint -noout | sed 's/://g' | cut -d= -f2)"

# Create AWS IAM role trusting the GKE OIDC issuer
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::123456789012:oidc-provider/container.googleapis.com/v1/projects/my-project/locations/us-central1/clusters/my-cluster"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "container.googleapis.com/v1/projects/my-project/locations/us-central1/clusters/my-cluster:sub": "system:serviceaccount:my-namespace:my-ksa"
      }
    }
  }]
}
EOF

aws iam create-role \
  --role-name gke-cross-cloud-role \
  --assume-role-policy-document file://trust-policy.json
```

### HashiCorp Vault Integration

```bash
# Configure Vault to trust GKE OIDC tokens
vault auth enable jwt

vault write auth/jwt/config \
  oidc_discovery_url="${ISSUER}" \
  default_role="gke-app"

vault write auth/jwt/role/gke-app \
  role_type="jwt" \
  bound_audiences="vault" \
  user_claim="sub" \
  bound_subject="system:serviceaccount:my-namespace:my-ksa" \
  policies="app-policy" \
  ttl="1h"
```

### Verify OIDC Token

```bash
# Get a ServiceAccount token
TOKEN=$(kubectl create token my-ksa --namespace my-namespace --audience vault)

# Decode and inspect (JWT)
echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq .
# {
#   "iss": "https://container.googleapis.com/v1/projects/...",
#   "sub": "system:serviceaccount:my-namespace:my-ksa",
#   "aud": ["vault"],
#   "exp": 1714567890
# }
```

## Common Issues

**"OIDC issuer URL not found" after enabling**

Propagation can take a few minutes. Retry after 5 minutes. Also ensure you're querying the correct cluster.

**"token audience mismatch" when federating**

The `--audience` in `kubectl create token` must match the `bound_audiences` in the external system (Vault, AWS).

**Workload Identity not injecting credentials**

Pod must use the annotated ServiceAccount AND the node pool must have Workload Identity enabled: `gcloud container node-pools update --workload-metadata=GKE_METADATA`.

## Best Practices

- **Enable Workload Identity on all GKE clusters** — eliminates static service account keys
- **Least-privilege GSA bindings** — one GSA per application, minimal IAM roles
- **Use `kubectl create token --audience`** — scoped tokens for each external service
- **Rotate nothing** — OIDC federation uses short-lived tokens, no rotation needed
- **Audit federation bindings** — review which KSAs can assume which external roles

## Key Takeaways

- `--enable-oidc-issuer` exposes a public OIDC discovery endpoint for your GKE cluster
- Workload Identity federates GKE ServiceAccounts → Google Cloud IAM without keys
- Cross-cloud federation (GKE → AWS/Azure) uses the OIDC issuer as an identity provider
- Vault, SPIFFE, and other systems can verify GKE pod identity via OIDC tokens
- Short-lived tokens eliminate credential rotation — the protocol handles it
