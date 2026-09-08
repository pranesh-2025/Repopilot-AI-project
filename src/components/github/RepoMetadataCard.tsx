/**
 * src/components/github/RepoMetadataCard.tsx
 *
 * Displays real repository metadata returned by the GitHub API.
 * Receives a `GitHubRepoMeta` object — all fields are already normalised
 * by githubService before reaching this component.
 *
 * This component is purely presentational: no API calls, no state.
 */

import { Star, GitFork, GitBranch, Globe, Code2 } from 'lucide-react'
import type { GitHubRepoMeta } from '../../lib/types/github'
import SectionCard from '../ui/SectionCard'

interface RepoMetadataCardProps {
  repo: GitHubRepoMeta
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span
        aria-hidden="true"
        style={{ color: 'var(--muted)', marginTop: 1, flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}
      >
        {icon}
      </span>
      <span style={{ color: 'var(--muted)', fontSize: 12, minWidth: 120, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ color: 'var(--text)', fontSize: 13, wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

export default function RepoMetadataCard({ repo }: RepoMetadataCardProps) {
  return (
    <SectionCard
      title="Imported Repository"
      action={
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 10px',
            borderRadius: 99,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            background: 'rgba(34,197,94,0.12)',
            color: 'var(--success)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--success)',
            }}
            aria-hidden="true"
          />
          GitHub · Live data
        </span>
      }
    >
      {/* Repo name + description */}
      <div style={{ marginBottom: 16 }}>
        <a
          href={repo.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--accent-light)',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>{repo.fullName}</span>
          <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
            <Globe size={13} />
          </span>
        </a>

        {repo.description && (
          <p
            style={{
              marginTop: 6,
              fontSize: 13,
              color: 'var(--muted)',
              lineHeight: 1.6,
            }}
          >
            {/* repo.description is a plain string — safe to render directly */}
            {repo.description}
          </p>
        )}
      </div>

      {/* Star / fork counts — visually prominent */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          marginBottom: 16,
          paddingBottom: 16,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          title="Stars"
        >
          <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
            <Star size={15} style={{ color: '#f59e0b' }} />
          </span>
          <strong style={{ color: 'var(--text)' }}>
            {repo.stars.toLocaleString()}
          </strong>
          <span style={{ color: 'var(--muted)' }}>stars</span>
        </span>

        <span
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          title="Forks"
        >
          <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
            <GitFork size={15} style={{ color: 'var(--muted)' }} />
          </span>
          <strong style={{ color: 'var(--text)' }}>
            {repo.forks.toLocaleString()}
          </strong>
          <span style={{ color: 'var(--muted)' }}>forks</span>
        </span>
      </div>

      {/* Metadata rows */}
      <div>
        <MetaRow icon={<Code2 size={14} />}    label="Primary language" value={repo.language}      />
        <MetaRow icon={<GitBranch size={14} />} label="Default branch"   value={repo.defaultBranch} />
        <MetaRow icon={<Globe size={14} />}     label="Repository URL"   value={repo.url}           />
        <div style={{ borderBottom: 'none' }}>
          <MetaRow
            icon={<Star size={14} />}
            label="Last pushed"
            value={new Date(repo.pushedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          />
        </div>
      </div>

    </SectionCard>
  )
}
