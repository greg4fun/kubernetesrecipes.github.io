// Single source of truth for the Udienza banner (https://www.udienza.com).
// The banner images are served and redrawn daily by udienza.com: never copy
// them into this repo.
export const UDIENZA_ALT =
  "Udienza: ten minutes with the people who build what you run. Watch free.";
export const UDIENZA_LABEL = "Udienza, the ten-minute video show";
export const UDIENZA_WIDE = "https://www.udienza.com/banners/latest-wide.png";
export const UDIENZA_SQUARE = "https://www.udienza.com/banners/latest-square.png";

export function udienzaHref(placement) {
  return (
    "https://www.udienza.com/?utm_source=kubernetes.recipes&utm_medium=banner" +
    `&utm_campaign=udienza_banner&utm_content=latest_wide_${placement}`
  );
}

export const UDIENZA_FOOTER_HREF =
  "https://www.udienza.com/?utm_source=kubernetes.recipes&utm_medium=referral&utm_campaign=udienza_footer";

export const UDIENZA_CLASS = {
  aside: "udienza-banner not-prose my-8 mx-auto max-w-[735px]",
  a: "block",
  img: "w-full h-auto rounded-xl shadow-md",
};
