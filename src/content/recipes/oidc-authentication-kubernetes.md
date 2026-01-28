---
title: "OIDC Authentication for Kubernetes"
description: "Configure OpenID Connect (OIDC) authentication to integrate Kubernetes with identity providers like Keycloak, Okta, Azure AD, and Google for secure user access"
category: "security"
difficulty: "advanced"
timeToComplete: "50 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Understanding of Kubernetes RBAC"
  - "Knowledge of OAuth2 and OIDC concepts"
  - "Access to an identity provider"
relatedRecipes:
  - "rbac-service-accounts"
  - "api-access-control"
  - "kubeconfig-contexts"
tags:
  - oidc
  - authentication
  - identity-provider
  - sso
  - security
  - keycloak
publishDate: "2026-01-28"
author: "kubernetes-recipes"
---

## Problem

Managing individual user certificates for Kubernetes access doesn't scale and makes it difficult to implement single sign-on (SSO), enforce password policies, or integrate with corporate identity systems. You need centralized authentication with your existing identity provider.

## Solution

Configure Kubernetes API server to use OpenID Connect (OIDC) for authentication, allowing users to authenticate using their corporate credentials through identity providers like Keycloak, Okta, Azure AD, or Google.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    User / kubectl                    │
└─────────────────────┬───────────────────────────────┘
                      │ 1. Request token
                      ▼
┌─────────────────────────────────────────────────────┐
│           Identity Provider (OIDC)                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │  Keycloak  │  │   Okta     │  │  Azure AD  │   │
│  └────────────┘  └────────────┘  └────────────┘   │
└─────────────────────┬───────────────────────────────┘
                      │ 2. ID Token (JWT)
                      ▼
┌─────────────────────────────────────────────────────┐
│                    kubectl                           │
│           (stores token in kubeconfig)              │
└─────────────────────┬───────────────────────────────┘
                      │ 3. API request + token
                      ▼
┌─────────────────────────────────────────────────────┐
│           Kubernetes API Server                      │
│  ┌────────────────────────────────────────────┐    │
│  │  4. Validate token signature & claims      │    │
│  │  5. Extract user identity & groups         │    │
│  │  6. RBAC authorization                     │    │
│  └────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Step 1: Configure Identity Provider (Keycloak Example)

Create OIDC client in Keycloak:

```bash
# Create realm for Kubernetes
curl -X POST "https://keycloak.example.com/admin/realms" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "realm": "kubernetes",
    "enabled": true,
    "sslRequired": "external"
  }'
```

Create OIDC client configuration:

```json
{
  "clientId": "kubernetes",
  "name": "Kubernetes API",
  "enabled": true,
  "publicClient": false,
  "secret": "kubernetes-client-secret",
  "redirectUris": [
    "http://localhost:8000",
    "http://localhost:18000"
  ],
  "webOrigins": ["*"],
  "protocol": "openid-connect",
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": true,
  "attributes": {
    "access.token.lifespan": "3600",
    "pkce.code.challenge.method": "S256"
  }
}
```

Configure group mapper for Kubernetes:

```json
{
  "name": "groups",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-group-membership-mapper",
  "consentRequired": false,
  "config": {
    "full.path": "false",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "claim.name": "groups",
    "userinfo.token.claim": "true"
  }
}
```

### Step 2: Configure API Server for OIDC

Update kube-apiserver configuration:

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml
apiVersion: v1
kind: Pod
metadata:
  name: kube-apiserver
  namespace: kube-system
spec:
  containers:
  - name: kube-apiserver
    command:
    - kube-apiserver
    # ... other flags ...
    # OIDC Configuration
    - --oidc-issuer-url=https://keycloak.example.com/realms/kubernetes
    - --oidc-client-id=kubernetes
    - --oidc-username-claim=preferred_username
    - --oidc-username-prefix=oidc:
    - --oidc-groups-claim=groups
    - --oidc-groups-prefix=oidc:
    - --oidc-ca-file=/etc/kubernetes/pki/oidc-ca.crt
    # Optional: Required claims
    - --oidc-required-claim=aud=kubernetes
```

For managed Kubernetes (EKS example):

```bash
# Update EKS cluster with OIDC
aws eks update-cluster-config \
  --name my-cluster \
  --identity-provider-config '{
    "oidc": {
      "identityProviderConfigName": "keycloak",
      "issuerUrl": "https://keycloak.example.com/realms/kubernetes",
      "clientId": "kubernetes",
      "usernameClaim": "preferred_username",
      "usernamePrefix": "oidc:",
      "groupsClaim": "groups",
      "groupsPrefix": "oidc:"
    }
  }'
```

### Step 3: Create RBAC for OIDC Users

Bind OIDC groups to Kubernetes roles:

```yaml
# ClusterRoleBinding for admins group
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: oidc-cluster-admins
subjects:
- kind: Group
  name: oidc:cluster-admins  # Matches OIDC group with prefix
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
---
# RoleBinding for developers in production namespace
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: oidc-developers
  namespace: production
subjects:
- kind: Group
  name: oidc:developers
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: edit
  apiGroup: rbac.authorization.k8s.io
---
# RoleBinding for specific user
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: oidc-user-jane
  namespace: development
subjects:
- kind: User
  name: oidc:jane@example.com
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: admin
  apiGroup: rbac.authorization.k8s.io
```

### Step 4: Configure kubectl with OIDC

Install kubelogin (OIDC helper):

```bash
# Install kubelogin
# macOS
brew install int128/kubelogin/kubelogin

