/**
 * src/lib/services/sourceAcquisitionService.ts
 *
 * Phase 5B: Source acquisition safety filter and planner.
 *
 * This module is the security gate for all Phase 5B source file fetches.
 * It inspects FileNode metadata (from Phase 4) and decides which files
 * are safe to acquire from GitHub.
 *
 * IMPORTANT: This service is purely synchronous and makes NO network calls.
 * It only reads FileNode metadata (path, name, size, supported flag).
 * No file content is accessed here.
 *
 * Architecture:
 *   Phase 4 flatFiles (FileNode[]) + Phase 4 fetchedContents keys
 *       ↓
 *   planAcquisition()  — pure, synchronous, no side effects
 *       ↓
 *   AcquisitionPlan { toFetch, skipped, alreadyAvailable }
 *       ↓
 *   useSourceAcquisition hook reads toFetch to drive GitHub API calls
 *
 * Security:
 *   - SECRET_RE deny-list is evaluated BEFORE any network call
 *   - Binary, generated, dependency, and build-output paths are blocked
 *   - All regex patterns are static compile-time constants (no ReDoS)
 *   - No user input is used to construct regex patterns
 *   - File sizes are GitHub-reported metadata (not content reads)
 *   - Unknown/unsupported extensions are blocked by default via FileNode.supported
 */

import type { FileNode, FileContent } from '../types/github'
import type { AcquisitionPlan, AcquisitionSkipReason, SkippedFile } from '../types/retrieval'

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Hard per-file size cap for acquisition candidates.
 * This is independent of the GitHub service's 100 KB display limit and is
 * applied to FileNode.size (GitHub-reported metadata) before fetching.
 * Set to 500 KB — files larger than this are unlikely to be useful as
 * standalone retrieval chunks and would consume rate-limit budget.
 */
export const MAX_SOURCE_FILE_BYTES = 500_000

/**
 * Default maximum number of source files to acquire in one run.
 * Keeps GitHub unauthenticated API usage well within the 60 req/hr limit.
 */
export const DEFAULT_MAX_FILES = 100

// ─── Security: secret filename patterns ──────────────────────────────────────

/**
 * Basenames that must NEVER be fetched.
 * Pattern covers:
 *  - .env and all .env.* variants (except .env.example and .env.sample)
 *  - secrets.json, secret.json, credentials.json, credential.json
 *  - .secret prefix files
 *  - Private key files (.pem, .key, .p12, .pfx)
 *  - SSH private key filenames
 *  - Password store files (.netrc, .pgpass)
 *
 * This list is intentionally conservative — deny by default.
 * .env.example and .env.sample are NOT blocked (they are templates, not secrets).
 */
const SECRET_BASENAME_RE =
  /^\.env(?!\.(?:example|sample|template)$)(?:\..+)?$|^secrets?\.json$|^credentials?\.json$|^\.secret|^id_rsa$|^id_ed25519$|^id_ecdsa$|^id_dsa$|^\.netrc$|^\.pgpass$|^.*\.pem$|^.*\.p12$|^.*\.pfx$|^.*\.key$/i

// ─── Dependency directory patterns ────────────────────────────────────────────

/**
 * Path segments that indicate third-party dependency directories.
 * Files inside these directories are third-party code — never fetched.
 */
const DEPENDENCY_PATH_RE =
  /(?:^|\/)(?:node_modules|vendor|bower_components|\.venv|venv|env|\.env|\.cargo|site-packages|Pods|\.gradle|\.m2)\//

// ─── Build output / compiled artefact patterns ───────────────────────────────

/**
 * Path segments that indicate compiled or generated output.
 * These directories contain machine-produced files, not source.
 */
const BUILD_OUTPUT_PATH_RE =
  /(?:^|\/)(?:dist|build|out|\.next|\.nuxt|\.svelte-kit|\.output|coverage|\.turbo|\.cache|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|htmlcov|target\/debug|target\/release|target\/wasm32|\.DS_Store)\//

// ─── Generated / lock-file patterns ──────────────────────────────────────────

/**
 * Exact basenames of well-known generated or lock files.
 * These files are auto-produced and should not be included in KB source chunks.
 */
