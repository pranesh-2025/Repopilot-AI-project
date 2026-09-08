/**
 * src/hooks/useRepositoryAnalysis.ts
 *
 * Orchestration hook for Phase 4 Repository Intelligence Analysis.
 *
 * Responsible for:
 *  1. Fetching the repository file tree via getRepoTree()
 *  2. Fetching the contents of recommended manifest / config files
 *  3. Passing collected data to the synchronous analyzeRepository()
 *  4. Exposing loading, error, and result state to the caller
 *
 * Phase 5A addition:
 *  The 'done' state now also carries `flatFiles` and `fetchedContents` so that
 *  the Phase 5A knowledge-base hook can reuse already-fetched data without
 *  making any additional GitHub API calls.
 *
 * This hook never calls the GitHub API from within analyzeRepository().
 * All I/O is performed here; the analyzer receives already-fetched data.
 *
 * Security:
 *  - .env files are excluded from content fetching (paths only)
 *  - Only RECOMMENDED_FETCH_PATHS files have their content fetched
 *  - No repository code is executed
 */

import { useState, useEffect, useRef } from 'react'
import type { GitHubRepoMeta, FileNode, FileContent, AnalysisResult } from '../lib/types/github'
import { getRepoTree, getFileContent } from '../lib/services/githubService'
import { analyzeRepository, RECOMMENDED_FETCH_PATHS } from '../lib/services/repositoryAnalyzer'

// ─── Types ───────────────────────────────────────────────────────────────────

export type AnalysisState =
  | { phase: 'idle' }
  | { phase: 'fetching-tree' }
  | { phase: 'fetching-files'; fetched: number; total: number }
  | { phase: 'analyzing' }
  | {
      phase: 'done'
      result: AnalysisResult
      /** Flat file list from the tree fetch — reused by Phase 5A KB builder */
      flatFiles: FileNode[]
      /** Fetched manifest contents — reused by Phase 5A KB builder */
      fetchedContents: Map<string, FileContent>
      /** Whether the GitHub tree was truncated */
      truncated: boolean
    }
  | { phase: 'error'; message: string }

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Runs the full repository intelligence analysis for the given repo metadata.
 * Re-runs whenever `repo` changes (new import).
 *
 * @param repo - Normalised repository metadata, or null if none imported
 */
export function useRepositoryAnalysis(repo: GitHubRepoMeta | null): AnalysisState {
  const [state, setState] = useState<AnalysisState>({ phase: 'idle' })

  // Track the repo we last started an analysis for so we can cancel stale runs
  const activeRepoRef = useRef<string | null>(null)

  useEffect(() => {
    if (!repo) {
      setState({ phase: 'idle' })
      activeRepoRef.current = null
      return
    }

    const repoKey = repo.fullName
    activeRepoRef.current = repoKey

    let cancelled = false

    async function runAnalysis() {
      if (!repo) return

      // ── Step 1: Fetch the file tree ──────────────────────────────────────
      setState({ phase: 'fetching-tree' })

      const treeResult = await getRepoTree(repo.owner, repo.name, repo.defaultBranch)

      if (cancelled) return

      if (!treeResult.ok) {
        setState({
          phase: 'error',
          message: `Could not fetch repository tree: ${treeResult.error.message}`,
        })
        return
      }

      const { flatFiles, truncated } = treeResult

      // ── Step 2: Fetch recommended manifest / config file contents ────────
      // Only fetch files that (a) exist in the tree and (b) are in RECOMMENDED_FETCH_PATHS
      // Never fetch .env files (their paths are recorded by the analyzer via flatFiles, not content)
      const filesToFetch: FileNode[] = flatFiles.filter((f) => {
        const name = f.name
        const path = f.path
        // Exclude actual .env files — we record their existence (path) but never their content
        if (/^\.env(?!\.(?:example|sample))/i.test(name)) return false
        // Only fetch files in our recommended list (by filename match)
        return RECOMMENDED_FETCH_PATHS.some((rec) => {
          const recName = rec.split('/').pop() ?? rec
          return name === recName || path === rec
        })
      })

      setState({ phase: 'fetching-files', fetched: 0, total: filesToFetch.length })

      const fetchedContents = new Map<string, FileContent>()

      for (let i = 0; i < filesToFetch.length; i++) {
        if (cancelled) return

        const file = filesToFetch[i]
        const contentResult = await getFileContent(
          repo.owner,
          repo.name,
          file.path,
          repo.defaultBranch,
        )

        if (!cancelled && contentResult.ok) {
          fetchedContents.set(file.path, contentResult.data)
        }
        // On failure (too large, network error, etc.) we simply skip — the analyzer
        // handles missing files gracefully

        setState({ phase: 'fetching-files', fetched: i + 1, total: filesToFetch.length })
      }

      if (cancelled) return

      // ── Step 3: Run synchronous static analysis ──────────────────────────
      setState({ phase: 'analyzing' })

      // Small yield to let React render the "analyzing" state before the
      // synchronous analyzer blocks the thread
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      if (cancelled) return

      const result = analyzeRepository(repo, flatFiles, truncated, fetchedContents)

      if (!cancelled) {
        setState({ phase: 'done', result, flatFiles, fetchedContents, truncated })
      }
    }

    runAnalysis().catch((err: unknown) => {
      if (!cancelled) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred during analysis.'
        setState({ phase: 'error', message })
      }
    })

    return () => {
      cancelled = true
    }
  }, [repo])

  return state
}
