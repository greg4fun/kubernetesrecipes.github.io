---
title: "How to Create Helm Chart Repositories"
description: "Set up and manage Helm chart repositories. Learn to host charts on GitHub Pages, S3, GCS, and OCI registries for team distribution."
category: "helm"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["helm", "repository", "charts", "packaging", "distribution"]
---

# How to Create Helm Chart Repositories

Helm repositories host packaged charts for distribution. Learn to create, host, and manage chart repositories using various backends.

## Package Your Chart

```bash
# Create chart package
helm package ./mychart

# Package with specific version
helm package ./mychart --version 1.2.0

# Package with app version
helm package ./mychart --app-version 2.0.0

# Output: mychart-1.2.0.tgz
```

## Create Repository Index

```bash
# Generate index.yaml for repository
helm repo index . --url https://charts.example.com

# Merge with existing index
helm repo index . --url https://charts.example.com --merge index.yaml
```

## GitHub Pages Repository

```bash
# Repository structure
charts-repo/
├── index.yaml
├── mychart-1.0.0.tgz
├── mychart-1.1.0.tgz
└── anotherchart-2.0.0.tgz
```

```yaml
# .github/workflows/release.yml
name: Release Charts

on:
  push:
    branches:
      - main
    paths:
      - 'charts/**'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Configure Git
        run: |
          git config user.name "$GITHUB_ACTOR"
          git config user.email "$GITHUB_ACTOR@users.noreply.github.com"

      - name: Install Helm
        uses: azure/setup-helm@v3

      - name: Run chart-releaser
        uses: helm/chart-releaser-action@v1.6.0
        env:
          CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
```

Use the repository:

```bash
helm repo add myrepo https://myorg.github.io/charts-repo
helm repo update
helm search repo myrepo
```

## AWS S3 Repository

```bash
# Install helm-s3 plugin
helm plugin install https://github.com/hypnoglow/helm-s3.git

# Initialize S3 repository
helm s3 init s3://my-helm-charts/stable

# Add repository
helm repo add myrepo s3://my-helm-charts/stable

# Push chart
helm s3 push mychart-1.0.0.tgz myrepo

# Push with force (overwrite)
helm s3 push mychart-1.0.0.tgz myrepo --force
```

```yaml
# S3 bucket policy for team access
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789:role/HelmUser"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-helm-charts",
        "arn:aws:s3:::my-helm-charts/*"
      ]
    }
  ]
}
```

## Google Cloud Storage Repository

```bash
# Install helm-gcs plugin
helm plugin install https://github.com/hayorov/helm-gcs.git

# Initialize GCS repository
helm gcs init gs://my-helm-charts

# Add repository
helm repo add myrepo gs://my-helm-charts

# Push chart
helm gcs push mychart-1.0.0.tgz myrepo
```

## OCI Registry (Harbor, ACR, ECR)

```bash
# Login to OCI registry
helm registry login registry.example.com

# Push chart to OCI
helm push mychart-1.0.0.tgz oci://registry.example.com/charts

# Pull chart from OCI
helm pull oci://registry.example.com/charts/mychart --version 1.0.0

# Install directly from OCI
helm install myrelease oci://registry.example.com/charts/mychart --version 1.0.0
```

## ChartMuseum Server

```yaml
# chartmuseum-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chartmuseum
spec:
  replicas: 1
  selector:
    matchLabels:
      app: chartmuseum
  template:
    metadata:
      labels:
        app: chartmuseum
    spec:
      containers:
        - name: chartmuseum
          image: ghcr.io/helm/chartmuseum:v0.16.0
          ports:
            - containerPort: 8080
          env:
            - name: STORAGE
              value: local
            - name: STORAGE_LOCAL_ROOTDIR
              value: /charts
            - name: BASIC_AUTH_USER
              valueFrom:
                secretKeyRef:
                  name: chartmuseum-auth
                  key: user
            - name: BASIC_AUTH_PASS
              valueFrom:
                secretKeyRef:
                  name: chartmuseum-auth
                  key: pass
          volumeMounts:
            - name: charts
              mountPath: /charts
      volumes:
        - name: charts
          persistentVolumeClaim:
            claimName: chartmuseum-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: chartmuseum
spec:
  ports:
    - port: 8080
  selector:
    app: chartmuseum
```

```bash
# Add ChartMuseum repo
helm repo add myrepo http://chartmuseum:8080 --username admin --password secret

# Push chart via API
curl -u admin:secret --data-binary "@mychart-1.0.0.tgz" \
  http://chartmuseum:8080/api/charts
```

## Repository Authentication

```bash
# Add repo with basic auth
helm repo add myrepo https://charts.example.com \
  --username myuser --password mypass

# Add repo with certificate
helm repo add myrepo https://charts.example.com \
  --ca-file ca.crt --cert-file client.crt --key-file client.key

# Store credentials in config
helm repo add myrepo https://charts.example.com \
  --username myuser --password mypass --pass-credentials
```

## Signing Charts

```bash
# Generate GPG key
gpg --quick-generate-key "Helm Charts <helm@example.com>"

# Package and sign
helm package --sign --key "helm@example.com" \
  --keyring ~/.gnupg/secring.gpg ./mychart

# Verify signature
helm verify mychart-1.0.0.tgz

# Install with verification
helm install myrelease myrepo/mychart --verify
```

## Repository Index Structure

```yaml
# index.yaml
apiVersion: v1
entries:
  mychart:
    - apiVersion: v2
      appVersion: "2.0.0"
      created: "2024-01-15T10:30:00Z"
      description: My awesome chart
      digest: sha256:abc123...
      name: mychart
      type: application
      urls:
        - https://charts.example.com/mychart-1.0.0.tgz
      version: 1.0.0
    - apiVersion: v2
      appVersion: "1.5.0"
      created: "2024-01-01T10:30:00Z"
      description: My awesome chart
      digest: sha256:def456...
      name: mychart
      urls:
        - https://charts.example.com/mychart-0.9.0.tgz
      version: 0.9.0
generated: "2024-01-15T10:30:00Z"
```

## Summary

Helm repositories enable chart distribution across teams. Use GitHub Pages for open source, S3/GCS for cloud-native teams, OCI registries for enterprise environments, and ChartMuseum for self-hosted solutions. Always sign charts for production use.
