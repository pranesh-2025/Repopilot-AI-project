/**
 * src/components/repository/KnowledgeBaseStatusPanel.tsx
 *
 * Phase 5A/5B: read-only panel for inspecting the in-memory knowledge base
 * and Phase 5B acquisition status.
 *
 * Displays:
 *  1. Phase 5B acquisition progress bar (when acquiring)
 *  2. Stats bar — indexed files, total chunks, languages, approximate lines
 *  3. Classification breakdown — source / test / config / doc / generated counts
 *  4. Language breakdown by chunk count
 *  5. Indexed files list (capped at 50, with overflow count)
 *  6. Ignored files section (collapsed by default)
 *  7. Debug section (toggle — shows chunk line ranges and content previews)
 *
 * All data sourced directly from the KnowledgeBase object — no fake values.
 * Follows the existing dark-theme inline-style design system.
 *
 * Security:
 *  - Chunk content rendered in <pre> — React escapes HTML by default
 *  - No dangerouslySetInnerHTML anywhere in this file
 */

import { useState } from 'react'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { KnowledgeBase, FileClassification, IndexedFile, IgnoredFile, ChunkMetadata } from '../../lib/types/knowledgeBase'
import type { AcquisitionState } from '../../lib/types/retrieval'

// ─── Shared style helpers ─────────────────────────────────────────────────────

function SectionHeader({ title, badge }: { title: string; badge?: string | number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {title}
      </h3>
      {badge !== undefined && (
        <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 99, padding: '2px 10px', fontWeight: 500 }}>
          {badge}
        </span>
      )}
    </div>
  )
}

function Card({ title, badge, children }: { title: string; badge?: string | number; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px' }}>
      <SectionHeader title={title} badge={badge} />
      {children}
    </section>
  )
}

// ─── Classification badge ─────────────────────────────────────────────────────

const CLASSIFICATION_STYLE: Record<FileClassification, { bg: string; color: string }> = {
  source:        { bg: 'rgba(99,102,241,0.12)',  color: 'var(--accent-light)' },
  test:          { bg: 'rgba(245,158,11,0.12)',  color: 'var(--warning)' },
  configuration: { bg: 'rgba(34,197,94,0.12)',   color: 'var(--success)' },
  documentation: { bg: 'rgba(139,92,246,0.12)',  color: '#a78bfa' },
  generated:     { bg: 'rgba(110,118,129,0.15)', color: 'var(--muted)' },
  unknown:       { bg: 'rgba(110,118,129,0.10)', color: 'var(--muted)' },
}

