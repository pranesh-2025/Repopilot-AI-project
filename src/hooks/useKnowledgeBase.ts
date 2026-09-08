/**
 * src/hooks/useKnowledgeBase.ts
 *
 * Phase 5A/5B Knowledge Base orchestration hook.
 *
 * Phase 5A behaviour (unchanged):
 *   Accepts Phase 4 data (flatFiles + fetchedContents) and builds an
 *   in-memory KnowledgeBase using only the already-fetched manifests.
 *   No new GitHub API calls.
 *
 * Phase 5B extension:
 *   When acquisitionState reaches 'done', this hook rebuilds the KB with
 *   the additional acquired source files merged in. Failed fetch paths are
 *   added to ignoredFiles with reason 'fetch_failed' for transparency.
 *
 * Architecture:
 *   useRepositoryAnalysis (Phase 4) → Phase4Data { flatFiles, fetchedContents, truncated }
 *       ↓
 *   useSourceAcquisition (Phase 5B) → AcquisitionState (optional)
 *       ↓
 *   useKnowledgeBase(repo, phase4Data, acquisitionState)
 *       ↓
 *   buildKnowledgeBase(meta, flatFiles, truncated, mergedContents, config, additionalContents)
 *       ↓
 *   KnowledgeBaseState
 *
 * Security:
 *   - No .env content ever reaches this hook (excluded upstream by Phase 4 + planner)
 *   - No repository code is executed
 *   - buildKnowledgeBase() is pure synchronous — no I/O
 */

import { useState, useEffect, useRef } from 'react'
import type { GitHubRepoMeta, FileNode, FileContent } from '../lib/types/github'
import type { KnowledgeBaseState, IgnoredFile } from '../lib/types/knowledgeBase'
import type { AcquisitionState } from '../lib/types/retrieval'
import { buildKnowledgeBase } from '../lib/services/knowledgeBaseService'

export type { KnowledgeBaseState }

// ─── Phase 4 data shape ───────────────────────────────────────────────────────

/**
 * The data produced by Phase 4 (useRepositoryAnalysis) that the KB hook needs.
 * Passed in directly to avoid coupling to AnalysisState.
 */
export interface Phase4Data {
  flatFiles: FileNode[]
  fetchedContents: Map<string, FileContent>
  truncated: boolean
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Builds an in-memory knowledge base from Phase 4 data, optionally extended
 * with Phase 5B acquired source files.
 *
 * Rebuilds whenever:
 *   - `repo` changes (new import)
 *   - `phase4Data` changes (re-analysis)
 *   - `acquisitionState` transitions to 'done' (new source files available)
 *
 * @param repo             - Normalised repository metadata, or null if none imported
 * @param phase4Data       - Data already fetched by useRepositoryAnalysis, or null
 * @param acquisitionState - Phase 5B acquisition state (optional — Phase 5A compat)
 */
export function useKnowledgeBase(
  repo: GitHubRepoMeta | null,
  phase4Data: Phase4Data | null,
  acquisitionState?: AcquisitionState,
): KnowledgeBaseState {
  const [state, setState] = useState<KnowledgeBaseState>({ phase: 'idle' })

  // Track which combination we last started a build for to discard stale builds
  const activeKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!repo || !phase4Data) {
      setState({ phase: 'idle' })
      activeKeyRef.current = null
      return
    }

    // Key includes acquisition phase so a completed acquisition triggers a rebuild
    const acquisitionKey =
      acquisitionState?.phase === 'done'
        ? `acq:${acquisitionState.acquiredContents.size}`
        : `acq:${acquisitionState?.phase ?? 'none'}`

    const buildKey =
      `${repo.fullName}::${phase4Data.flatFiles.length}::${String(phase4Data.truncated)}::${acquisitionKey}`

    activeKeyRef.current = buildKey

    let cancelled = false

    async function runBuild() {
      if (!repo || !phase4Data) return

      setState({ phase: 'building' })

      // Yield to React to let the 'building' state render before the
      // synchronous builder blocks the thread.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      if (cancelled) return

      // Determine additional contents from Phase 5B acquisition
      let additionalContents: Map<string, FileContent> | undefined
      let fetchFailedFiles: IgnoredFile[] = []

      if (acquisitionState?.phase === 'done') {
        additionalContents = acquisitionState.acquiredContents

        // Convert fetch failures to IgnoredFile entries for transparency
        fetchFailedFiles = acquisitionState.fetchFailures.map((failure) => ({
          path: failure.path,
          reason: 'fetch_failed' as const,
        }))
      }

      const buildResult = buildKnowledgeBase(
        repo,
        phase4Data.flatFiles,
        phase4Data.truncated,
        phase4Data.fetchedContents,
        {},
        additionalContents,
      )

      if (cancelled) return

      if (buildResult.ok) {
        // Inject fetch_failed entries into ignoredFiles for Phase 5B failures.
        // We append them to the KB's ignoredFiles list so the UI can display them.
        if (fetchFailedFiles.length > 0) {
          const kb = buildResult.kb
          // Create a new KB object with the augmented ignoredFiles list
          // (do not mutate the returned KB — keep it immutable)
          const augmentedKb = {
            ...kb,
            ignoredFiles: [...kb.ignoredFiles, ...fetchFailedFiles],
            stats: {
              ...kb.stats,
              totalIgnoredFiles: kb.stats.totalIgnoredFiles + fetchFailedFiles.length,
            },
          }
          setState({ phase: 'done', kb: augmentedKb })
        } else {
          setState({ phase: 'done', kb: buildResult.kb })
        }
      } else {
        setState({ phase: 'error', message: buildResult.error.message })
      }
    }

    runBuild().catch((err: unknown) => {
      if (!cancelled) {
        const message =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while building the knowledge base.'
        setState({ phase: 'error', message })
      }
    })

    return () => {
      cancelled = true
    }
  }, [repo, phase4Data, acquisitionState])

  return state
}
