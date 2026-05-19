import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promisify } from 'node:util'
import type pg from 'pg'

const execFile = promisify(execFileCallback)
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_ROOT = path.resolve(MODULE_DIR, '..')
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..')
const LEGACY_WORKSPACE_ROOT = '/var/lib/agent-cp/workspace'

export type WorkspaceMode = 'local' | 'git'

export interface AgentWorkspaceConfig {
  id: string
  mode: WorkspaceMode
  root_path: string
  remote_url?: string
  branch: string
  sync_status: string
  last_sync_at?: string
  last_commit?: string
  dirty: boolean
  created_at: string
  updated_at: string
}

export interface WorkspaceStatus extends AgentWorkspaceConfig {
  exists: boolean
  effective_root: string
  files: string[]
}

export interface WorkspaceFilePayload {
  path: string
  content: string
  version: string
  updated_at: string
}

export interface WorkspaceTemplateBundle {
  effectiveRoot: string
  revision?: string
  templates: Record<string, string>
  templatePaths: Record<string, string>
}

const DEFAULT_WORKSPACE_ROOT = process.env['ACP_AGENT_WORKSPACE']?.trim() || path.join(REPO_ROOT, '.agent-workspace')
const DEFAULT_BRANCH = 'main'
const WORKSPACE_FILE_DIRS = ['agents', 'prompts', 'skills', 'policies', 'memory', 'config'] as const
const EDITABLE_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.json'])
const TEMPLATE_PATHS = {
  primeProfile: 'agents/prime.md',
  standingRules: 'policies/standing-rules.md',
  system: 'prompts/prime/system.md',
  request: 'prompts/prime/request.md',
  llamacpp: 'prompts/prime/llamacpp.md',
  defaultAgentInstructions: 'prompts/agents/default-instructions.md',
  defaultAgentSoul: 'prompts/agents/default-soul.md',
  delegationTask: 'prompts/delegation/task.md',
} as const

const FALLBACK_TEMPLATE_ROOT = path.join(BACKEND_ROOT, 'prompts')

async function ensureWorkspaceConfigRow(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO agent_workspace_config (id, mode, root_path, branch, sync_status, dirty)
     VALUES ('default', 'local', $1, $2, 'uninitialized', false)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_WORKSPACE_ROOT, DEFAULT_BRANCH]
  )
}

export async function getWorkspaceConfig(pool: pg.Pool): Promise<AgentWorkspaceConfig> {
  await ensureWorkspaceConfigRow(pool)
  const { rows } = await pool.query<AgentWorkspaceConfig>(
    `SELECT * FROM agent_workspace_config WHERE id = 'default'`
  )
  return rows[0]
}