function ClassificationBadge({ cls }: { cls: FileClassification }) {
  const s = CLASSIFICATION_STYLE[cls]
  return (
    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', background: s.bg, color: s.color, borderRadius: 99, padding: '1px 8px', flexShrink: 0 }}>
      {cls}
    </span>
  )
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ kb }: { kb: KnowledgeBase }) {
  const { stats } = kb
  const items = [
    { label: 'Indexed files',   value: stats.totalIndexedFiles.toLocaleString() },
    { label: 'Ignored files',   value: stats.totalIgnoredFiles.toLocaleString() },
    { label: 'Chunks',          value: stats.totalChunks.toLocaleString() },
    { label: 'Languages',       value: Object.keys(stats.filesByLanguage).length.toString() },
    { label: '≈ Indexed lines', value: stats.approximateIndexedLines.toLocaleString() },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
      {items.map(({ label, value }) => (
        <div key={label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{value}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, fontWeight: 500 }}>{label}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Classification breakdown ─────────────────────────────────────────────────

function ClassificationBreakdown({ kb }: { kb: KnowledgeBase }) {
  const { filesByClassification } = kb.stats
  const order: FileClassification[] = ['source', 'test', 'configuration', 'documentation', 'generated', 'unknown']
  const entries = order.filter((cls) => (filesByClassification[cls] ?? 0) > 0)
  if (entries.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>No files classified.</p>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {entries.map((cls) => {
        const s = CLASSIFICATION_STYLE[cls]
        return (
          <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 8, background: s.bg, borderRadius: 'var(--radius)', padding: '8px 14px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{filesByClassification[cls]}</span>
            <span style={{ fontSize: 12, color: s.color, fontWeight: 500, textTransform: 'capitalize' }}>{cls}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Language breakdown ───────────────────────────────────────────────────────

function LanguageBreakdown({ kb }: { kb: KnowledgeBase }) {
  const { chunksByLanguage } = kb.stats
  const sorted = Object.entries(chunksByLanguage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
  const total = sorted.reduce((s, [, n]) => s + n, 0)
  if (sorted.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>No languages detected.</p>
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sorted.map(([lang, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0
        return (
          <li key={lang} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ color: 'var(--text)', fontWeight: 500, minWidth: 110, flexShrink: 0 }}>{lang}</span>
            <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-light)', borderRadius: 99 }} />
            </div>
            <span style={{ color: 'var(--muted)', minWidth: 60, textAlign: 'right', flexShrink: 0 }}>
              {count} chunk{count !== 1 ? 's' : ''} ({pct}%)
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ─── Indexed files list ───────────────────────────────────────────────────────

const MAX_FILES_SHOWN = 50

function IndexedFileRow({ file }: { file: IndexedFile }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <code style={{ fontSize: 11, fontFamily: "'JetBrains Mono','Fira Code',monospace", color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.path}>
        {file.path}
      </code>
      <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{file.totalLines} lines</span>
      <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{file.chunkCount} chunk{file.chunkCount !== 1 ? 's' : ''}</span>
      <ClassificationBadge cls={file.classification} />
    </div>
  )
}

function IndexedFilesList({ kb }: { kb: KnowledgeBase }) {
  const files = Array.from(kb.fileIndex.values())
  if (files.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>No files were indexed.</p>
  }
  const shown = files.slice(0, MAX_FILES_SHOWN)
  const overflow = files.length - shown.length
  return (
    <div>
      {shown.map((f) => <IndexedFileRow key={f.path} file={f} />)}
      {overflow > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--muted)' }}>
          …and {overflow} more file{overflow !== 1 ? 's' : ''} (not shown)
        </p>
      )}
    </div>
  )
}

// ─── Ignored files section ────────────────────────────────────────────────────

const IGNORE_REASON_LABEL: Record<string, string> = {
  binary:       'Binary file',
  generated:    'Generated / lock file',
  secret:       'Secret / credential file',
  oversized:    'File too large (>100 KB)',
  not_fetched:  'Content not fetched',
  empty:        'Empty file',
  unsupported:  'Unsupported file type',
  fetch_failed: 'Fetch failed (Phase 5B)',
}

function IgnoredFileRow({ file }: { file: IgnoredFile }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
      <code style={{ fontSize: 11, fontFamily: "'JetBrains Mono','Fira Code',monospace", color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.path}>
        {file.path}
      </code>
      <span style={{ fontSize: 10, background: 'rgba(110,118,129,0.15)', color: 'var(--muted)', borderRadius: 99, padding: '1px 8px', flexShrink: 0, fontWeight: 500 }}>
        {IGNORE_REASON_LABEL[file.reason] ?? file.reason}
      </span>
    </div>
  )
}

function IgnoredFilesSection({ kb }: { kb: KnowledgeBase }) {
  const [expanded, setExpanded] = useState(false)
  const { ignoredFiles } = kb
  if (ignoredFiles.length === 0) return null

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
        }}
        aria-expanded={expanded}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Ignored Files
        </h3>
        <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 99, padding: '2px 10px', fontWeight: 500 }}>
          {ignoredFiles.length} · {expanded ? 'hide' : 'show'}
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: 14 }}>
          {ignoredFiles.map((f) => <IgnoredFileRow key={f.path} file={f} />)}
        </div>
      )}
    </section>
  )
}

// ─── Debug section ────────────────────────────────────────────────────────────

const DEBUG_FILES  = 3
const DEBUG_CHUNKS = 3
const DEBUG_PREVIEW_CHARS = 300

function ChunkPreview({ chunk }: { chunk: ChunkMetadata }) {
  const preview = chunk.content.length > DEBUG_PREVIEW_CHARS
    ? chunk.content.slice(0, DEBUG_PREVIEW_CHARS) + '\n…'
    : chunk.content
  return (
    <div style={{ marginBottom: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <code style={{ fontSize: 10, color: 'var(--accent-light)', fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
          {chunk.id}
        </code>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          lines {chunk.startLine}–{chunk.endLine}
        </span>
        {chunk.symbolHint && (
          <span style={{ fontSize: 11, color: 'var(--warning)', background: 'rgba(245,158,11,0.1)', borderRadius: 4, padding: '1px 6px' }}>
            {chunk.symbolHint}
          </span>
        )}
      </div>
      <pre style={{ margin: 0, fontSize: 11, color: 'var(--text)', fontFamily: "'JetBrains Mono','Fira Code',monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, maxHeight: 200, overflow: 'auto' }}>
        {preview}
      </pre>
    </div>
  )
}

function DebugSection({ kb }: { kb: KnowledgeBase }) {
  const [open, setOpen] = useState(false)
  if (kb.stats.totalChunks === 0) return null

  const firstFiles = Array.from(kb.fileIndex.values()).slice(0, DEBUG_FILES)

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        aria-expanded={open}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Debug — Chunk Inspector
        </h3>
        <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 99, padding: '2px 10px', fontWeight: 500 }}>
          {open ? 'hide' : 'show'} first {DEBUG_FILES} files × {DEBUG_CHUNKS} chunks
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 16 }}>
          {firstFiles.map((file) => {
            const fileChunks = file.chunkIds
              .slice(0, DEBUG_CHUNKS)
              .map((id) => kb.chunks.get(id))
              .filter((c): c is ChunkMetadata => c !== undefined)

            return (
              <div key={file.path} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <code style={{ fontSize: 12, fontFamily: "'JetBrains Mono','Fira Code',monospace", color: 'var(--accent-light)' }}>
                    {file.path}
                  </code>
                  <ClassificationBadge cls={file.classification} />
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {file.chunkCount} chunk{file.chunkCount !== 1 ? 's' : ''} total · showing {fileChunks.length}
                  </span>
                </div>
                {fileChunks.map((chunk) => (
                  <ChunkPreview key={chunk.id} chunk={chunk} />
                ))}
              </div>
            )
          })}
          <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>
            Showing first {DEBUG_FILES} indexed files × first {DEBUG_CHUNKS} chunks each.
            Content previews truncated at {DEBUG_PREVIEW_CHARS} characters.
          </p>
        </div>
      )}
    </section>
  )
}

// ─── KB notes ─────────────────────────────────────────────────────────────────

function KBNotes({ kb }: { kb: KnowledgeBase }) {
  const notes: string[] = []
  if (kb.truncated) {
    notes.push('GitHub returned a truncated tree response. KB coverage may be incomplete.')
  }
  if (kb.stats.totalIndexedFiles === 0) {
    notes.push('No files were indexed. All files in the tree may be binary, generated, or not yet fetched.')
  }
  const notFetchedCount = kb.ignoredFiles.filter((f) => f.reason === 'not_fetched').length
  if (notFetchedCount > 0) {
    notes.push(
      `${notFetchedCount} file${notFetchedCount !== 1 ? 's' : ''} exist in the tree but their content was not fetched. ` +
      'Use "Acquire Sources" to fetch additional source files.',
    )
  }
  const fetchFailedCount = kb.ignoredFiles.filter((f) => f.reason === 'fetch_failed').length
  if (fetchFailedCount > 0) {
    notes.push(
      `${fetchFailedCount} file${fetchFailedCount !== 1 ? 's' : ''} failed to fetch during source acquisition. ` +
      'They appear in the Ignored Files list with reason "Fetch failed".',
    )
  }
  if (notes.length === 0) return null
  return (
    <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 'var(--radius)', padding: '10px 14px' }}>
      <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--warning)' }}>
        Knowledge base notes
      </p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {notes.map((note, i) => (
          <li key={i} style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{note}</li>
        ))}
      </ul>
    </div>
  )
}

