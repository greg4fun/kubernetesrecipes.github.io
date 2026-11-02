// One identity for Luca Berton and Open Empower in structured data, shared by
// all of Luca's sites (lucaberton.com, openempower.com, kubernetes.recipes,
// copypastelearn.com, udienza.com). Keep LUCA_BERTON and OPEN_EMPOWER identical
// to the copies on the other sites: same @id, name, url, jobTitle and sameAs.
// Search engines and AI assistants merge nodes by @id, so a different jobTitle
// or a typo in sameAs here splits the person into two entities.

export const OPEN_EMPOWER = {
  "@type": "Organization",
  "@id": "https://www.openempower.com/#organization",
  "name": "Open Empower",
  "url": "https://www.openempower.com/",
};

export const LUCA_BERTON = {
  "@type": "Person",
  "@id": "https://lucaberton.com/#person",
  "name": "Luca Berton",
  "url": "https://lucaberton.com/",
  "jobTitle": "Founder and CEO",
  "worksFor": { "@id": OPEN_EMPOWER["@id"] },
  "sameAs": [
    "https://www.linkedin.com/in/lucaberton/",
    "https://github.com/lucab85",
    "https://bsky.app/profile/lucaberton.com",
    "https://www.youtube.com/@BertonLuca",
  ],
};

// The site itself, as publisher of the recipes. Open Empower is its parent
// organization, so the recipes connect to the company and to its founder.
const SITE = "https://kubernetes.recipes";

export const KUBERNETES_RECIPES = {
  "@type": "Organization",
  "@id": `${SITE}#organization`,
  "name": "Kubernetes Recipes",
  "alternateName": "Kubernetes Recipe Book",
  "url": SITE,
  "logo": {
    "@type": "ImageObject",
    "url": `${SITE}/favicon.svg`,
    "width": 512,
    "height": 512,
  },
  "parentOrganization": OPEN_EMPOWER,
};

// Recipe/article author from a frontmatter `author` string: Luca's canonical
// Person for his name (and the default), the site Organization for the house
// byline "kubernetes-recipes", otherwise a plain Person.
export function authorEntity(name) {
  if (!name || name === LUCA_BERTON.name) return LUCA_BERTON;
  if (name === "kubernetes-recipes") {
    return { "@type": "Organization", "@id": KUBERNETES_RECIPES["@id"], "name": KUBERNETES_RECIPES.name, "url": SITE };
  }
  return { "@type": "Person", "name": name, "url": `${SITE}/authors/` };
}
