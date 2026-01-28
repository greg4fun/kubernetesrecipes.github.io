---
title: "How to Integrate HashiCorp Vault with Kubernetes"
description: "Securely manage secrets with HashiCorp Vault in Kubernetes. Learn to inject secrets into pods using the Vault Agent Injector and CSI Provider."
category: "security"
difficulty: "advanced"
timeToComplete: "40 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured with cluster-admin privileges"
  - "Helm 3 installed"
  - "HashiCorp Vault (can be deployed in cluster)"
relatedRecipes:
  - "external-secrets-operator"
  - "sealed-secrets-gitops"
  - "secrets-management-best-practices"
tags:
  - vault
  - secrets
  - security
  - hashicorp
  - secret-injection
  - csi
publishDate: "2026-01-28"
author: "Luca Berton"
---

## The Problem

Kubernetes Secrets are base64-encoded (not encrypted at rest by default) and difficult to manage at scale. You need centralized secret management with audit logging, dynamic secrets, and fine-grained access control.

## The Solution

Integrate HashiCorp Vault with Kubernetes to provide secure secret storage, dynamic secret generation, and automatic secret injection into pods.

## Vault Integration Methods

```
Vault-Kubernetes Integration Options:

┌─────────────────────────────────────────────────────────────────┐
│  METHOD 1: VAULT AGENT INJECTOR (Sidecar)                       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pod                                                      │   │
│  │  ┌─────────────┐    ┌─────────────────────────────────┐  │   │
│  │  │ Application │◄───│ Vault Agent (sidecar)           │  │   │
│  │  │             │    │ - Authenticates with Vault      │  │   │
│  │  │ /vault/     │    │ - Renders secrets to files     │  │   │
│  │  │ secrets/    │    │ - Auto-renews tokens           │  │   │
│  │  └─────────────┘    └─────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  METHOD 2: VAULT CSI PROVIDER                                    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pod                                                      │   │
│  │  ┌─────────────┐                                         │   │
│  │  │ Application │                                         │   │
│  │  │             │◄─── CSI Volume (secrets as files)      │   │
│  │  │ /mnt/secrets│                                         │   │
│  │  └─────────────┘                                         │   │
│  │         ▲                                                 │   │
│  │         │ CSI Driver                                      │   │
│  │  ┌──────┴───────┐                                        │   │
│  │  │ Vault CSI    │◄──── Vault Server                      │   │
│  │  │ Provider     │                                        │   │
│  │  └──────────────┘                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Deploy Vault in Kubernetes

### Install Vault with Helm

```bash
# Add HashiCorp Helm repo
helm repo add hashicorp https://helm.releases.hashicorp.com
helm repo update

# Install Vault in dev mode (for testing)
helm install vault hashicorp/vault \
  --namespace vault \
  --create-namespace \
  --set "server.dev.enabled=true" \
  --set "injector.enabled=true" \
  --set "csi.enabled=true"

# For production, use HA mode:
# helm install vault hashicorp/vault \
#   --namespace vault \
#   --set "server.ha.enabled=true" \
#   --set "server.ha.replicas=3"
```

### Verify Installation

```bash
# Check Vault pods
kubectl get pods -n vault

# Check Vault status
kubectl exec -n vault vault-0 -- vault status
```

## Step 2: Configure Kubernetes Authentication

### Enable Kubernetes Auth Method

```bash
# Exec into Vault pod
kubectl exec -it -n vault vault-0 -- /bin/sh

# Enable Kubernetes auth
vault auth enable kubernetes

# Configure Kubernetes auth
vault write auth/kubernetes/config \
  kubernetes_host="https://$KUBERNETES_PORT_443_TCP_ADDR:443"

# Exit the pod
exit
```

### Create a Policy

```bash
kubectl exec -it -n vault vault-0 -- /bin/sh

# Create a policy for the application
vault policy write myapp-policy - <<EOF
path "secret/data/myapp/*" {
  capabilities = ["read"]
}
path "database/creds/myapp-db" {
  capabilities = ["read"]
}
EOF

exit
```

### Create a Kubernetes Auth Role

```bash
kubectl exec -it -n vault vault-0 -- /bin/sh

# Create role that maps Kubernetes service account to Vault policy
vault write auth/kubernetes/role/myapp \
  bound_service_account_names=myapp-sa \
  bound_service_account_namespaces=production \
  policies=myapp-policy \
  ttl=1h

exit
```

## Step 3: Store Secrets in Vault

```bash
kubectl exec -it -n vault vault-0 -- /bin/sh

# Enable KV secrets engine
vault secrets enable -path=secret kv-v2

# Store secrets
vault kv put secret/myapp/config \
  database_url="postgresql://db.example.com:5432/myapp" \
  api_key="sk-1234567890abcdef" \
  jwt_secret="super-secret-jwt-key"

# Verify
vault kv get secret/myapp/config

exit
```

## Step 4: Vault Agent Injector Method

### Create Service Account

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
  namespace: production
```

