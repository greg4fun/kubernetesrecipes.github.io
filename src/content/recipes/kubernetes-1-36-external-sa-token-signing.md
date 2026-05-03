---
title: "Kubernetes 1.36 External SA Token Signing"
description: "Delegate ServiceAccount token signing to external KMS or HSM systems in Kubernetes 1.36. Improve security with hardware-backed key management."
tags:
  - "kubernetes-1.36"
  - "service-accounts"
  - "security"
  - "kms"
  - "tokens"
category: "security"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-oci-volume-source"
  - "kubernetes-1-36-selinux-mount-labeling"
  - "kubernetes-serviceaccount-guide"
  - "kubernetes-rbac-guide"
  - "kubernetes-secret-types-guide"
---

> 💡 **Quick Answer:** Kubernetes 1.36 allows **external signing of ServiceAccount tokens** via KMS or HSM. Token signing keys never leave the hardware security module, eliminating the risk of key extraction from the API server.

## The Problem

By default, Kubernetes stores SA token signing keys on the API server's filesystem:
- Keys are software-based — extractable if the node is compromised
- Key rotation requires API server restart
- No audit trail for key usage
- Doesn't meet compliance requirements (FIPS 140-2 Level 3, PCI-DSS)
- Multi-cluster key management is manual

## The Solution

External SA token signing delegates cryptographic operations to a KMS plugin, keeping private keys in hardware.

### Configure External Token Signing

```yaml
# /etc/kubernetes/kms-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: AuthenticationConfiguration
jwt:
  - issuer:
      url: "https://kubernetes.default.svc"
      audiences: ["api", "vault"]
    signerConfiguration:
      external:
        connectionURL: "unix:///var/run/kms/kms-plugin.sock"
        timeout: 10s
```

### API Server Configuration

```bash
kube-apiserver \
  --authentication-config=/etc/kubernetes/kms-config.yaml \
  --service-account-issuer=https://kubernetes.default.svc \
  --service-account-signing-endpoint=unix:///var/run/kms/kms-plugin.sock
```

### KMS Plugin Deployment

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: kms-plugin
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: kms-plugin
  template:
    metadata:
      labels:
        app: kms-plugin
    spec:
      nodeSelector:
        node-role.kubernetes.io/control-plane: ""
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          effect: NoSchedule
      containers:
        - name: kms-plugin
          image: registry.example.com/kms-plugin:v1.0
          volumeMounts:
            - name: socket
              mountPath: /var/run/kms
            - name: hsm-config
              mountPath: /etc/hsm
              readOnly: true
          env:
            - name: KMS_PROVIDER
              value: "aws-kms"    # or "vault", "azure-kv", "gcp-kms", "pkcs11"
            - name: KMS_KEY_ID
              value: "arn:aws:kms:us-east-1:123456789:key/abcd-1234"
      volumes:
        - name: socket
          hostPath:
            path: /var/run/kms
            type: DirectoryOrCreate
        - name: hsm-config
          secret:
            secretName: hsm-credentials
```

### Verify External Signing

```bash
# Create a token and check the signing
kubectl create token default --duration=1h

# Decode the JWT header to verify KMS key ID
kubectl create token default | cut -d. -f1 | base64 -d | jq .
# Should show: { "alg": "RS256", "kid": "kms://aws-kms/abcd-1234" }

# Check API server logs for KMS usage
kubectl logs -n kube-system kube-apiserver-* | grep "kms-plugin"
```

### Key Rotation with External Signing

```bash
# Rotate keys without API server restart
# 1. Create new key in KMS
aws kms create-key --description "k8s-sa-signing-2026-05"

# 2. Update KMS plugin config to use new key
# 3. KMS plugin automatically serves new key for signing
# 4. Old tokens remain valid until expiry (verification uses key ID from JWT header)
```

## Common Issues

### KMS plugin socket not found
- **Cause**: Plugin not running or socket path mismatch
- **Fix**: Verify DaemonSet is running and socket paths match in both configs

### Token signing timeout
- **Cause**: Network latency to cloud KMS service
- **Fix**: Increase timeout in config; use regional KMS endpoints

### Tokens not accepted after rotation
- **Cause**: API server doesn't have the new public key for verification
- **Fix**: Ensure KMS plugin exposes both old and new public keys during rotation

## Best Practices

1. **Use HSM-backed KMS** for FIPS 140-2 Level 3 compliance
2. **Set reasonable timeouts** — KMS calls add latency to token operations
3. **Monitor KMS plugin health** — token signing failure breaks all SA auth
4. **Implement key rotation** — rotate signing keys quarterly minimum
5. **Use regional KMS** — minimize latency for token signing operations

## Key Takeaways

- External SA token signing is available in **Kubernetes 1.36**
- Signing keys stay in KMS/HSM — never on the API server filesystem
- Supports AWS KMS, HashiCorp Vault, Azure Key Vault, GCP KMS, PKCS#11
- Key rotation without API server restart
- Meets enterprise compliance (FIPS 140-2, PCI-DSS, SOC 2)
