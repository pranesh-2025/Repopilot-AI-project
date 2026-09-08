/**
 * src/lib/services/retrievalService.ts
 *
 * Phase 5B: Deterministic keyword-based retrieval over the in-memory KnowledgeBase.
 *
 * Two exported functions:
 *   buildRetrievalIndex(kb)           — builds a fast-lookup index from a KB
 *   search(index, query)              — scores, filters, and ranks chunks
 *
 * Architecture:
 *   KnowledgeBase (from useKnowledgeBase)
 *       ↓
 *   buildRetrievalIndex(kb)  — tokenise chunks once at index-build time
 *       ↓
 *   RetrievalIndex (in-memory, keyed by chunkId)
 *       ↓
 *   search(index, query)     — score each entry, apply filters, sort by relevance
 *       ↓
 *   RetrievalResult { chunks: RetrievedChunk[] }
 *
 * Scoring:
 *   Three weighted signals (all deterministic, no LLM, no embeddings):
 *     1. Content term match  — query token found in chunk's searchableText tokens
 *     2. Path segment match  — query token matches a path segment
 *     3. Symbol hint match   — query token matches a symbol hint token
 *
 *   Weights: content=1.0, path=2.0, symbol=3.0
 *   Score is normalised to [0, 1].
 *
 * Security:
 *   - Query text is lowercased and split — never eval'd or used in regex construction
 *   - Content is never rendered as HTML
 *   - No user input reaches the GitHub API
 *   - All tokenisation is static string operations
 */

import type {
  RetrievalIndex,
  ChunkIndexEntry,
  RetrievalQuery,
  RetrievalResult,
  RetrievedChunk,
} from '../types/retrieval'
import type { KnowledgeBase, ChunkMetadata } from '../types/knowledgeBase'

// ─── Scoring weights ──────────────────────────────────────────────────────────

const WEIGHT_CONTENT = 1.0
const WEIGHT_PATH    = 2.0
const WEIGHT_SYMBOL  = 3.0

// Maximum possible score per query token (when all three signals fire)
const MAX_WEIGHT_PER_TOKEN = WEIGHT_CONTENT + WEIGHT_PATH + WEIGHT_SYMBOL

// ─── Tokenisation helpers ─────────────────────────────────────────────────────

/**
 * Splits text into lowercase tokens on whitespace and non-alphanumeric boundaries.
 * Filters out empty strings and very short tokens (length < 2).
 * Used for content tokenisation.
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter((t) => t.length >= 2)
}

/**
 * Splits a camelCase or snake_case identifier into component tokens.
 * Examples:
 *   "renderComponent" → ["render", "component"]
 *   "get_file_content" → ["get", "file", "content"]
 *   "HTTPClient"       → ["http", "client"]
 */
function splitIdentifier(identifier: string): string[] {
  if (!identifier) return []
  return identifier
    // Insert space before uppercase letters that follow lowercase letters (camelCase)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Insert space before consecutive uppercase followed by lowercase (acronyms like "HTTPClient")
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // Split on non-alphanumeric (underscores, hyphens, dots)
    .split(/[\W_]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 2)
}

// ─── Index builder ────────────────────────────────────────────────────────────

/**
 * Builds a RetrievalIndex from a KnowledgeBase.
 *
 * This should be called once after the KB is built (or rebuilt) and the
 * result stored in component state (e.g. via useMemo keyed on kb.builtAt).
 *
 * Time complexity: O(N × C) where N = chunks, C = avg content length.
 *
 * @param kb - The knowledge base to index
 */
