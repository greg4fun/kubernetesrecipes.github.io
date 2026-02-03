# kubernetes.recipes Content Roadmap
## Based on Search Demand + Content Gap Analysis

---

## 📊 Current State (After Duplicate Cleanup)

| Category | Current | After Cleanup | Target (6mo) |
|----------|---------|---------------|--------------|
| Deployments | 30 | 26 | 35 |
| Configuration | 31 | 28 | 35 |
| Security | 23 | 21 | 30 |
| Networking | 16 | 16 | 25 |
| Troubleshooting | 15 | 15 | 25 |
| Observability | 14 | 12 | 20 |
| Storage | 10 | 9 | 15 |
| Autoscaling | 7 | 6 | 12 |
| Helm | 6 | 6 | 12 |
| AI & ML | 5 | 5 | 15 |

---

## 🎯 Priority 1: Jobs/CronJobs Cluster (Highest Search Volume)

Your existing `jobs-cronjobs.md` is the foundation. Build out:

### Week 1-2: Core Job Patterns
1. **`cronjob-concurrency-policy.md`** ⭐ HIGH
   - Keywords: "kubernetes cronjob concurrency", "forbid allow replace"
   - Problem: Multiple job instances running when previous hasn't finished
   - Cover: Allow, Forbid, Replace policies with examples

2. **`job-parallelism-completions.md`** ⭐ HIGH
   - Keywords: "kubernetes job parallelism", "job completions"
   - Problem: Running jobs in parallel vs sequential
   - Cover: Work queue patterns, indexed jobs

3. **`cronjob-timezone-handling.md`** ⭐ HIGH
   - Keywords: "kubernetes cronjob timezone", "cronjob utc"
   - Problem: CronJobs run in UTC, confusing for users
   - Cover: timeZone field (K8s 1.27+), workarounds for older clusters

4. **`job-retry-backoff-limit.md`**
   - Keywords: "kubernetes job retry", "backoffLimit"
   - Problem: Jobs failing and retrying infinitely
   - Cover: backoffLimit, backoffLimitPerIndex

5. **`cronjob-missed-schedule-handling.md`**
   - Keywords: "kubernetes cronjob missed schedule", "startingDeadlineSeconds"
   - Problem: CronJob didn't run when expected
   - Cover: startingDeadlineSeconds, successfulJobsHistoryLimit

6. **`job-ttl-cleanup.md`**
   - Keywords: "kubernetes job cleanup", "ttlSecondsAfterFinished"
   - Problem: Completed jobs cluttering the cluster
   - Cover: TTL controller, manual cleanup strategies

---

## 🎯 Priority 2: Deployments Cluster (Money Topics)

You have strong coverage. Fill gaps:

### Week 3-4: Advanced Patterns
1. **`argo-rollouts-progressive-delivery.md`** ⭐ HIGH
   - Keywords: "argo rollouts", "progressive delivery kubernetes"
   - Problem: Need more control than native K8s deployments
   - Cover: Analysis, experiments, traffic management

2. **`deployment-rollback-strategies.md`** ⭐ HIGH
   - Keywords: "kubernetes rollback deployment", "deployment history"
   - Problem: Something went wrong, need to roll back
   - Cover: kubectl rollout undo, revision history, rollback hooks

3. **`zero-downtime-config-changes.md`**
   - Keywords: "kubernetes zero downtime config", "rolling config update"
   - Problem: ConfigMap/Secret changes don't trigger pod restart
   - Cover: Reloader, sha annotations, immutable configs

4. **`deployment-resource-budgets.md`**
   - Keywords: "kubernetes deployment resources", "guaranteed qos"
   - Problem: Pods getting evicted or throttled
   - Cover: QoS classes, requests=limits pattern, LimitRange

---

## 🎯 Priority 3: Troubleshooting Cluster (Long-Tail Gold)

High search volume, low competition. Expand:

### Week 5-6: Common Issues
1. **`debug-evicted-pods.md`** ⭐ HIGH
   - Keywords: "kubernetes pod evicted", "eviction reason"
   - Problem: Pods being evicted unexpectedly
   - Cover: Node pressure, resource limits, priority preemption

2. **`debug-service-discovery.md`** ⭐ HIGH
   - Keywords: "kubernetes service not working", "service discovery"
   - Problem: Pods can't reach services
   - Cover: DNS, endpoints, selectors, NetworkPolicy conflicts

3. **`debug-ingress-not-working.md`**
   - Keywords: "kubernetes ingress 404", "ingress not routing"
   - Problem: Ingress returns 404 or doesn't work
   - Cover: IngressClass, backend validation, TLS issues

4. **`debug-persistent-volume-issues.md`**
   - Keywords: "kubernetes pvc pending", "volume mount failed"
   - Problem: PVC stuck in Pending or mount errors
   - Cover: StorageClass, access modes, node affinity

