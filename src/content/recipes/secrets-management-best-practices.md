---
title: "Kubernetes Secrets Management Best Practices"
description: "Kubernetes Secrets management best practices: create and decode Secrets, encrypt etcd at rest, lock down RBAC, rotate safely, and sync from Vault or AWS."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
author: "Luca Berton"
tags: ["secrets", "security", "encryption", "best-practices", "management", "external-secrets", "vault", "sealed-secrets", "rbac", "base64"]
relatedRecipes:
  - "external-secrets-operator"
  - "secrets-encryption-kms"
  - "kubernetes-sealed-secrets-management"
  - "kubernetes-secret-types-guide"
  - "kubernetes-enterprise-secret-rotation"
  - "kubernetes-rbac-least-privilege"
  - "configmap-secrets-management"
  - "helm-secrets-sops-management"
  - "decode-docker-registry-secrets"
  - "kubernetes-security-checklist-2026"
  - "custom-ca-openshift"
  - "kubernetes-admission-webhooks-guide"
  - "kubernetes-gvisor-kata-containers-runtimeclass"
---

> **💡 Quick Answer:** Kubernetes Secrets are base64-encoded, **not encrypted**, by default — anyone with `get secrets` RBAC (or etcd access) can read them. For production: (1) enable encryption at rest (`EncryptionConfiguration`, ideally KMS v2), (2) restrict `get/list/watch` on secrets with RBAC `resourceNames`, (3) never commit plain Secrets to Git — use External Secrets Operator (Vault/AWS/GCP/Azure) or Sealed Secrets/SOPS, (4) mount Secrets as volumes rather than env vars so rotation propagates without a restart.
>
> **Key command:** `kubectl get secret db-credentials -o jsonpath='{.data.password}' | base64 -d`
>
> **Gotcha:** `list`/`watch` on secrets returns every value in the namespace — granting `list` is effectively granting `get` on all of them.

## Create Secrets

```bash
# Literal values (prefix the command with a space or use --from-file to keep values out of shell history)
kubectl create secret generic db-credentials \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!'

# From files / env file
kubectl create secret generic app-secrets --from-env-file=.env.production
kubectl create secret generic ssh-key --from-file=id_rsa=$HOME/.ssh/id_rsa

# Typed helpers
kubectl create secret tls app-tls --cert=tls.crt --key=tls.key
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=user --docker-password=pass
```

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
stringData:            # plain text, API server base64-encodes it into .data
  username: admin
  password: "S3cur3P@ss!"
# data:                # or pre-encoded: echo -n 'admin' | base64
#   username: YWRtaW4=
```

Common types: `Opaque`, `kubernetes.io/tls`, `kubernetes.io/dockerconfigjson`, `kubernetes.io/basic-auth`, `kubernetes.io/ssh-auth`. See [Secret types](/recipes/security/kubernetes-secret-types-guide/). Max size is **1 MiB** per Secret.

## Read and Decode Secrets

```bash
kubectl get secret db-credentials -o jsonpath='{.data.password}' | base64 -d

# All keys at once
kubectl get secret db-credentials -o json \
  | jq -r '.data | to_entries[] | "\(.key): \(.value | @base64d)"'
```

## Use Secrets in Pods

```yaml
spec:
  serviceAccountName: myapp
  containers:
    - name: app
      image: myapp:v1
      env:
        - name: DATABASE_PASSWORD          # single key
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
      envFrom:
        - secretRef:                       # every key as an env var
            name: app-config
      volumeMounts:
        - name: certs                      # preferred: files, auto-refreshed
          mountPath: /etc/tls
          readOnly: true
  volumes:
    - name: certs
      secret:
        secretName: app-tls
        defaultMode: 0400
  imagePullSecrets:
    - name: regcred
```

| Consumption | Updates when Secret changes? | Leak surface |
|---|---|---|
| `env` / `envFrom` | No — restart required | `/proc/<pid>/environ`, crash dumps, debug output |
| Volume mount | Yes, kubelet sync (~60–90s) | Files on tmpfs, `defaultMode` controls perms |
| Volume with `subPath` | **No** | Same as volume |

## Encrypt Secrets at Rest (etcd)

```yaml
# /etc/kubernetes/enc/encryption-config.yaml (every control-plane node)
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources: ["secrets"]
    providers:
      - kms:                       # preferred: envelope encryption via external KMS
          apiVersion: v2
          name: vault-kms
          endpoint: unix:///var/run/kms-plugin/socket.sock
      - aesgcm:                    # local-key fallback if no KMS
          keys:
            - name: key1
              secret: <base64 of: head -c 32 /dev/urandom>
      - identity: {}               # last: lets the API server read old plaintext data
```

```bash
# kube-apiserver flag:
#   --encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml
# After restart, rewrite every Secret so it's stored with the first provider:
kubectl get secrets -A -o json | kubectl replace -f -
```

The first provider encrypts new writes; the rest are only used for reads. `aescbc` still works but upstream no longer recommends it (padding-oracle weakness) — prefer KMS v2, or `aesgcm`/`secretbox` with regular key rotation. Managed clusters (EKS/GKE/AKS) and OpenShift expose this as a cluster setting instead of a file: see [Secrets encryption with KMS](/recipes/security/secrets-encryption-kms/).

## RBAC: Restrict Who Reads Secrets

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: secret-reader
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["app-config", "db-credentials"]   # named Secrets only
    verbs: ["get"]                                    # no list/watch
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-secret-reader
  namespace: production
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: secret-reader
subjects:
  - kind: ServiceAccount
    name: myapp
    namespace: production
```

Give developers a role covering `pods`, `services`, `configmaps`, etc. and simply omit `secrets`. Remember that anyone who can **create pods** in a namespace can mount any Secret in it, so pod-create is also a secret-read permission.

