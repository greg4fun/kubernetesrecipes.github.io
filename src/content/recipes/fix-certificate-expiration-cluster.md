---
title: "Fix Expired Certificates in Kubernetes"
description: "Renew expired certificates causing API server failures and kubelet disconnections. Manual and automatic renewal for kubeadm and OpenShift."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - certificates
  - tls
  - expiration
  - kubeadm
  - security
relatedRecipes:
  - "debug-crashloopbackoff"
  - "node-not-ready-troubleshooting"
  - "etcd-performance-troubleshooting"
  - "openshift-oauth-login-failures"
---
> 💡 **Quick Answer:** For kubeadm clusters: `kubeadm certs renew all && systemctl restart kubelet`. For OpenShift: certificates auto-rotate — if they haven't, check the `kube-controller-manager` and `openshift-kube-apiserver` pods for errors. Always check expiry with `kubeadm certs check-expiration` or `openssl x509 -noout -dates`.

## The Problem

Cluster components stop communicating. The API server rejects requests with TLS errors, kubelets show NotReady, etcd members can't sync, and `kubectl` commands fail with `x509: certificate has expired`. Kubernetes certificates are typically valid for 1 year and must be renewed before expiration.

## The Solution

### Check Certificate Expiration

**kubeadm clusters:**
```bash
kubeadm certs check-expiration
# CERTIFICATE                EXPIRES                  RESIDUAL TIME
# admin.conf                 Mar 19, 2027 00:00 UTC   364d
# apiserver                  Mar 19, 2027 00:00 UTC   364d
# apiserver-kubelet-client   Mar 19, 2026 00:00 UTC   EXPIRED!  ← Problem
```

**OpenShift:**
```bash
# Check API server certificate
oc get secret -n openshift-kube-apiserver -o json |   jq -r '.items[] | select(.type=="kubernetes.io/tls") | .metadata.name'

# Check specific cert
oc get secret kube-apiserver-cert -n openshift-kube-apiserver -o jsonpath='{.data.tls\.crt}' |   base64 -d | openssl x509 -noout -dates
```

**Any cluster — check from node:**
```bash
# Check kubelet client cert
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates -subject
# notBefore=Mar 19, 2025
# notAfter=Mar 19, 2026  ← Check this date

# Check all certs in the PKI directory
for cert in /etc/kubernetes/pki/*.crt; do
  echo "=== $cert ==="
  openssl x509 -in "$cert" -noout -dates -subject 2>/dev/null
done
```

### Renew Certificates (kubeadm)

```bash
# Renew all certificates
sudo kubeadm certs renew all

# Restart control plane components to pick up new certs
sudo systemctl restart kubelet

# If using static pods (default kubeadm):
# Moving manifests out and back forces restart
sudo mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/
sleep 10
sudo mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/

# Update kubeconfig for admin access
sudo cp /etc/kubernetes/admin.conf ~/.kube/config
```

### OpenShift Certificate Rotation

OpenShift auto-rotates most certificates. If rotation failed:

```bash
# Check certificate signing requests
oc get csr
# If you see Pending CSRs, approve them:
oc get csr -o name | xargs oc adm certificate approve

# Force kube-apiserver rollout
oc patch kubeapiserver cluster --type=merge -p '{"spec":{"forceRedeploymentReason":"cert-renewal-'$(date +%s)'"}}'
```

## Common Issues

### kubectl Fails After Certificate Renewal

Update your kubeconfig:
```bash
# kubeadm
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config

# Or regenerate
kubeadm kubeconfig user --client-name=admin --org=system:masters > ~/.kube/config
```

### etcd Certificates Expired Separately

```bash
# Check etcd certs
openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -dates

# Renew etcd certs specifically
kubeadm certs renew etcd-server
kubeadm certs renew etcd-peer
kubeadm certs renew etcd-healthcheck-client
```

## Best Practices

- **Set calendar reminders** 30 days before certificate expiration
- **Enable auto-rotation** — kubelet certificate rotation is on by default in modern K8s
- **Monitor cert expiry with Prometheus** — use `x509_cert_not_after` metric
- **Test renewal in staging** before production
- **Keep a backup of the PKI directory** — `tar czf pki-backup.tar.gz /etc/kubernetes/pki/`

## Key Takeaways

- Kubernetes certificates expire after 1 year (default) — plan renewal
- `kubeadm certs check-expiration` shows all cert dates at a glance
- OpenShift auto-rotates certificates — approve pending CSRs if stuck
- Always restart affected components after renewal
- Monitor expiration proactively — don't wait for outages
