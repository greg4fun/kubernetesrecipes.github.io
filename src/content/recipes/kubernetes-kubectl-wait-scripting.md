---
title: "kubectl wait: Script K8s Operations"
description: "Use kubectl wait for scripting Kubernetes operations. Wait for pod ready, job completion, deployment rollout, and custom conditions in CI/CD pipelines."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "scripting"
  - "automation"
  - "ci-cd"
  - "cka"
relatedRecipes:
  - "kubectl-cheat-sheet"
  - "kubectl-apply-vs-create"
  - "kubernetes-rolling-update-strategies"
  - "kubernetes-api-resources-explain"
---

> 💡 **Quick Answer:** `kubectl wait --for=condition=Ready pod/my-pod --timeout=120s` blocks until the pod is Ready. For deployments: `kubectl rollout status deployment/my-app --timeout=300s`. For jobs: `kubectl wait --for=condition=Complete job/my-job --timeout=600s`. Essential for CI/CD scripts that need to wait for Kubernetes operations to finish.

## The Problem

Kubernetes operations are asynchronous:

- `kubectl apply` returns immediately — resource may not be ready
- CI/CD pipelines need to wait for deployment completion
- Scripts need to block until preconditions are met
- No built-in way to sequence dependent operations

## The Solution

### kubectl wait

```bash
# Wait for pod to be Ready
kubectl wait --for=condition=Ready pod/my-pod --timeout=120s

# Wait for all pods with label
kubectl wait --for=condition=Ready pods -l app=nginx --timeout=120s

# Wait for deployment rollout
kubectl rollout status deployment/my-app --timeout=300s

# Wait for Job completion
kubectl wait --for=condition=Complete job/my-job --timeout=600s

# Wait for pod deletion
kubectl wait --for=delete pod/my-pod --timeout=60s

# Wait for custom condition
kubectl wait --for=condition=Available deployment/my-app --timeout=120s

# Wait for CRD condition
kubectl wait --for=condition=Ready certificate/my-cert --timeout=120s
```

### CI/CD Script Patterns

```bash
#!/bin/bash
set -euo pipefail

# Deploy and wait
echo "Deploying..."
kubectl apply -f manifests/

# Wait for all deployments
echo "Waiting for rollout..."
kubectl rollout status deployment/frontend --timeout=300s
kubectl rollout status deployment/backend --timeout=300s

# Wait for all pods ready
kubectl wait --for=condition=Ready pods -l app.kubernetes.io/part-of=myapp \
  --timeout=300s -n production

# Run database migration
echo "Running migration..."
kubectl apply -f jobs/migrate.yaml
kubectl wait --for=condition=Complete job/db-migrate --timeout=600s

# Smoke test
echo "Running smoke test..."
kubectl run smoke-test --image=curlimages/curl --rm -it --restart=Never -- \
  curl -sf http://frontend.production.svc/health

echo "Deployment successful!"
```

### Wait with jsonpath

```bash
# Wait for specific field value
kubectl wait --for=jsonpath='{.status.phase}'=Running pod/my-pod --timeout=60s

# Wait for specific number of ready replicas
kubectl wait --for=jsonpath='{.status.readyReplicas}'=3 deployment/my-app --timeout=120s

# Wait for LoadBalancer IP assignment
kubectl wait --for=jsonpath='{.status.loadBalancer.ingress[0].ip}' \
  service/my-lb --timeout=300s
```

### Polling Patterns (When wait Isn't Enough)

```bash
# Poll until condition met
until kubectl get pods -l app=nginx -o jsonpath='{.items[0].status.phase}' | grep -q Running; do
  echo "Waiting for pod..."
  sleep 5
done

# Wait for endpoint to have addresses
until [ "$(kubectl get endpoints my-service -o jsonpath='{.subsets[0].addresses}')" != "" ]; do
  echo "Waiting for endpoints..."
  sleep 5
done

# Wait for CRD to be established
kubectl wait --for=condition=Established crd/myresources.example.com --timeout=60s

# Retry with timeout
timeout 300 bash -c 'until kubectl get pods -l app=db -o jsonpath="{.items[0].status.containerStatuses[0].ready}" | grep true; do sleep 5; done'
```

### Deployment Script Template

```bash
#!/bin/bash
set -euo pipefail

NAMESPACE="${1:-production}"
TIMEOUT="${2:-300s}"

deploy() {
  local app=$1
  echo "→ Deploying $app..."
  kubectl apply -f "manifests/$app/" -n "$NAMESPACE"
  kubectl rollout status "deployment/$app" -n "$NAMESPACE" --timeout="$TIMEOUT"
  echo "✓ $app deployed"
}

# Sequential deployment with dependencies
deploy "database"
kubectl wait --for=condition=Ready pods -l app=database -n "$NAMESPACE" --timeout="$TIMEOUT"

deploy "backend"
kubectl wait --for=condition=Ready pods -l app=backend -n "$NAMESPACE" --timeout="$TIMEOUT"

deploy "frontend"

echo "All deployments complete!"

# Verify
kubectl get pods -n "$NAMESPACE" -l 'app in (database,backend,frontend)'
```

### Error Handling

```bash
# Capture wait failures
if ! kubectl wait --for=condition=Ready pod/my-pod --timeout=120s 2>/dev/null; then
  echo "ERROR: Pod not ready after 120s"
  kubectl describe pod my-pod
  kubectl logs my-pod --tail=50
  exit 1
fi

# Rollout with auto-rollback
if ! kubectl rollout status deployment/my-app --timeout=300s; then
  echo "ERROR: Rollout failed, rolling back..."
  kubectl rollout undo deployment/my-app
  kubectl rollout status deployment/my-app --timeout=300s
  exit 1
fi
```

## Common Issues

**"timed out waiting for the condition"**

Resource didn't reach the desired state in time. Check: `kubectl describe <resource>` for events and conditions.

**Wait returns immediately (already in desired state)**

That's correct behavior — `wait` returns 0 if condition is already met.

**Can't wait on custom conditions**

Only conditions in `.status.conditions[]` work with `--for=condition=`. Use `--for=jsonpath=` for other fields.

## Best Practices

- **Always set `--timeout`** — never wait forever in scripts
- **Use `rollout status`** for Deployments — more informative than `wait`
- **Handle failures** — describe + logs on timeout for debugging
- **Combine wait steps** — deploy → wait ready → smoke test → done
- **Use jsonpath wait** for non-standard conditions

## Key Takeaways

- `kubectl wait` blocks until a condition is met — essential for scripting
- `kubectl rollout status` is the preferred way to wait for Deployments
- `--for=condition=Ready`, `--for=condition=Complete`, `--for=delete`
- `--for=jsonpath=` enables waiting on any field value
- Always include `--timeout` and error handling in CI/CD scripts
