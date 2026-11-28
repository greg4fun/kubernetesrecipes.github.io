// OpenShift recipes and the Open Empower OpenShift upgrade review.
// THE ONE PLACE TO EDIT.
//
// OpenShift is the largest topic on the site (lifecycle and end of support,
// version matrix, oc commands, custom CA, IDMS/ICSP mirroring). Its readers run
// OpenShift at work, so the end-of-recipe box offers them the upgrade review
// instead of the CKA (cert-cta.astro). Every other recipe keeps the CKA box.
//
// Own offer, not an affiliate one: the link carries no data-affiliate, so it
// never fires `affiliate_click`. A click on a link marked data-enterprise-cta
// fires `enterprise_cta_click` with offer and placement (Layout.astro).

/** Words in a slug (split on "-") or tags that mark an OpenShift recipe. */
const TOKENS = new Set([
  "openshift", "ocp", "oc", "rhacs", "idms", "icsp", "redhat", "red-hat",
]);

// The bare "acs" is NOT here on purpose: on this site it also means PCIe Access
// Control Services (disable-acs-pcie-gpu-direct-p2p). RHACS recipes match by
// "rhacs", "openshift" or "Advanced Cluster Security".
//
// Titles: the same words, "Red Hat", and the oc CLI ("oc cp", "oc adm ...").
// "oc" counts only lowercase and followed by a space and a letter, so "OC" or
// "Oct" never match.
const TITLE_RE = /\b(openshift|ocp|rhacs|idms|icsp)\b|\bred hat\b|advanced cluster security/i;
const TITLE_OC_RE = /(^|[\s`'"(])oc [a-z]/;

/**
 * True for a recipe about OpenShift: matched by slug, title or tags.
 * Tags match whole ("openshift", "ocp", "rhacs") or as a prefix ("openshift-4",
 * "ocp-upgrade").
 */
export function isOpenShiftRecipe({ slug = "", title = "", tags = [] } = {}) {
  const words = String(slug).toLowerCase().split("-");
  if (words.some((w) => TOKENS.has(w))) return true;
  const t = (tags || []).map((x) => String(x).toLowerCase().trim());
  if (t.some((x) => TOKENS.has(x) || x.startsWith("openshift") || x.startsWith("ocp-") || x === "red hat")) return true;
  const ti = String(title);
  return TITLE_RE.test(ti) || TITLE_OC_RE.test(ti);
}

export const OPENSHIFT_REVIEW = {
  offer: "openshift-review",
  title: "OpenShift upgrade review",
  price: "€2,900",
  url: "https://www.openempower.com/services/openshift-upgrade-review",
};

/** The review URL with the group's campaign tags; utm_content is the recipe slug. */
export function openShiftReviewUrl(slug) {
  const params = new URLSearchParams({
    utm_source: "kubernetes.recipes",
    utm_medium: "referral",
    utm_campaign: OPENSHIFT_REVIEW.offer,
    utm_content: slug,
  });
  return `${OPENSHIFT_REVIEW.url}?${params}`;
}
