import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";
import partytown from "@astrojs/partytown";

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
      customPages: [
        "https://kubernetes.recipes",
        "https://kubernetes.recipes/recipes",
        "https://kubernetes.recipes/chapters",
        "https://kubernetes.recipes/authors",
        "https://kubernetes.recipes/blog",
        "https://kubernetes.recipes/pricing",
        "https://kubernetes.recipes/community",
        "https://kubernetes.recipes/contact",
      ],
      serialize(item) {
        // Set homepage as highest priority
        if (item.url === "https://kubernetes.recipes") {
          return { ...item, priority: 1.0, changefreq: "daily" };
        }
        // Recipe hub - high priority
        if (item.url === "https://kubernetes.recipes/recipes") {
          return { ...item, priority: 0.95, changefreq: "daily" };
        }
        // Recipe category pages - high priority
        if (item.url.match(/\/recipes\/[a-z-]+$/)) {
          return { ...item, priority: 0.9, changefreq: "weekly" };
        }
        // Individual recipe pages - high priority
        if (item.url.match(/\/recipes\/[a-z-]+\/[a-z-]+$/)) {
          return { ...item, priority: 0.85, changefreq: "monthly" };
        }
        // Set main pages as high priority
        if (item.url.match(/\/(chapters|pricing|authors)$/)) {
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
    partytown({ config: { forward: ["dataLayer.push"] } }), // Using the correct import
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