const GENERATED_BASENAME_RE =
  /^(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum|Gemfile\.lock|shrinkwrap\.json|npm-shrinkwrap\.json)$/

/**
 * Path-based patterns for generated code (proto outputs, codegen, minified).
 */
const GENERATED_PATH_RE =
  /\.min\.[cm]?[jt]s$|\.min\.css$|-min\.[cm]?js$|\.pb\.go$|_generated\.go$|\.g\.dart$|\.freezed\.dart$|\.graphql\.ts$|zz_generated\.|\.gen\.[jt]s$/

// ─── Binary / non-text file extension list ────────────────────────────────────

/**
 * File extensions that are definitely binary or non-readable as source.
 * Applied as a last resort when FileNode.supported is somehow true for these.
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'tif', 'avif', 'heic',
  // Vector / fonts
  'svg', 'woff', 'woff2', 'ttf', 'eot', 'otf',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // Archives
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'ear',
  // Executables / libraries
  'exe', 'dll', 'so', 'dylib', 'bin', 'obj', 'o', 'a', 'lib',
  // Media
  'mp4', 'mp3', 'wav', 'ogg', 'flac', 'webm', 'avi', 'mov',
  // Database / data
  'db', 'sqlite', 'sqlite3',
  // Compiled / bytecode
  'pyc', 'pyo', 'class', 'wasm',
  // Misc
  'dat', 'iso', 'img', 'dmg',
])

// ─── Helper ───────────────────────────────────────────────────────────────────

function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Produces a safe, auditable acquisition plan from the Phase 4 file tree.
 *
 * Rules are applied in order; the first matching rule wins.
 * No network calls, no file content reads.
 *
 * @param flatFiles       - All file nodes from Phase 4 getRepoTree()
 * @param fetchedContents - Phase 4 manifest contents (already available — not re-fetched)
 * @param options.maxFiles - Hard cap on toFetch length (default: DEFAULT_MAX_FILES = 100)
 */
export function planAcquisition(
  flatFiles: FileNode[],
  fetchedContents: Map<string, FileContent>,
  options?: { maxFiles?: number },
): AcquisitionPlan {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES

  const toFetch: FileNode[] = []
  const skipped: SkippedFile[] = []
  const alreadyAvailable: string[] = []

  function skip(path: string, reason: AcquisitionSkipReason): void {
    skipped.push({ path, reason })
  }

  for (const file of flatFiles) {
    const { path, name, size, supported } = file

    // Rule 1: Already fetched in Phase 4 — do not re-fetch
    if (fetchedContents.has(path)) {
      alreadyAvailable.push(path)
      continue
    }

    // Rule 2: Unsupported (unknown extension or explicitly marked non-text)
    if (!supported) {
      skip(path, 'unsupported')
      continue
    }

    // Rule 3: Binary extension (belt-and-suspenders even if supported=true)
    const ext = fileExtension(name)
    if (ext && BINARY_EXTENSIONS.has(ext)) {
      skip(path, 'binary')
      continue
    }

    // Rule 4: Secret / credential filename — HIGHEST priority block
    if (SECRET_BASENAME_RE.test(name)) {
      skip(path, 'secret')
      continue
    }

    // Rule 5: Dependency directory
    if (DEPENDENCY_PATH_RE.test(path)) {
      skip(path, 'dependency')
      continue
    }

    // Rule 6: Build output / compiled artefact
    if (BUILD_OUTPUT_PATH_RE.test(path)) {
      skip(path, 'build_output')
      continue
    }

    // Rule 7: Generated file (lock files, codegen output)
    if (GENERATED_BASENAME_RE.test(name) || GENERATED_PATH_RE.test(path)) {
      skip(path, 'generated')
      continue
    }

    // Rule 8: Oversized file
    if (size > MAX_SOURCE_FILE_BYTES) {
      skip(path, 'oversized')
      continue
    }

    // Rule 9: maxFiles cap — check before adding
    if (toFetch.length >= maxFiles) {
      skip(path, 'cap_reached')
      continue
    }

    // Passed all checks — safe to fetch
    toFetch.push(file)
  }

  return {
    toFetch,
    skipped,
    alreadyAvailable,
    totalCandidates: flatFiles.length,
  }
}
