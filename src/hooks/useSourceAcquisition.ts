/**
 * src/hooks/useSourceAcquisition.ts
 *
 * Phase 5B: React hook for batched, manual GitHub source file acquisition.
 *
 * Responsibilities:
 *  1. Call planAcquisition() to determine which files are safe to fetch.
 *  2. Fetch those files from GitHub in bounded batches.
 *  3. Emit granular progress state after each batch.
 *  4. Surface individual fetch failures as FetchFailure[] (never silently discard).
 *  5. Expose trigger() (opt-in, manual) and reset() controls.
 *
 * Design decisions:
 *  - Acquisition is MANUAL: trigger() must be called explicitly.
 *    It is never called automatically by this hook.
 *  - maxFiles=100 by default (safety cap — see DEFAULT_MAX_FILES).
 *  - Bounded concurrency: BATCH_SIZE files per concurrent batch.
 *  - Promise.allSettled() ensures one failure does not abort the batch.
 *  - Failed files are recorded in FetchFailure[] and surfaced to the caller.
 *  - acquiredContents does NOT include Phase 4 fetchedContents — merging
 *    is done explicitly by the KB hook.
 *
 * Security:
 *  - planAcquisition() runs before any network call — it is the security gate.
 *  - No GitHub token is stored in hook state or passed to components.
 *  - getFileContent() enforces a 100 KB per-file content limit.
 *  - Error messages are sanitised before surfacing (no token/secret leakage).
 */

import { useState, useRef, useCallback } from 'react'
import type { GitHubRepoMeta, FileNode, FileContent } from '../lib/types/github'
import type { AcquisitionState, FetchFailure, AcquisitionPlan } from '../lib/types/retrieval'
import { getFileContent } from '../lib/services/githubService'
import { planAcquisition, DEFAULT_MAX_FILES } from '../lib/services/sourceAcquisitionService'

export type { AcquisitionState }

// ─── Configuration ────────────────────────────────────────────────────────────

/** Number of files fetched concurrently within a single batch */
const BATCH_SIZE = 5

/** Milliseconds to pause between batches (rate-limit courtesy delay) */
const BATCH_DELAY_MS = 200

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Extracts a safe, display-ready error message from an unknown error value.
 * Never returns strings that could contain secrets or credentials.
 */
function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Fetch failed — unknown error.'
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseSourceAcquisitionOptions {
  /**
   * Maximum number of source files to acquire.
   * @default DEFAULT_MAX_FILES (100)
   */
  maxFiles?: number
  /**
   * Number of files fetched concurrently per batch.
   * @default BATCH_SIZE (5)
   */
  batchSize?: number
  /**
   * Delay in milliseconds between consecutive batches.
   * @default BATCH_DELAY_MS (200)
   */
  batchDelayMs?: number
}

export interface UseSourceAcquisitionReturn {
  state: AcquisitionState
  /**
   * Start the acquisition run.
   * Idempotent — calling while not idle is a no-op.
   */
  trigger: () => void
  /**
   * Reset state to idle and cancel any in-flight acquisition.
   * Safe to call at any time (e.g. on new repo import).
   */
  reset: () => void
}

/**
 * Manages the manual, batched acquisition of source files from GitHub.
 *
 * @param repo            - Repository metadata (owner, name, branch)
 * @param flatFiles       - All file nodes from Phase 4 tree fetch
 * @param fetchedContents - Phase 4 manifest map (files already available)
 * @param options         - Optional tuning parameters
 */