```bash
kubectl auth can-i list secrets -n production --as=system:serviceaccount:production:myapp
```

## Keep Secrets Out of Git

### External Secrets Operator (source of truth in Vault/AWS/GCP/Azure)

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace
```

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: db-credentials
  namespace: production
spec:
  refreshInterval: 1h                 # re-sync = automatic rotation
  secretStoreRef:
    name: vault-backend               # SecretStore / ClusterSecretStore
    kind: ClusterSecretStore
  target:
    name: db-credentials              # native Secret ESO creates
    creationPolicy: Owner
  data:
    - secretKey: password
      remoteRef:
        key: prod/db                  # Vault KV v2 path (without /data/)
        property: password
```

Full provider setup (Vault Kubernetes auth, AWS IRSA, GCP Workload Identity, PushSecret): [External Secrets Operator](/recipes/security/external-secrets-operator/). On OpenShift use the Red Hat-supported operator: [ESO on OpenShift](/recipes/security/external-secrets-operator-openshift/).

### Sealed Secrets (encrypted manifests in Git)

```bash
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm install sealed-secrets sealed-secrets/sealed-secrets -n kube-system

kubectl create secret generic db-creds -n production \
  --from-literal=password=supersecret --dry-run=client -o yaml \
  | kubeseal --format yaml > sealed-db-creds.yaml   # safe to commit
```

Sealed Secrets are bound to name + namespace by default (`--scope strict`); back up the controller's sealing key or you cannot decrypt after a cluster rebuild. Details: [Sealed Secrets](/recipes/security/kubernetes-sealed-secrets-management/). For Helm-centric repos, [SOPS + helm-secrets](/recipes/helm/helm-secrets-sops-management/) is the alternative.

### Secrets Store CSI Driver (never create a K8s Secret)

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: aws-secrets
spec:
  provider: aws
  parameters:
    objects: |
      - objectName: "prod/db-credentials"
        objectType: "secretsmanager"
---
# in the pod spec
volumes:
  - name: secrets
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: aws-secrets
```

The value is fetched at mount time straight into the pod; adding `secretObjects` mirrors it into a K8s Secret (which reintroduces etcd storage).

## Rotation Without Downtime

- **Volume-mounted Secrets** update in place; the app must re-read the file (or use a reloader sidecar).
- **Env var Secrets** need a rollout: `kubectl rollout restart deploy/myapp`, or automate with [Stakater Reloader](https://github.com/stakater/Reloader) (`reloader.stakater.com/auto: "true"`).
- **Versioned Secrets** (`db-credentials-v2`) + updating the Deployment reference gives an auditable, rollback-able rollout.
- **Immutable Secrets** (`immutable: true`) cut API-server watch load and prevent accidental edits — rotate by creating a new name.
- **ESO `refreshInterval`** re-syncs from the vault on a schedule. See [enterprise secret rotation](/recipes/security/kubernetes-enterprise-secret-rotation/).

## Audit Secret Access

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Metadata only: who touched which Secret. Never log Request/RequestResponse
  # for secrets — that writes the secret values into the audit log.
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]
```

## Common Issues

**ExternalSecret not syncing** — `kubectl describe externalsecret <name>` shows `SecretSyncedError`; usually auth (IAM/IRSA role, Vault role binding) or network reachability of the store. Check `kubectl get secretstore -o wide` for `Valid`.

**`secrets is forbidden`** — the pod's ServiceAccount lacks the verb; confirm with `kubectl auth can-i get secret/<name> --as=system:serviceaccount:<ns>:<sa>`.

**SealedSecret not decrypting** — sealed for a different namespace/name, or the controller key was regenerated. Re-seal with the right `-n`, or use `--scope cluster-wide` deliberately.

**Env var still has the old value** — env vars are resolved at container start. Restart the pods or switch to a volume mount (without `subPath`).

## Best Practices Checklist

1. Encryption at rest enabled (KMS v2 where available) and verified in etcd
2. No `list`/`watch` on secrets for humans or workloads that don't need it; `resourceNames` for the rest
3. No plain Secrets in Git — ESO, Sealed Secrets, or SOPS
4. Volume mounts over env vars; `defaultMode: 0400`
5. Rotation automated (ESO `refreshInterval`, Reloader) and tested
6. Audit logging at `Metadata` level for secrets
7. Apps never log secret values; scrub error messages
8. Short-lived credentials (Vault dynamic secrets, projected SA tokens) over static passwords

## Frequently Asked Questions

### Are Kubernetes Secrets encrypted?

Not by default. Secrets are stored base64-encoded in etcd, which is encoding, not encryption. You must configure an `EncryptionConfiguration` on the API server (or enable the managed-cluster equivalent) to encrypt them at rest, and TLS protects them in transit.

### What is the best way to manage secrets in Kubernetes?

Keep the source of truth in a dedicated secret manager (Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) and sync into the cluster with External Secrets Operator, with encryption at rest and tight RBAC on the resulting Secrets. For pure-GitOps teams without a vault, Sealed Secrets or SOPS are the standard choices.

### Should I use environment variables or volume mounts for Secrets?

Prefer volume mounts. They update automatically when the Secret changes and are less likely to leak via process listings, crash dumps or debug endpoints. Env vars are fine for legacy apps but require a pod restart on every rotation.

### What is the size limit for a Kubernetes Secret?

1 MiB per Secret object, the same as a ConfigMap. Larger payloads belong in a volume or external store.

### Secrets vs ConfigMaps — which should I use?

Use Secrets for anything sensitive (passwords, tokens, keys, certificates) so you can encrypt them at rest and scope RBAC separately; use ConfigMaps for non-sensitive configuration. See [ConfigMaps and Secrets](/recipes/configuration/configmap-secrets-management/).

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
