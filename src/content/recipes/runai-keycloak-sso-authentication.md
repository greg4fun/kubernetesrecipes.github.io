---
title: "Run:ai Keycloak SSO Authentication Setup"
description: "Configure Run:ai SSO authentication with Keycloak on OpenShift: OIDC integration, user federation, role mapping, and troubleshooting login failures."
tags:
  - "runai"
  - "keycloak"
  - "sso"
  - "authentication"
  - "openshift"
category: "security"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "runai-platform-components-architecture"
  - "runai-backend-architecture-openshift"
  - "kubernetes-serviceaccount-guide"
  - "openshift-oauth-proxy-guide"
  - "openshift-oidc-claims-mapping-troubleshooting"
---

> 💡 **Quick Answer:** Run:ai uses Keycloak for SSO authentication, supporting OIDC/SAML with corporate IdPs. The login page at `https://runai.apps.example.com` redirects to Keycloak, which handles user federation (LDAP/AD), role mapping (admin/researcher/viewer), and token issuance.

## The Problem

You need to:

- Enable SSO for Run:ai so users authenticate via corporate identity provider
- Map IdP groups to Run:ai roles (admin, researcher, viewer)
- Troubleshoot "CONTINUE WITH SSO" login failures
- Configure Keycloak realm and client for Run:ai

## The Solution

### Run:ai Login Flow

```text
User → Run:ai UI (https://runai.apps.example.com)
  → Keycloak Login Page (Email/Password or "CONTINUE WITH SSO")
  → Corporate IdP (SAML/OIDC)
  → Token issued → Redirect back to Run:ai UI
  → API calls with Bearer token
```

### Keycloak Realm Configuration

```yaml
# Run:ai creates a realm called "runai"
realm: runai
enabled: true
sslRequired: external
registrationAllowed: false

clients:
  - clientId: runai-frontend
    protocol: openid-connect
    publicClient: true
    redirectUris:
      - "https://runai.apps.example.com/*"
    webOrigins:
      - "https://runai.apps.example.com"

  - clientId: runai-cli
    protocol: openid-connect
    publicClient: true
    directAccessGrantsEnabled: true  # For CLI token auth
```

### Corporate IdP Integration (OIDC)

```yaml
# Identity Provider configuration in Keycloak
identityProviders:
  - alias: corporate-sso
    providerId: oidc
    enabled: true
    config:
      authorizationUrl: "https://login.corp.example.com/oauth2/authorize"
      tokenUrl: "https://login.corp.example.com/oauth2/token"
      clientId: "runai-keycloak"
      clientSecret: "${CORPORATE_OIDC_SECRET}"
      defaultScope: "openid profile email groups"
      syncMode: IMPORT
```

### Role Mapping

```text
Run:ai roles:
├── Platform Admin     → Full cluster access, manage projects/quotas
├── Department Admin   → Manage specific department resources
├── Researcher         → Submit/view own workloads
├── Viewer             → Read-only access to dashboards
└── ML Engineer        → Submit workloads + view metrics

Keycloak group → Run:ai role mapping:
  cn=gpu-admins,ou=groups → Platform Admin
  cn=ml-team,ou=groups    → Researcher
  cn=viewers,ou=groups    → Viewer
```

### Login Page Assets

```text
Run:ai login page resources (all 200 OK):
├── auth?response_type=code&connection=runai&client...  (document)
├── patternfly.min.css                                   (stylesheet)
├── patternfly-additions.min.css                         (stylesheet)
├── pficon.css                                           (stylesheet)
├── nv-login.css                                         (stylesheet)
├── menu-button-links.js                                 (script)
├── authChecker.js                                       (script)
├── data:image/svg+xml (inline logo)                     (svg+xml)
├── bg-login.jpg                                         (background)
├── nvidia-login-logo.svg                                (logo)
└── Roboto-Regular.ttf                                   (font)

Total: 12 requests, 11.6 kB transferred, 2.1 MB resources
Finish: 134 ms, DOMContentLoaded: 121 ms, Load: 225 ms
```

### Verify Keycloak Health

```bash
# Check Keycloak Pod
oc get pods -n runai-backend -l app=keycloak

# Check Keycloak logs
oc logs -n runai-backend -l app=keycloak --tail=50

# Test Keycloak endpoint
curl -sk https://runai.apps.example.com/auth/realms/runai/.well-known/openid-configuration | jq .issuer

# Check Keycloak admin console
# https://runai.apps.example.com/auth/admin/runai/console
```

### CLI Authentication

```bash
# Login via CLI (uses device code flow)
runai login

# Or with direct credentials
runai login --user researcher@example.com --password <password>

# Check current auth
runai whoami

# Token stored at ~/.runai/config
cat ~/.runai/config | jq .token
```

## Common Issues

### "CONTINUE WITH SSO" button does nothing
- **Cause**: IdP metadata URL unreachable from Keycloak Pod
- **Fix**: Check network policies; verify IdP URL accessible from runai-backend namespace

### Login redirects to blank page
- **Cause**: Redirect URI mismatch in Keycloak client config
- **Fix**: Add exact redirect URI including trailing slash

### Token expired errors in CLI
- **Cause**: Access token TTL too short (default 5min)
- **Fix**: Increase token lifespan in Keycloak realm settings (15-30 min)

### Users can't see their workloads
- **Cause**: Role mapping not applied correctly
- **Fix**: Check Keycloak group membership; verify role binding in Run:ai

## Best Practices

1. **Use SSO exclusively** — disable local admin password after initial setup
2. **Map groups not users** — easier to manage at scale
3. **Set token TTL to 15 min** — balance security vs user experience
4. **Enable MFA in corporate IdP** — Keycloak passes through MFA requirements
5. **Monitor login failures** — Keycloak events log shows failed attempts
6. **Backup Keycloak DB** — realm config is stored in PostgreSQL

## Key Takeaways

- Run:ai login page uses NVIDIA-branded Keycloak theme (PatternFly CSS)
- Two auth methods: local (email/password) and SSO (corporate IdP)
- Keycloak handles OIDC/SAML federation, group sync, and token issuance
- Role mapping: IdP groups → Keycloak groups → Run:ai roles
- CLI uses device code flow or direct access grants
- Login page loads in 225ms (12 requests, 2.1MB) — lightweight
- All auth state lives in PostgreSQL (part of runai-backend)
