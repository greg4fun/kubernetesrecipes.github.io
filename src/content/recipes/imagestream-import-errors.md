---
title: "Fix OpenShift ImageStream Import Errors"
description: "Debug ImageStream import failures in OpenShift. Resolve DNS errors, authentication issues, TLS certificate problems, and registry rate limiting for external images."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - imagestream
  - import
  - registry
  - troubleshooting
relatedRecipes:
  - "openshift-buildconfig-imagestream"
  - "openshift-idms-install-config"
  - "itms-external-registry-mapping"
---
> 💡 **Quick Answer:** Run `oc import-image <imagestream> --confirm --from=<registry/image:tag>` and check the error. Common fixes: add pull secret to `openshift-config/pull-secret`, trust the CA certificate, or use IDMS/ITMS for mirror registry.

## The Problem

ImageStreams fail to import tags from external registries. Builds that depend on ImageStreams fail with "import failed" or "unauthorized". The image-registry operator shows errors, and your CI/CD pipeline is broken.

## The Solution

### Step 1: Check Import Status

```bash
# Check ImageStream status
oc get is myapp -o json | jq '.status.tags[] | {tag: .tag, conditions: .conditions}'

# Re-trigger import with verbose output
oc import-image myapp:latest --from=registry.example.com/myapp:latest --confirm
```

### Step 2: Identify the Error

**Authentication failure:**
```
error: Import failed (Unauthorized): you may not have access to the container image
```

Fix — add credentials to the global pull secret:
```bash
# Get current pull secret
oc get secret/pull-secret -n openshift-config -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d > /tmp/pull-secret.json

# Add new registry auth
oc registry login --registry=registry.example.com --auth-basic=user:password --to=/tmp/pull-secret.json

# Update the cluster pull secret
oc set data secret/pull-secret -n openshift-config --from-file=.dockerconfigjson=/tmp/pull-secret.json
```

**TLS certificate error:**
```
error: Import failed: x509: certificate signed by unknown authority
```

Fix — add the CA certificate:
```bash
oc create configmap custom-ca --from-file=ca-bundle.crt=/path/to/ca.crt -n openshift-config
oc patch image.config.openshift.io/cluster --type=merge -p '{"spec":{"additionalTrustedCA":{"name":"custom-ca"}}}'
```

**DNS resolution failure:**
```
error: Import failed: dial tcp: lookup registry.example.com: no such host
```

Fix — verify DNS from a cluster pod:
```bash
oc debug node/worker-1 -- chroot /host nslookup registry.example.com
```

**Rate limiting (Docker Hub):**
```
error: Import failed: toomanyrequests: You have reached your pull rate limit
```

Fix — authenticate to Docker Hub to get higher limits:
```bash
oc registry login --registry=docker.io --auth-basic=<dockerhub-user>:<token> --to=/tmp/pull-secret.json
```

### Step 3: Verify Import Works

```bash
# Test import
oc import-image myapp:latest --confirm

# Check tags are populated
oc get is myapp
# NAME    IMAGE REPOSITORY                                    TAGS     UPDATED
# myapp   image-registry.openshift-image-registry.svc:5000/   latest   2 seconds ago
```

## Common Issues

### Scheduled Import Not Running

```bash
# Check if scheduled import is enabled
oc get is myapp -o jsonpath='{.spec.tags[0].importPolicy}'
# {"scheduled": true}

# If not, enable it:
oc tag --scheduled=true registry.example.com/myapp:latest myapp:latest
```

### ImageStream Pointing to Mirror but Failing

If using IDMS/ITMS for mirroring, ensure the mirror has the image:
```bash
skopeo inspect --tls-verify=false docker://mirror.internal.example.com/myapp:latest
```

## Best Practices

- **Use the global pull secret** for registry authentication — per-namespace secrets work but are harder to manage
- **Add CA certificates cluster-wide** via `image.config.openshift.io/cluster`
- **Enable scheduled imports** for ImageStreams that track external tags
- **Use IDMS/ITMS** for disconnected or air-gapped environments
- **Monitor import status** — failed imports don't always alert

## Key Takeaways

- ImageStream import errors are usually auth, TLS, DNS, or rate limits
- Global pull secret in `openshift-config` is the cluster-wide credential store
- Additional trusted CAs go in `image.config.openshift.io/cluster`
- Use `oc import-image --confirm` to re-trigger and see verbose errors
- Enable `scheduled: true` on tags to auto-refresh from external registries
