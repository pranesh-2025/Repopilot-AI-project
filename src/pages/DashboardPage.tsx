/**
 * src/pages/DashboardPage.tsx
 *
 * Main RepoPilot dashboard.
 *
 * Sections:
 *  1. GitHub Repository Import form (always visible)
 *  2. Imported Repo Metadata card (visible after successful import)
 *  3. Repository Intelligence Analysis (Phase 4 — visible after import)
 *  4. Repository Knowledge Base (Phase 5A — built from Phase 4 manifests)
 *  5. Source Acquisition controls (Phase 5B — manual "Acquire Sources" button)
 *  6. Source Retrieval search (Phase 5B — deterministic keyword search)
 *
 * Phase 5B acquisition is MANUAL and OPT-IN.
 * The "Acquire Sources" button must be clicked explicitly — it is never
 * triggered automatically.
 */

import { Download, Loader2, AlertCircle, Search, Database } from 'lucide-react'

import RepoImportForm from '../components/github/RepoImportForm'
import RepoMetadataCard from '../components/github/RepoMetadataCard'
import RepositoryIntelligencePanel from '../components/repository/RepositoryIntelligencePanel'
import KnowledgeBaseStatusPanel from '../components/repository/KnowledgeBaseStatusPanel'
import RetrievalSearchPanel from '../components/repository/RetrievalSearchPanel'
import { useImportedRepo } from '../lib/context/RepoContext'
import { useRepositoryAnalysis } from '../hooks/useRepositoryAnalysis'
import { useKnowledgeBase, type Phase4Data } from '../hooks/useKnowledgeBase'
import { useSourceAcquisition } from '../hooks/useSourceAcquisition'
import { planAcquisition, DEFAULT_MAX_FILES } from '../lib/services/sourceAcquisitionService'
import type { FileNode, FileContent } from '../lib/types/github'

// ─── Loading indicator ────────────────────────────────────────────────────────

function AnalysisLoading({ message }: { message: string }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '32px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <Loader2
        size={28}
        style={{
          color: 'var(--accent-light)',
          animation: 'spin 1s linear infinite',
        }}
        aria-hidden="true"
      />
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
        {message}
      </p>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── Error display ────────────────────────────────────────────────────────────

function AnalysisError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        background: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <AlertCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <div>
        <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>
          Analysis failed
        </p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          {message}
        </p>
      </div>
    </div>
  )
}

// ─── Empty prompt ─────────────────────────────────────────────────────────────

function AnalysisPrompt() {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '40px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: 'rgba(99,102,241,0.10)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-hidden="true"
      >
        <Search size={22} style={{ color: 'var(--accent-light)' }} />
      </div>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
        Repository Intelligence
      </p>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', maxWidth: 400, lineHeight: 1.6 }}>
        Import a public GitHub repository above to run the static intelligence
        analyzer. Results will appear here.
      </p>
    </div>
  )
}

// ─── Source Acquisition controls ──────────────────────────────────────────────

interface AcquisitionControlsProps {
  flatFiles: FileNode[]
  fetchedContents: Map<string, FileContent>
  onTrigger: () => void
  isAcquiring: boolean
  alreadyDone: boolean
}

