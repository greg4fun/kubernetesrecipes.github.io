---
title: "K8s Operator Pattern: Build Controllers"
description: "Build Kubernetes operators with the controller pattern. Reconciliation loops, watch events, owner references, finalizers, and operator frameworks comparison."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "operators"
  - "controllers"
  - "crd"
  - "automation"
  - "development"
relatedRecipes:
  - "kubernetes-crd-guide"
  - "kubernetes-admission-webhooks-guide"
  - "kubernetes-rbac-role-rolebinding"
---

> 💡 **Quick Answer:** The operator pattern encodes human operational knowledge in software. A controller watches custom resources (CRDs), compares desired state (spec) with actual state, and reconciles differences. Frameworks: **Kubebuilder** (Go, official), **Operator SDK** (Go/Ansible/Helm), **kopf** (Python), **KUDO** (declarative). Key concepts: reconciliation loop, owner references, finalizers, status updates.

## The Problem

Complex applications need operational logic:

- Database: create replicas, configure replication, manage backups, handle failover
- Certificate: issue, renew, distribute, revoke
- Application: deploy, configure, upgrade, scale, heal

Deployments and StatefulSets can't encode this application-specific logic.

## The Solution

### Operator Concept

```
User creates CR:
  Database (spec: {replicas: 3, engine: postgres, version: 16})
        │
        ▼
Controller watches for changes:
  Reconcile Loop:
    1. Read desired state (CR spec)
    2. Read actual state (existing pods, PVCs, Services)
    3. Compare desired vs actual
    4. Take action to converge (create/update/delete resources)
    5. Update CR status
    6. Requeue if not converged
```

### Controller Reconcile Pattern (Go)

```go
func (r *DatabaseReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    log := log.FromContext(ctx)
    
    // 1. Fetch the Database CR
    var db examplev1.Database
    if err := r.Get(ctx, req.NamespacedName, &db); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }
    
    // 2. Handle deletion (finalizer)
    if !db.DeletionTimestamp.IsZero() {
        return r.handleDeletion(ctx, &db)
    }
    
    // 3. Ensure StatefulSet exists
    sts := r.desiredStatefulSet(&db)
    controllerutil.SetControllerReference(&db, sts, r.Scheme)
    
    if err := r.CreateOrUpdate(ctx, sts, func() error {
        sts.Spec.Replicas = &db.Spec.Replicas
        sts.Spec.Template.Spec.Containers[0].Image = 
            fmt.Sprintf("postgres:%s", db.Spec.Version)
        return nil
    }); err != nil {
        return ctrl.Result{}, err
    }
    
    // 4. Ensure Service exists
    svc := r.desiredService(&db)
    controllerutil.SetControllerReference(&db, svc, r.Scheme)
    if err := r.CreateOrUpdate(ctx, svc, func() error { return nil }); err != nil {
        return ctrl.Result{}, err
    }
    
    // 5. Update status
    db.Status.Phase = "Ready"
    db.Status.ReadyReplicas = sts.Status.ReadyReplicas
    if err := r.Status().Update(ctx, &db); err != nil {
        return ctrl.Result{}, err
    }
    
    // 6. Requeue after 30s for health check
    return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
}
```

### Owner References

```yaml
# Child resource (StatefulSet) created by operator:
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: production-db
  ownerReferences:
  - apiVersion: example.com/v1
    kind: Database
    name: production-db
    uid: abc-123-def
    controller: true
    blockOwnerDeletion: true

# When Database CR is deleted → StatefulSet is garbage collected
# No orphaned resources!
```

### Finalizers

```go
// Finalizers prevent deletion until cleanup is done
const finalizerName = "databases.example.com/cleanup"

func (r *DatabaseReconciler) handleDeletion(ctx context.Context, db *examplev1.Database) (ctrl.Result, error) {
    if controllerutil.ContainsFinalizer(db, finalizerName) {
        // Perform cleanup
        if err := r.deleteBackups(ctx, db); err != nil {
            return ctrl.Result{}, err
        }
        if err := r.revokeCredentials(ctx, db); err != nil {
            return ctrl.Result{}, err
        }
        
        // Remove finalizer → allows deletion to proceed
        controllerutil.RemoveFinalizer(db, finalizerName)
        if err := r.Update(ctx, db); err != nil {
            return ctrl.Result{}, err
        }
    }
    return ctrl.Result{}, nil
}
```

### Kubebuilder Quickstart

```bash
# Initialize operator project
kubebuilder init --domain example.com --repo github.com/example/database-operator

# Create API (CRD + controller)
kubebuilder create api --group database --version v1 --kind Database
# Create Resource [y/n]: y
# Create Controller [y/n]: y

# Edit API types
# api/v1/database_types.go → define spec/status fields

# Edit controller
# internal/controller/database_controller.go → reconcile logic

# Generate CRD manifests
make manifests

# Install CRDs
make install

# Run locally
make run

# Build and push container
make docker-build docker-push IMG=registry.example.com/db-operator:v1

# Deploy to cluster
make deploy IMG=registry.example.com/db-operator:v1
```

### Operator SDK (Alternative)

```bash
# Initialize with Operator SDK
operator-sdk init --domain example.com --repo github.com/example/db-operator

# Helm-based operator (no Go code!)
operator-sdk init --plugins helm --domain example.com
operator-sdk create api --group database --version v1 --kind Database \
  --helm-chart=bitnami/postgresql

# Ansible-based operator
operator-sdk init --plugins ansible --domain example.com
operator-sdk create api --group database --version v1 --kind Database
# Edit roles/database/tasks/main.yml with Ansible tasks
```

### Framework Comparison

| Framework | Language | Complexity | Best For |
|-----------|----------|------------|----------|
| Kubebuilder | Go | Medium | Production Go operators |
| Operator SDK | Go/Ansible/Helm | Low-High | Red Hat ecosystem |
| kopf | Python | Low | Quick prototypes |
| KUDO | Declarative | Low | Stateful apps |
| Metacontroller | JSON hooks | Low | Simple controllers |
| shell-operator | Bash/Python | Low | Scripts as operators |

### Operator Best Practices

```
Reconciliation:
  ✅ Idempotent — running twice produces same result
  ✅ Level-triggered — react to current state, not events
  ✅ Handle partial failures — don't leave resources in bad state
  ✅ Use owner references — automatic garbage collection
  ✅ Update status — users need to know what's happening

Robustness:
  ✅ Exponential backoff on errors
  ✅ Finalizers for cleanup on deletion
  ✅ Leader election for HA (multiple replicas)
  ✅ Rate limiting on reconciliation
  ✅ Metrics and health endpoints
```

## Common Issues

**Controller not reconciling**

RBAC missing — controller can't watch or modify resources. Check: `kubectl logs <operator-pod>`. Add necessary RBAC rules.

**Infinite reconciliation loop**

Controller updates status → triggers watch → reconciles again. Use `status` subresource to avoid triggering on status-only changes.

**Orphaned resources after CR deletion**

Missing owner references. Set `controllerutil.SetControllerReference()` on all created resources.

## Best Practices

- **Idempotent reconciliation** — always converge to desired state
- **Owner references on all child resources** — automatic cleanup
- **Finalizers for external cleanup** — backups, cloud resources
- **Status updates** — communicate state to users
- **Leader election** — run 2+ replicas for HA

## Key Takeaways

- Operators encode operational knowledge as code (CRD + controller)
- Reconciliation loop: read desired state → compare actual → converge
- Owner references enable automatic garbage collection of child resources
- Finalizers ensure cleanup before deletion (external resources, backups)
- Kubebuilder and Operator SDK are the main frameworks for building operators
