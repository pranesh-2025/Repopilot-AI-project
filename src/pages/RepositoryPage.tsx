/**
 * src/pages/RepositoryPage.tsx
 *
 * Page wrapper for the /repository route.
 * - Shows a professional empty state if no repository has been imported yet.
 * - Renders RepositoryExplorer when a repository is available.
 */

import { Link } from 'react-router-dom'
import { GitBranch } from 'lucide-react'
import { useImportedRepo } from '../lib/context/RepoContext'
import RepositoryExplorer from '../components/repository/RepositoryExplorer'

export default function RepositoryPage() {
  const { importedRepo } = useImportedRepo()

  // ─── Empty state ───────────────────────────────────────────────────────────

  if (!importedRepo) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '70vh',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            maxWidth: 440,
            padding: '48px 40px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: 'rgba(99,102,241,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
            }}
          >
            <GitBranch size={24} style={{ color: 'var(--accent-light)' }} />
          </div>

          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--text)',
              margin: '0 0 8px',
            }}
          >
            No Repository Imported
          </h2>

          <p
            style={{
              fontSize: 13,
              color: 'var(--muted)',
              lineHeight: 1.7,
              margin: '0 0 24px',
            }}
          >
            Import a public GitHub repository from the Dashboard to explore its
            file structure and source files here.
          </p>

          <Link
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 20px',
              background: 'var(--accent)',
              color: '#fff',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  // ─── Explorer ──────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 52px - 48px)', // viewport minus TopBar (52px) and page padding (24px * 2)
        gap: 0,
      }}
    >
      {/* Page sub-header */}
      <div style={{ marginBottom: 12, flexShrink: 0 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
          Browsing{' '}
          <a
            href={importedRepo.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent-light)' }}
          >
            {importedRepo.fullName}
          </a>
          {' '}· branch{' '}
          <code
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 11,
              background: 'var(--surface2)',
              padding: '1px 6px',
              borderRadius: 3,
              color: 'var(--text)',
            }}
          >
            {importedRepo.defaultBranch}
          </code>
        </p>
      </div>

      {/* Explorer takes remaining height */}
      <RepositoryExplorer />
    </div>
  )
}