// ─── Acquisition progress bar ─────────────────────────────────────────────────

function AcquisitionProgress({ acquisitionState }: { acquisitionState: AcquisitionState }) {
  if (acquisitionState.phase === 'idle' || acquisitionState.phase === 'done') return null

  if (acquisitionState.phase === 'planning') {
    return (
      <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--radius)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Loader2 size={14} style={{ color: 'var(--accent-light)', animation: 'spin 1s linear infinite' }} aria-hidden="true" />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Planning source acquisition…</span>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (acquisitionState.phase === 'fetching') {
    const { fetched, failed, total, currentFile } = acquisitionState
    const done = fetched + failed
    const pct  = total > 0 ? Math.round((done / total) * 100) : 0
    return (
      <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--radius)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Loader2 size={14} style={{ color: 'var(--accent-light)', animation: 'spin 1s linear infinite', flexShrink: 0 }} aria-hidden="true" />
          <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
            Acquiring source files… {done}/{total} ({pct}%)
            {failed > 0 && <span style={{ color: 'var(--warning)' }}> · {failed} failed</span>}
          </span>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
        {/* Progress bar */}
        <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-light)', borderRadius: 99, transition: 'width 0.2s ease' }} />
        </div>
        {currentFile && (
          <code style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'JetBrains Mono','Fira Code',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={currentFile}>
            {currentFile}
          </code>
        )}
      </div>
    )
  }

  if (acquisitionState.phase === 'error') {
    return (
      <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <AlertTriangle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} aria-hidden="true" />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Acquisition error: {acquisitionState.message}</span>
      </div>
    )
  }

  return null
}

