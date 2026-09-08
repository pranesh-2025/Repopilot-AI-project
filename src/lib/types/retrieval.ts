/**
 * src/lib/types/retrieval.ts
 *
 * Phase 5B: TypeScript types for source acquisition and retrieval.
 *
 * Design principles:
 *   - All state machines use discriminated unions (no boolean flags).
 *   - Every acquisition outcome is recorded — no silent failures.
 *   - RetrievedChunk carries full provenance for AI citation.
 *   - No `any` types.
 */

import type { FileNode, FileContent } from './github'
import type { FileClassification } from './knowledgeBase'

// Re-export for convenience in consumers
export type { FileNode, FileContent }

// ─── Acquisition skip reasons ─────────────────────────────────────────────────

/**
 * Why a file was excluded from the source acquisition plan.
 * Mirrors IgnoreReason in knowledgeBase.ts but covers the pre-fetch phase.
 */
export type AcquisitionSkipReason =
  | 'already_fetched'   // Present in Phase 4 fetchedContents — no re-fetch needed
  | 'binary'            // Non-text extension (image, font, archive, etc.)
  | 'generated'         // Lock file, compiled output, auto-generated code
  | 'secret'            // .env, credentials, private key, certificate
  | 'oversized'         // FileNode.size > MAX_SOURCE_FILE_BYTES
  | 'dependency'        // node_modules, vendor, .venv, site-packages, etc.
  | 'build_output'      // dist/, build/, .next/, __pycache__, coverage/, etc.
  | 'unsupported'       // FileNode.supported === false
  | 'cap_reached'       // maxFiles limit reached — excess files excluded

/** A file that was present in the tree but excluded from acquisition. */
export interface SkippedFile {
  /** File path relative to repository root */
  path: string
  /** Why this file was not added to the fetch queue */
  reason: AcquisitionSkipReason
}

// ─── Acquisition plan ─────────────────────────────────────────────────────────

/**
 * The output of planAcquisition(): a complete, auditable description of
 * which files will be fetched, which are already available, and which
 * are excluded and why.
 *
 * This plan is produced BEFORE any GitHub API call is made.
 */
export interface AcquisitionPlan {
  /** Files that passed all safety checks and will be fetched from GitHub */
  toFetch: FileNode[]
  /** Files excluded from fetching with their reasons */
  skipped: SkippedFile[]
  /**
   * Paths already present in Phase 4 fetchedContents.
   * These are NOT re-fetched; they are available immediately.
   */
  alreadyAvailable: string[]
  /** Total candidate files considered (flatFiles.length) */
  totalCandidates: number
}

// ─── Acquisition state machine ────────────────────────────────────────────────

/**
 * State machine for the useSourceAcquisition hook.
 *
 * Transitions:
 *   idle → planning → fetching → done
 *   idle → planning → error (if planAcquisition throws)
 *   fetching → done  (even if some individual files fail)
 */
export type AcquisitionState =
  | { phase: 'idle' }
  | { phase: 'planning' }
  | {
      phase: 'fetching'
      /** Number of files successfully fetched so far */
      fetched: number
      /** Number of files that failed so far */
      failed: number
      /** Total files in the acquisition plan */
      total: number
      /** Path of the file currently being fetched */
      currentFile: string
    }
  | {
      phase: 'done'
      /** Newly acquired file contents — does NOT include Phase 4 fetchedContents */
      acquiredContents: Map<string, FileContent>
      /** The plan that drove this acquisition run */
      plan: AcquisitionPlan
      /** Files that could not be fetched despite passing the safety filter */
      fetchFailures: FetchFailure[]
    }
  | { phase: 'error'; message: string }

/** A file that passed the acquisition filter but failed during the GitHub fetch. */
export interface FetchFailure {
  /** File path relative to repository root */
  path: string
  /** Human-readable error message safe to display (no secrets) */
  errorMessage: string
}

// ─── Retrieval index (internal shapes exposed for service use) ────────────────

/**
 * Pre-processed index entry for a single chunk.
 * Built once from the KnowledgeBase; queried repeatedly.
 */
export interface ChunkIndexEntry {
  chunkId: string
  /** Normalised tokens from searchableText (path + language + content) */
  tokens: Set<string>
  /** Path split by '/' for prefix/segment matching */
  pathSegments: string[]
  /** Tokens derived from symbolHint (camelCase and underscore split) */
  symbolTokens: string[]
  classification: FileClassification
  language: string
  /** Path for prefix filtering */
  path: string
}

/** The in-memory retrieval index over a KnowledgeBase. */
export interface RetrievalIndex {
  /** Ordered list of all index entries */
  entries: ChunkIndexEntry[]
  /** Direct reference back to chunk content keyed by chunkId */
  chunkMap: Map<string, import('./knowledgeBase').ChunkMetadata>
  /** ISO timestamp from the KB that produced this index */
  builtAt: string
  /** How many chunks were indexed */
  totalChunks: number
}

// ─── Retrieval query and results ──────────────────────────────────────────────

/** Optional filters applied before scoring. */
export interface RetrievalFilter {
  /** Only return chunks from these classifications */
  classifications?: FileClassification[]
  /** Only return chunks from files in these languages */
  languages?: string[]
  /** Only return chunks from files whose path starts with this prefix */
  pathPrefix?: string
}

/** A user-supplied search request. */
export interface RetrievalQuery {
  /** Raw user input — tokenised internally; never eval'd or passed to regex constructor */
  queryText: string
  /** Optional filters applied before scoring */
  filter?: RetrievalFilter
  /**
   * Maximum number of results to return.
   * @default 20
   */
  maxResults?: number
  /**
   * Minimum relevance score threshold [0, 1].
   * Chunks scoring below this are excluded.
   * @default 0.0  (return all chunks with at least one term match)
   */
  minScore?: number
}

/**
 * A single retrieval result — the authoritative unit for downstream use.
 * Carries full provenance so AI answers can cite exact file + line ranges.
 */
export interface RetrievedChunk {
  /** Stable chunk identifier (FNV-1a hash from KB) */
  chunkId: string
  /** Full repository name, e.g. "facebook/react" */
  repository: string
  /** File path relative to repository root */
  path: string
  /** Human-readable language label */
  language: string
  /** 1-based inclusive start line */
  startLine: number
  /** 1-based inclusive end line */
  endLine: number
  /** Exact source text — never modified or sanitised */
  content: string
  /** Semantic classification of the containing file */
  classification: FileClassification
  /**
   * Best-effort leading declaration name (function, class, etc.).
   * Empty string if no declaration boundary was detected.
   */
  symbolHint: string
  /**
   * Normalised relevance score in [0, 1].
   * Deterministic: same KB + same query always produces the same score.
   */
  relevanceScore: number
  /** The query terms that produced at least one hit in this chunk */
  matchedTerms: string[]
}

/** The result of a retrieval search operation. */
export type RetrievalResult =
  | {
      ok: true
      chunks: RetrievedChunk[]
      /** Total matching chunks before maxResults truncation */
      totalMatches: number
      query: RetrievalQuery
    }
  | { ok: false; error: string }
