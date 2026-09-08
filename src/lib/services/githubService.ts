/**
 * src/lib/services/githubService.ts
 *
 * All GitHub API communication lives here.
 * React components never call the GitHub API directly — they call the
 * functions exported from this module.
 *
 * Architecture:
 *   React component → githubService → GitHub REST API
 *
 * Authentication:
 *   Public repository metadata does NOT require a token.
 *   The GitHub REST API allows ~60 unauthenticated requests per hour per IP.
 *   A future backend proxy can forward an authenticated request without ever
 *   exposing credentials to the browser.
 *
 * Configuration:
 *   VITE_GITHUB_API_BASE_URL  (optional, defaults to https://api.github.com)
 *   This is a base URL override for testing/proxying — NOT a secret.
 *   Never add VITE_GITHUB_TOKEN or any client-side credential here.
 */

import type {
  GitHubApiRepo,
  GitHubRepoMeta,
  GitHubFetchResult,
  ParsedGitHubUrl,
  GitHubFetchError,
  GitHubTreeApiResponse,
  GitHubTreeItem,
  RepoTreeNode,
  FolderNode,
  FileNode,
  TreeFetchResult,
  GitHubContentsApiResponse,
  FileContent,
  FileFetchResult,
} from '../types/github'

// ─── Configuration ───────────────────────────────────────────────────────────

const GITHUB_API_BASE: string =
  (import.meta.env.VITE_GITHUB_API_BASE_URL as string | undefined) ??
  'https://api.github.com'

/** Maximum file size (bytes) we will attempt to display. 100 KB. */
const MAX_DISPLAY_BYTES = 100_000

// ─── Shared fetch helper ─────────────────────────────────────────────────────

/** Shared headers sent with every GitHub API request */
const GH_HEADERS: HeadersInit = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

async function ghFetch(url: string): Promise<Response> {
  return fetch(url, { headers: GH_HEADERS })
}

function networkError(): GitHubFetchError {
  return {
    kind: 'network_error',
    message: 'Could not reach GitHub. Check your internet connection and try again.',
  }
}

function rateLimitError(): GitHubFetchError {
  return {
    kind: 'rate_limited',
    message:
      'GitHub API rate limit reached. Wait a moment and try again. Authenticated requests have a higher limit.',
  }
}

function unexpectedError(status: number): GitHubFetchError {
  return {
    kind: 'unexpected',
    message: `GitHub returned an unexpected response (HTTP ${status}). Try again later.`,
  }
}

function notFoundError(subject: string): GitHubFetchError {
  return {
    kind: 'not_found',
    message: `${subject} was not found on GitHub. Check the URL and make sure the repository is public.`,
  }
}

// ─── URL parsing ─────────────────────────────────────────────────────────────

/**
 * Parses a GitHub repository URL and returns the owner and repo name.
 *
 * Accepts:
 *   https://github.com/facebook/react
 *   https://github.com/facebook/react/
 *   https://github.com/facebook/react.git
 *   https://github.com/facebook/react/tree/main  (extra path segments ignored)
 *
 * Rejects (returns null):
 *   Non-https schemes, non-github.com hostnames, missing owner or repo, whitespace input
 */
export function parseGitHubUrl(raw: string): ParsedGitHubUrl | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname !== 'github.com') return null

  const segments = parsed.pathname
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (segments.length < 2) return null

  const owner = segments[0]
  const repo  = segments[1].replace(/\.git$/, '')

  if (!owner || !repo) return null

  return { owner, repo }
}

// ─── Repo metadata ────────────────────────────────────────────────────────────

function mapApiResponse(raw: GitHubApiRepo): GitHubRepoMeta {
  return {
    fullName:      raw.full_name,
    name:          raw.name,
    owner:         raw.owner.login,
    description:   raw.description ?? '',
    language:      raw.language ?? 'Unknown',
    url:           raw.html_url,
    stars:         raw.stargazers_count,
    forks:         raw.forks_count,
    defaultBranch: raw.default_branch,
    pushedAt:      raw.pushed_at,
  }
}

