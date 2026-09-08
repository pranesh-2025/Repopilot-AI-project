/**
 * src/components/repository/RetrievalSearchPanel.tsx
 *
 * Phase 5B: Deterministic source retrieval search UI.
 *
 * Displays:
 *  1. Search input with debounce
 *  2. Classification filter checkboxes
 *  3. Result count and query info
 *  4. Ranked RetrievedChunk results with:
 *     - file path (monospace)
 *     - language badge
 *     - line range (L{start}–L{end})
 *     - relevance score badge
 *     - symbol hint (if available)
 *     - first 8 lines of content as plain text
 *
 * Security:
 *  - Source content is ALWAYS rendered inside <pre><code> as plain text.
 *  - React escapes HTML by default — no dangerouslySetInnerHTML anywhere.
 *  - Query input is a controlled field — never eval'd or sent to GitHub.
 *  - No repository code is executed.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, ChevronDown, ChevronUp } from 'lucide-react'
import type { KnowledgeBase, FileClassification } from '../../lib/types/knowledgeBase'
import type { RetrievedChunk, RetrievalFilter } from '../../lib/types/retrieval'
import { buildRetrievalIndex, search } from '../../lib/services/retrievalService'

// ─── Constants ────────────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 300
const CONTENT_PREVIEW_LINES = 8
const MAX_RESULTS = 20

const ALL_CLASSIFICATIONS: FileClassification[] = [
  'source', 'test', 'configuration', 'documentation', 'generated', 'unknown',
]

// ─── Style helpers ────────────────────────────────────────────────────────────

const CLASSIFICATION_COLOR: Record<FileClassification, string> = {
  source:        'var(--accent-light)',
  test:          'var(--warning)',
  configuration: 'var(--success)',
  documentation: '#a78bfa',
  generated:     'var(--muted)',
  unknown:       'var(--muted)',
}

const CLASSIFICATION_BG: Record<FileClassification, string> = {
  source:        'rgba(99,102,241,0.12)',
  test:          'rgba(245,158,11,0.12)',
  configuration: 'rgba(34,197,94,0.12)',
  documentation: 'rgba(139,92,246,0.12)',
  generated:     'rgba(110,118,129,0.15)',
  unknown:       'rgba(110,118,129,0.10)',
}

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  // Colour shifts from muted (low) → warning (mid) → success (high)
  const color =
    score >= 0.7 ? 'var(--success)' :
    score >= 0.4 ? 'var(--warning)' :
    'var(--muted)'
  const bg =
    score >= 0.7 ? 'rgba(34,197,94,0.12)' :
    score >= 0.4 ? 'rgba(245,158,11,0.12)' :
    'rgba(110,118,129,0.12)'

  return (
    <span
      title="Relevance score"
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
        color, background: bg, borderRadius: 99, padding: '2px 8px',
        flexShrink: 0, fontFamily: 'monospace',
      }}
    >
      {score.toFixed(2)}
    </span>
  )
}

// ─── Classification badge ─────────────────────────────────────────────────────

function ClassBadge({ cls }: { cls: FileClassification }) {
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: CLASSIFICATION_COLOR[cls], background: CLASSIFICATION_BG[cls],
        borderRadius: 99, padding: '1px 7px', flexShrink: 0,
      }}
    >
      {cls}
    </span>
  )
}

// ─── Language badge ───────────────────────────────────────────────────────────

function LangBadge({ lang }: { lang: string }) {
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 500, color: 'var(--muted)',
        background: 'var(--surface2)', border: '1px solid var(--border)',
        borderRadius: 99, padding: '1px 7px', flexShrink: 0,
      }}
    >
      {lang}
    </span>
  )
}

// ─── Single result card ───────────────────────────────────────────────────────

function ResultCard({ chunk, index }: { chunk: RetrievedChunk; index: number }) {
  const [expanded, setExpanded] = useState(false)

  const lines = chunk.content.split('\n')
  const preview = expanded ? lines : lines.slice(0, CONTENT_PREVIEW_LINES)
  const canExpand = lines.length > CONTENT_PREVIEW_LINES

  return (
    <div
      style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '8px 12px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        {/* Result number */}
        <span
          style={{
            fontSize: 10, color: 'var(--muted)', fontWeight: 700,
            background: 'var(--surface2)', borderRadius: 4, padding: '0 5px',
            flexShrink: 0,
          }}
        >
          #{index + 1}
        </span>

        {/* File path */}
        <code
          title={chunk.path}
          style={{
            fontSize: 11, fontFamily: "'JetBrains Mono','Fira Code',monospace",
            color: 'var(--accent-light)', flex: 1, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }}
        >
          {chunk.path}
        </code>

        {/* Line range */}
        <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
          L{chunk.startLine}–L{chunk.endLine}
        </span>

        <LangBadge lang={chunk.language} />
        <ClassBadge cls={chunk.classification} />
        <ScoreBadge score={chunk.relevanceScore} />
      </div>

      {/* Symbol hint */}
      {chunk.symbolHint && (
        <div
          style={{
            padding: '4px 12px', background: 'rgba(245,158,11,0.06)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--warning)', fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
            ƒ {chunk.symbolHint}
          </span>
        </div>
      )}

      {/* Matched terms */}
      {chunk.matchedTerms.length > 0 && (
        <div style={{ padding: '4px 12px', display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
          {chunk.matchedTerms.map((term) => (
            <span
              key={term}
              style={{
                fontSize: 10, color: 'var(--accent-light)',
                background: 'rgba(99,102,241,0.1)', borderRadius: 4, padding: '0 5px',
              }}
            >
              {term}
            </span>
          ))}
        </div>
      )}

      {/* Content preview — plain text, React-escaped, no dangerouslySetInnerHTML */}
      <pre
        style={{
          margin: 0, padding: '10px 12px',
          fontSize: 11, fontFamily: "'JetBrains Mono','Fira Code',monospace",
          color: 'var(--text)', lineHeight: 1.6,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: expanded ? '60vh' : 'none',
          overflow: 'auto',
        }}
      >
        {preview.join('\n')}
        {!expanded && lines.length > CONTENT_PREVIEW_LINES && (
          <span style={{ color: 'var(--muted)' }}>{'\n'}…</span>
        )}
      </pre>

      {/* Expand/collapse button */}
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center',
            width: '100%', padding: '5px 12px',
            background: 'var(--surface)', border: 'none', borderTop: '1px solid var(--border)',
            cursor: 'pointer', fontSize: 11, color: 'var(--muted)',
          }}
        >
          {expanded
            ? <><ChevronUp size={12} /> Show less</>
            : <><ChevronDown size={12} /> Show all {lines.length} lines</>
          }
        </button>
      )}
    </div>
  )
}

