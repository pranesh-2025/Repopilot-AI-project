/**
 * src/components/repository/RepositoryIntelligencePanel.tsx
 *
 * Displays the structured output of the Phase 4 Repository Intelligence Analyzer.
 *
 * Receives an already-computed RepositoryAnalysis object and renders it.
 * No API calls or state management — purely presentational.
 *
 * Design system: dark theme, inline styles, CSS variables from index.css
 */

import type { ReactNode } from 'react'
import type { RepositoryAnalysis, EvidencedDetection, ConfigFile, EntryPoint, DependencyInfo } from '../../lib/types/github'

// ─── Language colour map (best-effort; unlisted langs get a default) ─────────

const LANG_COLOURS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f7df1e', Python: '#3572a5',
  'C++': '#f34b7d', 'C': '#555555', 'C#': '#178600',
  Go: '#00add8', Rust: '#dea584', Java: '#b07219',
  Kotlin: '#a97bff', Swift: '#f05138', Ruby: '#701516',
  PHP: '#4f5d95', CSS: '#563d7c', SCSS: '#c6538c', Less: '#1d365d',
  HTML: '#e34c26', Vue: '#41b883', Svelte: '#ff3e00', Dart: '#00b4ab',
  Elixir: '#6e4a7e', Haskell: '#5d4f85', Lua: '#000080', R: '#198ce7',
  Scala: '#c22d40', Clojure: '#db5855', GraphQL: '#e10098', SQL: '#e38c00',
  Shell: '#89e051', Markdown: '#083fa1', YAML: '#cb171e', JSON: '#292929',
  TOML: '#9c4121', XML: '#0060ac',
}

function langColour(name: string): string {
  return LANG_COLOURS[name] ?? '#6e7681'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Section heading matching the existing SectionCard header style */
function SectionHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
        }}
      >
        {title}
      </h3>
      {badge && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 99,
            padding: '2px 10px',
            fontWeight: 500,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

/** Detection status pill */
function StatusPill({ status }: { status: EvidencedDetection['status'] }) {
  const map: Record<EvidencedDetection['status'], { bg: string; color: string }> = {
    Detected: { bg: 'rgba(34,197,94,0.12)',  color: 'var(--success)' },
    Likely:   { bg: 'rgba(245,158,11,0.12)', color: 'var(--warning)' },
    Unknown:  { bg: 'rgba(110,118,129,0.15)', color: 'var(--muted)'  },
  }
  const s = map[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 8px',
        borderRadius: 99,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        background: s.bg,
        color: s.color,
        textTransform: 'uppercase',
        flexShrink: 0,
      }}
    >
      <span
        style={{ width: 5, height: 5, borderRadius: '50%', background: s.color }}
        aria-hidden="true"
      />
      {status}
    </span>
  )
}

/** Expandable evidence file list */
function EvidenceList({ files }: { files: string[] }) {
  if (files.length === 0) return null
  const show = files.slice(0, 3)
  const rest = files.slice(3)
  return (
    <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {show.map((f) => (
        <code
          key={f}
          style={{
            fontSize: 10,
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '1px 5px',
            color: 'var(--muted)',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          }}
        >
          {f}
        </code>
      ))}
      {rest.length > 0 && (
        <span
          style={{
            fontSize: 10,
            color: 'var(--muted)',
            padding: '1px 5px',
          }}
        >
          +{rest.length} more
        </span>
      )}
    </div>
  )
}

/** A single detection row */
function DetectionRow({ d }: { d: EvidencedDetection }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '9px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1 }}>
          {d.name}
          {d.version && (
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6, fontWeight: 400 }}>
              v{d.version}
            </span>
          )}
        </span>
        <StatusPill status={d.status} />
      </div>
      {d.explanation && (
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{d.explanation}</span>
      )}
      <EvidenceList files={d.evidence} />
    </div>
  )
}

/** A grid of detection rows — renders nothing if list is empty */
function DetectionList({
  items,
  emptyText = 'None detected',
}: {
  items: EvidencedDetection[]
  emptyText?: string
}) {
  if (items.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>{emptyText}</p>
  }
  return (
    <div>
      {items.map((d, i) => (
        <DetectionRow key={`${d.name}-${i}`} d={d} />
      ))}
    </div>
  )
}