export async function fetchGitHubRepo(
  owner: string,
  repo: string,
): Promise<GitHubFetchResult> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

  let response: Response
  try {
    response = await ghFetch(url)
  } catch {
    return { ok: false, error: networkError() }
  }

  if (response.status === 404)
    return { ok: false, error: notFoundError(`Repository "${owner}/${repo}"`) }
  if (response.status === 403 || response.status === 429)
    return { ok: false, error: rateLimitError() }
  if (!response.ok)
    return { ok: false, error: unexpectedError(response.status) }

  let json: unknown
  try { json = await response.json() } catch {
    return { ok: false, error: { kind: 'unexpected', message: 'GitHub returned an unparseable response.' } }
  }

  if (typeof json !== 'object' || json === null || !('full_name' in json))
    return { ok: false, error: { kind: 'unexpected', message: 'GitHub returned an unexpected data shape.' } }

  return { ok: true, data: mapApiResponse(json as GitHubApiRepo) }
}

export async function importGitHubRepo(rawUrl: string): Promise<GitHubFetchResult> {
  const parsed = parseGitHubUrl(rawUrl)
  if (!parsed) {
    return {
      ok: false,
      error: {
        kind: 'invalid_url',
        message: 'Enter a valid public GitHub repository URL, e.g. https://github.com/owner/repo',
      },
    }
  }
  return fetchGitHubRepo(parsed.owner, parsed.repo)
}

// ─── File filtering ───────────────────────────────────────────────────────────

/** Directory path prefixes that are always excluded from the tree display */
const IGNORED_DIRS: string[] = [
  '.git/', 'node_modules/', 'dist/', 'build/', '.next/', 'coverage/',
  '.cache/', '__pycache__/', 'vendor/', '.turbo/', '.output/', 'out/',
  '.svelte-kit/', '.nuxt/',
]

/**
 * Extension → highlight.js language alias + display label.
 * Extensions NOT in this map are treated as unsupported (binary/generated).
 */
const EXTENSION_MAP: Record<string, { label: string; hljs: string }> = {
  // JavaScript / TypeScript
  ts:    { label: 'TypeScript',  hljs: 'typescript'  },
  tsx:   { label: 'TSX',         hljs: 'typescript'  },
  js:    { label: 'JavaScript',  hljs: 'javascript'  },
  jsx:   { label: 'JSX',         hljs: 'javascript'  },
  mjs:   { label: 'JavaScript',  hljs: 'javascript'  },
  cjs:   { label: 'JavaScript',  hljs: 'javascript'  },
  // Web
  html:  { label: 'HTML',        hljs: 'xml'         },
  htm:   { label: 'HTML',        hljs: 'xml'         },
  css:   { label: 'CSS',         hljs: 'css'         },
  scss:  { label: 'SCSS',        hljs: 'scss'        },
  less:  { label: 'Less',        hljs: 'less'        },
  // Data / Config
  json:  { label: 'JSON',        hljs: 'json'        },
  jsonc: { label: 'JSON',        hljs: 'json'        },
  yaml:  { label: 'YAML',        hljs: 'yaml'        },
  yml:   { label: 'YAML',        hljs: 'yaml'        },
  toml:  { label: 'TOML',        hljs: 'ini'         },
  xml:   { label: 'XML',         hljs: 'xml'         },
  // Docs
  md:    { label: 'Markdown',    hljs: 'markdown'    },
  mdx:   { label: 'MDX',         hljs: 'markdown'    },
  txt:   { label: 'Text',        hljs: 'plaintext'   },
  // Backend languages
  py:    { label: 'Python',      hljs: 'python'      },
  rb:    { label: 'Ruby',        hljs: 'ruby'        },
  go:    { label: 'Go',          hljs: 'go'          },
  rs:    { label: 'Rust',        hljs: 'rust'        },
  java:  { label: 'Java',        hljs: 'java'        },
  kt:    { label: 'Kotlin',      hljs: 'kotlin'      },
  swift: { label: 'Swift',       hljs: 'swift'       },
  c:     { label: 'C',           hljs: 'c'           },
  cpp:   { label: 'C++',         hljs: 'cpp'         },
  cc:    { label: 'C++',         hljs: 'cpp'         },
  h:     { label: 'C/C++ Header',hljs: 'cpp'         },
  hpp:   { label: 'C++ Header',  hljs: 'cpp'         },
  cs:    { label: 'C#',          hljs: 'csharp'      },
  php:   { label: 'PHP',         hljs: 'php'         },
  // Shell / Script
  sh:    { label: 'Shell',       hljs: 'bash'        },
  bash:  { label: 'Bash',        hljs: 'bash'        },
  zsh:   { label: 'Zsh',         hljs: 'bash'        },
  fish:  { label: 'Fish',        hljs: 'bash'        },
  // Query / Graph
  sql:   { label: 'SQL',         hljs: 'sql'         },
  graphql: { label: 'GraphQL',   hljs: 'graphql'     },
  gql:   { label: 'GraphQL',     hljs: 'graphql'     },
  // Config files with no extension or dot-prefixed names
  dockerfile: { label: 'Dockerfile', hljs: 'dockerfile' },
  makefile:   { label: 'Makefile',   hljs: 'makefile'   },
  // SVG (as text)
  svg:   { label: 'SVG',         hljs: 'xml'         },
}

