// Kubernetes Recipes (Apress), the book this site is built around. One place
// for the facts and links the book cards show (hero.astro, pricing.astro,
// cta.astro, the recipe page's mid-article and end-of-recipe cards).
//
// Facts are the ones already on the site (hero.astro): no prices, ratings or
// reviews. The Amazon link is the Amazon Associates short link, so it stays
// rel="sponsored noopener"; the Springer link is plain rel="noopener".
// Links carry data-book="kubernetes-recipes" and data-book-placement, so a
// click fires book_click (book, placement); see Layout.astro.

export const APRESS_BOOK = {
  slug: "kubernetes-recipes",
  title: "Kubernetes Recipes",
  subtitle: "A Practical Guide for Container Orchestration and Deployment",
  authors: "Grzegorz Stencel & Luca Berton",
  publisher: "Apress",
  pages: 750,
  amazon: "https://amzn.to/3DzC8QA",
  springer: "https://link.springer.com/book/9798868813245",
  // public/book/cover-400.webp: public/book/cover.jpg (990x1500) at 400 px.
  cover: "/book/cover-400.webp",
  coverWidth: 400,
  coverHeight: 607,
};
