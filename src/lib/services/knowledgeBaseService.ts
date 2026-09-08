/**
 * src/lib/services/knowledgeBaseService.ts
 *
 * Phase 5A Repository Knowledge Base Builder.
 *
 * Accepts already-fetched repository data (from the Phase 4 pipeline) and
 * produces a structured, in-memory KnowledgeBase ready for retrieval.
 *
 * Architecture:
 *   Phase 4 data (flatFiles + fetchedContents)
 *       ↓
 *   buildKnowledgeBase(meta, flatFiles, truncated, fetchedContents)
 *       ↓
 *   KnowledgeBuildResult  (synchronous, no I/O)
 *
 * Security:
 *   - .env and credential-bearing files are excluded before any content access
 *   - No eval, no Function(), no dynamic imports
 *   - All regex patterns are static compile-time constants
 *   - Content is split on newlines only — never executed or HTML-rendered
 *   - File paths come from GitHub API (already validated upstream)
 */

import type { GitHubRepoMeta, FileNode, FileContent } from '../types/github'
import type {
  ChunkMetadata,
  ChunkingConfig,
  FileClassification,
  IgnoreReason,
  IndexedFile,
  IgnoredFile,
  KnowledgeBase,
  KnowledgeBaseStats,
  KnowledgeBuildResult,
} from '../types/knowledgeBase'

// ─── Configuration ────────────────────────────────────────────────────────────

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  maxChunkLines:   80,
  overlapLines:    10,
  minChunkLines:   5,
  maxFileSizeBytes: 100_000,
}

// ─── Secret / sensitive filename patterns ────────────────────────────────────

/**
 * Basenames that should never have their content fetched or indexed.
 * Matches exact filenames (case-insensitive) and common secret patterns.
 */
const SECRET_BASENAME_RE =
  /^\.env(?:\.(?:local|production|development|test|staging|example\.local|sample\.local))?$|^secrets?\.json$|^credentials?\.json$|^\.secret/i

// ─── Generated / lock-file patterns ──────────────────────────────────────────

const GENERATED_BASENAME_RE =
  /^(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum|Gemfile\.lock|shrinkwrap\.json|npm-shrinkwrap\.json)$/

const MINIFIED_PATH_RE = /\.min\.[cm]?[jt]s$|\.min\.css$|-min\.[cm]?js$/

/** Path segments that indicate generated / compiled output */
const GENERATED_PATH_SEGMENT_RE =
  /(?:^|\/)(?:dist|build|out|\.next|\.nuxt|\.svelte-kit|\.output|coverage|\.turbo|\.cache|__pycache__|vendor)\//

// ─── Test file patterns ───────────────────────────────────────────────────────

const TEST_PATH_RE =
  /(?:^|\/)(?:test|tests|__tests__|spec|specs|e2e|cypress|playwright)\//i

const TEST_FILENAME_RE =
  /\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.[a-z]+$|_spec\.[a-z]+$|^test_[^/]+\.[a-z]+$|^spec_[^/]+\.[a-z]+$/i

// ─── Configuration file patterns ─────────────────────────────────────────────

const CONFIG_LANGUAGES = new Set([
  'JSON', 'YAML', 'TOML', 'XML', 'Config', 'ENV',
  'Dockerfile', 'Makefile', 'Lock file', 'JSON/Config',
])

const CONFIG_FILENAME_RE =
  /(?:^|\/)(?:tsconfig|jest\.config|vitest\.config|vite\.config|webpack\.config|rollup\.config|babel\.config|prettier\.config|eslint\.config|karma\.conf|playwright\.config|cypress\.config|\.eslintrc|\.prettierrc|\.babelrc|\.editorconfig|Makefile|Dockerfile|docker-compose|\.travis|\.circleci|Jenkinsfile|\.gitlab-ci|azure-pipelines|serverless|turbo\.json)[^/]*$|\.ya?ml$|\.toml$|\.ini$|\.cfg$|\.conf$/i

// ─── Documentation file patterns ─────────────────────────────────────────────

const DOC_LANGUAGES = new Set(['Markdown', 'MDX', 'Text'])

const DOC_FILENAME_RE =
  /(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING|LICENSE|NOTICE|AUTHORS|HISTORY|CODE_OF_CONDUCT|SECURITY)[^/]*$/i

// ─── Declaration boundary patterns (per language group) ──────────────────────

/**
 * Maps a language label to a regex that matches lines starting a logical unit
 * (function, class, heading, etc.). Used by the chunker to prefer splitting
 * at meaningful boundaries rather than arbitrary line counts.
 */
