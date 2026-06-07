import { getCollection } from "astro:content";

// Native RSS 2.0 feed (no external dependency) — a distribution channel that was
// missing entirely (/rss.xml returned 404). Helps with Google Discover, feed
// readers, AI/news crawlers, and newsletter automation. Lists the most recent
// recipes for freshness; full discovery is handled by the sitemap.

const SITE = "https://kubernetes.recipes";
const MAX_ITEMS = 50;

const CATEGORY_LABELS: Record<string, string> = {
  ai: "AI & GPU",
  autoscaling: "Autoscaling",
  configuration: "Configuration",
  deployments: "Deployments",
  helm: "Helm",
  networking: "Networking",
  observability: "Observability",
  security: "Security",
  storage: "Storage",
  troubleshooting: "Troubleshooting",
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const recipes = (await getCollection("recipes"))
    .filter((r: any) => !r.data.draft)
    .sort((a: any, b: any) => new Date(b.data.publishDate).getTime() - new Date(a.data.publishDate).getTime())
    .slice(0, MAX_ITEMS);

  const buildDate = new Date().toUTCString();

  const items = recipes
    .map((r: any) => {
      const url = `${SITE}/recipes/${r.data.category}/${r.slug}/`;
      const pubDate = new Date(r.data.publishDate).toUTCString();
      const category = CATEGORY_LABELS[r.data.category] || r.data.category;
      return `    <item>
      <title>${escapeXml(r.data.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <category>${escapeXml(category)}</category>
      <description>${escapeXml(r.data.description || "")}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Kubernetes Recipes</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Production-ready Kubernetes and OpenShift recipes — deployments, networking, security, AI/GPU, storage, and troubleshooting.</description>
    <language>en-us</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
