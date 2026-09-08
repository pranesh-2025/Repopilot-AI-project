/**
 * src/lib/services/repositoryAnalyzer.ts
 *
 * Static Repository Intelligence Analyzer.
 *
 * Accepts already-fetched repository data and performs pure, synchronous
 * static analysis. Never calls the GitHub API or executes repository code.
 *
 * Architecture:
 *   githubService (async) → flatFiles + fetchedContents
 *       ↓
 *   analyzeRepository(meta, flatFiles, truncated, fetchedContents)
 *       ↓
 *   AnalysisResult  (synchronous, no I/O)
 *
 * Security:
 *   - No .env secret values are read (caller must not include them)
 *   - No code execution or eval
 *   - No dynamic regex from user input (all patterns are static constants)
 *   - File content is only inspected — never modified or executed
 */

import type {
  GitHubRepoMeta,
  FileNode,
  FileContent,
  EvidencedDetection,
  DependencyInfo,
  EntryPoint,
  ConfigFile,
  RepositoryAnalysis,
  AnalyzerError,
  AnalysisResult,
} from '../types/github'

// ─── Public constants ─────────────────────────────────────────────────────────

/**
 * Ordered list of manifest / key file paths the caller should attempt to fetch
 * before calling analyzeRepository(). The analyzer works without them, but
 * content-based analysis is richer when these are available.
 */
export const RECOMMENDED_FETCH_PATHS: readonly string[] = [
  'package.json',
  'requirements.txt',
  'Pipfile',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
  'README.md',
  'README.rst',
  'README',
] as const

// ─── Internal: extension → language label ────────────────────────────────────

/** Maps lowercase file extensions to a canonical language display name */
const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
  // JavaScript / TypeScript
  ts: 'TypeScript', tsx: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  // Web
  html: 'HTML', htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  // Backend
  py: 'Python',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++', cc: 'C++',
  h: 'C/C++ Header', hpp: 'C++ Header',
  cs: 'C#',
  php: 'PHP',
  // Shell
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell',
  // Data / Query
  sql: 'SQL',
  graphql: 'GraphQL', gql: 'GraphQL',
  // Config / data formats (counted but not dominant language)
  json: 'JSON', jsonc: 'JSON',
  yaml: 'YAML', yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  // Docs
  md: 'Markdown', mdx: 'Markdown',
  // Other
  dart: 'Dart',
  lua: 'Lua',
  r: 'R',
  scala: 'Scala',
  ex: 'Elixir', exs: 'Elixir',
  erl: 'Erlang',
  hs: 'Haskell',
  clj: 'Clojure',
  vue: 'Vue',
  svelte: 'Svelte',
}

// ─── Internal: known config files ────────────────────────────────────────────

interface ConfigPattern {
  /** Regex to match the full path or basename */
  pattern: RegExp
  purpose: string
  category: string
}

const CONFIG_PATTERNS: readonly ConfigPattern[] = [
  // --- Linting ---
  { pattern: /(?:^|\/)\.eslintrc(?:\.(?:js|cjs|mjs|json|yaml|yml))?$/, purpose: 'ESLint configuration', category: 'linting' },
  { pattern: /(?:^|\/)eslint\.config\.[cm]?js$/, purpose: 'ESLint flat configuration', category: 'linting' },
  { pattern: /(?:^|\/)\.pylintrc$/, purpose: 'Pylint configuration', category: 'linting' },
  { pattern: /(?:^|\/)\.flake8$/, purpose: 'Flake8 configuration', category: 'linting' },
  { pattern: /(?:^|\/)\.rubocop\.yml$/, purpose: 'RuboCop configuration', category: 'linting' },
  { pattern: /(?:^|\/)clippy\.toml$/, purpose: 'Clippy (Rust linter) configuration', category: 'linting' },
  // --- Formatting ---
  { pattern: /(?:^|\/)\.prettierrc(?:\.(?:js|cjs|mjs|json|yaml|yml))?$/, purpose: 'Prettier configuration', category: 'formatting' },
  { pattern: /(?:^|\/)\.editorconfig$/, purpose: 'EditorConfig', category: 'editor' },
  { pattern: /(?:^|\/)rustfmt\.toml$/, purpose: 'rustfmt configuration', category: 'formatting' },
  // --- Build tools ---
  { pattern: /(?:^|\/)vite\.config\.[cm]?[tj]s$/, purpose: 'Vite build configuration', category: 'build' },
  { pattern: /(?:^|\/)webpack\.config\.[cm]?js$/, purpose: 'Webpack configuration', category: 'build' },
  { pattern: /(?:^|\/)rollup\.config\.[cm]?[tj]s$/, purpose: 'Rollup configuration', category: 'build' },
  { pattern: /(?:^|\/)esbuild\.[cm]?[tj]s$/, purpose: 'esbuild configuration', category: 'build' },
  { pattern: /(?:^|\/)turbo\.json$/, purpose: 'Turborepo configuration', category: 'build' },
  { pattern: /(?:^|\/)Makefile$/, purpose: 'Makefile build script', category: 'build' },
  { pattern: /(?:^|\/)CMakeLists\.txt$/, purpose: 'CMake build configuration', category: 'build' },
  // --- TypeScript / Babel ---
  { pattern: /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/, purpose: 'TypeScript configuration', category: 'build' },
  { pattern: /(?:^|\/)babel\.config\.[cm]?[tj]s$/, purpose: 'Babel configuration', category: 'build' },
  { pattern: /(?:^|\/)\.babelrc(?:\.(?:js|json))?$/, purpose: 'Babel configuration', category: 'build' },
  // --- Testing ---
  { pattern: /(?:^|\/)jest\.config\.[cm]?[tj]s$/, purpose: 'Jest test configuration', category: 'testing' },
  { pattern: /(?:^|\/)vitest\.config\.[cm]?[tj]s$/, purpose: 'Vitest test configuration', category: 'testing' },
  { pattern: /(?:^|\/)pytest\.ini$/, purpose: 'pytest configuration', category: 'testing' },
  { pattern: /(?:^|\/)setup\.cfg$/, purpose: 'Python setup / pytest configuration', category: 'testing' },
  { pattern: /(?:^|\/)karma\.conf\.[cm]?js$/, purpose: 'Karma test runner configuration', category: 'testing' },
  { pattern: /(?:^|\/)mocha(?:rc|\.[cm]?js)?$/, purpose: 'Mocha test configuration', category: 'testing' },
  { pattern: /(?:^|\/)\.mocharc(?:\.(?:js|json|yaml|yml))?$/, purpose: 'Mocha test configuration', category: 'testing' },
  { pattern: /(?:^|\/)playwright\.config\.[cm]?[tj]s$/, purpose: 'Playwright E2E configuration', category: 'testing' },
  { pattern: /(?:^|\/)cypress\.config\.[cm]?[tj]s$/, purpose: 'Cypress E2E configuration', category: 'testing' },
  // --- Docker ---
  { pattern: /(?:^|\/)Dockerfile(?:\.[^/]+)?$/, purpose: 'Docker image build file', category: 'docker' },
  { pattern: /(?:^|\/)docker-compose(?:\.[^/]+)?\.ya?ml$/, purpose: 'Docker Compose service definition', category: 'docker' },
  { pattern: /(?:^|\/)\.dockerignore$/, purpose: 'Docker build ignore file', category: 'docker' },
  // --- CI/CD ---
  { pattern: /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/, purpose: 'GitHub Actions workflow', category: 'ci' },
  { pattern: /(?:^|\/)\.travis\.yml$/, purpose: 'Travis CI configuration', category: 'ci' },
  { pattern: /(?:^|\/)\.circleci\/config\.ya?ml$/, purpose: 'CircleCI configuration', category: 'ci' },
  { pattern: /(?:^|\/)Jenkinsfile$/, purpose: 'Jenkins pipeline', category: 'ci' },
  { pattern: /(?:^|\/)\.gitlab-ci\.yml$/, purpose: 'GitLab CI configuration', category: 'ci' },
  { pattern: /(?:^|\/)azure-pipelines\.ya?ml$/, purpose: 'Azure Pipelines configuration', category: 'ci' },
  { pattern: /(?:^|\/)\.buildkite\/pipeline\.ya?ml$/, purpose: 'Buildkite pipeline', category: 'ci' },
  // --- Kubernetes / Infrastructure ---
  { pattern: /(?:^|\/)k8s\/[^/]+\.ya?ml$/, purpose: 'Kubernetes manifest', category: 'infrastructure' },
  { pattern: /(?:^|\/)helm\/[^/]+/, purpose: 'Helm chart', category: 'infrastructure' },
  { pattern: /(?:^|\/)terraform\/[^/]+\.tf$/, purpose: 'Terraform configuration', category: 'infrastructure' },
  { pattern: /(?:^|\/)main\.tf$/, purpose: 'Terraform root module', category: 'infrastructure' },
  { pattern: /(?:^|\/)serverless\.ya?ml$/, purpose: 'Serverless Framework configuration', category: 'infrastructure' },
  // --- Package managers ---
  { pattern: /(?:^|\/)package\.json$/, purpose: 'npm / Node.js package manifest', category: 'package manager' },
  { pattern: /(?:^|\/)package-lock\.json$/, purpose: 'npm lock file', category: 'package manager' },
  { pattern: /(?:^|\/)yarn\.lock$/, purpose: 'Yarn lock file', category: 'package manager' },
  { pattern: /(?:^|\/)pnpm-lock\.yaml$/, purpose: 'pnpm lock file', category: 'package manager' },
  { pattern: /(?:^|\/)bun\.lockb$/, purpose: 'Bun lock file', category: 'package manager' },
  { pattern: /(?:^|\/)requirements\.txt$/, purpose: 'Python pip requirements', category: 'package manager' },
  { pattern: /(?:^|\/)Pipfile$/, purpose: 'Pipenv manifest', category: 'package manager' },
  { pattern: /(?:^|\/)pyproject\.toml$/, purpose: 'Python project / Poetry manifest', category: 'package manager' },
  { pattern: /(?:^|\/)Cargo\.toml$/, purpose: 'Rust Cargo manifest', category: 'package manager' },
  { pattern: /(?:^|\/)go\.mod$/, purpose: 'Go module manifest', category: 'package manager' },
  { pattern: /(?:^|\/)go\.sum$/, purpose: 'Go module checksum', category: 'package manager' },
  { pattern: /(?:^|\/)pom\.xml$/, purpose: 'Maven project manifest', category: 'package manager' },
  { pattern: /(?:^|\/)build\.gradle(?:\.kts)?$/, purpose: 'Gradle build script', category: 'package manager' },
  { pattern: /(?:^|\/)Gemfile$/, purpose: 'Bundler gem manifest', category: 'package manager' },
  { pattern: /(?:^|\/)composer\.json$/, purpose: 'Composer PHP package manifest', category: 'package manager' },
  // --- Version control ---
  { pattern: /(?:^|\/)\.gitignore$/, purpose: 'Git ignore rules', category: 'version control' },
  { pattern: /(?:^|\/)\.gitattributes$/, purpose: 'Git attributes configuration', category: 'version control' },
  // --- Environment ---
  { pattern: /(?:^|\/)\.env\.example$/, purpose: 'Environment variable template (non-secret)', category: 'environment' },
  { pattern: /(?:^|\/)\.env\.sample$/, purpose: 'Environment variable template (non-secret)', category: 'environment' },
  // --- Misc ---
  { pattern: /(?:^|\/)nginx\.conf$/, purpose: 'Nginx web server configuration', category: 'server' },
  { pattern: /(?:^|\/)apache\.conf$/, purpose: 'Apache web server configuration', category: 'server' },
]