// ─── Filter toolbar ───────────────────────────────────────────────────────────

interface FilterToolbarProps {
  activeClassifications: Set<FileClassification>
  onToggle: (cls: FileClassification) => void
}

function FilterToolbar({ activeClassifications, onToggle }: FilterToolbarProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, flexShrink: 0 }}>
        Filter:
      </span>
      {ALL_CLASSIFICATIONS.map((cls) => {
        const active = activeClassifications.has(cls)
        return (
          <button
            key={cls}
            type="button"
            onClick={() => onToggle(cls)}
            style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: active ? CLASSIFICATION_COLOR[cls] : 'var(--muted)',
              background: active ? CLASSIFICATION_BG[cls] : 'var(--surface2)',
              border: `1px solid ${active ? CLASSIFICATION_COLOR[cls] : 'var(--border)'}`,
              borderRadius: 99, padding: '2px 9px', cursor: 'pointer',
            }}
          >
            {cls}
          </button>
        )
      })}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface RetrievalSearchPanelProps {
  kb: KnowledgeBase | null
}

export default function RetrievalSearchPanel({ kb }: RetrievalSearchPanelProps) {
  const [queryText, setQueryText]     = useState('')
  const [results, setResults]         = useState<RetrievedChunk[]>([])
  const [totalMatches, setTotalMatches] = useState(0)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Start with all classifications active
  const [activeClassifications, setActiveClassifications] = useState<Set<FileClassification>>(
    new Set(ALL_CLASSIFICATIONS),
  )

  // Build the retrieval index once per KB (memoised on builtAt timestamp)
  const index = useMemo(() => {
    if (!kb) return null
    return buildRetrievalIndex(kb)
  }, [kb])

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Run search whenever query or filters change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!index || !queryText.trim()) {
      setResults([])
      setTotalMatches(0)
      setSearchError(null)
      return
    }

    debounceRef.current = setTimeout(() => {
      const filter: RetrievalFilter = {
        classifications: Array.from(activeClassifications),
      }

      const result = search(index, {
        queryText,
        filter,
        maxResults: MAX_RESULTS,
        minScore: 0.0,
      })

      if (result.ok) {
        setResults(result.chunks)
        setTotalMatches(result.totalMatches)
        setSearchError(null)
      } else {
        setResults([])
        setTotalMatches(0)
        setSearchError(result.error)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [queryText, activeClassifications, index])

  function toggleClassification(cls: FileClassification) {
    setActiveClassifications((prev) => {
      const next = new Set(prev)
      if (next.has(cls)) {
        // Keep at least one active
        if (next.size > 1) next.delete(cls)
      } else {
        next.add(cls)
      }
      return next
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Source Retrieval
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            Phase 5B · Deterministic keyword search over indexed chunks
          </p>
        </div>
        {index && (
          <span
            style={{
              fontSize: 11, color: 'var(--muted)',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 99, padding: '2px 10px',
            }}
          >
            {index.totalChunks.toLocaleString()} chunk{index.totalChunks !== 1 ? 's' : ''} indexed
          </span>
        )}
      </div>

      {/* Empty state — no KB yet */}
      {!kb && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '32px 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            Knowledge Base not yet built. Complete Phase 5A or acquire source files to enable search.
          </p>
        </div>
      )}

      {kb && (
        <>
          {/* Search input */}
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--muted)', pointerEvents: 'none',
              }}
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Search source files…"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                paddingLeft: 36, paddingRight: 16, paddingTop: 9, paddingBottom: 9,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--text)',
                outline: 'none',
              }}
              aria-label="Search source files"
            />
          </div>

          {/* Filters */}
          <FilterToolbar
            activeClassifications={activeClassifications}
            onToggle={toggleClassification}
          />

          {/* Search error */}
          {searchError && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>
              Search error: {searchError}
            </p>
          )}

          {/* Results summary */}
          {queryText.trim() && !searchError && (
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: 12, color: 'var(--muted)',
              }}
            >
              <span>
                {totalMatches === 0
                  ? 'No results — try a different search term.'
                  : `${totalMatches} match${totalMatches !== 1 ? 'es' : ''} · showing ${results.length}`
                }
              </span>
              {totalMatches > MAX_RESULTS && (
                <span>Showing top {MAX_RESULTS} results by relevance</span>
              )}
            </div>
          )}

          {/* Result cards */}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.map((chunk, i) => (
                <ResultCard key={chunk.chunkId} chunk={chunk} index={i} />
              ))}
            </div>
          )}

          {/* Idle state prompt */}
          {!queryText.trim() && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
              Type to search function names, variable names, file paths, or any source text.
            </p>
          )}
        </>
      )}
    </div>
  )
}