5. **`debug-container-runtime-issues.md`**
   - Keywords: "containerd error", "runc failed"
   - Problem: Container won't start due to runtime issues
   - Cover: Image pull, OCI errors, cgroup issues

---

## 🎯 Priority 4: GitOps Cluster (High Intent)

Your ArgoCD coverage is good. Add Flux depth:

### Week 7-8: GitOps Patterns
1. **`argocd-app-of-apps.md`** ⭐ HIGH
   - Keywords: "argocd app of apps", "argocd bootstrap"
   - Problem: Managing many ArgoCD applications
   - Cover: ApplicationSet, cluster bootstrapping

2. **`argocd-sync-waves.md`**
   - Keywords: "argocd sync waves", "argocd hooks"
   - Problem: Resources need to deploy in order
   - Cover: Sync phases, waves, resource hooks

3. **`flux-multi-tenancy.md`**
   - Keywords: "flux multi tenant", "flux namespace isolation"
   - Problem: Multiple teams sharing a cluster
   - Cover: Flux tenancy, RBAC, source isolation

4. **`gitops-secrets-management.md`**
   - Keywords: "gitops secrets", "sealed secrets vs external secrets"
   - Problem: How to handle secrets in GitOps
   - Cover: Comparison of approaches, when to use what

---

## 🎯 Priority 5: AI & ML Cluster (Emerging Traffic)

Your KAI Scheduler coverage is unique! Double down:

### Week 9-10: GPU/AI Workloads
1. **`gpu-scheduling-best-practices.md`** ⭐ HIGH
   - Keywords: "kubernetes gpu scheduling", "nvidia kubernetes"
   - Problem: GPUs not being utilized efficiently
   - Cover: Device plugins, time-slicing, MIG

2. **`model-serving-kubernetes.md`**
   - Keywords: "kubernetes model serving", "ml inference"
   - Problem: Deploying ML models for inference
   - Cover: Triton, TorchServe, Seldon comparison

3. **`distributed-training-kubernetes.md`**
   - Keywords: "kubernetes distributed training", "pytorch distributed"
   - Problem: Training large models across nodes
   - Cover: MPI, PyTorch DDP, Kubeflow Training Operator

---

## 📈 Content Publishing Calendar

### February 2026
| Week | Focus | Recipes |
|------|-------|---------|
| 1 | Jobs/CronJobs | concurrency-policy, parallelism-completions |
| 2 | Jobs/CronJobs | timezone, retry-backoff |
| 3 | Deployments | argo-rollouts, rollback-strategies |
| 4 | Deployments | zero-downtime-config, resource-budgets |

### March 2026
| Week | Focus | Recipes |
|------|-------|---------|
| 1 | Troubleshooting | evicted-pods, service-discovery |
| 2 | Troubleshooting | ingress-not-working, pv-issues |
| 3 | GitOps | app-of-apps, sync-waves |
| 4 | GitOps | flux-multi-tenancy, secrets-management |

### April 2026
| Week | Focus | Recipes |
|------|-------|---------|
| 1 | AI & ML | gpu-scheduling, model-serving |
| 2 | AI & ML | distributed-training |
| 3 | Observability | Fill gaps |
| 4 | Storage | Fill gaps |

---

## 🔗 Internal Linking Strategy

### Hub Pages to Strengthen
1. `/recipes/deployments/` - Add "Learning Path" section
2. `/recipes/troubleshooting/` - Add "Common Issues Quick Reference"
3. `/recipes/autoscaling/` - Add "When to Use What" comparison

### Cross-Cluster Links to Add
- Jobs → Autoscaling (scale based on queue depth with KEDA)
- GitOps → Security (secrets handling)
- Troubleshooting → Observability (monitoring to detect issues)
- Deployments → GitOps (automation progression)

---

## 📝 Recipe Template Best Practices

Every new recipe should include:

```markdown
## The Problem
[One paragraph describing the real-world problem]

## The Solution  
[One paragraph overview]

## Quick Start
[Minimal working example - copy-paste ready]

## Step-by-Step Guide
[Detailed walkthrough]

## Common Mistakes ⚠️
[3-5 bullet points of what people get wrong]

## Troubleshooting
[If X happens, do Y]

## Related Recipes
[2-3 internal links]
```

---

## 🎯 Quick Wins (Do This Week)

1. [ ] Run `./scripts/seo-cleanup.sh` to remove duplicates
2. [ ] Build site and verify sitemap
3. [ ] Start writing `cronjob-concurrency-policy.md`
4. [ ] Add "Common Mistakes" section to top 5 existing recipes
5. [ ] Submit sitemap to GSC