// ─── Internal: known entry points ────────────────────────────────────────────

interface EntryPattern {
  pattern: RegExp
  kind: string
}

const ENTRY_PATTERNS: readonly EntryPattern[] = [
  // HTML pages — match any index.html or index.htm anywhere in the tree
  { pattern: /(?:^|\/)index\.html?$/, kind: 'HTML page entry' },
  // Other named HTML files at root or in a project subdirectory
  { pattern: /(?:^|\/)home\.html?$/, kind: 'HTML page entry' },
  { pattern: /(?:^|\/)default\.html?$/, kind: 'HTML page entry' },
  { pattern: /(?:^|\/)main\.html?$/, kind: 'HTML page entry' },
  // JavaScript / TypeScript web apps
  { pattern: /(?:^|\/)(?:src\/)?main\.[tj]sx?$/, kind: 'web entry' },
  { pattern: /(?:^|\/)(?:src\/)?index\.[tj]sx?$/, kind: 'web entry' },
  { pattern: /(?:^|\/)app\.[tj]sx?$/, kind: 'web entry' },
  // Node / backend
  { pattern: /(?:^|\/)server\.[tj]sx?$/, kind: 'server entry' },
  { pattern: /(?:^|\/)app\.js$/, kind: 'server entry' },
  { pattern: /(?:^|\/)index\.js$/, kind: 'server entry' },
  { pattern: /(?:^|\/)bin\/www$/, kind: 'server entry' },
  // Python
  { pattern: /(?:^|\/)main\.py$/, kind: 'main script' },
  { pattern: /(?:^|\/)app\.py$/, kind: 'server entry' },
  { pattern: /(?:^|\/)run\.py$/, kind: 'server entry' },
  { pattern: /(?:^|\/)wsgi\.py$/, kind: 'WSGI entry' },
  { pattern: /(?:^|\/)asgi\.py$/, kind: 'ASGI entry' },
  { pattern: /(?:^|\/)manage\.py$/, kind: 'Django management entry' },
  { pattern: /(?:^|\/)__main__\.py$/, kind: 'Python package entry' },
  // Go
  { pattern: /(?:^|\/)main\.go$/, kind: 'Go main package' },
  { pattern: /(?:^|\/)cmd\/[^/]+\/main\.go$/, kind: 'Go CLI entry' },
  // Rust
  { pattern: /(?:^|\/)src\/main\.rs$/, kind: 'Rust binary entry' },
  { pattern: /(?:^|\/)src\/lib\.rs$/, kind: 'Rust library entry' },
  // Java / Kotlin / C#
  { pattern: /(?:^|\/)Main\.java$/, kind: 'Java main class' },
  { pattern: /(?:^|\/)Application\.java$/, kind: 'Spring Boot entry' },
  { pattern: /(?:^|\/)Program\.cs$/, kind: 'C# program entry' },
  { pattern: /(?:^|\/)Startup\.cs$/, kind: 'ASP.NET startup' },
  // Ruby
  { pattern: /(?:^|\/)config\.ru$/, kind: 'Rack application entry' },
]

// ─── Internal: package manager manifests ─────────────────────────────────────

interface PkgManagerPattern {
  pattern: RegExp
  name: string
  explanation: string
}

