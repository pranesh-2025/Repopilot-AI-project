/**
 * src/lib/context/RepoContext.tsx
 *
 * Shared context that stores the currently imported GitHub repository.
 * Both DashboardPage (writes) and RepositoryPage (reads) consume this context.
 *
 * No external state library is used — this is a standard React context with
 * a single nullable value and its setter.
 */

import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import type { GitHubRepoMeta } from '../types/github'

// ─── Context shape ───────────────────────────────────────────────────────────

interface RepoContextValue {
  importedRepo: GitHubRepoMeta | null
  setImportedRepo: (repo: GitHubRepoMeta | null) => void
}

// ─── Context creation ────────────────────────────────────────────────────────

const RepoContext = createContext<RepoContextValue | null>(null)

// ─── Provider ────────────────────────────────────────────────────────────────

export function RepoProvider({ children }: { children: ReactNode }) {
  const [importedRepo, setImportedRepo] = useState<GitHubRepoMeta | null>(null)

  return (
    <RepoContext.Provider value={{ importedRepo, setImportedRepo }}>
      {children}
    </RepoContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Returns the current imported repo and its setter.
 * Must be called inside a component that is a descendant of <RepoProvider>.
 */
export function useImportedRepo(): RepoContextValue {
  const ctx = useContext(RepoContext)
  if (!ctx) {
    throw new Error('useImportedRepo must be used inside <RepoProvider>')
  }
  return ctx
}
