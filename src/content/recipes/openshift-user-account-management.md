---
title: "OpenShift User Account Management"
description: "Manage user accounts in OpenShift: create users, assign roles, configure identity providers, manage groups, and implement RBAC for multi-tenant clusters."
tags:
  - "openshift"
  - "user-management"
  - "rbac"
  - "identity-provider"
  - "authentication"
category: "security"
publishDate: "2026-05-07"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-rbac-role-clusterrole"
  - "kubernetes-serviceaccount-guide"
  - "openshift-scc-security-context-constraints"
  - "kyverno-rebac-multi-tenant-rbac"
---

> 💡 **Quick Answer:** OpenShift user accounts are managed through Identity Providers (LDAP, HTPasswd, OIDC, GitHub) configured in the OAuth CR. Users authenticate via IdP, get mapped to OpenShift User objects, and receive permissions through RoleBindings to ClusterRoles.

## The Problem

You need to:

- Onboard users/teams to an OpenShift cluster
- Control who can access which namespaces/projects
- Integrate with corporate LDAP/Active Directory or SSO
- Manage user lifecycle (create, disable, remove)
- Implement least-privilege access across teams

## The Solution

### Identity Provider Configuration (OAuth CR)

```yaml
apiVersion: config.openshift.io/v1
kind: OAuth
metadata:
  name: cluster
spec:
  identityProviders:
    # HTPasswd (simple, good for small teams/testing)
    - name: local-users
      type: HTPasswd
      mappingMethod: claim
      htpasswd:
        fileData:
          name: htpasswd-secret

    # LDAP (Active Directory)
    - name: corporate-ldap
      type: LDAP
      mappingMethod: claim
      ldap:
        url: "ldaps://ldap.example.com:636/ou=Users,dc=example,dc=com?uid"
        insecure: false
        ca:
          name: ldap-ca-configmap
        bindDN: "cn=openshift,ou=ServiceAccounts,dc=example,dc=com"
        bindPassword:
          name: ldap-bind-password
        attributes:
          id: ["dn"]
          email: ["mail"]
          name: ["cn"]
          preferredUsername: ["uid"]

    # OpenID Connect (Keycloak, Azure AD, Okta)
    - name: corporate-sso
      type: OpenID
      mappingMethod: claim
      openID:
        clientID: openshift-cluster
        clientSecret:
          name: oidc-client-secret
        issuer: https://keycloak.example.com/realms/openshift
        claims:
          preferredUsername: ["preferred_username"]
          name: ["name"]
          email: ["email"]
          groups: ["groups"]
```

### HTPasswd User Management

```bash
# Create htpasswd file
htpasswd -c -B -b users.htpasswd admin 'SecureP@ss123'
htpasswd -B -b users.htpasswd developer 'DevP@ss456'
htpasswd -B -b users.htpasswd viewer 'ViewP@ss789'

# Create or update the secret
oc create secret generic htpasswd-secret \
  --from-file=htpasswd=users.htpasswd \
  -n openshift-config --dry-run=client -o yaml | oc apply -f -

# Add a new user
htpasswd -B -b users.htpasswd newuser 'NewP@ss000'
oc create secret generic htpasswd-secret \
  --from-file=htpasswd=users.htpasswd \
  -n openshift-config --dry-run=client -o yaml | oc apply -f -

# Remove a user
htpasswd -D users.htpasswd olduser
oc create secret generic htpasswd-secret \
  --from-file=htpasswd=users.htpasswd \
  -n openshift-config --dry-run=client -o yaml | oc apply -f -

# Also clean up the User and Identity objects
oc delete user olduser
oc delete identity local-users:olduser
```

### Assign Roles to Users

```bash
# Cluster-wide roles
oc adm policy add-cluster-role-to-user cluster-admin admin
oc adm policy add-cluster-role-to-user cluster-reader monitoring-user

# Project/namespace roles
oc adm policy add-role-to-user admin developer -n my-project
oc adm policy add-role-to-user edit developer -n staging
oc adm policy add-role-to-user view viewer -n production

# Remove roles
oc adm policy remove-role-from-user admin developer -n my-project
oc adm policy remove-cluster-role-from-user cluster-admin oldadmin
```

### Group Management

```yaml
# Create a Group
apiVersion: user.openshift.io/v1
kind: Group
metadata:
  name: platform-team
users:
  - admin
  - sre-engineer
  - platform-dev
---
apiVersion: user.openshift.io/v1
kind: Group
metadata:
  name: ml-team
users:
  - data-scientist
  - ml-engineer
  - gpu-user
```

```bash
# Create group via CLI
oc adm groups new platform-team admin sre-engineer platform-dev
oc adm groups new ml-team data-scientist ml-engineer

# Add user to existing group
oc adm groups add-users ml-team new-researcher

# Remove user from group
oc adm groups remove-users ml-team departed-user

# Assign role to entire group
oc adm policy add-role-to-group edit ml-team -n ml-workloads
oc adm policy add-cluster-role-to-group self-provisioner platform-team
```

### LDAP Group Sync

