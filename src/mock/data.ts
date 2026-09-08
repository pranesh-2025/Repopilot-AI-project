// MOCK DATA — replace with real API calls from src/api/client.ts
// when the backend analysis pipeline is ready.
// DO NOT import this file from any production service or API layer.

import type { RepoSummary } from '../types/dashboard'

export const MOCK_REPO: RepoSummary = {
  url: 'https://github.com/facebook/react',
  owner: 'facebook',
  name: 'react',
  description:
    'The library for web and native user interfaces. Maintained by Meta and a community of individual developers and companies.',
  primaryLanguage: 'JavaScript',
  filesAnalyzed: 1842,
  dependencies: 34,
  lastScanned: '2025-07-14T09:32:00Z',
  scores: {
    health: 87,
    architecture: 74,
    security: 91,
  },
  languages: [
    { language: 'JavaScript', percentage: 62, color: '#f7df1e' },
    { language: 'TypeScript', percentage: 24, color: '#3178c6' },
    { language: 'CSS', percentage: 9,  color: '#563d7c' },
    { language: 'Other',      percentage: 5,  color: '#6e7681' },
  ],
  recentAnalyses: [
    {
      id: 'a1',
      repoUrl: 'https://github.com/facebook/react',
      branch: 'main',
      status: 'complete',
      score: 87,
      analyzedAt: '2025-07-14T09:32:00Z',
    },
    {
      id: 'a2',
      repoUrl: 'https://github.com/vercel/next.js',
      branch: 'canary',
      status: 'complete',
      score: 82,
      analyzedAt: '2025-07-13T16:11:00Z',
    },
    {
      id: 'a3',
      repoUrl: 'https://github.com/vuejs/core',
      branch: 'main',
      status: 'error',
      score: 0,
      analyzedAt: '2025-07-12T11:05:00Z',
    },
  ],
}
