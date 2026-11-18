// Luca's own video courses on CopyPasteLearn (https://www.copypastelearn.com)
// and which recipes show them. THE ONE PLACE TO EDIT.
//
// Only courses that are live there with video. Titles and descriptions are the
// ones on each course page (copied Nov 18, 2026). No prices, ratings, student
// counts or lab promises: they go stale.
//
// Own product, not an affiliate offer: the card (course-cta.astro) carries no
// data-affiliate attribute, so it never fires `affiliate_click`, and its link
// is a normal followed link (no rel="sponsored" or "nofollow").

export const COPYPASTELEARN_COURSES = {
  kagent: {
    title: "kagent 1.0: Run AI Agents on Kubernetes",
    description:
      "Install kagent 1.0, build a Kubernetes-native AI agent, give it MCP tools, contain it with egress policies and trace everything it does.",
    format: "7 video lessons.",
    path: "/courses/kagent-ai-agents-on-kubernetes",
  },
  "otel-agents": {
    title: "Observe and Debug AI Agents with OpenTelemetry",
    description:
      "Trace every model call and tool call of an agent, read the traces, and find why a run was slow, expensive or wrong.",
    format: "6 video lessons.",
    path: "/courses/observe-and-debug-ai-agents-with-opentelemetry",
  },
};

// Tags that mark an AI, LLM or agent recipe filed under another category.
// "mcp" is NOT here on purpose: on this site it means MachineConfigPool
// (OpenShift), not Model Context Protocol. "agent" and "agents" alone are not
// here either: they also tag node agents and the agent-based installer.
// Loose tags such as "inference" or "machine-learning" are left out too: a
// recipe that only mentions them in passing keeps the general course block.
const AI_TAGS = new Set([
  "ai", "ai-workloads", "llm", "llms", "genai", "generative-ai",
  "ai-agent", "ai-agents", "agentic-ai", "multi-agent", "kagent",
]);

// Tags that mark a tracing recipe filed under another category. "monitoring"
// and "observability" alone are too loose there (a DaemonSet guide has them).
const TRACING_TAGS = new Set(["tracing", "distributed-tracing", "opentelemetry", "otel", "jaeger"]);

/**
 * The course key for one recipe, or null (the recipe then keeps the general
 * course block). The category decides first: every AI recipe and every
 * observability recipe gets its course. Recipes filed elsewhere match by tag,
 * AI before tracing; OpenClaw recipes among them keep their OpenClaw course.
 */
export function copyPasteLearnCourseKey({ category = "", tags = [] } = {}) {
  const cat = String(category).toLowerCase();
  const t = (tags || []).map((x) => String(x).toLowerCase());
  if (cat === "ai") return "kagent";
  if (cat === "observability") return "otel-agents";
  if (t.includes("openclaw")) return null;
  if (t.some((x) => AI_TAGS.has(x))) return "kagent";
  if (t.some((x) => TRACING_TAGS.has(x))) return "otel-agents";
  return null;
}

/** Course data plus its tagged URL, or null. */
export function copyPasteLearnCourseFor(recipe) {
  const key = copyPasteLearnCourseKey(recipe);
  if (!key) return null;
  const course = COPYPASTELEARN_COURSES[key];
  const params = new URLSearchParams({
    utm_source: "kubernetes.recipes",
    utm_medium: "referral",
    utm_campaign: "group-crosslink",
    utm_content: key,
  });
  return { key, ...course, url: `https://www.copypastelearn.com${course.path}?${params}` };
}
