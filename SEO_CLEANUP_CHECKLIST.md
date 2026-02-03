# kubernetes.recipes SEO Cleanup Checklist

## Phase 1: Duplicate Content Resolution (Week 1) ✅ COMPLETED

### High Priority: Exact Duplicates (Same Title)
These MUST be fixed immediately - Google will penalize for duplicate titles.

| Action | Old File | New Canonical | Status |
|--------|----------|---------------|--------|
| ✅ DELETED | `blue-green-deployments.md` | `blue-green-deployment.md` | Done |
| ✅ DELETED | `prometheus-monitoring.md` | `prometheus-monitoring-setup.md` | Done |

### Medium Priority: Topic Overlap
Consolidate content or differentiate clearly.

| Action | Old File | Keep As Canonical | Status |
|--------|----------|-------------------|--------|
| ✅ DELETED | `argocd-gitops.md` | `argocd-gitops-deployment.md` | Done |
| ✅ DELETED | `flux-gitops.md` | `flux-gitops-continuous-delivery.md` | Done |
| ✅ DELETED | `kubernetes-jobs-cronjobs.md` | `jobs-cronjobs.md` | Done |
| ✅ DELETED | `keda-event-autoscaling.md` | `keda-event-driven-autoscaling.md` | Done |
| ✅ DELETED | `container-logging.md` | `container-logging-patterns.md` | Done |
| ✅ DELETED | `downward-api.md` | `downward-api-metadata.md` | Done |
| ✅ DELETED | `kyverno-policies.md` | `kyverno-policy-management.md` | Done |
| ✅ DELETED | `velero-backup-restore.md` | `velero-backup-disaster-recovery.md` | Done |
| ✅ DELETED | `container-image-scanning.md` | `container-security-scanning.md` | Done |

### Files Deleted (11 total) ✅
```bash
# COMPLETED on 2026-02-03
# Files removed, redirect pages created in src/pages/recipes/[category]/
```

---

## Phase 2: Redirect Implementation ✅ COMPLETED

After deleting duplicates, redirect pages were created to preserve link equity.

**Implementation:** Client-side redirects using meta refresh + JavaScript (GitHub Pages compatible)

**Redirect Pages Created:**
- `src/pages/recipes/deployments/blue-green-deployments.astro`
- `src/pages/recipes/observability/prometheus-monitoring.astro`
- `src/pages/recipes/configuration/argocd-gitops.astro`
- `src/pages/recipes/configuration/flux-gitops.astro`
- `src/pages/recipes/configuration/kubernetes-jobs-cronjobs.astro`
- `src/pages/recipes/autoscaling/keda-event-autoscaling.astro`
- `src/pages/recipes/observability/container-logging.astro`
- `src/pages/recipes/configuration/downward-api.astro`
- `src/pages/recipes/security/kyverno-policies.astro`
- `src/pages/recipes/storage/velero-backup-restore.astro`
- `src/pages/recipes/security/container-image-scanning.astro`

**Sitemap:** Updated `astro.config.mjs` to exclude redirect pages from sitemap.

---

## Phase 3: Content Enhancement (Weeks 2-4)

### Category Hub Pages Need Unique Intros
Each `/recipes/[category]/` page should have:
- [ ] 150-300 words of unique intro text (currently has ~50)
- [ ] "Top 5 recipes" curated section
- [ ] "Next recipes to learn" progression
- [ ] FAQ schema markup

### Internal Linking Audit
Every recipe should have:
- [x] Link UP to category hub ✅ (breadcrumbs exist)
- [ ] Link to 2-3 related recipes (some have, most don't)
- [ ] "Next recipes" CTA block at end

---

## Phase 4: Content Clusters to Build

### Cluster 1: Deployments (Your Strongest)
**30 recipes** - Expand with:
- [ ] `argo-rollouts-progressive-delivery.md`
- [ ] `deployment-patterns-comparison.md`
- [ ] `zero-downtime-config-changes.md`
- [ ] `rollback-strategies.md`

### Cluster 2: Jobs/CronJobs (High Search Volume)
Current: 2 recipes → Target: 8
- [ ] `cronjob-timezone-handling.md`
- [ ] `job-parallelism-completions.md`
- [ ] `cronjob-concurrency-policy.md`
- [ ] `job-retry-backoff-limit.md`
- [ ] `cronjob-missed-schedule-handling.md`
- [ ] `job-ttl-cleanup.md`

### Cluster 3: Troubleshooting (Long-Tail Gold)
Current: 15 recipes → Keep expanding
- [ ] `debug-evicted-pods.md`
- [ ] `debug-volume-mount-issues.md`
- [ ] `debug-service-discovery.md`
- [ ] `debug-ingress-not-working.md`

---

## Technical SEO Checklist

- [x] XML Sitemap configured ✅
- [x] robots.txt configured ✅
- [x] Remove duplicate URLs from sitemap ✅ (auto-filtered via astro.config.mjs)
- [x] Add `<link rel="canonical">` to recipe pages ✅ (in Layout.astro)
- [x] Add JSON-LD structured data (HowTo schema) ✅ (Enhanced in Layout.astro)
- [x] Copy-to-clipboard buttons on code blocks ✅ (Added to Layout.astro)
- [ ] Verify in Google Search Console
- [ ] Submit updated sitemap to GSC

---

## GEO (Generative Engine Optimization) ✅ IN PROGRESS

**Quick Answer Pattern Added To (25 recipes):**

**Troubleshooting:**
- [x] debug-crashloopbackoff.md
- [x] debug-oom-killed.md
- [x] debug-imagepullbackoff.md
- [x] debug-dns-issues.md
- [x] debug-scheduling-failures.md
- [x] debug-node-issues.md
- [x] troubleshooting-pending-pvc.md

**Deployments:**
- [x] liveness-readiness-probes.md
- [x] rolling-update-deployment.md
- [x] blue-green-deployment.md
- [x] canary-deployments.md
- [x] statefulset-management.md
- [x] jobs-cronjobs.md
- [x] init-containers.md
- [x] graceful-shutdown.md
- [x] pod-affinity-anti-affinity.md
- [x] pod-disruption-budgets.md
- [x] argocd-gitops-deployment.md

**Autoscaling:**
- [x] horizontal-pod-autoscaler.md
- [x] vertical-pod-autoscaler.md
- [x] cluster-autoscaler.md

**Configuration:**
- [x] configmap-secrets-management.md
- [x] resource-limits-requests.md
- [x] namespace-management.md
- [x] kustomize-configuration.md

**Networking:**
- [x] ingress-routing.md
- [x] network-policies.md
- [x] service-loadbalancer-nodeport.md
- [x] istio-service-mesh.md

**Security:**
- [x] rbac-service-accounts.md
- [x] pod-security-standards.md
- [x] cert-manager-certificates.md
- [x] secrets-management-best-practices.md

**Observability:**
- [x] prometheus-monitoring-setup.md
- [x] container-logging-patterns.md

**Storage:**
- [x] etcd-backup-restore.md

**Helm:**
- [x] helm-chart-basics.md

**QuickAnswer Component:** Created at `src/components/quick-answer.astro` for MDX files.

---

## Quick Wins (Do Today) ✅

1. **Delete 11 duplicate files** ✅
2. **Create redirect pages** ✅
3. **Rebuild site** to regenerate sitemap
4. **Submit updated sitemap** to GSC
5. **Request removal** of old URLs in GSC if needed

---

## Metrics to Track

- [ ] Indexed pages in GSC (target: reduce 404s to <5)
- [ ] Crawl budget utilization
- [ ] Average position for "kubernetes [topic]" queries
- [ ] Click-through rate by recipe
