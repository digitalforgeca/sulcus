import type { MetadataRoute } from 'next';

export const dynamic = "force-static";

const BASE_URL = 'https://sulcus.ca';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/login`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/docs`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/docs/sdks`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/docs/triggers`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/docs/thermodynamic-engine`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/docs/memory-graph`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/docs/local-panel`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/docs/self-hosting`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/membench`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/status`,
      lastModified: now,
      changeFrequency: 'always',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/articles`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/articles/why-agents-forget`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/articles/thermodynamic-memory`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/articles/what-memory-feels-like`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];

  return staticPages;
}
