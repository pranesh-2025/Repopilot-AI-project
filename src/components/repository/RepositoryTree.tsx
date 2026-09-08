/**
 * src/components/repository/RepositoryTree.tsx
 *
 * Renders the full repository file tree with client-side search filtering.
 * All data comes from props — no API calls in this component.
 *
 * Search: filters the flat file list and rebuilds folder hierarchy to show
 * only folders that have at least one matching descendant.
 */

import { useState, useMemo } from 'react'
import type { RepoTreeNode, FileNode, FolderNode } from '../../lib/types/github'
import RepositoryTreeItem from './RepositoryTreeItem'
import FileSearch from './FileSearch'

// ─── Search filter helpers ───────────────────────────────────────────────────

/** Returns true if any descendant file path matches the query */
function folderHasMatch(folder: FolderNode, query: string): boolean {
  return folder.children.some((child) => {
    if (child.kind === 'file') return child.path.toLowerCase().includes(query)
    return folderHasMatch(child, query)
  })
}

/** Returns a filtered copy of the tree, pruning folders with no matching descendants */
function filterTree(nodes: RepoTreeNode[], query: string): RepoTreeNode[] {
  if (!query) return nodes
  const q = query.toLowerCase()
  const result: RepoTreeNode[] = []
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.path.toLowerCase().includes(q)) result.push(node)
    } else {
      if (folderHasMatch(node, q)) {
        const filtered = filterTree(node.children, q)
        result.push({ ...node, children: filtered })
      }
    }
  }
  return result
}

// ─── Component ───────────────────────────────────────────────────────────────

interface RepositoryTreeProps {
  nodes: RepoTreeNode[]
  selectedPath: string | null
  onSelectFile: (node: FileNode) => void
  /** Total file count (for the summary line) */
  totalFiles: number
  repoName: string
}

export default function RepositoryTree({
  nodes,
  selectedPath,
  onSelectFile,
  totalFiles,
  repoName,
}: RepositoryTreeProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const visibleNodes = useMemo(
    () => filterTree(nodes, searchQuery),
    [nodes, searchQuery],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text)',
            marginBottom: 8,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={repoName}
        >
          {repoName}
        </div>
        <FileSearch value={searchQuery} onChange={setSearchQuery} />
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
          {searchQuery
            ? `Filtering ${totalFiles.toLocaleString()} files`
            : `${totalFiles.toLocaleString()} files`}
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {visibleNodes.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 12,
            }}
          >
            {searchQuery
              ? `No files match "${searchQuery}"`
              : 'Repository is empty'}
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0 }}>
            {visibleNodes.map((node) => (
              <RepositoryTreeItem
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
