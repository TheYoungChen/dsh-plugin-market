/** Same-origin install API backed by the bundle's node-half route. */

/** One polled install job state. */
export interface InstallJobState {
  status: 'running' | 'done' | 'error' | 'canceled'
  output: string
  exitCode: number | null
  joined: string[]
}

/**
 * Start installing one source (`github:owner/repo`).
 * @param source - the pnpm install spec.
 * @param type - the detected install kind; routes the node half.
 * @returns the job id to poll.
 */
export async function startInstall(source: string, type = 'plugin'): Promise<string> {
  const response = await fetch('/api/plugin-market/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, type }),
  })
  const payload = (await response.json()) as { ok?: boolean; jobId?: string; message?: string }
  if (!response.ok || payload.ok !== true || payload.jobId === undefined) {
    throw new Error(payload.message ?? `install failed: ${response.status}`)
  }
  return payload.jobId
}

/** Poll one install job for progress. */
export async function pollInstall(jobId: string): Promise<InstallJobState> {
  const response = await fetch(`/api/plugin-market/job/${encodeURIComponent(jobId)}`)
  const payload = (await response.json()) as { ok?: boolean; message?: string } & InstallJobState
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? `job poll failed: ${response.status}`)
  }
  return payload
}

/** Cancel a running install job (kills the underlying `pnpm add`). */
export async function cancelInstall(jobId: string): Promise<void> {
  const response = await fetch(`/api/plugin-market/job/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  })
  const payload = (await response.json()) as { ok?: boolean; message?: string }
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? `cancel failed: ${response.status}`)
  }
}

/** One plugin already installed in the web profile. */
export interface InstalledPlugin {
  name: string
  version: string
  /** Normalized `owner/repo`, when the package declares a GitHub repository. */
  repo?: string
  /** True when declared in the profile but not resolvable in node_modules. */
  broken: boolean
}

/** The profile's installed plugins plus its full bundle layer stack. */
export interface InstalledReport {
  plugins: InstalledPlugin[]
  bundles: string[]
}

let installedCache: { at: number; value: InstalledReport } | null = null
const INSTALLED_TTL = 30_000

/**
 * List the plugins installed in the web profile, cached for 30s so reopening
 * the market does not re-request it. Pass `force` after any install/cleanup.
 */
export async function fetchInstalled(force = false): Promise<InstalledReport> {
  if (!force && installedCache !== null && Date.now() - installedCache.at < INSTALLED_TTL) {
    return installedCache.value
  }
  const response = await fetch('/api/plugin-market/installed')
  const payload = (await response.json()) as {
    ok?: boolean
    plugins?: InstalledPlugin[]
    bundles?: string[]
    message?: string
  }
  if (!response.ok || payload.ok !== true || payload.plugins === undefined) {
    throw new Error(payload.message ?? `installed fetch failed: ${response.status}`)
  }
  const value: InstalledReport = { plugins: payload.plugins, bundles: payload.bundles ?? [] }
  installedCache = { at: Date.now(), value }
  return value
}

/** Remove a broken dependency (and its bundle entry) from the web profile. */
export async function cleanupInstall(name: string): Promise<void> {
  const response = await fetch('/api/plugin-market/cleanup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const payload = (await response.json()) as { ok?: boolean; message?: string }
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? `cleanup failed: ${response.status}`)
  }
}

/** Uninstall a plugin: profile dependency/bundle + on-disk files. */
export async function uninstallInstall(name: string, type: string, repoName: string): Promise<void> {
  const response = await fetch('/api/plugin-market/uninstall', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, type, repoName }),
  })
  const payload = (await response.json()) as { ok?: boolean; message?: string }
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? `uninstall failed: ${response.status}`)
  }
}
