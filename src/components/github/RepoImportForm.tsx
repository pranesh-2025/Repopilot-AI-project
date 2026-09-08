/**
 * src/components/github/RepoImportForm.tsx
 *
 * Self-contained GitHub repository import form.
 * Manages all UI states internally:
 *   - empty   : initial state, URL input visible
 *   - loading : GitHub API request in flight
 *   - error   : invalid URL, 404, rate limit, network failure
 *   - success : real repository metadata returned (lifted to parent via onSuccess)
 *
 * The component calls `importGitHubRepo` from githubService — no GitHub API
 * logic lives inside this file.
 *
 * Props:
 *   onSuccess(repo) — called when GitHub returns valid metadata so the parent
 *                     (DashboardPage) can display the RepoMetadataCard.
 */

import { useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { importGitHubRepo, parseGitHubUrl } from '../../lib/services/githubService'
import type { GitHubRepoMeta } from '../../lib/types/github'
import SectionCard from '../ui/SectionCard'

interface RepoImportFormProps {
  onSuccess: (repo: GitHubRepoMeta) => void
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '10px 12px',
        background: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: 'var(--radius)',
        fontSize: 12,
        color: 'var(--danger)',
        lineHeight: 1.5,
      }}
    >
      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      {message}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type FormState = 'idle' | 'loading' | 'error'

export default function RepoImportForm({ onSuccess }: RepoImportFormProps) {
  const [url, setUrl]         = useState('')
  const [state, setState]     = useState<FormState>('idle')
  const [errorMsg, setErrMsg] = useState<string>('')

  // Live URL hint shown below the input before submission
  const parsed = parseGitHubUrl(url)
  const urlHint = url.trim() && !parsed
    ? 'Not a valid GitHub repository URL'
    : parsed
    ? `${parsed.owner} / ${parsed.repo}`
    : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'loading') return   // prevent duplicate submission

    setState('loading')
    setErrMsg('')

    const result = await importGitHubRepo(url)

    if (result.ok) {
      setState('idle')
      setUrl('')
      onSuccess(result.data)
    } else {
      setState('error')
      setErrMsg(result.error.message)
    }
  }

  const isLoading     = state === 'loading'
  const hasError      = state === 'error'
  const inputInvalid  = url.trim().length > 0 && !parsed

  return (
    <SectionCard title="Import a GitHub Repository">
      <form
        onSubmit={handleSubmit}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {/* Input row */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label
              htmlFor="github-repo-url"
              style={{
                display: 'block',
                fontSize: 12,
                color: 'var(--muted)',
                marginBottom: 6,
              }}
            >
              Public GitHub repository URL
            </label>

            <input
              id="github-repo-url"
              type="url"
              placeholder="https://github.com/owner/repository"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (state === 'error') { setState('idle'); setErrMsg('') }
              }}
              disabled={isLoading}
              aria-invalid={inputInvalid || hasError}
              aria-describedby={
                hasError
                  ? 'github-import-error'
                  : urlHint
                  ? 'github-url-hint'
                  : undefined
              }
              style={{
                width: '100%',
                padding: '9px 12px',
                background: isLoading ? 'var(--surface2)' : 'var(--surface2)',
                border: `1px solid ${inputInvalid || hasError ? 'var(--danger)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                color: isLoading ? 'var(--muted)' : 'var(--text)',
                fontSize: 13,
                outline: 'none',
                fontFamily: 'inherit',
                cursor: isLoading ? 'not-allowed' : 'text',
              }}
              onFocus={(e) => {
                if (!inputInvalid && !hasError)
                  e.currentTarget.style.borderColor = 'var(--accent)'
              }}
              onBlur={(e) => {
                if (!inputInvalid && !hasError)
                  e.currentTarget.style.borderColor = 'var(--border)'
              }}
            />

            {/* Live hint — shown only when there is something to say */}
            {urlHint && !hasError && (
              <p
                id="github-url-hint"
                style={{
                  margin: '5px 0 0',
                  fontSize: 11,
                  color: inputInvalid ? 'var(--danger)' : 'var(--success)',
                }}
              >
                {urlHint}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              type="submit"
              disabled={isLoading || inputInvalid || !url.trim()}
              aria-busy={isLoading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 20px',
                background: isLoading || inputInvalid || !url.trim()
                  ? 'var(--surface2)'
                  : 'var(--accent)',
                color: isLoading || inputInvalid || !url.trim()
                  ? 'var(--muted)'
                  : '#fff',
                borderRadius: 'var(--radius)',
                fontSize: 13,
                fontWeight: 600,
                cursor: isLoading || inputInvalid || !url.trim()
                  ? 'not-allowed'
                  : 'pointer',
                border: '1px solid var(--border)',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {isLoading && (
                <Loader2
                  size={14}
                  aria-hidden="true"
                  style={{ animation: 'spin 1s linear infinite' }}
                />
              )}
              {isLoading ? 'Fetching…' : 'Import Repository'}
            </button>
          </div>
        </div>

        {/* Error message */}
        {hasError && errorMsg && (
          <ErrorMessage message={errorMsg} />
        )}

        {/* Empty-state helper text */}
        {!url.trim() && (
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: 'var(--muted)',
              lineHeight: 1.6,
            }}
          >
            Enter a public GitHub repository URL to import its metadata. No GitHub account
            required. Full code analysis will be available in the next phase.
          </p>
        )}
      </form>

      {/* Spinner keyframe (injected once) */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </SectionCard>
  )
}
