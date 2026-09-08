/**
 * src/lib/types/knowledgeBase.ts
 *
 * TypeScript types for the Phase 5A in-memory Repository Knowledge Base.
 *
 * Design principles:
 *   - Every field is deterministically derived — nothing inferred by an LLM.
 *   - ChunkMetadata is the unit of retrieval; it carries its own provenance.
 *   - KnowledgeBase uses Map<string, …> for O(1) chunk/file lookup.
 *   - All types follow the same discriminated-union conventions as github.ts.
 *   - No `any` types.
 */

// ─── File classification ──────────────────────────────────────────────────────

/**
 * Semantic category of a source file.
 * Determined by path, filename, and language — never by LLM.
 */
export type FileClassification =
  | 'source'        // Application/library source code
  | 'test'          // Test, spec, or end-to-end files
  | 'configuration' // Config, CI, build, environment template files
  | 'documentation' // Markdown, RST, plain-text docs
  | 'generated'     // Compiled output, lock files, minified assets
  | 'unknown'       // Could not be classified with available evidence

// ─── Ignore reasons ───────────────────────────────────────────────────────────

/**
 * Why a file was excluded from the knowledge base.
 */
export type IgnoreReason =
  | 'binary'        // Binary or non-text file (FileNode.supported === false)
  | 'generated'     // Lock file, compiled output, or minified asset
  | 'secret'        // .env or credential-bearing filename
  | 'oversized'     // Content exceeds maxFileSizeBytes
  | 'not_fetched'   // File exists in tree but content was not provided to the builder
  | 'empty'         // File is zero-byte or whitespace-only
  | 'unsupported'   // Extension not in the supported language map
  | 'fetch_failed'  // Phase 5B: file was a valid acquisition candidate but the GitHub fetch failed

// ─── Chunking configuration ───────────────────────────────────────────────────

/**
 * Parameters controlling the sliding-window chunking algorithm.
 * All defaults are chosen to balance context density with chunk granularity.
 */
export interface ChunkingConfig {
  /**
   * Maximum number of source lines per chunk.
   * @default 80
   */
  maxChunkLines: number
  /**
   * Number of lines carried over from the end of one chunk into the start
   * of the next, providing context continuity.
   * @default 10
   */
  overlapLines: number
  /**
   * Minimum number of lines required to produce a standalone chunk.
   * Trailing windows smaller than this are merged into the previous chunk.
   * @default 5
   */
  minChunkLines: number
  /**
   * Maximum file content size in bytes. Files exceeding this are ignored.
   * Must match the GitHub service's own MAX_DISPLAY_BYTES (100 KB).
   * @default 100_000
   */
  maxFileSizeBytes: number
}

// ─── Chunk metadata ───────────────────────────────────────────────────────────

/**
 * The fundamental retrieval unit produced by the chunker.
 *
 * Every field is deterministically derived from repository evidence.
 * IDs are stable across repeated builds of the same repository state.
 */
export interface ChunkMetadata {
  /**
   * Deterministic identifier.
   * FNV-1a 32-bit hash of "{repository}::{path}::{startLine}::{endLine}".
   * Stable for identical inputs.
   */
  id: string
  /** Full repository name, e.g. "facebook/react" */
  repository: string
  /** File path relative to repository root, e.g. "src/App.tsx" */
  path: string
  /** Human-readable language label, e.g. "TypeScript" */
  language: string
  /** 1-based inclusive start line within the original file */
  startLine: number
  /** 1-based inclusive end line within the original file */
  endLine: number
  /** Exact source text for this chunk (never modified or sanitised) */
  content: string
  /**
   * Best-effort name of the leading declaration in this chunk
   * (function, class, method, heading, etc.).
   * Empty string if no declaration boundary was detected.
   */
  symbolHint: string
  /**
   * Concatenation of path + language + content for keyword/full-text search.
   * Computed once at build time to avoid repeated string concatenation.
   */
  searchableText: string
  /** Semantic classification of the containing file */
  classification: FileClassification
}

// ─── Indexed file record ──────────────────────────────────────────────────────

/**
 * Summary of a file that was successfully indexed into the knowledge base.
 */
export interface IndexedFile {
  /** File path relative to repository root */
  path: string
  /** Human-readable language label */
  language: string
  /** Semantic classification */
  classification: FileClassification
  /** Total number of lines in the original file */
  totalLines: number
  /** Number of chunks produced from this file */
  chunkCount: number
  /** Ordered list of chunk IDs for this file */
  chunkIds: string[]
}

// ─── Ignored file record ──────────────────────────────────────────────────────

/**
 * A file that was present in the repository tree but excluded from indexing.
 */
export interface IgnoredFile {
  /** File path relative to repository root */
  path: string
  /** Why the file was excluded */
  reason: IgnoreReason
}

// ─── Knowledge base statistics ────────────────────────────────────────────────

/**
 * Aggregate statistics about the built knowledge base.
 * All values are exact counts derived from the indexed data.
 */
export interface KnowledgeBaseStats {
  /** Total number of files successfully indexed */
  totalIndexedFiles: number
  /** Total number of files excluded from indexing */
  totalIgnoredFiles: number
  /** Total number of chunks across all indexed files */
  totalChunks: number
  /** Sum of (endLine - startLine + 1) across all chunks (excludes overlap double-counts) */
  approximateIndexedLines: number
  /** Indexed file count broken down by classification */
  filesByClassification: Record<FileClassification, number>
  /** Indexed file count broken down by language label */
  filesByLanguage: Record<string, number>
  /** Chunk count broken down by language label */
  chunksByLanguage: Record<string, number>
}

// ─── Knowledge base ───────────────────────────────────────────────────────────

/**
 * Top-level in-memory knowledge base object.
 *
 * Phase 5A: purely in-memory, no persistence.
 * Maps are used for O(1) chunk/file lookup.
 */
export interface KnowledgeBase {
  /** Full repository name, e.g. "facebook/react" */
  repository: string
  /** ISO 8601 timestamp of when this KB was built */
  builtAt: string
  /** Whether the GitHub tree response was truncated (analysis may be incomplete) */
  truncated: boolean
  /** All chunk metadata keyed by chunk ID */
  chunks: Map<string, ChunkMetadata>
  /** Indexed file records keyed by file path */
  fileIndex: Map<string, IndexedFile>
  /** Files that were present in the tree but excluded from indexing */
  ignoredFiles: IgnoredFile[]
  /** Aggregate statistics */
  stats: KnowledgeBaseStats
  /** The chunking configuration used to build this KB */
  config: ChunkingConfig
}

// ─── Build result ─────────────────────────────────────────────────────────────

export type KnowledgeBuildError =
  | { kind: 'no_repository'; message: string }
  | { kind: 'no_files';      message: string }
  | { kind: 'build_failed';  message: string; cause?: unknown }

export type KnowledgeBuildResult =
  | { ok: true;  kb: KnowledgeBase }
  | { ok: false; error: KnowledgeBuildError }

// ─── Hook state ───────────────────────────────────────────────────────────────

/**
 * State machine for the useKnowledgeBase hook.
 * Mirrors the AnalysisState pattern from useRepositoryAnalysis.
 */
export type KnowledgeBaseState =
  | { phase: 'idle' }
  | { phase: 'building' }
  | { phase: 'done';  kb: KnowledgeBase }
  | { phase: 'error'; message: string }