export async function updateWorkspaceConfig(
  pool: pg.Pool,
  patch: Partial<Pick<AgentWorkspaceConfig, 'mode' | 'root_path' | 'branch' | 'sync_status' | 'last_sync_at' | 'last_commit' | 'dirty'>> & {
    remote_url?: string | null
  }
): Promise<AgentWorkspaceConfig> {
  await ensureWorkspaceConfigRow(pool)

  const values: unknown[] = ['default']
  const sets: string[] = []
  const fields: Array<[keyof typeof patch, string, (value: unknown) => unknown]> = [
    ['mode', 'mode', (value) => value],
    ['root_path', 'root_path', (value) => normalizeWorkspaceRoot(typeof value === 'string' ? value : DEFAULT_WORKSPACE_ROOT)],
    ['remote_url', 'remote_url', (value) => value ?? null],
    ['branch', 'branch', (value) => value || DEFAULT_BRANCH],
    ['sync_status', 'sync_status', (value) => value || 'ready'],
    ['last_sync_at', 'last_sync_at', (value) => value ?? null],
    ['last_commit', 'last_commit', (value) => value ?? null],
    ['dirty', 'dirty', (value) => Boolean(value)],
  ]

  for (const [key, column, encode] of fields) {
    if (key in patch) {
      values.push(encode(patch[key]))
      sets.push(`${column} = $${values.length}`)
    }
  }

  if (sets.length === 0) {
    return getWorkspaceConfig(pool)
  }

  const { rows } = await pool.query<AgentWorkspaceConfig>(
    `UPDATE agent_workspace_config
     SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    values
  )
  return rows[0]
}

export async function ensureWorkspaceScaffold(pool: pg.Pool): Promise<WorkspaceStatus> {
  const config = await getWorkspaceConfig(pool)
  const effectiveRoot = await resolveUsableWorkspaceRoot(pool, config.root_path)

  if (config.mode === 'git' && config.remote_url?.trim()) {
    await syncGitWorkspace(effectiveRoot, config.remote_url.trim(), config.branch || DEFAULT_BRANCH)
  }

  for (const dir of WORKSPACE_FILE_DIRS) {
    await fs.mkdir(path.join(effectiveRoot, dir), { recursive: true })
  }

  await writeDefaultIfMissing(effectiveRoot, 'skills/.gitkeep', '')
  await writeDefaultIfMissing(effectiveRoot, 'memory/preferences.md', '# Preferences\n\n')
  await writeDefaultIfMissing(effectiveRoot, 'memory/decisions.md', '# Decisions\n\n')
  await writeDefaultIfMissing(effectiveRoot, 'config/routing.yaml', '# Prime routing overrides\n')
  await writeDefaultIfMissing(effectiveRoot, 'config/providers.yaml', await fs.readFile(path.join(FALLBACK_TEMPLATE_ROOT, 'config/providers.yaml'), 'utf8'))
  await writeDefaultIfMissing(effectiveRoot, 'policies/delegation.md', await fs.readFile(path.join(FALLBACK_TEMPLATE_ROOT, 'policies/delegation.md'), 'utf8'))
  await writeDefaultIfMissing(effectiveRoot, 'policies/approvals.md', await fs.readFile(path.join(FALLBACK_TEMPLATE_ROOT, 'policies/approvals.md'), 'utf8'))
  await writeDefaultIfMissing(effectiveRoot, 'skills/code-review.md', await fs.readFile(path.join(FALLBACK_TEMPLATE_ROOT, 'skills/code-review.md'), 'utf8'))
  await writeDefaultIfMissing(effectiveRoot, 'skills/deployment.md', await fs.readFile(path.join(FALLBACK_TEMPLATE_ROOT, 'skills/deployment.md'), 'utf8'))

  for (const [key, relativePath] of Object.entries(TEMPLATE_PATHS)) {
    const fallbackPath = path.join(FALLBACK_TEMPLATE_ROOT, keyToFallbackPath(key as keyof typeof TEMPLATE_PATHS))
    await writeDefaultIfMissing(effectiveRoot, relativePath, await fs.readFile(fallbackPath, 'utf8'))
  }

  const gitMeta = await readGitMetadata(effectiveRoot)
  const status = await updateWorkspaceConfig(pool, {
    root_path: effectiveRoot,
    sync_status: 'ready',
    last_commit: gitMeta.lastCommit,
    dirty: gitMeta.dirty,
  })
  return buildWorkspaceStatus(status, effectiveRoot, gitMeta.files, true)
}

export async function getWorkspaceStatus(pool: pg.Pool): Promise<WorkspaceStatus> {
  const config = await getWorkspaceConfig(pool)
  const effectiveRoot = await resolveUsableWorkspaceRoot(pool, config.root_path)
  const exists = await pathExists(effectiveRoot)
  if (!exists || (await listWorkspaceFilesFromRoot(effectiveRoot)).length === 0) {
    return ensureWorkspaceScaffold(pool)
  }

  const files = await listWorkspaceFilesFromRoot(effectiveRoot)
  const gitMeta = await readGitMetadata(effectiveRoot)
  const status = await updateWorkspaceConfig(pool, {
    root_path: effectiveRoot,
    last_commit: gitMeta.lastCommit,
    dirty: gitMeta.dirty,
    sync_status: 'ready',
  })
  return buildWorkspaceStatus(status, effectiveRoot, files, true)
}

export async function listWorkspaceFiles(pool: pg.Pool): Promise<string[]> {
  const status = await getWorkspaceStatus(pool)
  return status.files
}

export async function readWorkspaceFile(pool: pg.Pool, relativePath: string): Promise<WorkspaceFilePayload> {
  const status = await ensureWorkspaceScaffold(pool)
  const safePath = resolveWorkspacePath(status.effective_root, relativePath)
  const content = await fs.readFile(safePath, 'utf8')
  const fileStat = await fs.stat(safePath)
  return {
    path: relativePath,
    content,
    version: hashWorkspaceContent(content),
    updated_at: fileStat.mtime.toISOString(),
  }
}

export async function writeWorkspaceFile(
  pool: pg.Pool,
  relativePath: string,
  content: string,
  expectedVersion?: string
): Promise<WorkspaceFilePayload> {
  const status = await ensureWorkspaceScaffold(pool)
  const safePath = resolveWorkspacePath(status.effective_root, relativePath)
  const currentContent = await fs.readFile(safePath, 'utf8')
  const currentVersion = hashWorkspaceContent(currentContent)
  if (expectedVersion && expectedVersion !== currentVersion) {
    throw new WorkspaceVersionConflictError(relativePath)
  }
  await fs.mkdir(path.dirname(safePath), { recursive: true })
  await fs.writeFile(safePath, content, 'utf8')
  const fileStat = await fs.stat(safePath)
  const gitMeta = await readGitMetadata(status.effective_root)
  await updateWorkspaceConfig(pool, {
    dirty: gitMeta.dirty,
    last_commit: gitMeta.lastCommit,
    sync_status: 'ready',
  })
  return {
    path: relativePath,
    content,
    version: hashWorkspaceContent(content),
    updated_at: fileStat.mtime.toISOString(),
  }
}

export async function loadPrimeWorkspaceTemplates(pool: pg.Pool): Promise<WorkspaceTemplateBundle> {
  const status = await ensureWorkspaceScaffold(pool)
  const [primeProfile, standingRules, system, request, llamacpp, defaultAgentInstructions, defaultAgentSoul, delegationTask] = await Promise.all([
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.primeProfile, 'agents/prime.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.standingRules, 'policies/standing-rules.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.system, 'prime/system.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.request, 'prime/request.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.llamacpp, 'prime/llamacpp.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.defaultAgentInstructions, 'agents/default-instructions.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.defaultAgentSoul, 'agents/default-soul.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.delegationTask, 'delegation/task.md'),
  ])
  const gitMeta = await readGitMetadata(status.effective_root)
  return {
    effectiveRoot: status.effective_root,
    revision: gitMeta.lastCommit,
    templates: {
      primeProfile,
      standingRules,
      system,
      request,
      llamacpp,
      defaultAgentInstructions,
      defaultAgentSoul,
      delegationTask,
    },
    templatePaths: { ...TEMPLATE_PATHS },
  }
}

export async function loadWorkspaceTemplate(
  pool: pg.Pool,
  relativePath: string,
  fallbackPath: string
): Promise<string> {
  const status = await ensureWorkspaceScaffold(pool)
  return readWorkspaceOrFallback(status.effective_root, relativePath, fallbackPath)
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => values[key] ?? '')
}

export function normalizeWorkspaceRoot(rootPath: string): string {
  const trimmed = rootPath.trim()
  return path.resolve(trimmed || DEFAULT_WORKSPACE_ROOT)
}

async function resolveUsableWorkspaceRoot(pool: pg.Pool, configuredRoot: string): Promise<string> {
  const normalized = normalizeWorkspaceRoot(configuredRoot)
  try {
    await fs.mkdir(normalized, { recursive: true })
    return normalized
  } catch (error) {
    if (!shouldAutoFallbackWorkspaceRoot(normalized, error)) {
      throw error
    }

    const fallbackRoot = DEFAULT_WORKSPACE_ROOT
    await fs.mkdir(fallbackRoot, { recursive: true })
    await updateWorkspaceConfig(pool, {
      root_path: fallbackRoot,
      sync_status: 'ready',
    })
    return fallbackRoot
  }
}

function shouldAutoFallbackWorkspaceRoot(root: string, error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false
  const code = String((error as NodeJS.ErrnoException).code ?? '')
  if (code !== 'EACCES' && code !== 'EPERM') return false
  return root === LEGACY_WORKSPACE_ROOT || root.startsWith('/var/lib/agent-cp/')
}

function buildWorkspaceStatus(
  config: AgentWorkspaceConfig,
  effectiveRoot: string,
  files: string[],
  exists: boolean
): WorkspaceStatus {
  return {
    ...config,
    effective_root: effectiveRoot,
    exists,
    files,
  }
}

function keyToFallbackPath(key: keyof typeof TEMPLATE_PATHS): string {
  switch (key) {
    case 'primeProfile':
      return 'agents/prime.md'
    case 'standingRules':
      return 'policies/standing-rules.md'
    case 'system':
      return 'prime/system.md'
    case 'request':
      return 'prime/request.md'
    case 'llamacpp':
      return 'prime/llamacpp.md'
    case 'defaultAgentInstructions':
      return 'agents/default-instructions.md'
    case 'defaultAgentSoul':
      return 'agents/default-soul.md'
    case 'delegationTask':
      return 'delegation/task.md'
  }
}

async function readWorkspaceOrFallback(root: string, relativePath: string, fallbackPath: string): Promise<string> {
  const workspacePath = path.join(root, relativePath)
  if (await pathExists(workspacePath)) {
    return fs.readFile(workspacePath, 'utf8')
  }
  return fs.readFile(path.join(FALLBACK_TEMPLATE_ROOT, fallbackPath), 'utf8')
}

async function writeDefaultIfMissing(root: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, relativePath)
  if (await pathExists(target)) return
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function listWorkspaceFilesFromRoot(root: string): Promise<string[]> {
  const files: string[] = []
  for (const dir of WORKSPACE_FILE_DIRS) {
    const base = path.join(root, dir)
    if (!await pathExists(base)) continue
    const entries = await fs.readdir(base, { withFileTypes: true })
    await walkEntries(root, base, entries, files)
  }
  return files.sort()
}

async function walkEntries(
  root: string,
  currentDir: string,
  entries: Array<{ isDirectory(): boolean; isFile(): boolean; name: string }>,
  files: string[]
): Promise<void> {
  for (const entry of entries) {
    const absolute = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      const nested = await fs.readdir(absolute, { withFileTypes: true })
      await walkEntries(root, absolute, nested, files)
      continue
    }
    if (!entry.isFile()) continue
    if (!EDITABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !entry.name.endsWith('.gitkeep')) continue
    files.push(path.relative(root, absolute).replaceAll(path.sep, '/'))
  }
}

function resolveWorkspacePath(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, '')
  const absolute = path.resolve(root, normalized)
  if (!absolute.startsWith(root)) {
    throw new Error('workspace path escapes root')
  }
  return absolute
}

function hashWorkspaceContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export class WorkspaceVersionConflictError extends Error {
  constructor(relativePath: string) {
    super(`workspace file has changed since it was opened: ${relativePath}`)
    this.name = 'WorkspaceVersionConflictError'
  }
}

async function readGitMetadata(root: string): Promise<{ dirty: boolean; lastCommit?: string; files: string[] }> {
  try {
    const [{ stdout: commitStdout }, { stdout: statusStdout }] = await Promise.all([
      execFile('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 2000 }),
      execFile('git', ['-C', root, 'status', '--porcelain'], { timeout: 2000 }),
    ])
    return {
      dirty: statusStdout.trim().length > 0,
      lastCommit: commitStdout.trim() || undefined,
      files: await listWorkspaceFilesFromRoot(root),
    }
  } catch {
    return {
      dirty: false,
      files: await listWorkspaceFilesFromRoot(root),
    }
  }
}

async function syncGitWorkspace(root: string, remoteUrl: string, branch: string): Promise<void> {
  const parentDir = path.dirname(root)
  await fs.mkdir(parentDir, { recursive: true })
  const gitDir = path.join(root, '.git')

  if (!await pathExists(gitDir)) {
    if (await pathExists(root)) {
      const entries = await fs.readdir(root)
      if (entries.length > 0) {
        throw new Error(`workspace root ${root} exists and is not a git checkout`)
      }
    }
    await execFile('git', ['clone', '--branch', branch, remoteUrl, root], { timeout: 15000 })
    return
  }

  await execFile('git', ['-C', root, 'fetch', '--all', '--prune'], { timeout: 15000 })
  await execFile('git', ['-C', root, 'checkout', branch], { timeout: 10000 })
  await execFile('git', ['-C', root, 'pull', '--ff-only', 'origin', branch], { timeout: 15000 })
}
