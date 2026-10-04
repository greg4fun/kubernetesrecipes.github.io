// Build-time insertion of the Udienza banner into long-form Markdown/MDX
// content (recipes, blog posts): right after the first real top-level
// paragraph, so it is in the static HTML (no JavaScript, no layout shift).
// If there is no real paragraph within the first six blocks, it goes at the
// top of the body.
import {
  UDIENZA_ALT,
  UDIENZA_CLASS,
  UDIENZA_LABEL,
  UDIENZA_SQUARE,
  UDIENZA_WIDE,
  udienzaHref,
} from "../utils/udienza.mjs";

const MAX_BLOCKS = 6;

const text = (node) =>
  node.type === "text"
    ? node.value
    : (node.children || []).map(text).join("");

const isBlock = (n) => n.type === "element" || n.type === "mdxJsxFlowElement";

// A paragraph with actual text (not an image-only paragraph).
const isRealParagraph = (n) =>
  n.type === "element" && n.tagName === "p" && text(n).trim().length > 0;

const h = (tagName, properties, children = []) => ({
  type: "element",
  tagName,
  properties,
  children,
});

export function udienzaBannerNode(placement) {
  return h(
    "aside",
    { className: UDIENZA_CLASS.aside.split(" "), "aria-label": UDIENZA_LABEL },
    [
      h(
        "a",
        {
          href: udienzaHref(placement),
          target: "_blank",
          rel: "noopener",
          className: [UDIENZA_CLASS.a],
        },
        [
          h("picture", {}, [
            h("source", { media: "(max-width: 640px)", srcSet: UDIENZA_SQUARE }),
            h("img", {
              src: UDIENZA_WIDE,
              alt: UDIENZA_ALT,
              width: 1200,
              height: 300,
              loading: "eager",
              decoding: "async",
              className: UDIENZA_CLASS.img.split(" "),
            }),
          ]),
        ],
      ),
    ],
  );
}

export default function rehypeUdienzaBanner() {
  return (tree, file) => {
    const path = String(file.path || "").replaceAll("\\", "/");
    const placement = path.includes("/src/content/recipes/")
      ? "recipe_top"
      : path.includes("/src/content/blog/")
        ? "post_top"
        : null;
    if (!placement) return;

    const banner = udienzaBannerNode(placement);
    const children = tree.children;
    let seen = 0;
    for (let i = 0; i < children.length && seen < MAX_BLOCKS; i++) {
      const node = children[i];
      if (!isBlock(node)) continue;
      seen++;
      if (isRealParagraph(node)) {
        children.splice(i + 1, 0, banner);
        return;
      }
    }
    children.unshift(banner);
  };
}