function AcquisitionControls({
  flatFiles,
  fetchedContents,
  onTrigger,
  isAcquiring,
  alreadyDone,
}: AcquisitionControlsProps) {
  // Compute plan stats for display (pure, no side effects)
  const planStats = (() => {
    try {
      const plan = planAcquisition(flatFiles, fetchedContents, { maxFiles: DEFAULT_MAX_FILES })
      return {
        candidates: plan.totalCandidates,
        toFetch: plan.toFetch.length,
        skipped: plan.skipped.length,
        alreadyAvailable: plan.alreadyAvailable.length,
        maxFiles: DEFAULT_MAX_FILES,
      }
    } catch {
      return null
    }
  })()

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Source Acquisition
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            Phase 5B · Safely fetch real source files from GitHub
          </p>
        </div>

        {/* Acquire Sources button */}
        <button
          type="button"
          onClick={onTrigger}
          disabled={isAcquiring || alreadyDone || (planStats?.toFetch ?? 0) === 0}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '8px 16px',
            background: (isAcquiring || alreadyDone || (planStats?.toFetch ?? 0) === 0)
              ? 'var(--surface2)'
              : 'var(--accent)',
            color: (isAcquiring || alreadyDone || (planStats?.toFetch ?? 0) === 0)
              ? 'var(--muted)'
              : '#fff',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
            fontWeight: 600,
            cursor: (isAcquiring || alreadyDone || (planStats?.toFetch ?? 0) === 0)
              ? 'not-allowed'
              : 'pointer',
          }}
          aria-label="Acquire source files from GitHub"
        >
          {isAcquiring
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Acquiring…</>
            : alreadyDone
              ? <><Database size={14} /> Sources Acquired</>
              : <><Download size={14} /> Acquire Sources</>
          }
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </button>
      </div>

      {/* Plan stats grid */}
      {planStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          {[
            { label: 'Total candidates',  value: planStats.candidates },
            { label: `Selected (max ${planStats.maxFiles})`, value: planStats.toFetch },
            { label: 'Already available', value: planStats.alreadyAvailable },
            { label: 'Skipped / filtered', value: planStats.skipped },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '8px 12px',
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
                {value.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, fontWeight: 500 }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info note */}
      <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
        Acquisition is manual and opt-in. Safety filters exclude secrets, binaries, generated files,
        and dependency directories. Maximum {DEFAULT_MAX_FILES} files per run.
        GitHub unauthenticated API: up to 60 requests/hour per IP.
      </p>
    </div>
  )
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { importedRepo, setImportedRepo } = useImportedRepo()
  const analysisState = useRepositoryAnalysis(importedRepo)

  // Derive Phase 4 data when analysis is done
  const phase4Data: Phase4Data | null =
    analysisState.phase === 'done'
      ? {
          flatFiles:       analysisState.flatFiles,
          fetchedContents: analysisState.fetchedContents,
          truncated:       analysisState.truncated,
        }
      : null

  // Phase 5B: source acquisition (manual/opt-in)
  const acquisition = useSourceAcquisition(
    importedRepo,
    phase4Data?.flatFiles ?? [],
    phase4Data?.fetchedContents ?? new Map(),
    { maxFiles: DEFAULT_MAX_FILES },
  )

  // Phase 5A/5B: knowledge base (rebuilds automatically when acquisition completes)
  const kbState = useKnowledgeBase(importedRepo, phase4Data, acquisition.state)

  // Reset acquisition when a new repo is imported
  // (We pass a key to force reset on importedRepo change via useEffect in hook)

  // ── Derive loading message from analysis phase ─────────────────────────────
  function loadingMessage(): string {
    if (analysisState.phase === 'fetching-tree') return 'Fetching repository file tree…'
    if (analysisState.phase === 'fetching-files') {
      const { fetched, total } = analysisState
      return total > 0
        ? `Fetching manifest files… (${fetched} / ${total})`
        : 'Fetching manifest files…'
    }
    if (analysisState.phase === 'analyzing') return 'Running static analysis…'
    return 'Preparing…'
  }

  const isLoading =
    analysisState.phase === 'fetching-tree' ||
    analysisState.phase === 'fetching-files' ||
    analysisState.phase === 'analyzing'

  const isAcquiring =
    acquisition.state.phase === 'planning' ||
    acquisition.state.phase === 'fetching'

  const acquisitionDone = acquisition.state.phase === 'done'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 }}>

      {/* ── 1. GitHub Repository Import ── */}
      <RepoImportForm onSuccess={(repo) => {
        acquisition.reset()
        setImportedRepo(repo)
      }} />

      {/* ── 2. Imported Repo Metadata (visible only after successful import) ── */}
      {importedRepo && (
        <RepoMetadataCard repo={importedRepo} />
      )}

      {/* ── 3. Repository Intelligence Analysis ── */}
      {!importedRepo && (
        <AnalysisPrompt />
      )}

      {importedRepo && isLoading && (
        <AnalysisLoading message={loadingMessage()} />
      )}

      {importedRepo && analysisState.phase === 'error' && (
        <AnalysisError message={analysisState.message} />
      )}

      {importedRepo && analysisState.phase === 'done' && (
        <>
          {analysisState.result.ok ? (
            <RepositoryIntelligencePanel analysis={analysisState.result.data} />
          ) : (
            <AnalysisError message={analysisState.result.error.message} />
          )}
        </>
      )}

      {/* ── 4. Source Acquisition controls (Phase 5B) ── */}
      {importedRepo && phase4Data && analysisState.phase === 'done' && (
        <AcquisitionControls
          flatFiles={phase4Data.flatFiles}
          fetchedContents={phase4Data.fetchedContents}
          onTrigger={acquisition.trigger}
          isAcquiring={isAcquiring}
          alreadyDone={acquisitionDone}
        />
      )}

      {/* ── 5. Knowledge Base status (Phase 5A/5B) ── */}
      {importedRepo && kbState.phase === 'building' && (
        <AnalysisLoading message="Building knowledge base…" />
      )}

      {importedRepo && kbState.phase === 'error' && (
        <AnalysisError message={kbState.message} />
      )}

      {importedRepo && kbState.phase === 'done' && (
        <KnowledgeBaseStatusPanel
          kb={kbState.kb}
          acquisitionState={acquisition.state}
        />
      )}

      {/* ── 6. Source Retrieval search (Phase 5B) ── */}
      {importedRepo && kbState.phase === 'done' && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 24px',
          }}
        >
          <RetrievalSearchPanel kb={kbState.kb} />
        </div>
      )}

    </div>
  )
}