const BOUNDARY_RE: Readonly<Record<string, RegExp>> = {
  TypeScript: /^(?:export\s+)?(?:(?:async\s+)?function|class|const\s+\w+\s*=\s*(?:async\s+)?\(|interface|type\s+\w+\s*=|enum|abstract\s+class)\b/,
  TSX:        /^(?:export\s+)?(?:(?:async\s+)?function|class|const\s+\w+\s*=\s*(?:async\s+)?\(|interface|type\s+\w+\s*=|enum)\b/,
  JavaScript: /^(?:export\s+)?(?:(?:async\s+)?function|class|const\s+\w+\s*=\s*(?:async\s+)?\(|module\.exports)\b/,
  JSX:        /^(?:export\s+)?(?:(?:async\s+)?function|class|const\s+\w+\s*=\s*(?:async\s+)?\()\b/,
  Python:     /^(?:async\s+)?def\s|^class\s/,
  Go:         /^func\s/,
  Rust:       /^(?:pub(?:\([^)]*\))?\s+)?(?:fn\s|struct\s|enum\s|impl\s|trait\s|type\s)/,
  Ruby:       /^(?:def\s|class\s|module\s)/,
  Java:       /^(?:\s*(?:public|private|protected|static|final|abstract|synchronized)\s+)*(?:class|interface|enum|@interface|void|\w+)\s+\w+\s*[({<]/,
  Kotlin:     /^(?:fun\s|class\s|object\s|interface\s|data\s+class\s|sealed\s+class\s|enum\s+class\s)/,
  'C#':       /^(?:\s*(?:public|private|protected|internal|static|override|virtual|abstract|sealed|async)\s+)*(?:class|interface|enum|struct|void|\w+)\s+\w+\s*[({<]/,
  'C++':      /^(?:[\w:*&<>]+\s+)+[\w:*~]+\s*\([^)]*\)\s*(?:const\s*)?[{;]|^class\s|^struct\s|^namespace\s/,
  'C':        /^[\w*]+\s+[\w*]+\s*\([^)]*\)\s*\{|^typedef\s|^struct\s|^enum\s/,
  PHP:        /^(?:function\s|class\s|interface\s|trait\s|abstract\s+class\s)/,
  Swift:      /^(?:func\s|class\s|struct\s|enum\s|protocol\s|extension\s|actor\s)/,
  Markdown:   /^#{1,6}\s/,
  MDX:        /^#{1,6}\s/,
  SQL:        /^(?:CREATE|ALTER|DROP|SELECT|INSERT|UPDATE|DELETE|WITH)\b/i,
  GraphQL:    /^(?:type|input|interface|enum|union|scalar|schema|fragment|query|mutation|subscription)\s/,
  Shell:      /^(?:function\s+\w+|^\w+\s*\(\)\s*\{)/,
}

// ─── Symbol-hint extraction ───────────────────────────────────────────────────

/**
 * Extract the leading declaration name from a single source line.
 * Returns empty string when no named declaration is found.
 * Applied only to the first non-blank line of each chunk.
 */
function extractSymbolHint(line: string, language: string): string {
  const trimmed = line.trim()
  if (!trimmed) return ''

  // Language-specific extraction
  if (language === 'Python') {
    const m = /^(?:async\s+)?def\s+([\w_]+)|^class\s+([\w_]+)/.exec(trimmed)
    return m ? (m[1] ?? m[2] ?? '') : ''
  }
  if (language === 'Go') {
    const m = /^func\s+(?:\([^)]+\)\s+)?([\w_]+)/.exec(trimmed)
    return m ? (m[1] ?? '') : ''
  }
  if (language === 'Rust') {
    const m = /^(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|impl|trait|type)\s+([\w_]+)/.exec(trimmed)
    return m ? (m[1] ?? '') : ''
  }
  if (language === 'Ruby') {
    const m = /^(?:def|class|module)\s+([\w_:]+)/.exec(trimmed)
    return m ? (m[1] ?? '') : ''
  }
  if (language === 'SQL') {
    const m = /^(?:CREATE|ALTER)\s+(?:TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."[\]`]+)/i.exec(trimmed)
    return m ? (m[1] ?? '') : ''
  }
  if (language === 'Markdown' || language === 'MDX') {
    const m = /^#{1,6}\s+(.+)/.exec(trimmed)
    return m ? (m[1] ?? '').slice(0, 60).trim() : ''
  }
  if (language === 'GraphQL') {
    const m = /^(?:type|input|interface|enum|fragment|query|mutation)\s+([\w_]+)/.exec(trimmed)
    return m ? (m[1] ?? '') : ''
  }
  // JS / TS / JSX / TSX / C# / Java / PHP / Kotlin / Swift / C / C++
  // Capture the first word after common keywords
  const m =
    /(?:function|class|interface|enum|struct|trait|protocol|extension|actor)\s+([\w_$]+)/.exec(trimmed) ??
    /^(?:export\s+)?(?:async\s+)?(?:const|let|var)\s+([\w_$]+)\s*=\s*(?:async\s+)?(?:function|\()/.exec(trimmed) ??
    /^(?:export\s+default\s+function|export\s+function)\s+([\w_$]+)/.exec(trimmed)
  return m ? (m[1] ?? '') : ''
}

// ─── Deterministic chunk ID ───────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash — pure arithmetic, no crypto dependency.
 * Given identical inputs, always produces the same hex string.
 */
function deterministicId(
  repo: string,
  path: string,
  startLine: number,
  endLine: number,
): string {
  const raw = `${repo}::${path}::${startLine}::${endLine}`
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    // FNV prime × h — keep 32-bit via >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ─── File classification ──────────────────────────────────────────────────────

/**
 * Classify a file by its path and language.
 * Returns the classification or 'unknown' — never throws.
 */
function classifyFile(path: string, language: string): FileClassification {
  const basename = path.split('/').pop() ?? path

  if (DOC_LANGUAGES.has(language) || DOC_FILENAME_RE.test(path)) return 'documentation'
  if (TEST_PATH_RE.test(path) || TEST_FILENAME_RE.test(basename)) return 'test'
  if (
    GENERATED_BASENAME_RE.test(basename) ||
    MINIFIED_PATH_RE.test(path) ||
    GENERATED_PATH_SEGMENT_RE.test(path)
  ) return 'generated'
  if (
    CONFIG_LANGUAGES.has(language) ||
    CONFIG_FILENAME_RE.test(path)
  ) return 'configuration'

  // Languages that produce source code
  const SOURCE_LANGUAGES = new Set([
    'TypeScript', 'TSX', 'JavaScript', 'JSX',
    'Python', 'Ruby', 'Go', 'Rust', 'Java', 'Kotlin', 'Swift',
    'C', 'C++', 'C/C++ Header', 'C++ Header', 'C#', 'PHP',
    'Shell', 'Bash', 'SQL', 'GraphQL', 'Vue', 'Svelte',
    'Dart', 'Lua', 'R', 'Scala', 'Elixir', 'Erlang', 'Haskell', 'Clojure',
  ])
  if (SOURCE_LANGUAGES.has(language)) return 'source'

  return 'unknown'
}

/**
 * Determine if a file should be ignored, and why.
 * Returns an IgnoreReason string, or null if the file is acceptable.
 */
function shouldIgnoreFile(
  file: FileNode,
  fetchedContents: Map<string, FileContent>,
  config: ChunkingConfig,
): IgnoreReason | null {
  const basename = file.name.toLowerCase()

  // Secret files — checked first, before any content access
  if (SECRET_BASENAME_RE.test(file.name)) return 'secret'

  // Unsupported by the GitHub service (binary / unrecognised extension)
  if (!file.supported) return file.language === 'Binary' ? 'binary' : 'unsupported'

  // Generated / lock files — content would not be useful for code understanding
  if (
    GENERATED_BASENAME_RE.test(file.name) ||
    MINIFIED_PATH_RE.test(file.path) ||
    basename.endsWith('.map') ||
    (basename.endsWith('.d.ts') && GENERATED_PATH_SEGMENT_RE.test(file.path))
  ) return 'generated'

  // Not in the provided content map
  const fetched = fetchedContents.get(file.path)
  if (!fetched) return 'not_fetched'

  // Oversized (defence-in-depth — GitHub service also enforces this)
  if (fetched.size > config.maxFileSizeBytes) return 'oversized'

  // Empty content
  if (fetched.content.trim().length === 0) return 'empty'

  return null
}

// ─── Chunker ──────────────────────────────────────────────────────────────────

/**
 * Split a source file into overlapping chunks using a sliding window with
 * logical-boundary preference.
 *
 * The algorithm:
 *  1. Split content into lines.
 *  2. Slide a window of maxChunkLines forward.
 *  3. Before committing a split, search backward for the last declaration
 *     boundary within the lower half of the window.
 *  4. If found → split there; otherwise → fixed split.
 *  5. Advance with overlapLines carried into the next window.
 *  6. Tiny trailing windows (< minChunkLines) are merged into the previous chunk.
 */
export function chunkFile(
  content: string,
  path: string,
  language: string,
  classification: FileClassification,
  repository: string,
  config: ChunkingConfig,
): ChunkMetadata[] {
  const lines = content.split('\n')
  const totalLines = lines.length

  if (totalLines === 0) return []

  // Single-chunk case — entire file fits within one chunk
  if (totalLines <= config.maxChunkLines) {
    const symbolHint = extractSymbolHint(lines[0] ?? '', language)
    const id = deterministicId(repository, path, 1, totalLines)
    return [
      {
        id,
        repository,
        path,
        language,
        startLine: 1,
        endLine: totalLines,
        content,
        symbolHint,
        searchableText: `${path}\n${language}\n${content}`,
        classification,
      },
    ]
  }

  const boundaryRe = BOUNDARY_RE[language] ?? null
  const chunks: ChunkMetadata[] = []
  let pos = 0 // 0-based index into lines[]

  while (pos < totalLines) {
    const remaining = totalLines - pos
    if (remaining <= 0) break

    // Target end of this window (0-based, exclusive upper bound → then convert)
    let windowEnd = Math.min(pos + config.maxChunkLines, totalLines) - 1 // inclusive

    // If there's a boundary regex and we're not at the very end of the file,
    // search backward for a logical split point in the lower half of the window
    if (boundaryRe && windowEnd < totalLines - 1) {
      const searchStart = pos + Math.floor((windowEnd - pos) / 2)
      let bestBoundary = -1
      for (let i = windowEnd; i >= searchStart; i--) {
        if (boundaryRe.test(lines[i] ?? '')) {
          bestBoundary = i
          break
        }
      }
      if (bestBoundary > pos) {
        // Split just before the boundary so the boundary line starts the next chunk
        windowEnd = bestBoundary - 1
      }
    }

    // Find the first non-blank line in this chunk for symbol extraction
    let firstNonBlank = pos
    while (firstNonBlank <= windowEnd && !(lines[firstNonBlank] ?? '').trim()) {
      firstNonBlank++
    }
    const symbolHint = extractSymbolHint(lines[firstNonBlank] ?? '', language)

    const startLine = pos + 1         // 1-based
    const endLine   = windowEnd + 1   // 1-based
    const chunkContent = lines.slice(pos, windowEnd + 1).join('\n')
    const id = deterministicId(repository, path, startLine, endLine)

    // Check if this trailing chunk is too small to stand alone
    const chunkLineCount = windowEnd - pos + 1
    if (chunkLineCount < config.minChunkLines && chunks.length > 0) {
      // Merge into the previous chunk
      const prev = chunks[chunks.length - 1]
      const mergedContent = prev.content + '\n' + chunkContent
      const mergedEnd = endLine
      const mergedId = deterministicId(repository, path, prev.startLine, mergedEnd)
      chunks[chunks.length - 1] = {
        ...prev,
        id: mergedId,
        endLine: mergedEnd,
        content: mergedContent,
        searchableText: `${path}\n${language}\n${mergedContent}`,
      }
    } else {
      chunks.push({
        id,
        repository,
        path,
        language,
        startLine,
        endLine,
        content: chunkContent,
        symbolHint,
        searchableText: `${path}\n${language}\n${chunkContent}`,
        classification,
      })
    }

    // Advance: move forward by (chunkLineCount - overlapLines), minimum 1
    const advance = Math.max(1, chunkLineCount - config.overlapLines)
    pos += advance
  }

  return chunks
}

// ─── Statistics builder ───────────────────────────────────────────────────────

function buildStats(
  allChunks: ChunkMetadata[],
  fileIndex: Map<string, IndexedFile>,
  ignoredFiles: IgnoredFile[],
): KnowledgeBaseStats {
  const filesByClassification: Record<FileClassification, number> = {
    source: 0, test: 0, configuration: 0, documentation: 0, generated: 0, unknown: 0,
  }
  const filesByLanguage: Record<string, number> = {}
  const chunksByLanguage: Record<string, number> = {}
  let approximateIndexedLines = 0

  for (const indexedFile of fileIndex.values()) {
    filesByClassification[indexedFile.classification] =
      (filesByClassification[indexedFile.classification] ?? 0) + 1
    filesByLanguage[indexedFile.language] =
      (filesByLanguage[indexedFile.language] ?? 0) + 1
  }

  for (const chunk of allChunks) {
    chunksByLanguage[chunk.language] =
      (chunksByLanguage[chunk.language] ?? 0) + 1
    approximateIndexedLines += chunk.endLine - chunk.startLine + 1
  }

  return {
    totalIndexedFiles: fileIndex.size,
    totalIgnoredFiles: ignoredFiles.length,
    totalChunks: allChunks.length,
    approximateIndexedLines,
    filesByClassification,
    filesByLanguage,
    chunksByLanguage,
  }
}

// ─── Exported: main builder function ─────────────────────────────────────────

/**
 * Builds an in-memory knowledge base from already-fetched repository data.
 *
 * This function is SYNCHRONOUS and performs no I/O.
 * It never calls the GitHub API, executes code, or reads secrets.
 *
 * Phase 5A: only files present in `fetchedContents` are indexed.
 * Phase 5B: `additionalContents` (newly acquired source files) are merged in.
 *   Later entries win on key collision — `additionalContents` overrides `fetchedContents`
 *   for the same path, but in practice paths should not overlap.
 *
 * Files in the tree whose content was not fetched appear in `ignoredFiles`
 * with reason 'not_fetched', keeping stats transparent.
 *
 * @param meta               - Normalised repository metadata from githubService
 * @param flatFiles          - Flat file list from getRepoTree()
 * @param truncated          - Whether GitHub truncated the tree response
 * @param fetchedContents    - Map of path → FileContent (from Phase 4 pipeline)
 * @param config             - Optional chunking config override
 * @param additionalContents - Phase 5B acquired source files (merged with fetchedContents)
 */
export function buildKnowledgeBase(
  meta: GitHubRepoMeta,
  flatFiles: FileNode[],
  truncated: boolean,
  fetchedContents: Map<string, FileContent>,
  config: Partial<ChunkingConfig> = {},
  additionalContents?: Map<string, FileContent>,
): KnowledgeBuildResult {
  try {
    if (!meta || !meta.fullName) {
      return {
        ok: false,
        error: { kind: 'no_repository', message: 'No repository metadata provided.' },
      }
    }
    if (flatFiles.length === 0) {
      return {
        ok: false,
        error: {
          kind: 'no_files',
          message: 'No file tree data provided. Fetch the repository tree first.',
        },
      }
    }

    const cfg: ChunkingConfig = { ...DEFAULT_CHUNKING_CONFIG, ...config }
    const repository = meta.fullName

    // Merge Phase 4 manifests with Phase 5B acquired source files.
    // additionalContents entries take precedence on key collision (last-writer wins).
    const mergedContents: Map<string, FileContent> = additionalContents
      ? new Map([...fetchedContents, ...additionalContents])
      : fetchedContents

    const chunks    = new Map<string, ChunkMetadata>()
    const fileIndex = new Map<string, IndexedFile>()
    const ignoredFiles: IgnoredFile[] = []
    const allChunks: ChunkMetadata[] = []

    for (const file of flatFiles) {
      // Check ignore conditions against the merged content map
      const ignoreReason = shouldIgnoreFile(file, mergedContents, cfg)
      if (ignoreReason !== null) {
        ignoredFiles.push({ path: file.path, reason: ignoreReason })
        continue
      }

      // At this point we know the file is in mergedContents (shouldIgnoreFile checked)
      const fetched = mergedContents.get(file.path)!
      const classification = classifyFile(file.path, file.language)

      // Produce chunks
      const fileChunks = chunkFile(
        fetched.content,
        file.path,
        file.language,
        classification,
        repository,
        cfg,
      )

      if (fileChunks.length === 0) {
        ignoredFiles.push({ path: file.path, reason: 'empty' })
        continue
      }

      // Store chunks
      for (const chunk of fileChunks) {
        chunks.set(chunk.id, chunk)
        allChunks.push(chunk)
      }

      // Record indexed file
      const indexed: IndexedFile = {
        path: file.path,
        language: file.language,
        classification,
        totalLines: fetched.lines,
        chunkCount: fileChunks.length,
        chunkIds: fileChunks.map((c) => c.id),
      }
      fileIndex.set(file.path, indexed)
    }

    const stats = buildStats(allChunks, fileIndex, ignoredFiles)

    const kb: KnowledgeBase = {
      repository,
      builtAt: new Date().toISOString(),
      truncated,
      chunks,
      fileIndex,
      ignoredFiles,
      stats,
      config: cfg,
    }

    return { ok: true, kb }
  } catch (cause: unknown) {
    return {
      ok: false,
      error: {
        kind: 'build_failed',
        message: 'An unexpected error occurred during knowledge base construction.',
        cause,
      },
    }
  }
}