### Deploy Application with Vault Annotations

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
      annotations:
        # Enable Vault Agent Injector
        vault.hashicorp.com/agent-inject: "true"
        vault.hashicorp.com/role: "myapp"
        
        # Inject secrets from path
        vault.hashicorp.com/agent-inject-secret-config: "secret/data/myapp/config"
        
        # Template the secret file
        vault.hashicorp.com/agent-inject-template-config: |
          {{- with secret "secret/data/myapp/config" -}}
          DATABASE_URL={{ .Data.data.database_url }}
          API_KEY={{ .Data.data.api_key }}
          JWT_SECRET={{ .Data.data.jwt_secret }}
          {{- end }}
    spec:
      serviceAccountName: myapp-sa
      containers:
        - name: app
          image: myapp:1.0
          command: ["sh", "-c", "source /vault/secrets/config && exec ./myapp"]
          # Or read from file
          env:
            - name: CONFIG_FILE
              value: "/vault/secrets/config"
```

### Advanced Injection Options

```yaml
metadata:
  annotations:
    # Basic injection
    vault.hashicorp.com/agent-inject: "true"
    vault.hashicorp.com/role: "myapp"
    
    # Multiple secrets
    vault.hashicorp.com/agent-inject-secret-db: "secret/data/myapp/database"
    vault.hashicorp.com/agent-inject-secret-api: "secret/data/myapp/api-keys"
    
    # Custom file permissions
    vault.hashicorp.com/agent-inject-perms-db: "0400"
    
    # JSON format output
    vault.hashicorp.com/agent-inject-template-db: |
      {{- with secret "secret/data/myapp/database" -}}
      {
        "host": "{{ .Data.data.host }}",
        "port": {{ .Data.data.port }},
        "username": "{{ .Data.data.username }}",
        "password": "{{ .Data.data.password }}"
      }
      {{- end }}
    
    # Run as init container only (no sidecar)
    vault.hashicorp.com/agent-pre-populate-only: "true"
    
    # Custom agent resource limits
    vault.hashicorp.com/agent-limits-cpu: "250m"
    vault.hashicorp.com/agent-limits-mem: "128Mi"
    vault.hashicorp.com/agent-requests-cpu: "50m"
    vault.hashicorp.com/agent-requests-mem: "64Mi"
```

## Step 5: Vault CSI Provider Method

### Install Secrets Store CSI Driver

```bash
# Install CSI driver
helm install csi-secrets-store secrets-store-csi-driver/secrets-store-csi-driver \
  --namespace kube-system \
  --set syncSecret.enabled=true \
  --set enableSecretRotation=true
```

### Create SecretProviderClass

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: vault-myapp-secrets
  namespace: production
spec:
  provider: vault
  parameters:
    vaultAddress: "http://vault.vault.svc.cluster.local:8200"
    roleName: "myapp"
    objects: |
      - objectName: "database-url"
        secretPath: "secret/data/myapp/config"
        secretKey: "database_url"
      - objectName: "api-key"
        secretPath: "secret/data/myapp/config"
        secretKey: "api_key"
      - objectName: "jwt-secret"
        secretPath: "secret/data/myapp/config"
        secretKey: "jwt_secret"
  # Optionally sync to Kubernetes Secret
  secretObjects:
    - secretName: myapp-secrets
      type: Opaque
      data:
        - objectName: database-url
          key: DATABASE_URL
        - objectName: api-key
          key: API_KEY
```

### Use CSI Volume in Pod

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-csi
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp-csi
  template:
    metadata:
      labels:
        app: myapp-csi
    spec:
      serviceAccountName: myapp-sa
      containers:
        - name: app
          image: myapp:1.0
          volumeMounts:
            - name: secrets
              mountPath: "/mnt/secrets"
              readOnly: true
          env:
            # From synced Kubernetes Secret
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: myapp-secrets
                  key: DATABASE_URL
      volumes:
        - name: secrets
          csi:
            driver: secrets-store.csi.k8s.io
            readOnly: true
            volumeAttributes:
              secretProviderClass: vault-myapp-secrets
```

## Step 6: Dynamic Database Credentials

### Enable Database Secrets Engine

```bash
kubectl exec -it -n vault vault-0 -- /bin/sh

# Enable database secrets engine
vault secrets enable database

# Configure PostgreSQL connection
vault write database/config/myapp-postgres \
  plugin_name=postgresql-database-plugin \
  allowed_roles="myapp-db" \
  connection_url="postgresql://{{username}}:{{password}}@postgres.database.svc.cluster.local:5432/myapp?sslmode=disable" \
  username="vault_admin" \
  password="admin_password"

# Create role for dynamic credentials
vault write database/roles/myapp-db \
  db_name=myapp-postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
  default_ttl="1h" \
  max_ttl="24h"

