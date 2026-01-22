// 1. Import utilities from `astro:content`
import { z, defineCollection } from 'astro:content';

// 2. Define your collection(s)
const blogCollection = defineCollection({
  schema: z.object({
    draft: z.boolean(),
    title: z.string(),
    snippet: z.string(),
    image: z.object({
      src: z.string(),
      alt: z.string(),
    }),
    publishDate: z.string().transform(str => new Date(str)),
    author: z.string().default('Astroship'),
    category: z.string(),
    tags: z.array(z.string()),
  }),
});

const teamCollection = defineCollection({
  schema: z.object({
    draft: z.boolean(),
    name: z.string(),
    title: z.string(),
    avatar: z.object({
      src: z.string(),
      alt: z.string(),
    }),
    publishDate: z.string().transform(str => new Date(str)),
  }),
});

// Recipe collection for SEO-optimized Kubernetes tutorials
const recipeCollection = defineCollection({
  schema: z.object({
    draft: z.boolean().default(false),
    title: z.string(),
    description: z.string(),
    // Category for URL structure: networking, storage, security, deployments, observability, troubleshooting
    category: z.enum([
      'networking',
      'storage', 
      'security',
      'deployments',
      'observability',
      'troubleshooting',
      'autoscaling',
      'gitops',
      'helm'
    ]),
    // Difficulty level
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
    // Time to complete
    timeToComplete: z.string().default('15 minutes'),
    // Kubernetes version compatibility
    kubernetesVersion: z.string().default('1.28+'),
    // Prerequisites
    prerequisites: z.array(z.string()).default([]),
    // Related recipes (slugs)
    relatedRecipes: z.array(z.string()).default([]),
    // Tags for filtering
    tags: z.array(z.string()),
    // Publication date
    publishDate: z.string().transform(str => new Date(str)),
    // Last updated date
    updatedDate: z.string().transform(str => new Date(str)).optional(),
    // Author
    author: z.string().default('Luca Berton'),
    // Featured image
    image: z.object({
      src: z.string(),
      alt: z.string(),
    }).optional(),
  }),
});

// 3. Export a single `collections` object to register your collection(s)
//    This key should match your collection directory name in "src/content"
export const collections = {
  'blog': blogCollection,
  'team': teamCollection,
  'recipes': recipeCollection,
};