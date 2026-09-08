/**
 * src/components/repository/RepositoryTreeItem.tsx
 *
 * Renders a single node in the repository file tree:
 *  - FolderNode: chevron + folder icon + name, toggles expand on click
 *  - FileNode (supported): file icon + name, selectable
 *  - FileNode (unsupported): greyed out, shows tooltip, not selectable
 *
 * Recurses for folder children when the folder is expanded.
 */

import { useState } from 'react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileCode2,
  FileText,
  File,
  FileJson,
  FileImage,
} from 'lucide-react'
import type { RepoTreeNode, FileNode, FolderNode } from '../../lib/types/github'

// ─── File icon selection ─────────────────────────────────────────────────────

const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'cs', 'php', 'sh', 'bash'])
const TEXT_EXTS = new Set(['md', 'mdx', 'txt', 'yaml', 'yml', 'toml', 'env', 'gitignore', 'editorconfig'])
const JSON_EXTS = new Set(['json', 'jsonc'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'bmp'])

function getExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function FileIcon({ name, supported }: { name: string; supported: boolean }) {
  if (!supported) return <File size={13} style={{ color: 'var(--muted)', opacity: 0.5 }} />
  const ext = getExt(name)
  if (CODE_EXTS.has(ext))  return <FileCode2 size={13} style={{ color: 'var(--accent-light)' }} />
  if (TEXT_EXTS.has(ext))  return <FileText  size={13} style={{ color: '#6ee7b7' }} />
  if (JSON_EXTS.has(ext))  return <FileJson  size={13} style={{ color: '#fbbf24' }} />
  if (IMAGE_EXTS.has(ext)) return <FileImage size={13} style={{ color: '#a78bfa' }} />
  return <File size={13} style={{ color: 'var(--muted)' }} />
}

// ─── Single item ─────────────────────────────────────────────────────────────

interface TreeItemProps {
  node: RepoTreeNode
  depth: number
  selectedPath: string | null
  onSelectFile: (node: FileNode) => void
}

function FolderItem({
  node, depth, selectedPath, onSelectFile,
}: {
  node: FolderNode
  depth: number
  selectedPath: string | null
  onSelectFile: (n: FileNode) => void
}) {
  const [open, setOpen] = useState(depth === 0)

  return (
    <li style={{ listStyle: 'none' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          width: '100%',
          padding: `3px 8px 3px ${8 + depth * 14}px`,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text)',
          fontSize: 12,
          fontFamily: 'inherit',
          textAlign: 'left',
          borderRadius: 3,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onMouseOver={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
        onMouseOut={(e)  => (e.currentTarget.style.background = 'transparent')}
      >
        <ChevronRight
          size={12}
          aria-hidden="true"
          style={{
            color: 'var(--muted)',
            transform: open ? 'rotate(90deg)' : 'none',
            flexShrink: 0,
          }}
        />
        {open
          ? <FolderOpen size={13} aria-hidden="true" style={{ color: '#fbbf24', flexShrink: 0 }} />
          : <Folder    size={13} aria-hidden="true" style={{ color: '#fbbf24', flexShrink: 0 }} />
        }
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
      </button>

      {open && node.children.length > 0 && (
        <ul style={{ margin: 0, padding: 0 }}>
          {node.children.map((child) => (
            <RepositoryTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function FileItem({
  node, depth, selected, onSelectFile,
}: {
  node: FileNode
  depth: number
  selected: boolean
  onSelectFile: (n: FileNode) => void
}) {
  return (
    <li style={{ listStyle: 'none' }}>
      <button
        type="button"
        onClick={() => { if (node.supported) onSelectFile(node) }}
        disabled={!node.supported}
        title={node.supported ? node.path : `${node.name} — ${node.language} (not displayable)`}
        aria-pressed={selected}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          width: '100%',
          padding: `3px 8px 3px ${8 + depth * 14}px`,
          background: selected ? 'rgba(99,102,241,0.18)' : 'transparent',
          border: 'none',
          cursor: node.supported ? 'pointer' : 'default',
          color: node.supported ? (selected ? 'var(--accent-light)' : 'var(--text)') : 'var(--muted)',
          opacity: node.supported ? 1 : 0.55,
          fontSize: 12,
          fontFamily: 'inherit',
          textAlign: 'left',
          borderRadius: 3,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onMouseOver={(e) => {
          if (!selected && node.supported)
            e.currentTarget.style.background = 'var(--surface2)'
        }}
        onMouseOut={(e) => {
          if (!selected)
            e.currentTarget.style.background = selected ? 'rgba(99,102,241,0.18)' : 'transparent'
        }}
      >
        <span style={{ width: 12, flexShrink: 0 }} aria-hidden="true" />
        <span style={{ flexShrink: 0 }} aria-hidden="true">
          <FileIcon name={node.name} supported={node.supported} />
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
      </button>
    </li>
  )
}

// ─── Exported recursive item ─────────────────────────────────────────────────

export default function RepositoryTreeItem({
  node, depth, selectedPath, onSelectFile,
}: TreeItemProps) {
  if (node.kind === 'folder') {
    return (
      <FolderItem
        node={node}
        depth={depth}
        selectedPath={selectedPath}
        onSelectFile={onSelectFile}
      />
    )
  }
  return (
    <FileItem
      node={node}
      depth={depth}
      selected={selectedPath === node.path}
      onSelectFile={onSelectFile}
    />
  )
}