// ─── Acquisition done summary ─────────────────────────────────────────────────

function AcquisitionDoneSummary({ acquisitionState }: { acquisitionState: AcquisitionState }) {
  if (acquisitionState.phase !== 'done') return null
  const { acquiredContents, fetchFailures, plan } = acquisitionState
  const acquired = acquiredContents.size
  const failed   = fetchFailures.length

  return (
    <div style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 'var(--radius)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} aria-hidden="true" />
      <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
        Source acquisition complete.{' '}
        <span style={{ color: 'var(--success)', fontWeight: 600 }}>{acquired} file{acquired !== 1 ? 's' : ''} acquired</span>
        {failed > 0 && (
          <span style={{ color: 'var(--warning)' }}> · {failed} failed</span>
        )}
        {plan.skipped.length > 0 && (
          <span> · {plan.skipped.length} skipped</span>
        )}
      </span>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface KnowledgeBaseStatusPanelProps {
  kb: KnowledgeBase
  acquisitionState?: AcquisitionState
}

export default function KnowledgeBaseStatusPanel({ kb, acquisitionState }: KnowledgeBaseStatusPanelProps) {
  const hasAcquisition = acquisitionState !== undefined && acquisitionState.phase !== 'idle'
  const isDone = acquisitionState?.phase === 'done'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Repository Knowledge Base
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            {isDone ? 'Phase 5B · Source files acquired and indexed' : 'Phase 5A · In-memory index built from Phase 4 manifests'}
          </p>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', background: 'rgba(34,197,94,0.12)', color: 'var(--success)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} aria-hidden="true" />
          Indexed
        </span>
      </div>

      {/* Acquisition progress (Phase 5B) */}
      {hasAcquisition && acquisitionState && (
        <AcquisitionProgress acquisitionState={acquisitionState} />
      )}

      {/* Acquisition done summary (Phase 5B) */}
      {isDone && acquisitionState && (
        <AcquisitionDoneSummary acquisitionState={acquisitionState} />
      )}

      {/* Notes */}
      <KBNotes kb={kb} />

      {/* Stats */}
      <Card title="Statistics">
        <StatsBar kb={kb} />
      </Card>

      {/* Classification breakdown */}
      <Card title="File Classification">
        <ClassificationBreakdown kb={kb} />
      </Card>

      {/* Language breakdown */}
      <Card title="Languages by Chunk Count" badge={Object.keys(kb.stats.chunksByLanguage).length}>
        <LanguageBreakdown kb={kb} />
      </Card>

      {/* Indexed files */}
      <Card title="Indexed Files" badge={kb.stats.totalIndexedFiles}>
        <IndexedFilesList kb={kb} />
      </Card>

      {/* Ignored files (collapsible) */}
      <IgnoredFilesSection kb={kb} />

      {/* Debug chunk inspector (collapsible) */}
      <DebugSection kb={kb} />

      {/* Build timestamp */}
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, textAlign: 'right' }}>
        Built at{' '}
        {new Date(kb.builtAt).toLocaleString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })}
        {kb.truncated && ' · tree truncated'}
      </p>
    </div>
  )
}
