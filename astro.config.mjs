import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";


// Redirect stub pages to exclude from the sitemap. These exist as thin
// meta-refresh redirect pages in src/pages/recipes/**; they must not appear in
// the sitemap (they are not real content). Matched by EXACT path to avoid
// accidentally excluding real destination pages with overlapping slugs
// (e.g. /recipes/autoscaling/kubernetes-resource-optimization/).
const redirectStubPaths = new Set([
  "/recipes/security/kubernetes-secrets-management-best-practices/",
  "/recipes/security/kubernetes-secrets-best-practices/",
  "/recipes/security/kubernetes-secrets-complete-guide/",
  "/recipes/security/kubernetes-secrets-guide/",
  "/recipes/security/kubernetes-secrets-management-guide/",
  "/recipes/security/kubernetes-secrets-management-external/",
  "/recipes/security/kubernetes-external-secrets-guide/",
  "/recipes/configuration/kubernetes-configmap-secrets-management/",
  "/recipes/configuration/kubernetes-configmap/",
  "/recipes/configuration/kubernetes-configmap-best-practices/",
  "/recipes/configuration/configmap-hot-reload-troubleshooting/",
  "/recipes/configuration/namespace-management/",
  "/recipes/configuration/kubernetes-namespace-management-guide/",
  "/recipes/configuration/kubernetes-namespace-best-practices/",
  "/recipes/troubleshooting/kubernetes-namespace-stuck-terminating/",
  "/recipes/security/rbac-service-accounts/",
  "/recipes/security/kubernetes-pod-security-standards/",
  "/recipes/security/kubernetes-falco-runtime-security/",
  "/recipes/security/kubernetes-networkpolicy-examples/",
  "/recipes/security/kubernetes-networkpolicy-default-deny-examples/",
  "/recipes/security/kubernetes-audit-logging-guide/",
  "/recipes/deployments/kubernetes-statefulset-patterns/",
  "/recipes/deployments/kubernetes-statefulset-guide/",
  "/recipes/deployments/kubernetes-statefulset-management/",
  "/recipes/deployments/kubernetes-statefulset-headless-service/",
  "/recipes/deployments/kubernetes-daemonset/",
  "/recipes/deployments/kubernetes-replicaset-explained/",
  "/recipes/deployments/kubernetes-deployment-strategies/",
  "/recipes/deployments/kubernetes-deployment-rolling-update/",
  "/recipes/deployments/rolling-update-deployment/",
  "/recipes/deployments/kubernetes-rolling-update-strategies/",
  "/recipes/deployments/kubernetes-rolling-update-zero-downtime/",
  "/recipes/deployments/kubernetes-canary-deployment/",
  "/recipes/configuration/kubernetes-init-containers/",
  "/recipes/deployments/kubernetes-init-containers-guide/",
  "/recipes/deployments/sidecar-containers/",
  "/recipes/deployments/kubernetes-sidecar-containers-guide/",
  "/recipes/deployments/kubernetes-cronjob/",
  "/recipes/deployments/kubernetes-cronjob-patterns-guide/",
  "/recipes/deployments/kubernetes-job-cronjob/",
  "/recipes/deployments/kubernetes-jobs-cronjobs-guide/",
  "/recipes/deployments/jobs-cronjobs/",
  "/recipes/configuration/kubernetes-cronjob-concurrencypolicy-guide/",
  "/recipes/troubleshooting/kubernetes-coredns-troubleshooting/",
  "/recipes/networking/kubernetes-dns-guide/",
  "/recipes/networking/kubernetes-ingress-guide/",
  "/recipes/networking/kubernetes-gateway-api-guide/",
  "/recipes/networking/kubernetes-cni-comparison/",
  "/recipes/networking/kubernetes-service-types/",
  "/recipes/troubleshooting/kubernetes-502-bad-gateway-troubleshooting/",
  "/recipes/troubleshooting/kubernetes-imagepullbackoff-troubleshoot/",
  "/recipes/troubleshooting/kubernetes-imagepullbackoff-fix/",
  "/recipes/deployments/kubernetes-image-pull-optimization/",
  "/recipes/troubleshooting/kubernetes-oomkilled-fix/",
  "/recipes/configuration/kubernetes-cluster-upgrade-guide/",
  "/recipes/configuration/kubernetes-etcd-backup-restore/",
  "/recipes/deployments/kubernetes-multi-cluster-management/",
  "/recipes/configuration/kubernetes-multicluster-management/",
  "/recipes/deployments/kubernetes-multicluster-management-guide/",
  "/recipes/deployments/kubernetes-operator-pattern-guide/",
  "/recipes/ai/nccl-environment-variables-guide/",
  "/recipes/ai/nccl-roce-validation-mpijob-complete-reference/",
  "/recipes/configuration/crossplane-kubernetes-infrastructure-management/",
  "/recipes/configuration/kubernetes-crossplane-infrastructure-guide/",
  "/recipes/deployments/crossplane-kubernetes-infrastructure/",
  "/recipes/deployments/kubernetes-argocd-gitops-guide/",
  "/recipes/deployments/kubernetes-flux-gitops-guide/",
  "/recipes/deployments/argo-workflows-kubernetes/",
  "/recipes/deployments/tekton-pipelines-kubernetes/",
  "/recipes/configuration/kubernetes-backstage-developer-portal/",
  "/recipes/troubleshooting/kubernetes-chaos-engineering-litmus/",
  "/recipes/storage/kubernetes-backup-velero-guide/",
  "/recipes/storage/kubernetes-velero-backup-guide/",
  "/recipes/storage/velero-backup-disaster-recovery/",
  "/recipes/storage/kubernetes-rook-ceph-storage/",
  "/recipes/storage/kubernetes-longhorn-distributed-storage/",
  "/recipes/observability/kubernetes-loki-log-aggregation/",
  "/recipes/observability/logging-efk-stack/",
  "/recipes/observability/prometheus-monitoring-kubernetes-guide/",
  "/recipes/observability/alertmanager-setup/",
  "/recipes/deployments/cloudnativepg-postgresql-kubernetes/",
  "/recipes/deployments/cloudnativepg-kubernetes-postgresql/",
  "/recipes/helm/kubernetes-helm-oci-registry/",
  "/recipes/helm/kubernetes-helm-library-charts/",
  "/recipes/configuration/kubernetes-kustomize-configuration-management/",
  "/recipes/security/kubernetes-gvisor-runtimeclass-guide/",
  "/recipes/security/kubernetes-runtimeclass-gvisor-guide/",
  "/recipes/configuration/kubernetes-pod-lifecycle/",
  "/recipes/troubleshooting/kubernetes-pod-lifecycle-states/",
  "/recipes/helm/helm-hooks-lifecycle-guide/",
  "/recipes/deployments/openshift-lifecycle-support-versions/",
  "/recipes/configuration/openshift-lifecycle-versions/",
  "/recipes/troubleshooting/kubernetes-finalizers-explained-troubleshooting/",
  "/recipes/configuration/kubernetes-finalizers/",
  "/recipes/configuration/kubernetes-finalizers-ownership-guide/",
  "/recipes/configuration/kubernetes-finalizers-guide/",
  "/recipes/configuration/kubernetes-finalizers-explained/",
  "/recipes/deployments/kubernetes-pod-lifecycle-termination/",
  "/recipes/deployments/kubernetes-graceful-shutdown-prestop/",
  "/recipes/configuration/kubernetes-terminationgraceperiodseconds/",
  "/recipes/deployments/kubernetes-terminationgraceperiod/",
  "/recipes/deployments/kubernetes-graceful-shutdown-pod-termination/",
  "/recipes/deployments/kubernetes-graceful-shutdown/",
  "/recipes/gitops/",
  "/recipes/configuration/argocd-gitops/",
  "/recipes/configuration/flux-gitops/",
  "/recipes/configuration/downward-api/",
  "/recipes/configuration/kubernetes-jobs-cronjobs/",
  "/recipes/configuration/kubernetes-resource-optimization/",
  "/recipes/autoscaling/keda-event-autoscaling/",
  "/recipes/observability/container-logging/",
  "/recipes/observability/prometheus-monitoring/",
  "/recipes/storage/velero-backup-restore/",
  "/recipes/security/container-image-scanning/",
  "/recipes/security/kyverno-policies/",
  "/recipes/troubleshooting/custom-ca-registry/",
  "/recipes/deployments/blue-green-deployments/",
  "/recipes/deployments/kubernetes-jobs-cronjobs/",
  "/recipes/storage/s3-model-storage-permissions/deploy-mistral-vllm-kubernetes/",
  "/recipes/configuration/openshift-idms-install-config/",
  "/recipes/security/quay-robot-account-kubernetes/",
  "/recipes/security/network-policies/",
  "/recipes/configuration/kubernetes-lease-objects/",
  "/recipes/configuration/kubernetes-lease-api-leader-election/",
  "/recipes/configuration/kubernetes-lease-leader-election/",
  "/recipes/configuration/openshift-lifecycle-versions-guide/",
  "/recipes/observability/grafana-dashboard-6417-node-exporter/",
  "/recipes/deployments/kubernetes-daemonset-one-pod-per-node/",
  "/recipes/ai/volcano-batch-scheduling-kubernetes/",
  "/recipes/ai/volcano-batch-scheduler-gang-scheduling-kubernetes/",
  "/recipes/security/cert-manager-certificates/",
  "/recipes/security/container-security-scanning/",
  "/recipes/storage/csi-drivers-storage/",
  "/recipes/security/custom-ca-openshift-kubernetes/",
  "/recipes/troubleshooting/debug-crashloopbackoff/",
  "/recipes/observability/distributed-tracing-jaeger/",
  "/recipes/networking/istio-service-mesh/",
  "/recipes/autoscaling/keda-event-driven-autoscaling/",
  "/recipes/configuration/kubeconfig-contexts/",
  "/recipes/troubleshooting/kubectl-plugins-extensions/",
  "/recipes/configuration/kubernetes-backup-restore/",
  "/recipes/configuration/kubernetes-cronjob-concurrencypolicy/",
  "/recipes/troubleshooting/kubernetes-debug-container-ephemeral/",
  "/recipes/configuration/kubernetes-labels-annotations/",
  "/recipes/troubleshooting/kubernetes-node-taint-master-fix/",
  "/recipes/security/kubernetes-runtimeclass/",
  "/recipes/configuration/kustomize-configuration/",
  "/recipes/ai/nvidia-gpu-operator-setup/",
  "/recipes/deployments/pod-disruption-budgets/",
  "/recipes/deployments/pod-priority-preemption/",
  "/recipes/observability/prometheus-metrics-setup/",
  "/recipes/configuration/resource-quotas-namespace/",
  "/recipes/deployments/argocd-gitops-deployment/",
  "/recipes/deployments/blue-green-deployment/",
  "/recipes/autoscaling/cluster-autoscaler/",
  "/recipes/configuration/crossplane-infrastructure-management/",
  "/recipes/troubleshooting/debug-oom-killed/",
  "/recipes/configuration/downward-api-metadata/",
  "/recipes/troubleshooting/ephemeral-containers-debugging/",
  "/recipes/storage/etcd-backup-restore/",
  "/recipes/deployments/graceful-shutdown/",
  "/recipes/helm/helm-dependencies/",
  "/recipes/helm/helm-hooks/",
  "/recipes/deployments/init-containers/",
  "/recipes/networking/istio-traffic-management/",
  "/recipes/ai/kai-scheduler-topology-aware/",
  "/recipes/troubleshooting/kubectl-debugging-commands/",
  "/recipes/security/kubernetes-audit-logging/",
  "/recipes/troubleshooting/kubernetes-imagepullbackoff-troubleshooting/",
  "/recipes/deployments/kubernetes-probes-configuration/",
  "/recipes/networking/linkerd-service-mesh/",
  "/recipes/deployments/liveness-readiness-probes/",
  "/recipes/storage/local-persistent-volumes/",
  "/recipes/configuration/pod-resource-management/",
  "/recipes/security/pod-security-admission/",
  "/recipes/security/pod-security-context/",
  "/recipes/observability/prometheus-monitoring-setup/",
  "/recipes/networking/rate-limiting-kubernetes/",
  "/recipes/configuration/resource-requests-limits/",
  "/recipes/security/sealed-secrets-gitops/",
  "/recipes/networking/switch-gpudirect-rdma-dma-buf/",
  "/recipes/autoscaling/vertical-pod-autoscaler/",
  "/recipes/deployments/multi-container-pod-patterns/",
  "/recipes/configuration/node-taints-tolerations/",
  "/recipes/deployments/taints-tolerations/",
  "/recipes/security/oidc-authentication-kubernetes/",
  "/recipes/observability/opentelemetry-collector/",
  "/recipes/deployments/pod-affinity-anti-affinity/",
  "/recipes/deployments/pod-priority-preemption-scheduling/",
  "/recipes/security/admission-webhooks/",
  "/recipes/configuration/api-versions-deprecations/",
  "/recipes/troubleshooting/debug-dns-issues/",
  "/recipes/helm/helm-chart-creation/",
  "/recipes/troubleshooting/kubernetes-kubectl-exec-guide/",
  "/recipes/troubleshooting/kubernetes-network-debugging-guide/",
  "/recipes/troubleshooting/kubernetes-pending-pod-troubleshooting/",
  "/recipes/security/kyverno-policy-management/",
  "/recipes/deployments/topology-spread-constraints/",
  "/recipes/networking/nginx-ingress-tls-cert-manager/",
  "/recipes/storage/volume-snapshots/",
  "/recipes/networking/custom-dns-configuration/",
  "/recipes/autoscaling/hpa-custom-metrics/",
  "/recipes/networking/ingress-routing/",
  "/recipes/troubleshooting/troubleshooting-pending-pvc/",
  "/recipes/ai/nccl-allreduce-benchmark-profile/",
  "/recipes/configuration/open-kernel-modules-dma-buf/",
  "/recipes/observability/grafana-kubernetes-dashboards/",
  "/recipes/troubleshooting/fix-kubernetes-dns-resolution/",
]);

