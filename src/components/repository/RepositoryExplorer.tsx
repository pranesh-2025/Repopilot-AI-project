/**
 * src/components/repository/RepositoryExplorer.tsx
 *
 * Smart container for the Repository Explorer.
 * Responsibilities:
 *  - Reads the imported repo from context
 *  - Fetches the repository tree once (re-fetches if repo changes)
 *  - Fetches individual file content when the user selects a file
 *  - Caches fetched file content in memory (Map) to avoid re-requests
 *  - Manages and passes all state down to RepositoryTree and SourceViewer
 *  - Shows a truncation warning banner if GitHub returned a partial tree
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { useImportedRepo } from '../../lib/context/RepoContext'
import { getRepoTree, getFileContent } from '../../lib/services/githubService'
import type { FileNode, RepoTreeNode, GitHubFetchError, FileContent } from '../../lib/types/github'
import RepositoryTree from './RepositoryTree'
import SourceViewer from './SourceViewer'
import type { ViewerState } from './SourceViewer'

// ─── Tree loading state ────────────────────────────────────────────────────────

type TreeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: GitHubFetchError }
  | { status: 'ready'; nodes: RepoTreeNode[]; flatFiles: FileNode[]; truncated: boolean }

// ─── Component ────────────────────────────────────────────────────────────────

export default function RepositoryExplorer() {
  const { importedRepo } = useImportedRepo()

  const [treeState, setTreeState] = useState<TreeState>({ status: 'idle' })
  const [viewerState, setViewerState] = useState<ViewerState>({ status: 'empty' })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  // In-memory cache: path → FileContent (cleared when repo changes)
  const fileCache = useRef<Map<string, FileContent>>(new Map())

  // ─── Load tree when repo changes ──────────────────────────────────────────

  useEffect(() => {
    if (!importedRepo) return

    setTreeState({ status: 'loading' })
    setViewerState({ status: 'empty' })
    setSelectedPath(null)
    fileCache.current.clear()

    getRepoTree(importedRepo.owner, importedRepo.name, importedRepo.defaultBranch)
      .then((result) => {
        if (result.ok) {
          setTreeState({
            status: 'ready',
            nodes: result.nodes,
            flatFiles: result.flatFiles,
            truncated: result.truncated,
          })
        } else {
          setTreeState({ status: 'error', error: result.error })
        }
      })
      .catch(() => {
        setTreeState({
          status: 'error',
          error: { kind: 'unexpected', message: 'An unexpected error occurred loading the repository tree.' },
        })
      })
  }, [importedRepo])

  // ─── Load file when user selects one ──────────────────────────────────────

  const handleSelectFile = useCallback(
    (node: FileNode) => {
      if (!importedRepo) return

      setSelectedPath(node.path)

      // Serve from cache if already fetched
      const cached = fileCache.current.get(node.path)
      if (cached) {
        setViewerState({ status: 'content', file: cached })
        return
      }

      setViewerState({ status: 'loading', filename: node.name })

      getFileContent(importedRepo.owner, importedRepo.name, node.path, importedRepo.defaultBranch)
        .then((result) => {
          if (result.ok) {
            fileCache.current.set(node.path, result.data)
            setViewerState({ status: 'content', file: result.data })
          } else {
            setViewerState({ status: 'error', error: result.error })
          }
        })
        .catch(() => {
          setViewerState({
            status: 'error',
            error: { kind: 'unexpected', message: 'An unexpected error occurred loading the file.' },
          })
        })
    },
    [importedRepo],
  )

  // ─── Retry tree load ───────────────────────────────────────────────────────

  function handleRetryTree() {
    if (!importedRepo) return
    setTreeState({ status: 'loading' })
    getRepoTree(importedRepo.owner, importedRepo.name, importedRepo.defaultBranch)
      .then((result) => {
        if (result.ok) {
          setTreeState({ status: 'ready', nodes: result.nodes, flatFiles: result.flatFiles, truncated: result.truncated })
        } else {
          setTreeState({ status: 'error', error: result.error })
        }
      })
      .catch(() => {
        setTreeState({ status: 'error', error: { kind: 'unexpected', message: 'Retry failed.' } })
      })
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--surface)',
      }}
    >
      {/* LEFT: file tree panel */}
      <div
        style={{
          width: 280,
          minWidth: 220,
          maxWidth: 280,
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {treeState.status === 'loading' && (
          <div
            role="status"
            aria-label="Loading repository tree"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: 'var(--muted)',
              fontSize: 12,
            }}
          >
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
            Loading tree…
            <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {treeState.status === 'error' && (
          <div
            role="alert"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: 20,
            }}
          >
            <AlertCircle size={24} style={{ color: 'var(--danger)', opacity: 0.8 }} aria-hidden="true" />
            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.6 }}>
              {treeState.error.message}
            </p>
            <button
              type="button"
              onClick={handleRetryTree}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 12px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <RefreshCw size={11} aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        {treeState.status === 'ready' && (
          <RepositoryTree
            nodes={treeState.nodes}
            selectedPath={selectedPath}
            onSelectFile={handleSelectFile}
            totalFiles={treeState.flatFiles.length}
            repoName={importedRepo?.fullName ?? ''}
          />
        )}
      </div>

      {/* RIGHT: source viewer panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Truncation warning */}
        {treeState.status === 'ready' && treeState.truncated && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 14px',
              background: 'rgba(245,158,11,0.08)',
              borderBottom: '1px solid rgba(245,158,11,0.2)',
              fontSize: 11,
              color: 'var(--warning)',
              flexShrink: 0,
            }}
          >
            <AlertCircle size={12} aria-hidden="true" />
            Repository tree is incomplete — GitHub returned a partial result (tree too large).
            Some files may not appear.
          </div>
        )}

        <SourceViewer state={viewerState} />
      </div>
    </div>
  )
}
