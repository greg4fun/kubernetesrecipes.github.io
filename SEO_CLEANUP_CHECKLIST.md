# kubernetes.recipes SEO Cleanup Checklist

## Phase 1: Duplicate Content Resolution (Week 1)

### High Priority: Exact Duplicates (Same Title)
These MUST be fixed immediately - Google will penalize for duplicate titles.

| Action | Old File | New Canonical | Status |
|--------|----------|---------------|--------|
| ❌ DELETE | `blue-green-deployments.md` | `blue-green-deployment.md` | Pending |
| ❌ DELETE | `prometheus-monitoring.md` | `prometheus-monitoring-setup.md` | Pending |

### Medium Priority: Topic Overlap
Consolidate content or differentiate clearly.

| Action | Old File | Keep As Canonical | Reason |
|--------|----------|-------------------|--------|
| ❌ DELETE | `argocd-gitops.md` | `argocd-gitops-deployment.md` | 745 lines vs 356 - keep longer |
| ❌ DELETE | `flux-gitops.md` | `flux-gitops-continuous-delivery.md` | More complete |
| ❌ DELETE | `kubernetes-jobs-cronjobs.md` | `jobs-cronjobs.md` | Simpler URL |
| ❌ DELETE | `keda-event-autoscaling.md` | `keda-event-driven-autoscaling.md` | More descriptive |
| ❌ DELETE | `container-logging.md` | `container-logging-patterns.md` | Patterns is richer |
| ❌ DELETE | `downward-api.md` | `downward-api-metadata.md` | More specific |
| ❌ DELETE | `kyverno-policies.md` | `kyverno-policy-management.md` | Broader topic |
| ❌ DELETE | `velero-backup-restore.md` | `velero-backup-disaster-recovery.md` | DR is better keyword |
| ❌ DELETE | `container-image-scanning.md` | `container-security-scanning.md` | More complete |

### Files to Delete (11 total)
```bash
# Run from project root
rm src/content/recipes/blue-green-deployments.md
rm src/content/recipes/prometheus-monitoring.md
rm src/content/recipes/argocd-gitops.md
rm src/content/recipes/flux-gitops.md
rm src/content/recipes/kubernetes-jobs-cronjobs.md
rm src/content/recipes/keda-event-autoscaling.md
rm src/content/recipes/container-logging.md
rm src/content/recipes/downward-api.md
rm src/content/recipes/kyverno-policies.md
rm src/content/recipes/velero-backup-restore.md
rm src/content/recipes/container-image-scanning.md
```

---

## Phase 2: Redirect Implementation

After deleting duplicates, Astro won't generate pages for them.
Create redirect pages manually OR use client-side redirects.

See `/src/pages/redirects/` for implementation.

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
- [ ] Remove duplicate URLs from sitemap (will auto-fix after deletions)
- [ ] Add `<link rel="canonical">` to recipe pages
- [ ] Add JSON-LD structured data (HowTo schema)
- [ ] Verify in Google Search Console

---

## Quick Wins (Do Today)

1. **Delete 11 duplicate files** (see commands above)
2. **Rebuild site** to regenerate sitemap
3. **Submit updated sitemap** to GSC
4. **Request removal** of old URLs in GSC if needed

---

## Metrics to Track

- [ ] Indexed pages in GSC (target: reduce 404s to <5)
- [ ] Crawl budget utilization
- [ ] Average position for "kubernetes [topic]" queries
- [ ] Click-through rate by recipe
