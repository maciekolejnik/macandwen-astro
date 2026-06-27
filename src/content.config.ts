import { defineCollection } from 'astro:content';
import { z } from 'zod';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.string().optional(),
    featured_image: z.url(),
    publishdate: z.string().optional(),
    small_image: z.url().optional(),
    summary: z.string().optional(),
  }),
});

export const collections = { blog };