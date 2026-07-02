---
title: "K8s Certificate Rotation and Management"
description: "Manage Kubernetes cluster certificates with kubeadm. Check expiration, renew certificates, configure auto-rotation, and troubleshoot TLS errors."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "advanced"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "certificates"
  - "tls"
  - "security"
  - "administration"
  - "cka"
relatedRecipes:
  - "kubernetes-kubeadm-upgrade-guide"
  - "kubernetes-oidc-authentication-guide"
---

> 💡 **Quick Answer:** Check certificate expiration: `kubeadm certs check-expiration`. Renew all: `kubeadm certs renew all`. Certificates auto-renew during `kubeadm upgrade`. Default expiration: 1 year (CA: 10 years). After renewal, restart control plane components: `crictl` or move static pod manifests.

## The Problem

Kubernetes uses TLS certificates everywhere:

- kube-apiserver, etcd, kubelet communication
- Service account token signing
- Webhook admission controllers
- Default expiration: 1 year — cluster breaks when they expire

## The Solution

### Check Certificate Expiration

```bash
# Check all certificate expirations
kubeadm certs check-expiration
# CERTIFICATE                EXPIRES                  RESIDUAL TIME
# admin.conf                 May 02, 2027 20:00 UTC   364d
# apiserver                  May 02, 2027 20:00 UTC   364d
# apiserver-etcd-client      May 02, 2027 20:00 UTC   364d
# apiserver-kubelet-client   May 02, 2027 20:00 UTC   364d
# controller-manager.conf    May 02, 2027 20:00 UTC   364d
# etcd-healthcheck-client    May 02, 2027 20:00 UTC   364d
# etcd-peer                  May 02, 2027 20:00 UTC   364d
# etcd-server                May 02, 2027 20:00 UTC   364d
# front-proxy-client         May 02, 2027 20:00 UTC   364d
# scheduler.conf             May 02, 2027 20:00 UTC   364d
#
# CERTIFICATE AUTHORITY      EXPIRES                  RESIDUAL TIME
# ca                         Apr 30, 2036 20:00 UTC   3650d
# etcd-ca                    Apr 30, 2036 20:00 UTC   3650d
# front-proxy-ca             Apr 30, 2036 20:00 UTC   3650d

# Check individual certificate
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates
# notBefore=May  2 20:00:00 2026 GMT
# notAfter=May  2 20:00:00 2027 GMT

# Check certificate details
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text | grep -A2 "Subject Alternative"
```

### Renew Certificates

```bash
# Renew all certificates
kubeadm certs renew all

# Renew specific certificate
kubeadm certs renew apiserver
kubeadm certs renew apiserver-kubelet-client
kubeadm certs renew admin.conf

# After renewal, restart control plane components
# Option 1: Move manifests (triggers recreation)
mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/
sleep 5
mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/

# Option 2: Kill containers directly
crictl ps | grep kube-apiserver | awk '{print $1}' | xargs crictl stop
crictl ps | grep kube-controller-manager | awk '{print $1}' | xargs crictl stop
crictl ps | grep kube-scheduler | awk '{print $1}' | xargs crictl stop
crictl ps | grep etcd | awk '{print $1}' | xargs crictl stop

# Update kubeconfig with new certs
cp /etc/kubernetes/admin.conf ~/.kube/config
```

### Certificate Locations

```bash
# PKI directory structure
/etc/kubernetes/pki/
├── apiserver.crt                # API server certificate
├── apiserver.key                # API server key
├── apiserver-etcd-client.crt    # API server → etcd client cert
├── apiserver-etcd-client.key
├── apiserver-kubelet-client.crt # API server → kubelet client cert
├── apiserver-kubelet-client.key
├── ca.crt                       # Cluster CA (10 year)
├── ca.key
├── front-proxy-ca.crt           # Front proxy CA
├── front-proxy-ca.key
├── front-proxy-client.crt
├── front-proxy-client.key
├── sa.key                       # ServiceAccount signing key
├── sa.pub                       # ServiceAccount verification key
└── etcd/
    ├── ca.crt                   # etcd CA
    ├── ca.key
    ├── healthcheck-client.crt
    ├── healthcheck-client.key
    ├── peer.crt                 # etcd peer communication
    ├── peer.key
    ├── server.crt               # etcd server certificate
    └── server.key

# Kubeconfig files (embed certificates)
/etc/kubernetes/
├── admin.conf
├── controller-manager.conf
├── scheduler.conf
└── kubelet.conf
```

### Kubelet Certificate Rotation

```yaml
# kubelet auto-rotates its own certificates (enabled by default)
# Check kubelet config
cat /var/lib/kubelet/config.yaml | grep -A3 rotateCertificates
# rotateCertificates: true       ← Auto-rotation enabled

# Kubelet certificates
ls /var/lib/kubelet/pki/
# kubelet-client-current.pem → kubelet-client-2026-05-02.pem
# kubelet.crt
# kubelet.key

# Check kubelet certificate expiration
openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -dates
```

### Automated Renewal CronJob

```bash
# /etc/cron.monthly/renew-k8s-certs
#!/bin/bash
EXPIRY=$(kubeadm certs check-expiration 2>/dev/null | grep apiserver | awk '{print $5}')
DAYS_LEFT=$(( ($(date -d "$EXPIRY" +%s) - $(date +%s)) / 86400 ))

if [ "$DAYS_LEFT" -lt 60 ]; then
  kubeadm certs renew all
  crictl ps | grep -E 'kube-apiserver|kube-controller|kube-scheduler|etcd' | \
    awk '{print $1}' | xargs -r crictl stop
  echo "Certificates renewed on $(date)" >> /var/log/k8s-cert-renewal.log
fi
```

## Common Issues

**"x509: certificate has expired"**

Certificates expired — cluster is broken. Renew: `kubeadm certs renew all`. Restart all control plane components.

**"Unable to connect to the server" after renewal**

kubeconfig still has old certificates. Copy new admin.conf: `cp /etc/kubernetes/admin.conf ~/.kube/config`.

**CA certificate expiring**

CA has 10-year default. If it expires, ALL certs must be regenerated. Plan CA rotation well ahead.

## Best Practices

- **Monitor certificate expiration** — alert at 30 days remaining
- **Upgrade regularly** — `kubeadm upgrade` auto-renews certificates
- **Enable kubelet certificate rotation** — `rotateCertificates: true`
- **Backup PKI directory** — `/etc/kubernetes/pki/` before any changes
- **Automate renewal** — cron job or monitoring integration

## Key Takeaways

- `kubeadm certs check-expiration` shows all certificate dates
- `kubeadm certs renew all` renews everything in one command
- Certificates auto-renew during `kubeadm upgrade`
- After renewal, restart control plane components and update kubeconfig
- Kubelet auto-rotates its own certificates by default