export function buildRetrievalIndex(kb: KnowledgeBase): RetrievalIndex {
  const entries: ChunkIndexEntry[] = []
  const chunkMap = new Map<string, ChunkMetadata>()

  for (const chunk of kb.chunks.values()) {
    // Register in chunkMap for O(1) content lookup during search
    chunkMap.set(chunk.id, chunk)

    // Tokenise the full searchable text (path + language + content)
    const tokens = new Set(tokenise(chunk.searchableText))

    // Path segments for path-prefix and segment matching
    const pathSegments = chunk.path
      .toLowerCase()
      .split('/')
      .filter((s) => s.length > 0)

    // Symbol tokens from camelCase/underscore splitting of the symbol hint
    const symbolTokens = splitIdentifier(chunk.symbolHint)

    entries.push({
      chunkId:       chunk.id,
      tokens,
      pathSegments,
      symbolTokens,
      classification: chunk.classification,
      language:       chunk.language,
      path:           chunk.path,
    })
  }

  return {
    entries,
    chunkMap,
    builtAt:     kb.builtAt,
    totalChunks: kb.chunks.size,
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Performs a deterministic keyword search over the retrieval index.
 *
 * Scoring model (per query token, summed across all tokens):
 *   +WEIGHT_CONTENT if token is in the chunk's searchableText token set
 *   +WEIGHT_PATH    if token matches any path segment
 *   +WEIGHT_SYMBOL  if token matches any symbol hint token
 *
 * Final score = min(rawScore / (queryTokens.length × MAX_WEIGHT_PER_TOKEN), 1.0)
 * Ensures score is always in [0, 1].
 *
 * @param index - Pre-built RetrievalIndex
 * @param query - Search query with optional filters
 */
export function search(
  index: RetrievalIndex,
  query: RetrievalQuery,
): RetrievalResult {
  try {
    // Validate and tokenise the query
    const trimmed = query.queryText.trim()
    if (!trimmed) {
      return { ok: true, chunks: [], totalMatches: 0, query }
    }

    if (index.entries.length === 0) {
      return { ok: true, chunks: [], totalMatches: 0, query }
    }

    const queryTokens = tokenise(trimmed)
    if (queryTokens.length === 0) {
      return { ok: true, chunks: [], totalMatches: 0, query }
    }

    const minScore   = query.minScore   ?? 0.0
    const maxResults = query.maxResults ?? 20
    const filter     = query.filter

    // Normalise filter lists for fast lookup
    const filterClassifications = filter?.classifications
      ? new Set(filter.classifications)
      : null
    const filterLanguages = filter?.languages
      ? new Set(filter.languages.map((l) => l.toLowerCase()))
      : null
    const filterPathPrefix = filter?.pathPrefix
      ? filter.pathPrefix.toLowerCase()
      : null

    // Score all entries
    interface ScoredEntry {
      entry: ChunkIndexEntry
      relevanceScore: number
      matchedTerms: string[]
    }

    const scored: ScoredEntry[] = []
    const denominator = queryTokens.length * MAX_WEIGHT_PER_TOKEN

    for (const entry of index.entries) {
      // ── Apply pre-score filters ──────────────────────────────────────────
      if (filterClassifications && !filterClassifications.has(entry.classification)) {
        continue
      }
      if (filterLanguages && !filterLanguages.has(entry.language.toLowerCase())) {
        continue
      }
      if (filterPathPrefix && !entry.path.toLowerCase().startsWith(filterPathPrefix)) {
        continue
      }

      // ── Score this entry ─────────────────────────────────────────────────
      let rawScore = 0
      const matchedTerms: string[] = []

      for (const token of queryTokens) {
        let tokenScore = 0

        if (entry.tokens.has(token)) {
          tokenScore += WEIGHT_CONTENT
        }
        if (entry.pathSegments.includes(token)) {
          tokenScore += WEIGHT_PATH
        }
        if (entry.symbolTokens.includes(token)) {
          tokenScore += WEIGHT_SYMBOL
        }

        if (tokenScore > 0) {
          rawScore += tokenScore
          matchedTerms.push(token)
        }
      }

      if (rawScore === 0) continue  // No match at all

      const relevanceScore = Math.min(rawScore / denominator, 1.0)
      if (relevanceScore < minScore) continue

      scored.push({ entry, relevanceScore, matchedTerms })
    }

    // Sort descending by relevance score
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore)

    const totalMatches = scored.length

    // Map to RetrievedChunk (look up full chunk metadata)
    const chunks: RetrievedChunk[] = scored
      .slice(0, maxResults)
      .map(({ entry, relevanceScore, matchedTerms }) => {
        // chunkMap is guaranteed to have this entry (same KB source)
        const chunk = index.chunkMap.get(entry.chunkId)!
        return {
          chunkId:       chunk.id,
          repository:    chunk.repository,
          path:          chunk.path,
          language:      chunk.language,
          startLine:     chunk.startLine,
          endLine:       chunk.endLine,
          content:       chunk.content,
          classification: chunk.classification,
          symbolHint:    chunk.symbolHint,
          relevanceScore,
          matchedTerms,
        }
      })

    return { ok: true, chunks, totalMatches, query }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Retrieval failed — unknown error.'
    return { ok: false, error: message }
  }
}