// https://astro.build/config
export default defineConfig({
  site: "https://kubernetes.recipes",
  base: "/",
  trailingSlash: "always",
  integrations: [
    mdx(),
    sitemap({
      changefreq: "weekly",
      priority: 0.7,
      lastmod: new Date(),
      // Use trailing slashes consistently to match trailingSlash: "always"
      customPages: [
        "https://kubernetes.recipes/",
        "https://kubernetes.recipes/recipes/",
        "https://kubernetes.recipes/chapters/",
        "https://kubernetes.recipes/authors/",
        "https://kubernetes.recipes/community/",
        "https://kubernetes.recipes/contact/",
      ],
      filter(page) {
        const url = new URL(page);
        // Exclude redirect stub pages (exact path match)
        if (redirectStubPaths.has(url.pathname)) {
          return false;
        }
        // Exclude demo/template pages (blog posts, pricing)
        if (page.includes("/blog/") || page.includes("/pricing/")) {
          return false;
        }
        // Exclude non-trailing-slash duplicates (customPages without slash already
        // generated trailing-slash versions via Astro, so drop bare versions)
        if (url.pathname !== "/" && !url.pathname.endsWith("/")) {
          return false;
        }
        return true;
      },
      serialize(item) {
        // Set homepage as highest priority
        if (item.url === "https://kubernetes.recipes/" || item.url === "https://kubernetes.recipes") {
          return { ...item, priority: 1.0, changefreq: "daily" };
        }
        // Recipe hub - high priority
        if (item.url.match(/\/recipes\/?$/)) {
          return { ...item, priority: 0.95, changefreq: "daily" };
        }
        // Recipe category pages - high priority
        if (item.url.match(/\/recipes\/[a-z-]+\/?$/)) {
          return { ...item, priority: 0.9, changefreq: "weekly" };
        }
        // Individual recipe pages - high priority
        if (item.url.match(/\/recipes\/[a-z-]+\/[a-z-]+\/?$/)) {
          return { ...item, priority: 0.85, changefreq: "monthly" };
        }
        // Set main pages as high priority
        if (item.url.match(/\/(chapters|pricing|authors)\/?$/)) {
          return { ...item, priority: 0.9, changefreq: "weekly" };
        }
        // Set blog posts
        if (item.url.includes("/blog/")) {
          return { ...item, priority: 0.8, changefreq: "monthly" };
        }
        return item;
      },
    }),
    icon(),
    (await import("astro-compress")).default({
      CSS: true,  // Astro-compress for minify
      HTML: {
        "html-minifier-terser": {
          removeAttributeQuotes: true,
        },
      },
      Image: false,
      JavaScript: true,
      SVG: true,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
//  outDir: "public",
//  publicDir: "static",
});