```yaml
# ldap-sync-config.yaml
kind: LDAPSyncConfig
apiVersion: v1
url: "ldaps://ldap.example.com:636"
insecure: false
ca: /etc/ldap-ca/ca.crt
bindDN: "cn=openshift,ou=ServiceAccounts,dc=example,dc=com"
bindPassword:
  file: /etc/ldap-bind/password
augmentedActiveDirectory:
  groupsQuery:
    baseDN: "ou=Groups,dc=example,dc=com"
    scope: sub
    derefAliases: never
    filter: (objectClass=group)
  groupUIDAttribute: dn
  groupNameAttributes: ["cn"]
  usersQuery:
    baseDN: "ou=Users,dc=example,dc=com"
    scope: sub
    derefAliases: never
  userNameAttributes: ["sAMAccountName"]
  groupMembershipAttributes: ["memberOf"]
```

```bash
# Sync LDAP groups to OpenShift
oc adm groups sync --sync-config=ldap-sync-config.yaml --confirm

# Dry run (preview changes)
oc adm groups sync --sync-config=ldap-sync-config.yaml

# Prune groups that no longer exist in LDAP
oc adm groups prune --sync-config=ldap-sync-config.yaml --confirm

# Schedule via CronJob for continuous sync
oc create cronjob ldap-sync \
  --image=registry.example.com/openshift-tools:latest \
  --schedule="*/30 * * * *" \
  -- /bin/sh -c "oc adm groups sync --sync-config=/config/sync.yaml --confirm"
```

### User Account Audit

```bash
# List all users
oc get users

# List users with their identities
oc get users -o custom-columns='NAME:.metadata.name,IDENTITIES:.identities'

# List all role bindings for a user
oc get rolebindings,clusterrolebindings --all-namespaces \
  -o json | jq -r '
  .items[] |
  select(.subjects[]? | .name == "developer" and .kind == "User") |
  "\(.metadata.namespace // "cluster-wide")/\(.metadata.name) → \(.roleRef.name)"'

# Find inactive users (no API calls in 30 days)
oc get users -o json | jq -r '.items[] | .metadata.name' | while read user; do
  LAST=$(oc get events --field-selector involvedObject.name="$user" \
    --sort-by='.lastTimestamp' -o json 2>/dev/null | \
    jq -r '.items[-1].lastTimestamp // "never"')
  echo "$user: last active $LAST"
done

# List who has cluster-admin
oc get clusterrolebindings -o json | jq -r '
  .items[] |
  select(.roleRef.name == "cluster-admin") |
  .subjects[] |
  "\(.kind): \(.name)"'
```

### Disable/Remove User Access

```bash
# Step 1: Remove from identity provider (htpasswd example)
htpasswd -D users.htpasswd departed-user
oc create secret generic htpasswd-secret \
  --from-file=htpasswd=users.htpasswd \
  -n openshift-config --dry-run=client -o yaml | oc apply -f -

# Step 2: Remove all role bindings
oc get rolebindings --all-namespaces -o json | jq -r "
  .items[] |
  select(.subjects[]? | .name == \"departed-user\") |
  \"oc delete rolebinding \(.metadata.name) -n \(.metadata.namespace)\"" | sh

# Step 3: Delete user and identity objects
oc delete user departed-user
oc delete identity "local-users:departed-user"

# Step 4: Revoke active OAuth tokens
oc get oauthaccesstokens --field-selector userName=departed-user -o name | \
  xargs oc delete
```

### Project Self-Provisioning Control

```bash
# Allow specific group to create projects
oc adm policy add-cluster-role-to-group self-provisioner platform-team

# Remove self-provisioner from all authenticated users (restrict project creation)
oc adm policy remove-cluster-role-from-group self-provisioner \
  system:authenticated:oauth

# Set project template (enforce labels, quotas on new projects)
oc create -f project-template.yaml -n openshift-config
oc edit projects.config.openshift.io cluster
# spec:
#   projectRequestTemplate:
#     name: project-template
```

## Common Issues

### User can authenticate but gets "forbidden"
- **Cause**: No RoleBinding grants access to any project
- **Fix**: Add role to user for at least one namespace

### LDAP sync creates duplicate users
- **Cause**: `mappingMethod: add` creates new identities per login
- **Fix**: Use `mappingMethod: claim` (1:1 mapping)

### OAuth pods crash after IdP change
- **Cause**: Invalid IdP config (bad CA, wrong URL)
- **Fix**: Check `oc logs -n openshift-authentication`; revert OAuth CR

### Removed user can still access cluster
- **Cause**: OAuth token still valid (tokens last 24h by default)
- **Fix**: Delete `oauthaccesstokens` for the user; or wait for token expiry

## Best Practices

1. **Never use HTPasswd in production** — use LDAP or OIDC for real environments
2. **Group-based RBAC** — assign roles to groups, not individual users
3. **LDAP sync on schedule** — CronJob every 30 minutes keeps groups current
4. **Audit cluster-admin regularly** — minimize privileged accounts
5. **Offboarding checklist** — remove IdP entry + role bindings + user object + tokens
6. **Project templates** — enforce quotas/labels on every new project

## Key Takeaways

- Users authenticate via Identity Providers (OAuth CR configuration)
- HTPasswd for dev/test; LDAP or OIDC for production
- Groups + RoleBindings = scalable RBAC (don't bind per-user)
- LDAP group sync automates group membership from corporate directory
- Offboarding requires 4 steps: IdP removal, role cleanup, user/identity deletion, token revocation
- Self-provisioner role controls who can create new projects
- `mappingMethod: claim` prevents duplicate identity issues
