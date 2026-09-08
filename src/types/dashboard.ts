// Shared TypeScript types for the RepoPilot dashboard.
// Keep in sync with src/api/client.ts as the real API is wired up.

export interface LanguageStat {
  language: string
  percentage: number
  color: string
}

export interface HealthScores {
  health: number
  architecture: number
  security: number
}

export interface RecentAnalysis {
  id: string
  repoUrl: string
  branch: string
  status: 'complete' | 'pending' | 'error'
  score: number
  analyzedAt: string
}

export interface RepoSummary {
  url: string
  owner: string
  name: string
  description: string
  primaryLanguage: string
  filesAnalyzed: number
  dependencies: number
  scores: HealthScores
  languages: LanguageStat[]
  recentAnalyses: RecentAnalysis[]
  lastScanned: string
}