const PKG_MANAGER_PATTERNS: readonly PkgManagerPattern[] = [
  { pattern: /(?:^|\/)yarn\.lock$/, name: 'Yarn', explanation: 'yarn.lock file detected' },
  { pattern: /(?:^|\/)pnpm-lock\.yaml$/, name: 'pnpm', explanation: 'pnpm-lock.yaml file detected' },
  { pattern: /(?:^|\/)bun\.lockb$/, name: 'Bun', explanation: 'bun.lockb lock file detected' },
  { pattern: /(?:^|\/)package-lock\.json$/, name: 'npm', explanation: 'package-lock.json file detected' },
  { pattern: /(?:^|\/)package\.json$/, name: 'npm', explanation: 'package.json manifest detected' },
  { pattern: /(?:^|\/)Pipfile\.lock$/, name: 'Pipenv', explanation: 'Pipfile.lock detected' },
  { pattern: /(?:^|\/)Pipfile$/, name: 'Pipenv', explanation: 'Pipfile manifest detected' },
  { pattern: /(?:^|\/)poetry\.lock$/, name: 'Poetry', explanation: 'poetry.lock detected' },
  { pattern: /(?:^|\/)pyproject\.toml$/, name: 'pip/Poetry', explanation: 'pyproject.toml detected' },
  { pattern: /(?:^|\/)requirements\.txt$/, name: 'pip', explanation: 'requirements.txt detected' },
  { pattern: /(?:^|\/)Cargo\.lock$/, name: 'Cargo', explanation: 'Cargo.lock detected' },
  { pattern: /(?:^|\/)Cargo\.toml$/, name: 'Cargo', explanation: 'Cargo.toml manifest detected' },
  { pattern: /(?:^|\/)go\.sum$/, name: 'Go Modules', explanation: 'go.sum checksum detected' },
  { pattern: /(?:^|\/)go\.mod$/, name: 'Go Modules', explanation: 'go.mod manifest detected' },
  { pattern: /(?:^|\/)pom\.xml$/, name: 'Maven', explanation: 'pom.xml Maven manifest detected' },
  { pattern: /(?:^|\/)build\.gradle(?:\.kts)?$/, name: 'Gradle', explanation: 'Gradle build script detected' },
  { pattern: /(?:^|\/)Gemfile\.lock$/, name: 'Bundler', explanation: 'Gemfile.lock detected' },
  { pattern: /(?:^|\/)Gemfile$/, name: 'Bundler', explanation: 'Gemfile manifest detected' },
  { pattern: /(?:^|\/)composer\.lock$/, name: 'Composer', explanation: 'composer.lock detected' },
  { pattern: /(?:^|\/)composer\.json$/, name: 'Composer', explanation: 'composer.json detected' },
]

// ─── Internal: module / service directory patterns ───────────────────────────

interface ModulePattern {
  pattern: RegExp
  label: string
  category: 'service' | 'module'
}

const MODULE_PATTERNS: readonly ModulePattern[] = [
  // Services (top-level microservice / service layer dirs)
  { pattern: /^services\/([^/]+)$/, label: 'service', category: 'service' },
  { pattern: /^packages\/([^/]+)$/, label: 'package', category: 'service' },
  { pattern: /^apps\/([^/]+)$/, label: 'application', category: 'service' },
  // Modules (common architectural layers)
  { pattern: /^(?:src\/)?controllers?\b/, label: 'Controllers', category: 'module' },
  { pattern: /^(?:src\/)?models?\b/, label: 'Models', category: 'module' },
  { pattern: /^(?:src\/)?repositories?\b/, label: 'Repositories', category: 'module' },
  { pattern: /^(?:src\/)?handlers?\b/, label: 'Handlers', category: 'module' },
  { pattern: /^(?:src\/)?middlewares?\b/, label: 'Middlewares', category: 'module' },
  { pattern: /^(?:src\/)?routes?\b/, label: 'Routes', category: 'module' },
  { pattern: /^(?:src\/)?migrations?\b/, label: 'Migrations', category: 'module' },
  { pattern: /^(?:src\/)?components?\b/, label: 'Components', category: 'module' },
  { pattern: /^(?:src\/)?pages?\b/, label: 'Pages', category: 'module' },
  { pattern: /^(?:src\/)?hooks?\b/, label: 'Hooks', category: 'module' },
  { pattern: /^(?:src\/)?utils?\b/, label: 'Utilities', category: 'module' },
  { pattern: /^(?:src\/)?helpers?\b/, label: 'Helpers', category: 'module' },
  { pattern: /^(?:src\/)?(?:__)?tests?(?:__)?$/, label: 'Tests', category: 'module' },
  { pattern: /^(?:src\/)?spec\b/, label: 'Test specs', category: 'module' },
  { pattern: /^(?:src\/)?lib\b/, label: 'Library', category: 'module' },
  { pattern: /^(?:src\/)?api\b/, label: 'API layer', category: 'module' },
  { pattern: /^(?:src\/)?store\b/, label: 'State store', category: 'module' },
  { pattern: /^(?:src\/)?domain\b/, label: 'Domain layer', category: 'module' },
  { pattern: /^(?:src\/)?infrastructure\b/, label: 'Infrastructure', category: 'module' },
  { pattern: /^(?:src\/)?config\b/, label: 'Configuration', category: 'module' },
  { pattern: /^(?:src\/)?types?\b/, label: 'Type definitions', category: 'module' },
  { pattern: /^(?:src\/)?schemas?\b/, label: 'Schemas', category: 'module' },
]

// ─── Internal: npm detection tables ──────────────────────────────────────────

interface NpmDetectionEntry {
  packages: readonly string[]
  name: string
  category: 'framework' | 'frontend' | 'backend' | 'database' | 'auth' | 'api'
  explanation: string
}

