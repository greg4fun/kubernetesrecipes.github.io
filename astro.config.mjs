import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";
import partytown from "@astrojs/partytown";

// https://astro.build/config
export default defineConfig({
  site: "https://kubernetes.recipes/",
  base: "/",
  integrations: [
    mdx(),
    sitemap(),
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