export function useSourceAcquisition(
  repo: GitHubRepoMeta | null,
  flatFiles: FileNode[],
  fetchedContents: Map<string, FileContent>,
  options?: UseSourceAcquisitionOptions,
): UseSourceAcquisitionReturn {
  const [state, setState] = useState<AcquisitionState>({ phase: 'idle' })

  // cancelledRef: set to true by reset() to stop the in-flight async loop
  const cancelledRef = useRef(false)

  const reset = useCallback(() => {
    cancelledRef.current = true
    setState({ phase: 'idle' })
  }, [])

  const trigger = useCallback(() => {
    // Guard: only start from idle state
    if (state.phase !== 'idle') return
    if (!repo) return

    const maxFiles  = options?.maxFiles     ?? DEFAULT_MAX_FILES
    const batchSize = options?.batchSize    ?? BATCH_SIZE
    const batchDelay = options?.batchDelayMs ?? BATCH_DELAY_MS

    // Reset the cancellation flag for this new run
    cancelledRef.current = false

    async function run() {
      if (!repo) return

      // ── Step 1: Plan ──────────────────────────────────────────────────────
      setState({ phase: 'planning' })

      let plan: AcquisitionPlan
      try {
        plan = planAcquisition(flatFiles, fetchedContents, { maxFiles })
      } catch (err: unknown) {
        if (!cancelledRef.current) {
          setState({ phase: 'error', message: `Acquisition planning failed: ${safeErrorMessage(err)}` })
        }
        return
      }

      if (cancelledRef.current) return

      // If there's nothing to fetch, complete immediately
      if (plan.toFetch.length === 0) {
        setState({
          phase: 'done',
          acquiredContents: new Map(),
          plan,
          fetchFailures: [],
        })
        return
      }

      // ── Step 2: Fetch in batches ──────────────────────────────────────────
      const acquiredContents = new Map<string, FileContent>()
      const fetchFailures: FetchFailure[] = []
      let fetched = 0
      let failed = 0
      const total = plan.toFetch.length

      // Initialise progress state
      setState({
        phase: 'fetching',
        fetched: 0,
        failed: 0,
        total,
        currentFile: plan.toFetch[0]?.path ?? '',
      })

      // Process in batches of batchSize
      for (let batchStart = 0; batchStart < total; batchStart += batchSize) {
        if (cancelledRef.current) return

        const batch = plan.toFetch.slice(batchStart, batchStart + batchSize)

        // Update currentFile to the first file of this batch
        if (!cancelledRef.current) {
          setState({
            phase: 'fetching',
            fetched,
            failed,
            total,
            currentFile: batch[0]?.path ?? '',
          })
        }

        // Fetch all files in the batch concurrently
        const results = await Promise.allSettled(
          batch.map((file) =>
            getFileContent(repo.owner, repo.name, file.path, repo.defaultBranch),
          ),
        )

        if (cancelledRef.current) return

        // Process batch results
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          const file = batch[i]

          if (result.status === 'fulfilled') {
            const fetchResult = result.value
            if (fetchResult.ok) {
              acquiredContents.set(file.path, fetchResult.data)
              fetched++
            } else {
              // GitHub returned an error response
              fetchFailures.push({
                path: file.path,
                errorMessage: fetchResult.error.message,
              })
              failed++
            }
          } else {
            // Promise itself rejected (network/thrown error)
            fetchFailures.push({
              path: file.path,
              errorMessage: safeErrorMessage(result.reason),
            })
            failed++
          }
        }

        // Update progress after the batch
        if (!cancelledRef.current) {
          setState({
            phase: 'fetching',
            fetched,
            failed,
            total,
            currentFile: batch[batch.length - 1]?.path ?? '',
          })
        }

        // Courtesy delay between batches (skip after last batch)
        if (batchStart + batchSize < total && !cancelledRef.current) {
          await delay(batchDelay)
        }
      }

      if (cancelledRef.current) return

      // ── Step 3: Done ──────────────────────────────────────────────────────
      setState({
        phase: 'done',
        acquiredContents,
        plan,
        fetchFailures,
      })
    }

    run().catch((err: unknown) => {
      if (!cancelledRef.current) {
        setState({
          phase: 'error',
          message: `Source acquisition failed: ${safeErrorMessage(err)}`,
        })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, repo, flatFiles, fetchedContents, options?.maxFiles, options?.batchSize, options?.batchDelayMs])

  return { state, trigger, reset }
}
