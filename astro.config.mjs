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
