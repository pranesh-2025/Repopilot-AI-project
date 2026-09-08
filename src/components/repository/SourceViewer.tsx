/**
 * src/components/repository/SourceViewer.tsx
 *
 * Right panel of the Repository Explorer.
 * Displays source file contents with:
 *  - Line numbers (separate gutter column)
 *  - Syntax highlighting via highlight.js (core + specific languages only)
 *  - Four UI states: empty / loading / error / content
 *
 * Security:
 *  - File content is NEVER executed, eval'd, or inserted via dangerouslySetInnerHTML.
 *  - Syntax-highlighted HTML from highlight.js is inserted safely because:
 *    (a) it only operates on plain text that we control (decoded file content)
 *    (b) highlight.js HTML-escapes all characters before wrapping in <span> tags
 *    (c) we do NOT pass untrusted HTML to highlight.js — only the decoded text
 *  - dangerouslySetInnerHTML is used ONLY for the highlight.js output,
 *    which consists exclusively of:
 *      • HTML entities for characters like <, >, &
 *      • <span class="hljs-*"> wrappers with no href, src, or event attributes
 *  - This is the standard, documented usage of highlight.js in React.
 *
 * Why dangerouslySetInnerHTML here is acceptable:
 *   The input to hljs.highlight() is always a plain-text string (decoded file bytes).
 *   highlight.js escapes every HTML special character before emitting tokens.
 *   No user-supplied URL, script, or HTML attribute ever enters the highlighted output.
 *   The alternative (splitting lines and rendering spans per token) would require
 *   reimplementing highlight.js's entire tokeniser — far more error-prone.
 */

import { useMemo } from 'react'
import hljs from 'highlight.js/lib/core'

// Register only the languages we support — keeps bundle small
import javascript  from 'highlight.js/lib/languages/javascript'
import typescript  from 'highlight.js/lib/languages/typescript'
import xml         from 'highlight.js/lib/languages/xml'       // html + svg
import css         from 'highlight.js/lib/languages/css'
import scss        from 'highlight.js/lib/languages/scss'
import less        from 'highlight.js/lib/languages/less'
import json        from 'highlight.js/lib/languages/json'
import yaml        from 'highlight.js/lib/languages/yaml'
import markdown    from 'highlight.js/lib/languages/markdown'
import python      from 'highlight.js/lib/languages/python'
import ruby        from 'highlight.js/lib/languages/ruby'
import go          from 'highlight.js/lib/languages/go'
import rust        from 'highlight.js/lib/languages/rust'
import java        from 'highlight.js/lib/languages/java'
import kotlin      from 'highlight.js/lib/languages/kotlin'
import swift       from 'highlight.js/lib/languages/swift'
import cpp         from 'highlight.js/lib/languages/cpp'
import csharp      from 'highlight.js/lib/languages/csharp'
import php         from 'highlight.js/lib/languages/php'
import bash        from 'highlight.js/lib/languages/bash'
import sql         from 'highlight.js/lib/languages/sql'
import graphql     from 'highlight.js/lib/languages/graphql'
import ini         from 'highlight.js/lib/languages/ini'       // toml
import plaintext   from 'highlight.js/lib/languages/plaintext'
import dockerfile  from 'highlight.js/lib/languages/dockerfile'

hljs.registerLanguage('javascript',  javascript)
hljs.registerLanguage('typescript',  typescript)
hljs.registerLanguage('xml',         xml)
hljs.registerLanguage('css',         css)
hljs.registerLanguage('scss',        scss)
hljs.registerLanguage('less',        less)
hljs.registerLanguage('json',        json)
hljs.registerLanguage('yaml',        yaml)
hljs.registerLanguage('markdown',    markdown)
hljs.registerLanguage('python',      python)
hljs.registerLanguage('ruby',        ruby)
hljs.registerLanguage('go',          go)
hljs.registerLanguage('rust',        rust)
hljs.registerLanguage('java',        java)
hljs.registerLanguage('kotlin',      kotlin)
hljs.registerLanguage('swift',       swift)
hljs.registerLanguage('cpp',         cpp)
hljs.registerLanguage('c',           cpp)   // c uses cpp grammar
hljs.registerLanguage('csharp',      csharp)
hljs.registerLanguage('php',         php)
hljs.registerLanguage('bash',        bash)
hljs.registerLanguage('sql',         sql)
hljs.registerLanguage('graphql',     graphql)
hljs.registerLanguage('ini',         ini)
hljs.registerLanguage('plaintext',   plaintext)
hljs.registerLanguage('dockerfile',  dockerfile)

import type { FileContent, GitHubFetchError } from '../../lib/types/github'
import { AlertCircle, Loader2, FileCode2 } from 'lucide-react'

