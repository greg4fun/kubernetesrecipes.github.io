import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";


// Redirect pages to exclude from sitemap (these are client-side redirects, not real content)
// These pages exist in src/pages/recipes/[category]/*.astro as redirect stubs
const redirectPages = [
  "blue-green-deployments",
  "prometheus-monitoring", 
  "argocd-gitops",
  "flux-gitops",
  "kubernetes-jobs-cronjobs",
  "keda-event-autoscaling",
  "container-logging",
  "downward-api",
  "kyverno-policies",
  "velero-backup-restore",
  "container-image-scanning",
  "kubernetes-jobs-cronjobs",
  "deploy-mistral-vllm-kubernetes",
  "gitops",
];

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
        "https://kubernetes.recipes/blog/",
        "https://kubernetes.recipes/pricing/",
        "https://kubernetes.recipes/community/",
        "https://kubernetes.recipes/contact/",
      ],
      filter(page) {
        // Exclude redirect stub pages
        for (const redirect of redirectPages) {
          if (page.includes(`/recipes/`) && page.includes(`/${redirect}/`)) {
            return false;
          }
        }
        // Exclude non-trailing-slash duplicates (customPages without slash already
        // generated trailing-slash versions via Astro, so drop bare versions)
        const url = new URL(page);
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