const NPM_DETECTION_TABLE: readonly NpmDetectionEntry[] = [
  // Frameworks (fullstack / frontend)
  { packages: ['next'], name: 'Next.js', category: 'framework', explanation: 'next package in dependencies' },
  { packages: ['nuxt', '@nuxt/core'], name: 'Nuxt', category: 'framework', explanation: 'nuxt package in dependencies' },
  { packages: ['@remix-run/node', '@remix-run/react'], name: 'Remix', category: 'framework', explanation: 'Remix packages in dependencies' },
  { packages: ['astro'], name: 'Astro', category: 'framework', explanation: 'astro package in dependencies' },
  { packages: ['@sveltejs/kit'], name: 'SvelteKit', category: 'framework', explanation: '@sveltejs/kit in dependencies' },
  { packages: ['gatsby'], name: 'Gatsby', category: 'framework', explanation: 'gatsby package in dependencies' },
  // Frontend UI libraries
  { packages: ['react', 'react-dom'], name: 'React', category: 'frontend', explanation: 'react/react-dom in dependencies' },
  { packages: ['vue', '@vue/core'], name: 'Vue', category: 'frontend', explanation: 'vue package in dependencies' },
  { packages: ['@angular/core'], name: 'Angular', category: 'frontend', explanation: '@angular/core in dependencies' },
  { packages: ['svelte'], name: 'Svelte', category: 'frontend', explanation: 'svelte package in dependencies' },
  { packages: ['solid-js'], name: 'Solid', category: 'frontend', explanation: 'solid-js in dependencies' },
  { packages: ['preact'], name: 'Preact', category: 'frontend', explanation: 'preact in dependencies' },
  { packages: ['@qwikdev/astro', 'qwik'], name: 'Qwik', category: 'frontend', explanation: 'Qwik package in dependencies' },
  // Backend frameworks
  { packages: ['express'], name: 'Express', category: 'backend', explanation: 'express in dependencies' },
  { packages: ['fastify'], name: 'Fastify', category: 'backend', explanation: 'fastify in dependencies' },
  { packages: ['koa'], name: 'Koa', category: 'backend', explanation: 'koa in dependencies' },
  { packages: ['@nestjs/core', '@nestjs/common'], name: 'NestJS', category: 'backend', explanation: '@nestjs packages in dependencies' },
  { packages: ['@hapi/hapi'], name: 'Hapi', category: 'backend', explanation: '@hapi/hapi in dependencies' },
  { packages: ['hono'], name: 'Hono', category: 'backend', explanation: 'hono in dependencies' },
  { packages: ['elysia'], name: 'Elysia', category: 'backend', explanation: 'elysia in dependencies (Bun framework)' },
  { packages: ['sails'], name: 'Sails.js', category: 'backend', explanation: 'sails in dependencies' },
  // Database clients & ORMs
  { packages: ['mongoose'], name: 'Mongoose (MongoDB ODM)', category: 'database', explanation: 'mongoose in dependencies' },
  { packages: ['mongodb', '@mongodb-js/saslprep'], name: 'MongoDB driver', category: 'database', explanation: 'mongodb driver in dependencies' },
  { packages: ['prisma', '@prisma/client'], name: 'Prisma ORM', category: 'database', explanation: 'Prisma packages in dependencies' },
  { packages: ['typeorm'], name: 'TypeORM', category: 'database', explanation: 'typeorm in dependencies' },
  { packages: ['sequelize', 'sequelize-typescript'], name: 'Sequelize ORM', category: 'database', explanation: 'Sequelize in dependencies' },
  { packages: ['pg', 'pg-native'], name: 'PostgreSQL (node-postgres)', category: 'database', explanation: 'pg driver in dependencies' },
  { packages: ['mysql2', 'mysql'], name: 'MySQL client', category: 'database', explanation: 'mysql2/mysql in dependencies' },
  { packages: ['better-sqlite3', 'sqlite3'], name: 'SQLite', category: 'database', explanation: 'SQLite driver in dependencies' },
  { packages: ['@supabase/supabase-js'], name: 'Supabase client', category: 'database', explanation: '@supabase/supabase-js in dependencies' },
  { packages: ['@planetscale/database'], name: 'PlanetScale client', category: 'database', explanation: '@planetscale/database in dependencies' },
  { packages: ['redis', 'ioredis', '@redis/client'], name: 'Redis client', category: 'database', explanation: 'Redis client in dependencies' },
  { packages: ['drizzle-orm'], name: 'Drizzle ORM', category: 'database', explanation: 'drizzle-orm in dependencies' },
  { packages: ['knex'], name: 'Knex.js query builder', category: 'database', explanation: 'knex in dependencies' },
  { packages: ['mikro-orm', '@mikro-orm/core'], name: 'MikroORM', category: 'database', explanation: 'MikroORM in dependencies' },
  // Authentication
  { packages: ['passport', 'passport-local', 'passport-jwt'], name: 'Passport.js', category: 'auth', explanation: 'passport in dependencies' },
  { packages: ['jsonwebtoken'], name: 'JSON Web Token (jsonwebtoken)', category: 'auth', explanation: 'jsonwebtoken in dependencies' },
  { packages: ['@auth/core', 'next-auth', '@next-auth/prisma-adapter'], name: 'Auth.js / NextAuth', category: 'auth', explanation: 'Auth.js (next-auth) in dependencies' },
  { packages: ['@clerk/nextjs', '@clerk/clerk-sdk-node', '@clerk/backend'], name: 'Clerk', category: 'auth', explanation: 'Clerk auth in dependencies' },
  { packages: ['lucia', 'lucia-auth'], name: 'Lucia', category: 'auth', explanation: 'lucia in dependencies' },
  { packages: ['better-auth'], name: 'better-auth', category: 'auth', explanation: 'better-auth in dependencies' },
  { packages: ['bcrypt', 'bcryptjs'], name: 'bcrypt (password hashing)', category: 'auth', explanation: 'bcrypt in dependencies (password hashing)' },
  { packages: ['argon2'], name: 'Argon2 (password hashing)', category: 'auth', explanation: 'argon2 in dependencies (password hashing)' },
  { packages: ['jose'], name: 'jose (JWT/JWS/JWE)', category: 'auth', explanation: 'jose in dependencies' },
  // API patterns
  { packages: ['@trpc/server', '@trpc/client'], name: 'tRPC', category: 'api', explanation: 'tRPC packages in dependencies' },
  { packages: ['graphql'], name: 'GraphQL', category: 'api', explanation: 'graphql package in dependencies' },
  { packages: ['@apollo/server', 'apollo-server', 'apollo-server-express'], name: 'Apollo Server', category: 'api', explanation: 'Apollo Server in dependencies' },
  { packages: ['@apollo/client', 'apollo-client'], name: 'Apollo Client (GraphQL)', category: 'api', explanation: 'Apollo Client in dependencies' },
  { packages: ['urql'], name: 'urql (GraphQL client)', category: 'api', explanation: 'urql in dependencies' },
  { packages: ['socket.io', 'socket.io-client'], name: 'Socket.IO (WebSocket)', category: 'api', explanation: 'Socket.IO in dependencies' },
  { packages: ['ws'], name: 'WebSocket (ws)', category: 'api', explanation: 'ws package in dependencies' },
  { packages: ['swagger-ui-express', '@nestjs/swagger', 'swagger-jsdoc'], name: 'OpenAPI / Swagger', category: 'api', explanation: 'Swagger/OpenAPI package in dependencies' },
  { packages: ['openapi-types', 'openapi3-ts'], name: 'OpenAPI types', category: 'api', explanation: 'OpenAPI type packages in dependencies' },
]

// ─── Internal: Python detection patterns ─────────────────────────────────────

interface PythonDetectionEntry {
  packages: readonly string[]
  name: string
  category: 'framework' | 'frontend' | 'backend' | 'database' | 'auth' | 'api'
  explanation: string
}

const PYTHON_DETECTION_TABLE: readonly PythonDetectionEntry[] = [
  // Backend frameworks
  { packages: ['django'], name: 'Django', category: 'backend', explanation: 'django in Python requirements' },
  { packages: ['flask'], name: 'Flask', category: 'backend', explanation: 'flask in Python requirements' },
  { packages: ['fastapi'], name: 'FastAPI', category: 'backend', explanation: 'fastapi in Python requirements' },
  { packages: ['tornado'], name: 'Tornado', category: 'backend', explanation: 'tornado in Python requirements' },
  { packages: ['aiohttp'], name: 'aiohttp', category: 'backend', explanation: 'aiohttp in Python requirements' },
  { packages: ['starlette'], name: 'Starlette', category: 'backend', explanation: 'starlette in Python requirements' },
  { packages: ['falcon'], name: 'Falcon', category: 'backend', explanation: 'falcon in Python requirements' },
  { packages: ['bottle'], name: 'Bottle', category: 'backend', explanation: 'bottle in Python requirements' },
  { packages: ['sanic'], name: 'Sanic', category: 'backend', explanation: 'sanic in Python requirements' },
  // Database
  { packages: ['sqlalchemy', 'sqlmodel'], name: 'SQLAlchemy ORM', category: 'database', explanation: 'SQLAlchemy in Python requirements' },
  { packages: ['psycopg2', 'psycopg2-binary', 'psycopg'], name: 'PostgreSQL (psycopg)', category: 'database', explanation: 'psycopg2/psycopg in Python requirements' },
  { packages: ['pymysql', 'mysqlclient'], name: 'MySQL (Python)', category: 'database', explanation: 'PyMySQL/mysqlclient in Python requirements' },
  { packages: ['motor'], name: 'Motor (async MongoDB)', category: 'database', explanation: 'motor in Python requirements' },
  { packages: ['pymongo'], name: 'PyMongo (MongoDB)', category: 'database', explanation: 'pymongo in Python requirements' },
  { packages: ['redis', 'redis-py'], name: 'Redis (Python)', category: 'database', explanation: 'redis package in Python requirements' },
  { packages: ['tortoise-orm'], name: 'Tortoise ORM', category: 'database', explanation: 'tortoise-orm in Python requirements' },
  { packages: ['databases'], name: 'Databases (async SQL)', category: 'database', explanation: 'databases package in Python requirements' },
  { packages: ['alembic'], name: 'Alembic (DB migrations)', category: 'database', explanation: 'alembic in Python requirements' },
  { packages: ['beanie'], name: 'Beanie (MongoDB ODM)', category: 'database', explanation: 'beanie in Python requirements' },
  // Auth
  { packages: ['djangorestframework-simplejwt'], name: 'DRF SimpleJWT', category: 'auth', explanation: 'djangorestframework-simplejwt in requirements' },
  { packages: ['python-jose', 'jose'], name: 'python-jose (JWT)', category: 'auth', explanation: 'python-jose in Python requirements' },
  { packages: ['authlib'], name: 'Authlib (OAuth/OIDC)', category: 'auth', explanation: 'authlib in Python requirements' },
  { packages: ['flask-login'], name: 'Flask-Login', category: 'auth', explanation: 'flask-login in Python requirements' },
  { packages: ['passlib'], name: 'passlib (password hashing)', category: 'auth', explanation: 'passlib in Python requirements' },
  // API
  { packages: ['graphene', 'strawberry-graphql'], name: 'GraphQL (Python)', category: 'api', explanation: 'GraphQL library in Python requirements' },
  { packages: ['djangorestframework', 'rest_framework'], name: 'Django REST Framework', category: 'api', explanation: 'djangorestframework in requirements' },
  { packages: ['channels'], name: 'Django Channels (WebSocket)', category: 'api', explanation: 'channels in Python requirements' },
]