/** Returns the extension entry for a filename, or null if unsupported. */
function getExtensionEntry(filename: string): { label: string; hljs: string } | null {
  const lower = filename.toLowerCase()
  // Special case: dotfiles and extensionless config files
  const base = lower.split('/').pop() ?? lower
  if (base === 'dockerfile') return EXTENSION_MAP['dockerfile']
  if (base === 'makefile')   return EXTENSION_MAP['makefile']
  if (base === '.gitignore' || base === '.dockerignore' || base === '.editorconfig') {
    return { label: 'Config', hljs: 'plaintext' }
  }
  if (base === '.prettierrc' || base === '.eslintrc' || base === '.babelrc') {
    return { label: 'JSON/Config', hljs: 'json' }
  }
  if (base === '.env.example' || base === '.env.sample') {
    return { label: 'ENV', hljs: 'bash' }
  }
  // Lock files — show but mark as generated
  if (base === 'package-lock.json' || base === 'yarn.lock' || base === 'pnpm-lock.yaml') {
    return { label: 'Lock file', hljs: 'plaintext' }
  }

  const dotIdx = lower.lastIndexOf('.')
  if (dotIdx === -1) return null
  const ext = lower.slice(dotIdx + 1)
  return EXTENSION_MAP[ext] ?? null
}

function isIgnoredPath(path: string): boolean {
  const p = path.endsWith('/') ? path : path + '/'
  return IGNORED_DIRS.some((dir) => p.startsWith(dir) || ('/' + p).startsWith('/' + dir))
}

// ─── Tree building ────────────────────────────────────────────────────────────

/**
 * Converts a flat list of GitHubTreeItems into a nested RepoTreeNode tree.
 * Filters out ignored directories and non-blob/tree items.
 */
function buildTree(items: GitHubTreeItem[]): { nodes: RepoTreeNode[]; flatFiles: FileNode[] } {
  // Sort so folders come before files, and alphabetically within each group
  const sorted = [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return a.path.localeCompare(b.path)
  })

  const root: FolderNode = { kind: 'folder', path: '', name: '', children: [] }
  const folderMap = new Map<string, FolderNode>()
  folderMap.set('', root)

  const flatFiles: FileNode[] = []

  for (const item of sorted) {
    // Skip commits (submodules) and ignored paths
    if (item.type === 'commit') continue
    if (isIgnoredPath(item.path)) continue

    const parts   = item.path.split('/')
    const name    = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')

    // Ensure all parent folders exist in the map
    let currentPath = ''
    for (let i = 0; i < parts.length - 1; i++) {
      const segmentPath = parts.slice(0, i + 1).join('/')
      if (!folderMap.has(segmentPath)) {
        const newFolder: FolderNode = {
          kind: 'folder',
          path: segmentPath,
          name: parts[i],
          children: [],
        }
        const parentFolder = folderMap.get(currentPath) ?? root
        parentFolder.children.push(newFolder)
        folderMap.set(segmentPath, newFolder)
      }
      currentPath = segmentPath
    }

    const parent = folderMap.get(parentPath) ?? root

    if (item.type === 'tree') {
      if (!folderMap.has(item.path)) {
        const folder: FolderNode = { kind: 'folder', path: item.path, name, children: [] }
        parent.children.push(folder)
        folderMap.set(item.path, folder)
      }
    } else if (item.type === 'blob') {
      const extEntry = getExtensionEntry(item.path)
      const fileSize = item.size ?? 0
      const supported = extEntry !== null && fileSize <= MAX_DISPLAY_BYTES
      const fileNode: FileNode = {
        kind: 'file',
        path: item.path,
        name,
        size: fileSize,
        supported,
        language: extEntry?.label ?? 'Binary',
      }
      parent.children.push(fileNode)
      flatFiles.push(fileNode)
    }
  }

  return { nodes: root.children, flatFiles }
}

