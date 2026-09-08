import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// ---- Types ----
export interface Repo {
  id: number
  url: string
  owner: string
  name: string
  status: 'pending' | 'ingesting' | 'ready' | 'error'
  error_message?: string
  created_at: string
  updated_at: string
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  language?: string
  children?: FileNode[]
}

export interface LanguageStat {
  language: string
  files: number
  lines: number
  percentage: number
}

export interface ImportantFile {
  path: string
  reason: string
  category: string
}

export interface Dependency {
  ecosystem: string
  file: string
  packages: string[]
}

export interface RiskFlag {
  severity: string
  category: string
  message: string
  file?: string
}

export interface Analysis {
  repository_id: number
  file_tree?: FileNode
  language_stats?: { languages: LanguageStat[]; total_files: number }
  important_files?: ImportantFile[]
  dependencies?: Dependency[]
  readme_summary?: string
  architecture_summary?: string
  project_overview?: string
  tech_stack?: {
    languages: string[]
    frameworks: string[]
    databases: string[]
    testing: string[]
    devops: string[]
  }
  risk_flags?: RiskFlag[]
  created_at?: string
  updated_at?: string
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ChatSession {
  id: number
  repository_id: number
  created_at: string
  messages: ChatMessage[]
}

export interface ImpactedArea {
  file: string
  reason: string
  risk_level: string
}

export interface ChangeImpactResult {
  changed_files: string[]
  impacted_areas: ImpactedArea[]
  summary: string
  recommendations: string[]
}

// ---- Repo API ----
export const repoApi = {
  ingest: (url: string) => api.post<Repo>('/repos', { url }),
  list: () => api.get<Repo[]>('/repos'),
  get: (id: number) => api.get<Repo>(`/repos/${id}`),
  delete: (id: number) => api.delete(`/repos/${id}`),
}

// ---- Analysis API ----
export const analysisApi = {
  get: (repoId: number) => api.get<Analysis>(`/analysis/${repoId}`),
}

// ---- Chat API ----
export const chatApi = {
  createSession: (repoId: number) => api.post<ChatSession>(`/chat/sessions/${repoId}`),
  listSessions: (repoId: number) => api.get<ChatSession[]>(`/chat/sessions/${repoId}`),
  getSession: (repoId: number, sessionId: number) =>
    api.get<ChatSession>(`/chat/sessions/${repoId}/${sessionId}`),
  sendMessage: (repoId: number, sessionId: number, content: string) =>
    api.post<ChatMessage>(`/chat/sessions/${repoId}/${sessionId}/messages`, { content }),
}

// ---- Impact API ----
export const impactApi = {
  analyze: (repoId: number, changedFiles: string[], description?: string) =>
    api.post<ChangeImpactResult>('/impact', {
      repository_id: repoId,
      changed_files: changedFiles,
      description,
    }),
}