// ─── Internal: source file scan patterns ─────────────────────────────────────

// Static regex patterns — never constructed from user input
const RE_GRAPHQL_SCHEMA = /\b(?:type\s+Query|type\s+Mutation|type\s+Subscription|schema\s*\{|extend\s+type)/
const RE_GRAPHQL_TAG    = /\bgql\s*`|gql\s*\(/
const RE_SQL_KEYWORDS   = /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i
const RE_REST_JAVA      = /@(?:GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping|RestController|Controller)/
const RE_REST_PYTHON    = /@(?:app|router|blueprint)\s*\.(?:get|post|put|delete|patch|route)\s*\(/
const RE_AUTH_BEARER    = /Authorization.*Bearer|Bearer.*token|jwt\.(?:sign|verify|decode)/
const RE_OAUTH_PATTERN  = /\bOAuth2?\b|\bopenid.connect\b|\boidc\b/i
const RE_GRAPHQL_FILE   = /\.(?:graphql|gql)$/i

// ─── Internal: helper utilities ───────────────────────────────────────────────

/** Extract the lowercase extension from a filename/path, or empty string */
function getExt(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase()
}

/** Merge a new detection into an existing array, combining evidence, keeping best status */
function mergeDetection(
  existing: EvidencedDetection[],
  incoming: EvidencedDetection,
): void {
  const idx = existing.findIndex(
    (d) => d.name.toLowerCase() === incoming.name.toLowerCase(),
  )
  if (idx === -1) {
    existing.push({ ...incoming })
    return
  }
  const current = existing[idx]
  // Merge evidence (dedup)
  const evidenceSet = new Set([...current.evidence, ...incoming.evidence])
  current.evidence = Array.from(evidenceSet)
  // Keep best status: Detected > Likely > Unknown
  const rank = (s: EvidencedDetection['status']): number =>
    s === 'Detected' ? 2 : s === 'Likely' ? 1 : 0
  if (rank(incoming.status) > rank(current.status)) {
    current.status = incoming.status
  }
  // Keep or upgrade version
  if (!current.version && incoming.version) current.version = incoming.version
  // Append explanation if different
  if (incoming.explanation && current.explanation !== incoming.explanation) {
    current.explanation = current.explanation
      ? `${current.explanation}; ${incoming.explanation}`
      : incoming.explanation
  }
}

// ─── Pass 1: Path-only detectors ─────────────────────────────────────────────

function detectLanguages(flatFiles: FileNode[]): EvidencedDetection[] {
  const langEvidence = new Map<string, string[]>()

  for (const f of flatFiles) {
    const ext = getExt(f.path)
    const lang = EXT_TO_LANGUAGE[ext]
    if (!lang) continue
    const arr = langEvidence.get(lang) ?? []
    arr.push(f.path)
    langEvidence.set(lang, arr)
  }

  return Array.from(langEvidence.entries())
    .map(([name, evidence]) => ({
      name,
      status: 'Detected' as const,
      evidence,
      explanation: `${evidence.length} file(s) with matching extension`,
    }))
    .sort((a, b) => b.evidence.length - a.evidence.length)
}

function detectConfigFiles(flatFiles: FileNode[]): ConfigFile[] {
  const found: ConfigFile[] = []
  const seen = new Set<string>()

  for (const f of flatFiles) {
    if (seen.has(f.path)) continue
    for (const cp of CONFIG_PATTERNS) {
      if (cp.pattern.test(f.path)) {
        found.push({ path: f.path, purpose: cp.purpose, category: cp.category })
        seen.add(f.path)
        break
      }
    }
  }

  return found
}

function detectEntryPoints(flatFiles: FileNode[]): EntryPoint[] {
  const found: EntryPoint[] = []
  const seen = new Set<string>()

  for (const f of flatFiles) {
    if (seen.has(f.path)) continue
    for (const ep of ENTRY_PATTERNS) {
      if (ep.pattern.test(f.path)) {
        found.push({ path: f.path, kind: ep.kind, evidence: [f.path] })
        seen.add(f.path)
        break
      }
    }
  }

  return found
}

function detectPackageManagers(flatFiles: FileNode[]): EvidencedDetection[] {
  const detections: EvidencedDetection[] = []
  const filePaths = new Set(flatFiles.map((f) => f.path))

  for (const pm of PKG_MANAGER_PATTERNS) {
    for (const f of flatFiles) {
      if (pm.pattern.test(f.path) && filePaths.has(f.path)) {
        mergeDetection(detections, {
          name: pm.name,
          status: 'Detected',
          evidence: [f.path],
          explanation: pm.explanation,
        })
        break
      }
    }
  }

  return detections
}

function detectModules(
  flatFiles: FileNode[],
): { services: EvidencedDetection[]; modules: EvidencedDetection[] } {
  const services: EvidencedDetection[] = []
  const modules: EvidencedDetection[] = []
  const seenPaths = new Set<string>()

  // Only look at unique directory paths from the flat list
  const dirs = new Set<string>()
  for (const f of flatFiles) {
    const parts = f.path.split('/')
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'))
    }
  }

  for (const dir of dirs) {
    if (seenPaths.has(dir)) continue
    for (const mp of MODULE_PATTERNS) {
      const match = mp.pattern.exec(dir)
      if (!match) continue
      seenPaths.add(dir)
      const label = match[1]
        ? `${mp.label} (${match[1]})`
        : mp.label
      const detection: EvidencedDetection = {
        name: label,
        status: 'Detected',
        evidence: [dir + '/'],
        explanation: `Directory "${dir}" detected`,
      }
      if (mp.category === 'service') {
        mergeDetection(services, detection)
      } else {
        mergeDetection(modules, detection)
      }
      break
    }
  }

  return { services, modules }
}

// ─── Pass 2: Content-based manifest parsers ───────────────────────────────────

/** Safely parse JSON from file content, returning null on failure */
function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

/** Extract a semver-like version string from a range spec (^1.2.3 → 1.2.3) */
function extractVersion(spec: string): string | undefined {
  const m = /(\d+\.\d+(?:\.\d+)?)/.exec(spec)
  return m ? m[1] : undefined
}

interface NpmManifestFields {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

function parseNpmManifest(
  content: string,
  filePath: string,
  notes: string[],
): {
  frameworks: EvidencedDetection[]
  frontend: EvidencedDetection[]
  backend: EvidencedDetection[]
  database: EvidencedDetection[]
  auth: EvidencedDetection[]
  api: EvidencedDetection[]
  depInfo: DependencyInfo | null
} {
  const empty = {
    frameworks: [], frontend: [], backend: [], database: [],
    auth: [], api: [], depInfo: null,
  }

  const parsed = safeParseJson(content)
  if (typeof parsed !== 'object' || parsed === null) {
    notes.push(`${filePath}: could not parse as JSON — content-based analysis skipped for this file`)
    return empty
  }

  const manifest = parsed as NpmManifestFields
  const deps    = manifest.dependencies    ?? {}
  const devDeps = manifest.devDependencies ?? {}
  const peers   = manifest.peerDependencies ?? {}

  // All packages combined for detection (prod + dev + peer)
  const allPkgs: Record<string, string> = { ...peers, ...devDeps, ...deps }

  const frameworks: EvidencedDetection[] = []
  const frontend:   EvidencedDetection[] = []
  const backend:    EvidencedDetection[] = []
  const database:   EvidencedDetection[] = []
  const auth:       EvidencedDetection[] = []
  const api:        EvidencedDetection[] = []

  for (const entry of NPM_DETECTION_TABLE) {
    const matched = entry.packages.find((pkg) => pkg in allPkgs)
    if (!matched) continue

    const version = extractVersion(allPkgs[matched] ?? '')
    const detection: EvidencedDetection = {
      name: entry.name,
      status: 'Detected',
      evidence: [filePath],
      explanation: entry.explanation,
      ...(version ? { version } : {}),
    }

    switch (entry.category) {
      case 'framework': mergeDetection(frameworks, detection); break
      case 'frontend':  mergeDetection(frontend,   detection); break
      case 'backend':   mergeDetection(backend,    detection); break
      case 'database':  mergeDetection(database,   detection); break
      case 'auth':      mergeDetection(auth,        detection); break
      case 'api':       mergeDetection(api,         detection); break
    }
  }

  // Build dependency info
  const prodNames = Object.keys(deps)
  const devNames  = Object.keys(devDeps)

  // Notable: any package that matched our detection table
  const allMatchedNames = new Set<string>()
  for (const entry of NPM_DETECTION_TABLE) {
    for (const pkg of entry.packages) {
      if (pkg in allPkgs) allMatchedNames.add(pkg)
    }
  }

  const depInfo: DependencyInfo = {
    ecosystem: 'npm',
    manifestFile: filePath,
    packageCount: prodNames.length,
    devPackageCount: devNames.length,
    notable: Array.from(allMatchedNames).slice(0, 20),
  }

  return { frameworks, frontend, backend, database, auth, api, depInfo }
}

/**
 * Parses Python requirement files (requirements.txt, Pipfile, pyproject.toml).
 * Handles the three most common formats with simple line/section parsing —
 * not a full PEP-compliant parser, but sufficient for package-name detection.
 */
function parsePythonManifest(
  content: string,
  filePath: string,
  filename: string,
  notes: string[],
): {
  backend: EvidencedDetection[]
  database: EvidencedDetection[]
  auth: EvidencedDetection[]
  api: EvidencedDetection[]
  depInfo: DependencyInfo | null
} {
  const empty = { backend: [], database: [], auth: [], api: [], depInfo: null }

  let packageNames: string[] = []

  if (filename === 'requirements.txt') {
    // One package per line, optional version specifier; skip comments/blank lines
    packageNames = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
      .map((l) => l.split(/[=><!~\s\[;]/)[0].toLowerCase().trim())
      .filter((l) => l.length > 0)
  } else if (filename === 'Pipfile') {
    // TOML-like; extract keys from [packages] and [dev-packages] sections
    let inSection = false
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (/^\[(packages|dev-packages)\]/.test(trimmed)) { inSection = true; continue }
      if (/^\[/.test(trimmed)) { inSection = false; continue }
      if (!inSection) continue
      const m = /^([\w-]+)\s*=/.exec(trimmed)
      if (m) packageNames.push(m[1].toLowerCase())
    }
  } else if (filename === 'pyproject.toml') {
    // Extract from [tool.poetry.dependencies], [project.dependencies], etc.
    let inDeps = false
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (/^\[(?:tool\.poetry\.(?:dev-)?dependencies|project\.dependencies|project\.optional-dependencies\.\w+)\]/.test(trimmed)) {
        inDeps = true; continue
      }
      if (/^\[/.test(trimmed)) { inDeps = false; continue }
      if (!inDeps) continue
      // toml key = value or value in array
      const m = /^([\w-]+)\s*[=,]/.exec(trimmed)
      if (m && m[1].toLowerCase() !== 'python') packageNames.push(m[1].toLowerCase())
    }
  } else {
    notes.push(`${filePath}: unrecognised Python manifest format — skipped`)
    return empty
  }

  if (packageNames.length === 0) {
    notes.push(`${filePath}: no packages extracted from Python manifest`)
    return empty
  }

  const backend:  EvidencedDetection[] = []
  const database: EvidencedDetection[] = []
  const auth:     EvidencedDetection[] = []
  const api:      EvidencedDetection[] = []

  const notablePkgs: string[] = []

  for (const entry of PYTHON_DETECTION_TABLE) {
    const matched = entry.packages.find((pkg) =>
      packageNames.some((name) => name === pkg.toLowerCase() || name.startsWith(pkg.toLowerCase() + '[')),
    )
    if (!matched) continue
    notablePkgs.push(matched)
    const detection: EvidencedDetection = {
      name: entry.name,
      status: 'Detected',
      evidence: [filePath],
      explanation: entry.explanation,
    }
    switch (entry.category) {
      case 'backend':  mergeDetection(backend,  detection); break
      case 'database': mergeDetection(database, detection); break
      case 'auth':     mergeDetection(auth,     detection); break
      case 'api':      mergeDetection(api,      detection); break
    }
  }

  const depInfo: DependencyInfo = {
    ecosystem: 'pip',
    manifestFile: filePath,
    packageCount: packageNames.length,
    devPackageCount: 0,
    notable: notablePkgs.slice(0, 20),
  }

  return { backend, database, auth, api, depInfo }
}

function parseCargoManifest(
  content: string,
  filePath: string,
  notes: string[],
): { backend: EvidencedDetection[]; database: EvidencedDetection[]; depInfo: DependencyInfo | null } {
  const empty = { backend: [], database: [], depInfo: null }

  // Simple TOML key extraction from [dependencies] section
  let inDeps = false
  const packageNames: string[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (/^\[(?:dependencies|dev-dependencies|build-dependencies)\]/.test(trimmed)) {
      inDeps = true; continue
    }
    if (/^\[/.test(trimmed)) { inDeps = false; continue }
    if (!inDeps) continue
    const m = /^([\w-]+)\s*[=.]/.exec(trimmed)
    if (m) packageNames.push(m[1].toLowerCase())
  }

  if (packageNames.length === 0) {
    notes.push(`${filePath}: no dependencies extracted from Cargo.toml`)
    return empty
  }

  const CARGO_FRAMEWORKS: Record<string, string> = {
    'actix-web': 'Actix Web', 'axum': 'Axum', 'rocket': 'Rocket',
    'warp': 'Warp', 'tide': 'Tide', 'poem': 'Poem',
  }
  const CARGO_DATABASES: Record<string, string> = {
    'diesel': 'Diesel ORM', 'sqlx': 'sqlx', 'sea-orm': 'SeaORM',
    'tokio-postgres': 'tokio-postgres', 'rusqlite': 'rusqlite',
    'mongodb': 'MongoDB (Rust)',
  }

  const backend: EvidencedDetection[] = []
  const database: EvidencedDetection[] = []
  const notable: string[] = []

  for (const pkg of packageNames) {
    if (CARGO_FRAMEWORKS[pkg]) {
      notable.push(pkg)
      mergeDetection(backend, {
        name: CARGO_FRAMEWORKS[pkg],
        status: 'Detected',
        evidence: [filePath],
        explanation: `${pkg} in Cargo.toml dependencies`,
      })
    }
    if (CARGO_DATABASES[pkg]) {
      notable.push(pkg)
      mergeDetection(database, {
        name: CARGO_DATABASES[pkg],
        status: 'Detected',
        evidence: [filePath],
        explanation: `${pkg} in Cargo.toml dependencies`,
      })
    }
  }

  const depInfo: DependencyInfo = {
    ecosystem: 'cargo',
    manifestFile: filePath,
    packageCount: packageNames.length,
    devPackageCount: 0,
    notable: notable.slice(0, 20),
  }

  return { backend, database, depInfo }
}

function parseGoManifest(
  content: string,
  filePath: string,
  notes: string[],
): { backend: EvidencedDetection[]; database: EvidencedDetection[]; depInfo: DependencyInfo | null } {
  const empty = { backend: [], database: [], depInfo: null }

  // go.mod uses "require" blocks: `require (\n\tmodule/path vX.Y.Z\n)`
  const requireMatches = content.matchAll(/^\s*([\w./-]+)\s+v[\w.+-]+/gm)
  const modules: string[] = []
  for (const m of requireMatches) {
    modules.push(m[1].toLowerCase())
  }

  if (modules.length === 0) {
    notes.push(`${filePath}: no module requirements extracted from go.mod`)
    return empty
  }

  const GO_FRAMEWORKS: Record<string, string> = {
    'github.com/gin-gonic/gin': 'Gin',
    'github.com/labstack/echo': 'Echo',
    'github.com/gofiber/fiber': 'Fiber',
    'github.com/go-chi/chi': 'Chi',
    'github.com/gorilla/mux': 'Gorilla Mux',
    'github.com/beego/beego': 'Beego',
  }
  const GO_DATABASES: Record<string, string> = {
    'gorm.io/gorm': 'GORM',
    'github.com/jmoiron/sqlx': 'sqlx (Go)',
    'github.com/go-pg/pg': 'go-pg (PostgreSQL)',
    'go.mongodb.org/mongo-driver': 'MongoDB Go driver',
    'github.com/redis/go-redis': 'go-redis',
    'github.com/jackc/pgx': 'pgx (PostgreSQL)',
  }

  const backend: EvidencedDetection[] = []
  const database: EvidencedDetection[] = []
  const notable: string[] = []

  for (const mod of modules) {
    for (const [key, name] of Object.entries(GO_FRAMEWORKS)) {
      if (mod.startsWith(key)) {
        notable.push(key)
        mergeDetection(backend, {
          name, status: 'Detected', evidence: [filePath],
          explanation: `${key} in go.mod`,
        })
      }
    }
    for (const [key, name] of Object.entries(GO_DATABASES)) {
      if (mod.startsWith(key)) {
        notable.push(key)
        mergeDetection(database, {
          name, status: 'Detected', evidence: [filePath],
          explanation: `${key} in go.mod`,
        })
      }
    }
  }

  const depInfo: DependencyInfo = {
    ecosystem: 'go modules',
    manifestFile: filePath,
    packageCount: modules.length,
    devPackageCount: 0,
    notable: notable.slice(0, 20),
  }

  return { backend, database, depInfo }
}

function parseGemfile(
  content: string,
  filePath: string,
  notes: string[],
): { backend: EvidencedDetection[]; database: EvidencedDetection[]; auth: EvidencedDetection[]; depInfo: DependencyInfo | null } {
  const empty = { backend: [], database: [], auth: [], depInfo: null }

  // Gemfile format: gem 'name' or gem "name"
  const gemMatches = content.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)
  const gems: string[] = []
  for (const m of gemMatches) gems.push(m[1].toLowerCase())

  if (gems.length === 0) {
    notes.push(`${filePath}: no gems extracted from Gemfile`)
    return empty
  }

  const GEM_BACKEND:  Record<string, string> = {
    'rails': 'Ruby on Rails', 'sinatra': 'Sinatra', 'grape': 'Grape',
    'hanami': 'Hanami', 'roda': 'Roda',
  }
  const GEM_DATABASE: Record<string, string> = {
    'activerecord': 'ActiveRecord', 'sequel': 'Sequel ORM',
    'mongoid': 'Mongoid (MongoDB)', 'redis': 'Redis (Ruby)', 'pg': 'PostgreSQL (ruby-pg)',
    'mysql2': 'MySQL (mysql2)',
  }
  const GEM_AUTH: Record<string, string> = {
    'devise': 'Devise (Rails auth)', 'warden': 'Warden (Rack auth)',
    'jwt': 'JWT (Ruby)', 'doorkeeper': 'Doorkeeper (OAuth2)',
  }

  const backend: EvidencedDetection[] = []
  const database: EvidencedDetection[] = []
  const auth: EvidencedDetection[] = []
  const notable: string[] = []

  for (const gem of gems) {
    if (GEM_BACKEND[gem])  { notable.push(gem); mergeDetection(backend,  { name: GEM_BACKEND[gem],  status: 'Detected', evidence: [filePath], explanation: `${gem} in Gemfile` }) }
    if (GEM_DATABASE[gem]) { notable.push(gem); mergeDetection(database, { name: GEM_DATABASE[gem], status: 'Detected', evidence: [filePath], explanation: `${gem} in Gemfile` }) }
    if (GEM_AUTH[gem])     { notable.push(gem); mergeDetection(auth,     { name: GEM_AUTH[gem],     status: 'Detected', evidence: [filePath], explanation: `${gem} in Gemfile` }) }
  }

  return {
    backend, database, auth,
    depInfo: { ecosystem: 'bundler', manifestFile: filePath, packageCount: gems.length, devPackageCount: 0, notable: notable.slice(0, 20) },
  }
}

function parsePomXml(
  content: string,
  filePath: string,
): { backend: EvidencedDetection[]; database: EvidencedDetection[]; depInfo: DependencyInfo | null } {
  // Simple artifact ID extraction — not a full XML parser, but sufficient
  const artifactIds: string[] = []
  const artifactMatches = content.matchAll(/<artifactId>\s*([^<]+)\s*<\/artifactId>/g)
  for (const m of artifactMatches) artifactIds.push(m[1].trim().toLowerCase())

  const MAVEN_BACKEND:  Record<string, string> = {
    'spring-boot-starter-web': 'Spring Boot (Web)',
    'spring-boot-starter': 'Spring Boot',
    'quarkus-core': 'Quarkus',
    'micronaut-core': 'Micronaut',
  }
  const MAVEN_DATABASE: Record<string, string> = {
    'hibernate-core': 'Hibernate ORM',
    'spring-boot-starter-data-jpa': 'Spring Data JPA',
    'postgresql': 'PostgreSQL (JDBC)',
    'mysql-connector-java': 'MySQL (JDBC)',
    'mongodb-driver-core': 'MongoDB Java driver',
    'jedis': 'Jedis (Redis Java)',
  }

  const backend: EvidencedDetection[] = []
  const database: EvidencedDetection[] = []
  const notable: string[] = []

  for (const id of artifactIds) {
    if (MAVEN_BACKEND[id])  { notable.push(id); mergeDetection(backend,  { name: MAVEN_BACKEND[id],  status: 'Detected', evidence: [filePath], explanation: `${id} in pom.xml` }) }
    if (MAVEN_DATABASE[id]) { notable.push(id); mergeDetection(database, { name: MAVEN_DATABASE[id], status: 'Detected', evidence: [filePath], explanation: `${id} in pom.xml` }) }
  }

  return {
    backend, database,
    depInfo: { ecosystem: 'maven', manifestFile: filePath, packageCount: artifactIds.length, devPackageCount: 0, notable: notable.slice(0, 20) },
  }
}

// ─── Pass 3: Source file pattern scanners ─────────────────────────────────────

interface SourceScanResult {
  apiPatterns: EvidencedDetection[]
  databaseHints: EvidencedDetection[]
  authHints: EvidencedDetection[]
}

function scanSourceFile(filePath: string, content: string): SourceScanResult {
  const api:   EvidencedDetection[] = []
  const db:    EvidencedDetection[] = []
  const auth:  EvidencedDetection[] = []

  // GraphQL — schema definitions or gql tagged templates
  if (RE_GRAPHQL_SCHEMA.test(content) || RE_GRAPHQL_TAG.test(content) || RE_GRAPHQL_FILE.test(filePath)) {
    mergeDetection(api, {
      name: 'GraphQL',
      status: 'Likely',
      evidence: [filePath],
      explanation: 'GraphQL schema definition or gql tag found in source',
    })
  }

  // REST — Java annotations or Python decorators
  if (RE_REST_JAVA.test(content)) {
    mergeDetection(api, {
      name: 'REST API',
      status: 'Likely',
      evidence: [filePath],
      explanation: 'Spring MVC / REST controller annotations found',
    })
  }
  if (RE_REST_PYTHON.test(content)) {
    mergeDetection(api, {
      name: 'REST API',
      status: 'Likely',
      evidence: [filePath],
      explanation: 'Python route decorator (@app.get / @router.get) found',
    })
  }

  // SQL keywords in source
  if (RE_SQL_KEYWORDS.test(content)) {
    mergeDetection(db, {
      name: 'SQL database usage',
      status: 'Likely',
      evidence: [filePath],
      explanation: 'Raw SQL statement found in source file',
    })
  }

  // Auth patterns
  if (RE_AUTH_BEARER.test(content)) {
    mergeDetection(auth, {
      name: 'JWT / Bearer token authentication',
      status: 'Likely',
      evidence: [filePath],
      explanation: 'JWT sign/verify or Bearer token pattern found in source',
    })
  }
  if (RE_OAUTH_PATTERN.test(content)) {
    mergeDetection(auth, {
      name: 'OAuth / OpenID Connect',
      status: 'Likely',
      evidence: [filePath],
      explanation: 'OAuth2 / OIDC pattern found in source',
    })
  }

  return { apiPatterns: api, databaseHints: db, authHints: auth }
}

// ─── Extensions worth scanning for source patterns ───────────────────────────

const SOURCE_SCAN_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'cs', 'php',
  'graphql', 'gql',
])

// ─── Exported: main analyzer function ─────────────────────────────────────────

/**
 * Performs static analysis on already-fetched repository data.
 *
 * This function is SYNCHRONOUS and performs no I/O.
 * It never calls the GitHub API, executes code, or reads secrets.
 *
 * @param meta          - Normalised repository metadata from githubService
 * @param flatFiles     - Flat list of all file nodes from getRepoTree()
 * @param truncated     - Whether GitHub truncated the tree response
 * @param fetchedContents - Map of path → FileContent for pre-fetched files
 *                          (caller is responsible for fetching; see RECOMMENDED_FETCH_PATHS)
 * @returns AnalysisResult — either structured analysis data or a typed error
 */
export function analyzeRepository(
  meta: GitHubRepoMeta,
  flatFiles: FileNode[],
  truncated: boolean,
  fetchedContents: Map<string, FileContent>,
): AnalysisResult {
  try {
    if (flatFiles.length === 0) {
      return {
        ok: false,
        error: {
          kind: 'no_tree',
          message:
            'No file tree data was provided. Fetch the repository tree first using getRepoTree().',
        },
      }
    }

    const notes: string[] = []

    if (truncated) {
      notes.push(
        'GitHub returned a truncated tree response. Analysis is based on available files only and may be incomplete.',
      )
    }

    // ── Pass 1: path-only ────────────────────────────────────────────────────
    const languages    = detectLanguages(flatFiles)
    const configFiles  = detectConfigFiles(flatFiles)
    const entryPoints  = detectEntryPoints(flatFiles)
    const pkgManagers  = detectPackageManagers(flatFiles)
    const { services: majorServices, modules: majorModules } = detectModules(flatFiles)

    // Accumulators for content-based passes
    const frameworks:   EvidencedDetection[] = []
    const frontendTech: EvidencedDetection[] = []
    const backendTech:  EvidencedDetection[] = []
    const dbTech:       EvidencedDetection[] = []
    const authMechs:    EvidencedDetection[] = []
    const apiPatterns:  EvidencedDetection[] = []
    const dependencies: DependencyInfo[]     = []

    // Use GitHub's primary language field as a lightweight supplement
    // (not authoritative — extension-based analysis above is the real source)
    if (meta.language && meta.language !== 'Unknown') {
      const alreadyDetected = languages.some(
        (l) => l.name.toLowerCase() === meta.language.toLowerCase(),
      )
      if (!alreadyDetected) {
        notes.push(
          `GitHub reports primary language as "${meta.language}" but no matching files were found in the fetched tree. ` +
          'This may be due to tree truncation or filtered file types.',
        )
      }
    }

    // ── Pass 2: content-based manifest parsing ───────────────────────────────
    const manifestFilenames = new Set([
      'package.json', 'requirements.txt', 'Pipfile', 'pyproject.toml',
      'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile',
    ])

    for (const [path, fc] of fetchedContents) {
      const filename = path.split('/').pop() ?? path

      if (filename === 'package.json') {
        const r = parseNpmManifest(fc.content, path, notes)
        r.frameworks.forEach((d) => mergeDetection(frameworks,   d))
        r.frontend  .forEach((d) => mergeDetection(frontendTech, d))
        r.backend   .forEach((d) => mergeDetection(backendTech,  d))
        r.database  .forEach((d) => mergeDetection(dbTech,       d))
        r.auth      .forEach((d) => mergeDetection(authMechs,    d))
        r.api       .forEach((d) => mergeDetection(apiPatterns,  d))
        if (r.depInfo) dependencies.push(r.depInfo)

      } else if (filename === 'requirements.txt' || filename === 'Pipfile' || filename === 'pyproject.toml') {
        const r = parsePythonManifest(fc.content, path, filename, notes)
        r.backend  .forEach((d) => mergeDetection(backendTech, d))
        r.database .forEach((d) => mergeDetection(dbTech,      d))
        r.auth     .forEach((d) => mergeDetection(authMechs,   d))
        r.api      .forEach((d) => mergeDetection(apiPatterns, d))
        if (r.depInfo) dependencies.push(r.depInfo)

      } else if (filename === 'Cargo.toml') {
        const r = parseCargoManifest(fc.content, path, notes)
        r.backend .forEach((d) => mergeDetection(backendTech, d))
        r.database.forEach((d) => mergeDetection(dbTech,      d))
        if (r.depInfo) dependencies.push(r.depInfo)

      } else if (filename === 'go.mod') {
        const r = parseGoManifest(fc.content, path, notes)
        r.backend .forEach((d) => mergeDetection(backendTech, d))
        r.database.forEach((d) => mergeDetection(dbTech,      d))
        if (r.depInfo) dependencies.push(r.depInfo)

      } else if (filename === 'Gemfile') {
        const r = parseGemfile(fc.content, path, notes)
        r.backend .forEach((d) => mergeDetection(backendTech, d))
        r.database.forEach((d) => mergeDetection(dbTech,      d))
        r.auth    .forEach((d) => mergeDetection(authMechs,   d))
        if (r.depInfo) dependencies.push(r.depInfo)

      } else if (filename === 'pom.xml') {
        const r = parsePomXml(fc.content, path)
        r.backend .forEach((d) => mergeDetection(backendTech, d))
        r.database.forEach((d) => mergeDetection(dbTech,      d))
        if (r.depInfo) dependencies.push(r.depInfo)

      } else if (!manifestFilenames.has(filename)) {
        // ── Pass 3: source file pattern scanning ────────────────────────────
        const ext = getExt(path)
        if (SOURCE_SCAN_EXTENSIONS.has(ext) || RE_GRAPHQL_FILE.test(path)) {
          const scan = scanSourceFile(path, fc.content)
          scan.apiPatterns  .forEach((d) => mergeDetection(apiPatterns, d))
          scan.databaseHints.forEach((d) => mergeDetection(dbTech,      d))
          scan.authHints    .forEach((d) => mergeDetection(authMechs,   d))
        }
      }
    }

    // Note if recommended manifests weren't available
    const fetchedPaths = new Set(fetchedContents.keys())
    for (const rec of RECOMMENDED_FETCH_PATHS) {
      if (!rec.endsWith('.md') && !rec.endsWith('.rst') && rec !== 'README') {
        const exists = flatFiles.some((f) => f.path === rec || f.name === rec)
        if (exists && !fetchedPaths.has(rec)) {
          notes.push(
            `${rec} exists in the repository but its content was not provided — content-based analysis skipped for this file.`,
          )
        }
      }
    }

    const analysis: RepositoryAnalysis = {
      meta: {
        analyzedAt: new Date().toISOString(),
        fileCount: flatFiles.length,
        truncated,
        analysisNotes: notes,
      },
      languages,
      frameworks,
      packageManagers: pkgManagers,
      frontendTechnologies: frontendTech,
      backendTechnologies: backendTech,
      databaseTechnologies: dbTech,
      authMechanisms: authMechs,
      apiPatterns,
      configFiles,
      entryPoints,
      majorServices,
      majorModules,
      dependencies,
    }

    return { ok: true, data: analysis }
  } catch (cause: unknown) {
    return {
      ok: false,
      error: {
        kind: 'analysis_failed',
        message: 'An unexpected error occurred during repository analysis.',
        cause,
      },
    }
  }
}