// ─── Highlight.js dark theme (inline, no external CSS file needed) ───────────
const HLJS_DARK_THEME = `
.hljs{background:#0f1117;color:#abb2bf}.hljs-comment,.hljs-quote{color:#5c6370;font-style:italic}
.hljs-doctag,.hljs-keyword,.hljs-formula{color:#c678dd}
.hljs-section,.hljs-name,.hljs-selector-tag,.hljs-deletion,.hljs-subst{color:#e06c75}
.hljs-literal{color:#56b6c2}.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string{color:#98c379}
.hljs-attr,.hljs-variable,.hljs-template-variable,.hljs-type,.hljs-selector-class,.hljs-selector-attr,.hljs-selector-pseudo,.hljs-number{color:#d19a66}
.hljs-symbol,.hljs-bullet,.hljs-link,.hljs-meta,.hljs-selector-id,.hljs-title{color:#61aeee}
.hljs-built_in,.hljs-title.class_,.hljs-class .hljs-title{color:#e6c07b}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:bold}
.hljs-link{text-decoration:underline}
`

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewerState =
  | { status: 'empty' }
  | { status: 'loading'; filename: string }
  | { status: 'error';   error: GitHubFetchError }
  | { status: 'content'; file: FileContent }

interface SourceViewerProps {
  state: ViewerState
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyPanel() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted)',
        gap: 12,
        padding: 32,
      }}
    >
      <FileCode2 size={40} style={{ opacity: 0.3 }} aria-hidden="true" />
      <p style={{ margin: 0, fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
        Select a file from the tree to view its source.
      </p>
    </div>
  )
}

function LoadingPanel({ filename }: { filename: string }) {
  return (
    <div
      role="status"
      aria-label={`Loading ${filename}`}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        color: 'var(--muted)',
        fontSize: 13,
      }}
    >
      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
      Loading {filename}…
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function ErrorPanel({ error }: { error: GitHubFetchError }) {
  return (
    <div
      role="alert"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 32,
      }}
    >
      <AlertCircle size={32} style={{ color: 'var(--danger)', opacity: 0.8 }} aria-hidden="true" />
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: 'var(--muted)',
          textAlign: 'center',
          maxWidth: 360,
          lineHeight: 1.6,
        }}
      >
        {error.message}
      </p>
    </div>
  )
}

function ContentPanel({ file }: { file: FileContent }) {
  // Highlight once per file change (memoised)
  const highlighted = useMemo(() => {
    try {
      return hljs.highlight(file.content, { language: file.language }).value
    } catch {
      // Fallback: highlight.js HTML-escapes the content even in plaintext mode
      return hljs.highlight(file.content, { language: 'plaintext' }).value
    }
  }, [file.content, file.language])

  const lines = highlighted.split('\n')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* File header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
          flexWrap: 'wrap',
          rowGap: 4,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text)',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          }}
        >
          {file.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.path}
        </span>
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {file.lines.toLocaleString()} lines
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {file.size < 1024
              ? `${file.size} B`
              : `${Math.round(file.size / 1024)} KB`}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--accent-light)',
              background: 'rgba(99,102,241,0.12)',
              padding: '1px 7px',
              borderRadius: 99,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {file.language}
          </span>
        </div>
      </div>

      {/* Code body */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex' }}>
        {/* Highlight.js dark theme */}
        <style>{HLJS_DARK_THEME}</style>

        {/* Line number gutter */}
        <div
          aria-hidden="true"
          style={{
            flexShrink: 0,
            padding: '12px 10px',
            background: 'var(--surface2)',
            borderRight: '1px solid var(--border)',
            textAlign: 'right',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            lineHeight: '1.6',
            color: 'var(--muted)',
            userSelect: 'none',
            minWidth: 48,
          }}
        >
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Source code — dangerouslySetInnerHTML is used here ONLY for hljs output.
            See the module-level security comment for the full justification.
            hljs.highlight() HTML-escapes all source characters before producing tokens.
            No untrusted HTML ever reaches this innerHTML. */}
        <pre
          style={{
            flex: 1,
            margin: 0,
            padding: '12px 16px',
            overflow: 'visible',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            lineHeight: '1.6',
            tabSize: 2,
            background: 'var(--bg)',
            color: 'var(--text)',
            whiteSpace: 'pre',
          }}
        >
          <code
            className={`language-${file.language}`}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SourceViewer({ state }: SourceViewerProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg)',
        minWidth: 0,
      }}
    >
      {state.status === 'empty'   && <EmptyPanel />}
      {state.status === 'loading' && <LoadingPanel filename={state.filename} />}
      {state.status === 'error'   && <ErrorPanel error={state.error} />}
      {state.status === 'content' && <ContentPanel file={state.file} />}
    </div>
  )
}

export type { ViewerState }