/** Card wrapper matching existing SectionCard style */
function Card({
  title,
  badge,
  children,
}: {
  title: string
  badge?: string
  children: ReactNode
}) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
      }}
    >
      <SectionHeader title={title} badge={badge} />
      {children}
    </section>
  )
}

/** "Not analyzed yet" placeholder for future phases */
function NotAvailableCard({ title }: { title: string }) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        opacity: 0.6,
      }}
    >
      <SectionHeader title={title} />
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
        Not analyzed yet — available in a future phase.
      </p>
    </section>
  )
}

// ─── Language breakdown bar ───────────────────────────────────────────────────

function LanguageBreakdown({ languages }: { languages: EvidencedDetection[] }) {
  if (languages.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>No languages detected.</p>
  }
  // Use file count (evidence.length) as the metric for bar proportions
  const total = languages.reduce((sum, l) => sum + l.evidence.length, 0)
  const items = languages.slice(0, 8) // cap bar at 8 languages
  const otherCount = languages.slice(8).reduce((sum, l) => sum + l.evidence.length, 0)

  const barItems = [
    ...items.map((l) => ({
      name: l.name,
      count: l.evidence.length,
      color: langColour(l.name),
    })),
    ...(otherCount > 0 ? [{ name: 'Other', count: otherCount, color: '#6e7681' }] : []),
  ]

  return (
    <div>
      {/* Bar */}
      <div
        role="img"
        aria-label="Language breakdown bar"
        style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', gap: 2 }}
      >
        {barItems.map((l) => (
          <div
            key={l.name}
            style={{ flex: l.count, background: l.color, minWidth: 2 }}
            title={`${l.name}: ${l.count} file(s)`}
          />
        ))}
      </div>
      {/* Legend */}
      <ul
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 20px',
          marginTop: 12,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {barItems.map((l) => {
          const pct = total > 0 ? Math.round((l.count / total) * 100) : 0
          return (
            <li
              key={l.name}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}
            >
              <span
                style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }}
                aria-hidden="true"
              />
              <span style={{ color: 'var(--text)', fontWeight: 500 }}>{l.name}</span>
              <span>{pct}%</span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>({l.count} files)</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Config files section ─────────────────────────────────────────────────────

function ConfigFilesList({ files }: { files: ConfigFile[] }) {
  if (files.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>No config files detected.</p>
  }

  // Group by category
  const grouped = new Map<string, ConfigFile[]>()
  for (const f of files) {
    const arr = grouped.get(f.category) ?? []
    arr.push(f)
    grouped.set(f.category, arr)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from(grouped.entries()).map(([cat, items]) => (
        <div key={cat}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              marginBottom: 6,
            }}
          >
            {cat}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {items.map((f) => (
              <div
                key={f.path}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '5px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <code
                  style={{
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    color: 'var(--accent-light)',
                    flex: '0 0 auto',
                    maxWidth: '50%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={f.path}
                >
                  {f.path}
                </code>
                <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>{f.purpose}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Entry points section ─────────────────────────────────────────────────────

function EntryPointsList({ entries }: { entries: EntryPoint[] }) {
  if (entries.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>No entry points detected.</p>
  }
  return (
    <div>
      {entries.map((e) => (
        <div
          key={e.path}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 0',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <code
            style={{
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              color: 'var(--text)',
              flex: 1,
            }}
          >
            {e.path}
          </code>
          <span
            style={{
              fontSize: 11,
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '1px 6px',
              color: 'var(--muted)',
              flexShrink: 0,
            }}
          >
            {e.kind}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Dependencies section ─────────────────────────────────────────────────────

function DependenciesList({ deps }: { deps: DependencyInfo[] }) {
  if (deps.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
        No parsed dependency manifests available.
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {deps.map((d) => (
        <div
          key={d.manifestFile}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '12px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <code
              style={{
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                color: 'var(--accent-light)',
              }}
            >
              {d.manifestFile}
            </code>
            <span
              style={{
                fontSize: 10,
                background: 'rgba(99,102,241,0.12)',
                color: 'var(--accent-light)',
                padding: '1px 7px',
                borderRadius: 99,
                fontWeight: 600,
                letterSpacing: '0.04em',
              }}
            >
              {d.ecosystem}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <span style={{ color: 'var(--muted)' }}>
              <strong style={{ color: 'var(--text)' }}>{d.packageCount}</strong> production
            </span>
            {d.devPackageCount > 0 && (
              <span style={{ color: 'var(--muted)' }}>
                <strong style={{ color: 'var(--text)' }}>{d.devPackageCount}</strong> dev
              </span>
            )}
          </div>
          {d.notable.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {d.notable.map((pkg) => (
                <code
                  key={pkg}
                  style={{
                    fontSize: 10,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    padding: '1px 5px',
                    color: 'var(--muted)',
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }}
                >
                  {pkg}
                </code>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Analysis warnings ────────────────────────────────────────────────────────

function AnalysisNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return (
    <div
      style={{
        background: 'rgba(245,158,11,0.07)',
        border: '1px solid rgba(245,158,11,0.25)',
        borderRadius: 'var(--radius)',
        padding: '10px 14px',
        marginBottom: 20,
      }}
    >
      <p
        style={{
          margin: '0 0 6px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--warning)',
        }}
      >
        Analysis notes
      </p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {notes.map((note, i) => (
          <li key={i} style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            {note}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface RepositoryIntelligencePanelProps {
  analysis: RepositoryAnalysis
}

export default function RepositoryIntelligencePanel({ analysis }: RepositoryIntelligencePanelProps) {
  const { meta } = analysis

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Meta summary bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        {[
          { label: 'Files in tree',  value: meta.fileCount.toLocaleString() },
          { label: 'Languages',      value: analysis.languages.length },
          { label: 'Dependencies',   value: analysis.dependencies.reduce((s, d) => s + d.packageCount, 0).toLocaleString() },
          { label: 'Config files',   value: analysis.configFiles.length },
          { label: 'Entry points',   value: analysis.entryPoints.length },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px 16px',
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, fontWeight: 500 }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Notes / warnings */}
      <AnalysisNotes notes={meta.analysisNotes} />

      {/* Language breakdown */}
      <Card title="Languages" badge={`${analysis.languages.length} detected`}>
        <LanguageBreakdown languages={analysis.languages} />
      </Card>

      {/* Two-column layout for the category sections */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 20,
        }}
      >
        <Card title="Frameworks">
          <DetectionList items={analysis.frameworks} emptyText="No frameworks detected." />
        </Card>

        <Card title="Package Managers">
          <DetectionList items={analysis.packageManagers} emptyText="No package managers detected." />
        </Card>

        <Card title="Frontend Technologies">
          <DetectionList items={analysis.frontendTechnologies} emptyText="No frontend technologies detected." />
        </Card>

        <Card title="Backend Technologies">
          <DetectionList items={analysis.backendTechnologies} emptyText="No backend technologies detected." />
        </Card>

        <Card title="Database Technologies">
          <DetectionList items={analysis.databaseTechnologies} emptyText="No database technologies detected." />
        </Card>

        <Card title="Authentication Mechanisms">
          <DetectionList items={analysis.authMechanisms} emptyText="No authentication mechanisms detected." />
        </Card>

        <Card title="API Patterns">
          <DetectionList items={analysis.apiPatterns} emptyText="No API patterns detected." />
        </Card>

        <Card title="Major Modules">
          <DetectionList items={analysis.majorModules} emptyText="No major modules detected." />
        </Card>
      </div>

      {/* Major Services — only show if any detected */}
      {analysis.majorServices.length > 0 && (
        <Card title="Major Services" badge={`${analysis.majorServices.length} detected`}>
          <DetectionList items={analysis.majorServices} />
        </Card>
      )}

      {/* Entry Points */}
      <Card title="Entry Points">
        <EntryPointsList entries={analysis.entryPoints} />
      </Card>

      {/* Configuration Files */}
      <Card title="Configuration Files" badge={`${analysis.configFiles.length} found`}>
        <ConfigFilesList files={analysis.configFiles} />
      </Card>

      {/* Dependencies */}
      <Card title="Dependencies">
        <DependenciesList deps={analysis.dependencies} />
      </Card>

      {/* Future-phase placeholders — clearly marked */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
        }}
      >
        <NotAvailableCard title="Architecture Analysis" />
        <NotAvailableCard title="Security Analysis" />
        <NotAvailableCard title="Code Health" />
      </div>

      {/* Analysis timestamp */}
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, textAlign: 'right' }}>
        Analysis performed at{' '}
        {new Date(meta.analyzedAt).toLocaleString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })}
        {meta.truncated && ' · tree was truncated by GitHub'}
      </p>
    </div>
  )
}
