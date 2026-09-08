/**
 * src/components/repository/FileSearch.tsx
 *
 * Controlled text input for filtering the repository file tree.
 * Purely presentational — search logic lives in RepositoryTree.
 */

import { Search, X } from 'lucide-react'

interface FileSearchProps {
  value: string
  onChange: (value: string) => void
}

export default function FileSearch({ value, onChange }: FileSearchProps) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Search
        size={13}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 9,
          color: 'var(--muted)',
          pointerEvents: 'none',
          flexShrink: 0,
        }}
      />
      <input
        type="search"
        aria-label="Search files"
        placeholder="Search files…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '6px 28px 6px 28px',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color: 'var(--text)',
          fontSize: 12,
          outline: 'none',
          fontFamily: 'inherit',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          style={{
            position: 'absolute',
            right: 7,
            display: 'flex',
            alignItems: 'center',
            padding: 2,
            color: 'var(--muted)',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