exit
```

### Use Dynamic Credentials

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-dynamic-db
  namespace: production
spec:
  template:
    metadata:
      annotations:
        vault.hashicorp.com/agent-inject: "true"
        vault.hashicorp.com/role: "myapp"
        vault.hashicorp.com/agent-inject-secret-db-creds: "database/creds/myapp-db"
        vault.hashicorp.com/agent-inject-template-db-creds: |
          {{- with secret "database/creds/myapp-db" -}}
          export DB_USERNAME="{{ .Data.username }}"
          export DB_PASSWORD="{{ .Data.password }}"
          {{- end }}
    spec:
      serviceAccountName: myapp-sa
      containers:
        - name: app
          image: myapp:1.0
          command:
            - sh
            - -c
            - |
              source /vault/secrets/db-creds
              exec ./myapp --db-user=$DB_USERNAME --db-pass=$DB_PASSWORD
```

## Step 7: PKI - Dynamic TLS Certificates

### Enable PKI Secrets Engine

```bash
kubectl exec -it -n vault vault-0 -- /bin/sh

# Enable PKI engine
vault secrets enable pki
vault secrets tune -max-lease-ttl=87600h pki

# Generate root CA
vault write -field=certificate pki/root/generate/internal \
  common_name="example.com" \
  ttl=87600h > /tmp/CA_cert.crt

# Configure issuing certificates
vault write pki/config/urls \
  issuing_certificates="http://vault.vault.svc.cluster.local:8200/v1/pki/ca" \
  crl_distribution_points="http://vault.vault.svc.cluster.local:8200/v1/pki/crl"

# Enable intermediate CA
vault secrets enable -path=pki_int pki
vault secrets tune -max-lease-ttl=43800h pki_int

# Create role for issuing certs
vault write pki_int/roles/myapp-dot-com \
  allowed_domains="myapp.example.com,myapp.production.svc.cluster.local" \
  allow_subdomains=true \
  max_ttl="720h"

exit
```

### Request TLS Certificate

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-tls
  namespace: production
spec:
  template:
    metadata:
      annotations:
        vault.hashicorp.com/agent-inject: "true"
        vault.hashicorp.com/role: "myapp"
        vault.hashicorp.com/agent-inject-secret-tls: "pki_int/issue/myapp-dot-com"
        vault.hashicorp.com/agent-inject-template-tls: |
          {{- with secret "pki_int/issue/myapp-dot-com" "common_name=myapp.example.com" -}}
          {{ .Data.certificate }}
          {{ .Data.ca_chain }}
          {{- end }}
        vault.hashicorp.com/agent-inject-secret-tls-key: "pki_int/issue/myapp-dot-com"
        vault.hashicorp.com/agent-inject-template-tls-key: |
          {{- with secret "pki_int/issue/myapp-dot-com" "common_name=myapp.example.com" -}}
          {{ .Data.private_key }}
          {{- end }}
    spec:
      serviceAccountName: myapp-sa
      containers:
        - name: app
          image: nginx:1.25
          volumeMounts:
            - name: tls
              mountPath: /etc/nginx/ssl
          ports:
            - containerPort: 443
```

## Verification Commands

```bash
# Check Vault Agent sidecar logs
kubectl logs -n production -l app=myapp -c vault-agent

# Verify secrets were injected
kubectl exec -n production deploy/myapp -c app -- cat /vault/secrets/config

# Check Vault authentication
kubectl exec -n vault vault-0 -- vault read auth/kubernetes/role/myapp

# List active leases (dynamic secrets)
kubectl exec -n vault vault-0 -- vault list sys/leases/lookup/database/creds/myapp-db
```

## Troubleshooting

### Common Issues

```bash
# Issue: "permission denied" in Vault Agent
# Check: Service account and namespace match role
kubectl exec -n vault vault-0 -- vault read auth/kubernetes/role/myapp

# Issue: Agent not injecting
# Check: Mutating webhook
kubectl get mutatingwebhookconfigurations | grep vault

# Issue: Authentication failures
# Check: Kubernetes auth config
kubectl exec -n vault vault-0 -- vault read auth/kubernetes/config

# Debug agent injection
kubectl logs -n production <pod> -c vault-agent-init
kubectl logs -n production <pod> -c vault-agent
```

### Enable Debug Logging

```yaml
metadata:
  annotations:
    vault.hashicorp.com/agent-inject: "true"
    vault.hashicorp.com/log-level: "debug"
```

## Best Practices

1. **Use Dynamic Secrets**: Generate short-lived credentials instead of static secrets
2. **Least Privilege**: Create narrow Vault policies for each application
3. **Rotate Root Tokens**: Never use root token in production
4. **Enable Audit Logging**: Track all secret access
5. **Use Namespaces**: Vault namespaces for multi-tenant isolation
6. **Auto-Unseal**: Use cloud KMS for automatic unsealing

## Summary

HashiCorp Vault provides enterprise-grade secret management for Kubernetes. Use the Agent Injector for sidecar-based injection or CSI Provider for volume-based secrets. Dynamic secrets and PKI certificates provide superior security compared to static Kubernetes Secrets.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