// ─── Service: get repository tree ────────────────────────────────────────────

export async function getRepoTree(
  owner: string,
  repo: string,
  branch: string,
): Promise<TreeFetchResult> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`

  let response: Response
  try {
    response = await ghFetch(url)
  } catch {
    return { ok: false, error: networkError() }
  }

  if (response.status === 404)
    return { ok: false, error: notFoundError(`Repository tree for "${owner}/${repo}"`) }
  if (response.status === 403 || response.status === 429)
    return { ok: false, error: rateLimitError() }
  if (!response.ok)
    return { ok: false, error: unexpectedError(response.status) }

  let json: unknown
  try { json = await response.json() } catch {
    return { ok: false, error: { kind: 'unexpected', message: 'Could not parse the repository tree response.' } }
  }

  if (
    typeof json !== 'object' || json === null ||
    !('tree' in json) || !Array.isArray((json as GitHubTreeApiResponse).tree)
  ) {
    return { ok: false, error: { kind: 'unexpected', message: 'Unexpected repository tree response shape.' } }
  }

  const raw = json as GitHubTreeApiResponse
  const { nodes, flatFiles } = buildTree(raw.tree)

  return { ok: true, nodes, flatFiles, truncated: raw.truncated === true }
}

// ─── Service: get file content ────────────────────────────────────────────────

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<FileFetchResult> {
  // URL-encode each path segment individually (not the slashes)
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`

  let response: Response
  try {
    response = await ghFetch(url)
  } catch {
    return { ok: false, error: networkError() }
  }

  if (response.status === 404)
    return { ok: false, error: notFoundError(`File "${path}"`) }
  if (response.status === 403 || response.status === 429)
    return { ok: false, error: rateLimitError() }
  if (!response.ok)
    return { ok: false, error: unexpectedError(response.status) }

  let json: unknown
  try { json = await response.json() } catch {
    return { ok: false, error: { kind: 'unexpected', message: 'Could not parse the file content response.' } }
  }

  if (typeof json !== 'object' || json === null || !('content' in json)) {
    return { ok: false, error: { kind: 'unexpected', message: 'Unexpected file content response shape.' } }
  }

  const raw = json as GitHubContentsApiResponse

  if (raw.type !== 'file') {
    return { ok: false, error: { kind: 'unsupported_file', message: 'This path is a directory, not a file.' } }
  }

  if (raw.size > MAX_DISPLAY_BYTES) {
    return {
      ok: false,
      error: {
        kind: 'too_large',
        message: `File is too large to display safely (${Math.round(raw.size / 1024)} KB). Limit is ${MAX_DISPLAY_BYTES / 1000} KB.`,
      },
    }
  }

  if (raw.encoding !== 'base64') {
    return { ok: false, error: { kind: 'unexpected', message: `Unknown encoding: ${raw.encoding}` } }
  }

  let decoded: string
  try {
    decoded = atob(raw.content.replace(/\n/g, ''))
  } catch {
    return { ok: false, error: { kind: 'unexpected', message: 'Could not decode file content.' } }
  }

  const extEntry = getExtensionEntry(path)
  const name     = path.split('/').pop() ?? path
  const lines    = decoded.split('\n').length

  return {
    ok: true,
    data: {
      path,
      name,
      content: decoded,
      size: raw.size,
      language: extEntry?.hljs ?? 'plaintext',
      lines,
    },
  }
}

/** Re-export extension helper for use in UI components (file icon selection) */
export { getExtensionEntry }
