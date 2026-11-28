// AI/GPU recipes and their end-of-recipe offers: Luca's Leanpub ebooks and the
// GPU cluster design review on lucaberton.com. THE ONE PLACE TO EDIT.
//
// Which box a recipe shows at the end (cert-cta.astro), first match wins:
//   1. OpenShift recipe (openshift.mjs): the OpenShift upgrade review, plus
//      one line for the OpenShift AI ebook when the recipe is about AI/GPU
//      workloads on OpenShift (isOpenShiftAiRecipe);
//   2. AI/GPU recipe (isAiGpuRecipe): the Kubernetes AI ebook and the GPU
//      cluster design review;
//   3. any other recipe: the Linux Foundation certification for its category.
//
// Tracking (Layout.astro): a Leanpub link carries data-book and fires
// `book_click` (book, placement); the review link carries data-enterprise-cta
// and fires `enterprise_cta_click` (offer, placement). No prices for the
// ebooks: Leanpub prices vary. The review price is the one on its page.

/** Slug words (split on "-") that mark an AI/GPU recipe. */
const SLUG_WORDS = new Set([
  "gpu", "gpus", "nvidia", "rdma", "nccl", "vllm", "llm", "llms", "cuda",
  "infiniband", "roce", "gpudirect",
]);

/** Tags that mark an AI/GPU recipe, whole. Tags starting with gpu- or nvidia- count too. */
const TAGS = new Set([
  ...SLUG_WORDS,
  "llm-serving", "model-serving", "distributed-inference", "inference-optimization",
  "gpu-operator", "mig", "kserve", "triton", "tensorrt-llm", "nvidia-nim", "dcgm",
  // GPU fabric: RoCE/InfiniBand NICs and their drivers.
  "rocev2", "mofed", "mellanox", "connectx", "nfsordma", "doca", "gpudirect-storage",
  "accelerators", "llm-security",
]);

const TITLE_RE = /\b(gpus?|nvidia|rdma|nccl|vllm|llms?|cuda|infiniband|roce|gpudirect)\b/i;

const words = (slug) => String(slug).toLowerCase().split("-");
const lower = (tags) => (tags || []).map((x) => String(x).toLowerCase().trim());

/**
 * True for an AI/GPU recipe: category "ai", or GPU, NVIDIA, RDMA, NCCL, vLLM
 * or LLM-serving words in the slug or title, or at least two such tags. One
 * tag alone is not enough: general guides (taints, Karpenter, the cluster
 * autoscaler) carry a lone "gpu" tag and keep their certification box.
 */
export function isAiGpuRecipe({ category = "", slug = "", title = "", tags = [] } = {}) {
  if (String(category).toLowerCase() === "ai") return true;
  if (words(slug).some((w) => SLUG_WORDS.has(w))) return true;
  if (TITLE_RE.test(String(title))) return true;
  const hits = lower(tags).filter((t) => TAGS.has(t) || t.startsWith("gpu-") || t.startsWith("nvidia-"));
  return hits.length >= 2;
}

// Extra words that mark an AI workload, counted only on OpenShift recipes
// (where "ai", "inference" or "training" are not ambiguous).
const OPENSHIFT_AI_WORDS = new Set([
  "rhoai", "openshift-ai", "ai", "ml", "mlops", "kubeflow", "runai", "instructlab",
  "inference", "training", "fine-tuning",
]);
const OPENSHIFT_AI_TITLE_RE = /\b(openshift ai|rhoai|red hat ai|ai|kubeflow|run:ai|inference|training)\b/i;

/**
 * True for an OpenShift recipe about OpenShift AI, RHOAI or AI/GPU workloads.
 * Call it only for recipes isOpenShiftRecipe() already matched.
 */
export function isOpenShiftAiRecipe(recipe = {}) {
  if (isAiGpuRecipe(recipe)) return true;
  const { slug = "", title = "", tags = [] } = recipe;
  if (words(slug).some((w) => OPENSHIFT_AI_WORDS.has(w))) return true;
  if (lower(tags).some((t) => OPENSHIFT_AI_WORDS.has(t))) return true;
  return OPENSHIFT_AI_TITLE_RE.test(String(title));
}

// Leanpub coupon that tags sales from this site. It exists on both books at
// full price (no discount, no end date): Leanpub does not report UTMs, so the
// coupon is how its Sales page shows which site sold a copy.
export const LEANPUB_COUPON = "kubernetesrecipes";

export const LEANPUB_BOOKS = {
  "kubernetes-ai": {
    title: "Kubernetes AI",
    // From the book's Leanpub description.
    description:
      "A hands-on guide to running LLMs and GPU workloads on Kubernetes: inference, training, NVIDIA GPUs, storage, networking, security and operations.",
    url: `https://leanpub.com/kubernetes-ai/c/${LEANPUB_COUPON}`,
  },
  "openshift-ai": {
    title: "OpenShift AI Platform Guide",
    url: `https://leanpub.com/openshift-ai/c/${LEANPUB_COUPON}`,
  },
};

export const GPU_REVIEW = {
  offer: "gpu-review",
  title: "GPU cluster design review",
  // As on https://lucaberton.com/services/gpu-cluster-review/ (Nov 28, 2026).
  terms: "EUR 10,000 · two weeks · written recommendation and a working session",
  url: "https://lucaberton.com/services/gpu-cluster-review/",
};

const tagged = (base, campaign, slug) => {
  const params = new URLSearchParams({
    utm_source: "kubernetes.recipes",
    utm_medium: "referral",
    utm_campaign: campaign,
    utm_content: slug,
  });
  return `${base}?${params}`;
};

/** A Leanpub book URL; utm_campaign leanpub-<book>, utm_content the recipe slug. */
export const leanpubUrl = (book, slug) => tagged(LEANPUB_BOOKS[book].url, `leanpub-${book}`, slug);

/** The GPU review URL; utm_campaign gpu-review, utm_content the recipe slug. */
export const gpuReviewUrl = (slug) => tagged(GPU_REVIEW.url, GPU_REVIEW.offer, slug);
