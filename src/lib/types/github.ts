/**
 * src/lib/types/github.ts
 *
 * TypeScript types for GitHub REST API responses and RepoPilot's own
 * internal representation of repository metadata.
 *
 * The raw GitHub API response types map 1-to-1 with the fields the API
 * returns. We never let these raw shapes bleed through to the UI —
 * githubService.ts maps them to clean internal types.
 */

// ─── Existing: Repo metadata ─────────────────────────────────────────────────

export interface GitHubApiRepo {
  id: number
  full_name: string
  name: string
  description: string | null
  html_url: string
  stargazers_count: number
  forks_count: number
  language: string | null
  default_branch: string
  owner: {
    login: string
    avatar_url: string
  }
  private: boolean
  archived: boolean
  pushed_at: string
  updated_at: string
}

export interface GitHubRepoMeta {
  fullName: string
  name: string
  owner: string
  description: string
  language: string
  url: string
  stars: number
  forks: number
  defaultBranch: string
  pushedAt: string
}

export interface ParsedGitHubUrl {
  owner: string
  repo: string
}

export type GitHubFetchResult =
  | { ok: true;  data: GitHubRepoMeta }
  | { ok: false; error: GitHubFetchError }

export type GitHubFetchError =
  | { kind: 'invalid_url';       message: string }
  | { kind: 'not_found';         message: string }
  | { kind: 'rate_limited';      message: string }
  | { kind: 'network_error';     message: string }
  | { kind: 'unexpected';        message: string }
  | { kind: 'too_large';         message: string }
  | { kind: 'unsupported_file';  message: string }
  | { kind: 'truncated_tree';    message: string }

// ─── New: Repository tree ────────────────────────────────────────────────────

/** One item as returned by GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1 */
export interface GitHubTreeItem {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number    // present for blobs
  url: string
}

/** Full response from the git/trees endpoint */
export interface GitHubTreeApiResponse {
  sha: string
  url: string
  tree: GitHubTreeItem[]
  truncated: boolean
}

/** RepoPilot's normalised file-system node */
export type RepoTreeNode = FolderNode | FileNode

export interface FolderNode {
  kind: 'folder'
  path: string
  name: string
  children: RepoTreeNode[]
}

export interface FileNode {
  kind: 'file'
  path: string
  name: string
  size: number
  /** Whether RepoPilot can display the contents (text-based extension + size OK) */
  supported: boolean
  /** Human-readable language label derived from extension */
  language: string
}

export type TreeFetchResult =
  | { ok: true;  nodes: RepoTreeNode[]; flatFiles: FileNode[]; truncated: boolean }
  | { ok: false; error: GitHubFetchError }

// ─── New: File content ───────────────────────────────────────────────────────

/** Response from GET /repos/{owner}/{repo}/contents/{path} */
export interface GitHubContentsApiResponse {
  name: string
  path: string
  sha: string
  size: number
  html_url: string
  download_url: string | null
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  content: string       // base64-encoded (with embedded newlines)
  encoding: 'base64' | string
}

/** Clean internal type for a displayable source file */
export interface FileContent {
  path: string
  name: string
  content: string   // decoded plain text
  size: number      // bytes
  language: string  // for syntax highlighting
  lines: number
}

export type FileFetchResult =
  | { ok: true;  data: FileContent }
  | { ok: false; error: GitHubFetchError }

// ─── Phase 4: Repository Intelligence Analyzer types ─────────────────────────

/**
 * The base unit for any detected technology or mechanism.
 * Every detection carries the file paths that justify the detection.
 */
export interface EvidencedDetection {
  /** Display name, e.g. "React", "PostgreSQL", "JWT" */
  name: string
  /** Detection confidence based on evidence strength */
  status: 'Detected' | 'Likely' | 'Unknown'
  /**
   * File paths (relative to repo root) that directly support this detection.
   * Must be non-empty when status is "Detected" or "Likely".
   */
  evidence: string[]
  /** Specific version string extracted from a manifest, if available */
  version?: string
  /** Human-readable explanation of why this was detected */
  explanation?: string
}

/** Dependency manifest information for a specific ecosystem */
export interface DependencyInfo {
  /** Package ecosystem, e.g. "npm", "pip", "cargo", "go modules" */
  ecosystem: string
  /** Path to the manifest file that was parsed, e.g. "package.json" */
  manifestFile: string
  /** Count of production/runtime dependencies */
  packageCount: number
  /** Count of development-only dependencies (0 if not applicable to ecosystem) */
  devPackageCount: number
  /** Names of notable packages (well-known libraries, security-relevant packages) */
  notable: string[]
}

/** A recognised application or script entry point */
export interface EntryPoint {
  /** File path relative to repo root */
  path: string
  /**
   * Category of entry point.
   * e.g. "web entry", "CLI entry", "main script", "server entry", "test runner"
   */
  kind: string
  /** File paths used as evidence */
  evidence: string[]
}

/** A recognised configuration file */
export interface ConfigFile {
  /** File path relative to repo root */
  path: string
  /** Human-readable purpose, e.g. "ESLint configuration" */
  purpose: string
  /**
   * Logical category.
   * e.g. "linting", "formatting", "ci", "docker", "editor", "testing",
   *       "build", "package manager", "version control", "environment"
   */
  category: string
}

/** Top-level structured output returned by analyzeRepository() */
export interface RepositoryAnalysis {
  meta: {
    /** ISO 8601 timestamp of when the analysis was performed */
    analyzedAt: string
    /** Total number of files in the provided flat file list */
    fileCount: number
    /**
     * true when GitHub truncated the tree response.
     * Analysis proceeded on available data only.
     */
    truncated: boolean
    /**
     * Non-fatal operational notices, e.g. "package.json not found",
     * "pyproject.toml could not be parsed".
     * These are informational — not errors.
     */
    analysisNotes: string[]
  }

  /** Programming languages detected from file extensions */
  languages: EvidencedDetection[]
  /** Frameworks detected (frontend and fullstack) */
  frameworks: EvidencedDetection[]
  /** Package managers detected from lock files and manifests */
  packageManagers: EvidencedDetection[]
  /** Frontend-specific technologies */
  frontendTechnologies: EvidencedDetection[]
  /** Backend-specific technologies (servers, runtimes, server frameworks) */
  backendTechnologies: EvidencedDetection[]
  /** Database clients and ORMs detected */
  databaseTechnologies: EvidencedDetection[]
  /** Authentication libraries and patterns detected */
  authMechanisms: EvidencedDetection[]
  /** API design patterns detected (REST indicators, GraphQL, WebSocket, tRPC, etc.) */
  apiPatterns: EvidencedDetection[]
  /** Well-known configuration files found in the tree */
  configFiles: ConfigFile[]
  /** Recognised application entry points */
  entryPoints: EntryPoint[]
  /** Top-level service directories (e.g. microservice folders, service layer dirs) */
  majorServices: EvidencedDetection[]
  /** Significant module/layer directories found in the tree */
  majorModules: EvidencedDetection[]
  /** Parsed dependency manifest information */
  dependencies: DependencyInfo[]
}

/** Error kinds returned by the analyzer */
export type AnalyzerError =
  | { kind: 'no_tree';          message: string }
  | { kind: 'analysis_failed';  message: string; cause?: unknown }

/** Discriminated union result type — mirrors the existing service pattern */
export type AnalysisResult =
  | { ok: true;  data: RepositoryAnalysis }
  | { ok: false; error: AnalyzerError }