# Linux
curl -LO https://github.com/int128/kubelogin/releases/latest/download/kubelogin_linux_amd64.zip
unzip kubelogin_linux_amd64.zip
sudo mv kubelogin /usr/local/bin/kubectl-oidc_login
```

Configure kubeconfig for OIDC:

```yaml
# ~/.kube/config
apiVersion: v1
kind: Config
clusters:
- name: production
  cluster:
    server: https://kubernetes.example.com:6443
    certificate-authority-data: <base64-ca-cert>
contexts:
- name: production
  context:
    cluster: production
    user: oidc-user
    namespace: default
current-context: production
users:
- name: oidc-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: kubectl
      args:
      - oidc-login
      - get-token
      - --oidc-issuer-url=https://keycloak.example.com/realms/kubernetes
      - --oidc-client-id=kubernetes
      - --oidc-client-secret=kubernetes-client-secret
      - --oidc-extra-scope=groups
      - --oidc-extra-scope=email
```

### Step 5: Configure Azure AD Integration

Register application in Azure AD:

```bash
# Create Azure AD application
az ad app create \
  --display-name "Kubernetes Cluster" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "http://localhost:8000"

# Add API permissions
az ad app permission add \
  --id <app-id> \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope

# Get tenant info
az account show --query tenantId -o tsv
```

Configure API server for Azure AD:

```yaml
# API server flags for Azure AD
- --oidc-issuer-url=https://login.microsoftonline.com/<tenant-id>/v2.0
- --oidc-client-id=<application-id>
- --oidc-username-claim=email
- --oidc-groups-claim=groups
```

Kubeconfig for Azure AD:

```yaml
users:
- name: azure-ad-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: kubelogin
      args:
      - get-token
      - --environment
      - AzurePublicCloud
      - --server-id
      - <server-application-id>
      - --client-id
      - <client-application-id>
      - --tenant-id
      - <tenant-id>
```

### Step 6: Configure Okta Integration

Create Okta application:

```bash
# Okta configuration
# 1. Create new OIDC Web Application
# 2. Set redirect URIs: http://localhost:8000
# 3. Enable refresh tokens
# 4. Note client ID and secret
```

API server configuration for Okta:

```yaml
- --oidc-issuer-url=https://your-org.okta.com
- --oidc-client-id=<okta-client-id>
- --oidc-username-claim=email
- --oidc-groups-claim=groups
- --oidc-username-prefix=okta:
- --oidc-groups-prefix=okta:
```

### Step 7: Implement Token Refresh

Configure automatic token refresh:

```yaml
# kubeconfig with refresh token support
users:
- name: oidc-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: kubectl
      args:
      - oidc-login
      - get-token
      - --oidc-issuer-url=https://keycloak.example.com/realms/kubernetes
      - --oidc-client-id=kubernetes
      - --oidc-client-secret=kubernetes-client-secret
      - --grant-type=authcode-keyboard
      - --token-cache-dir=~/.kube/cache/oidc-login
      interactiveMode: IfAvailable
      provideClusterInfo: true
```

### Step 8: Audit OIDC Authentication

Enable audit logging for OIDC events:

```yaml
# audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
# Log authentication events
- level: Metadata
  users: ["system:anonymous"]
  verbs: ["*"]
  resources:
  - group: "authentication.k8s.io"
    resources: ["tokenreviews"]
# Log OIDC user actions at Request level
- level: Request
  userGroups: ["oidc:*"]
  verbs: ["create", "update", "patch", "delete"]
```

## Verification

Test OIDC authentication:

```bash
# Login with OIDC
kubectl oidc-login setup \
  --oidc-issuer-url=https://keycloak.example.com/realms/kubernetes \
  --oidc-client-id=kubernetes \
  --oidc-client-secret=kubernetes-client-secret

# Verify token
kubectl auth whoami

# Check group membership
kubectl auth can-i --list

# Test specific permissions
kubectl auth can-i create deployments -n production
```

Verify API server configuration:

```bash
# Check API server logs for OIDC
kubectl logs -n kube-system kube-apiserver-<node> | grep -i oidc

# Verify OIDC discovery endpoint
curl https://keycloak.example.com/realms/kubernetes/.well-known/openid-configuration

# Validate JWT token
kubectl oidc-login get-token \
  --oidc-issuer-url=https://keycloak.example.com/realms/kubernetes \
  --oidc-client-id=kubernetes | jwt decode -
```

Test RBAC bindings:

```bash
# Impersonate OIDC user
kubectl auth can-i create pods \
  --as=oidc:jane@example.com \
  -n production

# Impersonate OIDC group
kubectl auth can-i delete deployments \
  --as-group=oidc:developers \
  -n production
```

## Best Practices

1. **Use group-based RBAC** instead of individual user bindings
2. **Set appropriate token lifetimes** (1-8 hours recommended)
3. **Enable PKCE** for public clients
4. **Use secure redirect URIs** (localhost for CLI)
5. **Implement token refresh** for better UX
6. **Audit authentication events** for security monitoring
7. **Use username/group prefixes** to distinguish OIDC users
8. **Sync groups from IdP** rather than manual assignment
9. **Test authentication flow** before production rollout
10. **Document login procedures** for users

## Common Issues

**Token validation failures:**
- Verify issuer URL matches exactly
- Check clock skew between API server and IdP
- Ensure CA certificate is correct

**Groups not appearing:**
- Verify groups claim is configured in IdP
- Check groups are included in ID token (not just access token)
- Confirm group mapper is properly configured

**kubectl authentication errors:**
- Clear token cache: `rm -rf ~/.kube/cache/oidc-login`
- Verify kubeconfig exec configuration
- Check client secret is correct

## Related Resources

- [Kubernetes OIDC Authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#openid-connect-tokens)
- [kubelogin Documentation](https://github.com/int128/kubelogin)
- [Keycloak Kubernetes Integration](https://www.keycloak.org/docs/latest/securing_apps/)

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
