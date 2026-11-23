// Luca's own video courses on CopyPasteLearn (https://www.copypastelearn.com)
// and which recipes show them. THE ONE PLACE TO EDIT.
//
// Only courses that are live there with video: a course whose free lesson has
// no video is not linked from this site, neither from a recipe card nor from
// the general block or the homepage list. Titles and descriptions are the
// ones on each course page (kagent and otel-agents copied Nov 18, 2026, the
// others Nov 21, 2026, including mcp-server, goose, mlops-mac and
// kubernetes-mac, added that day; the Hermes description is shortened from
// its "What you'll learn" list and the Kubernetes on your Mac one from the
// first sentences of its description). No prices, ratings, student counts or
// lab promises: they go stale.
//
// Own product, not an affiliate offer: the card (course-cta.astro) carries no
// data-affiliate attribute, so it never fires `affiliate_click`, and its link
// is a normal followed link (no rel="sponsored" or "nofollow"). A click on a
// link inside [data-cpl-course] fires `course_click` (Layout.astro).

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
  "llm-d": {
    title: "llm-d Distributed Inference Without GPUs",
    description:
      "Use a Kubernetes simulation to observe how llm-d routes, queues, and scales inference requests, then compare the simulator with a GPU serving setup.",
    format: "6 video lessons.",
    path: "/courses/llm-d-distributed-inference",
  },
  hermes: {
    title: "A personal AI agent on your Mac with Hermes Agent",
    description:
      "Install Hermes Agent on your Mac, connect it to a local Ollama model, then add approvals, skills, memory, an MCP server and scheduled tasks.",
    format: "6 video lessons.",
    path: "/courses/hermes-agent",
  },
  openclaw: {
    title: "OpenClaw: Your First AI Agent",
    description:
      "Deploy OpenClaw locally or on a small VPS, add real tools, create one reusable automation, and apply essential security guardrails.",
    format: "7 video lessons.",
    path: "/courses/openclaw-agent",
  },
  dapr: {
    title: "Build Durable AI Agents with Dapr Agents",
    description:
      "Agents that survive restarts: workflows, state and pub/sub with Dapr Agents, from the first agent to a multi-agent system.",
    format: "6 video lessons.",
    path: "/courses/build-durable-ai-agents-with-dapr-agents",
  },
  "mcp-server": {
    title: "Build and Secure an MCP Server",
    description:
      "Build a real MCP server in Python with the official SDK, serve it over HTTP, add authentication and hardening, then deploy it to a kagent cluster.",
    format: "6 video lessons.",
    path: "/courses/build-and-secure-an-mcp-server",
  },
  goose: {
    title: "Run Coding Agents in Production with goose and AGENTS.md",
    description:
      "Install goose, teach it your project's rules with AGENTS.md, then run it the way a team does: recipes, CI, guardrails and a record of what it did.",
    format: "6 video lessons.",
    path: "/courses/coding-agents-in-production-goose-agents-md",
  },
  // The two below have no tag rule. They are the courses of the general block
  // (course-cta.astro) and of the homepage list (courses-section.astro).
  "mlops-mac": {
    title: "MLOps on Your Mac: Experiments, Model Registry and Trust",
    description:
      "Follow a model from its first training run through registration, deployment, and monitoring, with checks before promotion.",
    format: "6 video lessons.",
    path: "/courses/mlops-on-your-mac",
  },
  "kubernetes-mac": {
    title: "Kubernetes on your Mac",
    description:
      "Build a multi-node Kubernetes cluster on your Apple Silicon Mac using kind, install applications with Helm and reach them using ingress or Gateway.",
    format: "6 video lessons.",
    path: "/courses/kubernetes-on-your-mac",
  },
};

// A recipe about one of these tools gets the course about that tool, whatever
// its category. First match wins, in this order.
const TOOL_TAGS = [
  ["hermes", new Set(["hermes", "hermes-agent"])],
  ["openclaw", new Set(["openclaw"])],
  ["dapr", new Set(["dapr", "dapr-agents"])],
  ["llm-d", new Set(["llm-d"])],
  // Model Context Protocol. The plain "mcp" tag is NOT here (see AGENT_TAGS).
  // Tool tags are checked before AGENT_TAGS, so an MCP recipe that also has
  // the "kagent" tag gets this course and not the kagent one.
  ["mcp-server", new Set(["model-context-protocol", "mcp-server"])],
  ["goose", new Set(["goose", "agents-md"])],
];

// Tags that mark an agent recipe: the kagent course.
// "mcp" is NOT here on purpose: on this site it means MachineConfigPool
// (OpenShift), not Model Context Protocol. "agent" and "agents" alone are not
// here either: they also tag node agents and the agent-based installer.
const AGENT_TAGS = new Set(["ai-agent", "ai-agents", "agentic-ai", "multi-agent", "kagent"]);

// Tags that mark a recipe about serving a model: the llm-d course. "inference"
// alone counts only inside the AI category (see copyPasteLearnCourseKey): a
// recipe filed elsewhere that mentions it in passing keeps the general block.
const SERVING_TAGS = new Set([
  "vllm", "llm-serving", "model-serving", "distributed-inference", "inference-optimization",
  "kserve", "triton", "tensorrt-llm", "nvidia-nim", "kv-cache",
]);

// Tags that mark an AI or LLM recipe filed under another category. Loose tags
// such as "machine-learning" are left out: those recipes keep the general
// course block.
const AI_TAGS = new Set(["ai", "ai-workloads", "llm", "llms", "genai", "generative-ai"]);

// Tags that mark a tracing recipe filed under another category. "monitoring"
// and "observability" alone are too loose there (a DaemonSet guide has them).
const TRACING_TAGS = new Set(["tracing", "distributed-tracing", "opentelemetry", "otel", "jaeger"]);

/**
 * The course key for one recipe, or null (the recipe then keeps the general
 * course block). The topic decides first: a recipe about one tool, about
 * agents or about model serving gets that course. Then the category: every
 * other AI recipe gets the kagent course and every other observability recipe
 * the OpenTelemetry course. Recipes filed elsewhere match by tag, AI before
 * tracing.
 */
export function copyPasteLearnCourseKey({ category = "", tags = [] } = {}) {
  const cat = String(category).toLowerCase();
  const t = (tags || []).map((x) => String(x).toLowerCase());
  for (const [key, set] of TOOL_TAGS) {
    if (t.some((x) => set.has(x))) return key;
  }
  if (t.some((x) => AGENT_TAGS.has(x))) return "kagent";
  if (t.some((x) => SERVING_TAGS.has(x))) return "llm-d";
  if (cat === "ai") return t.includes("inference") ? "llm-d" : "kagent";
  if (cat === "observability") return "otel-agents";
  if (t.some((x) => AI_TAGS.has(x))) return "kagent";
  if (t.some((x) => TRACING_TAGS.has(x))) return "otel-agents";
  return null;
}

/**
 * A CopyPasteLearn URL with the group's campaign tags. `content` says which
 * card the click came from: a course key, or a name such as "general-mid".
 */
export function copyPasteLearnUrl(path, content) {
  const params = new URLSearchParams({
    utm_source: "kubernetes.recipes",
    utm_medium: "referral",
    utm_campaign: "group-crosslink",
    utm_content: content,
  });
  return `https://www.copypastelearn.com${path}?${params}`;
}

/** Course data plus its tagged URL, or null. */
export function copyPasteLearnCourseFor(recipe) {
  const key = copyPasteLearnCourseKey(recipe);
  if (!key) return null;
  const course = COPYPASTELEARN_COURSES[key];
  return { key, ...course, url: copyPasteLearnUrl(course.path, key) };
}
