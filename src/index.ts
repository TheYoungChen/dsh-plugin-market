/**
 * Plugin market bundle, node half. A same-origin HTTP route the browser panel
 * calls to install a plugin: it mirrors the official `dsh plugin` pnpm-forwarder
 * (run `pnpm add <source>` in the web profile, then reconcile
 * `dsh.profile.bundles` for dependencies that declare `dsh.bundle`).
 *
 * Progress is streamed through a polling job: POST /install starts the async
 * `pnpm add` and returns a job id; GET /job/<id> returns the accumulated
 * stdout/stderr and status. No official remote namespace is required — the
 * panel fetches this route directly, like dsh-external/plugin-console.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

/** `$DSH_HOME`, falling back to the platform home's `.dsh`. */
function dshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  if (env !== undefined && env !== '') return env
  return join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.dsh')
}

/** The web profile directory (the running `dsh web` profile). */
function profileWebDir(): string {
  return join(dshHome(), 'profiles', 'web')
}

function readProfileManifest(): ProfileManifest {
  try {
    return JSON.parse(readFileSync(join(profileWebDir(), 'package.json'), 'utf8')) as ProfileManifest
  } catch {
    return {}
  }
}

function writeProfileManifest(manifest: ProfileManifest): void {
  writeFileSync(join(profileWebDir(), 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
}

/** Whether an installed package contributes a profile layer (`dsh.bundle`). */
function declaresBundle(packageName: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(
      join(profileWebDir(), 'node_modules', packageName, 'package.json'),
      'utf8',
    )) as { dsh?: { bundle?: { patch?: unknown } } }
    return manifest.dsh?.bundle?.patch !== undefined
  } catch {
    return false
  }
}

/** Append `dsh.bundle` dependencies to the profile layer stack. */
function reconcileBundles(): string[] {
  const manifest = readProfileManifest()
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const joined: string[] = []
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (declaresBundle(name) && !bundles.includes(name)) {
      bundles.push(name)
      joined.push(name)
    }
  }
  if (joined.length === 0) return []
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  writeProfileManifest(manifest)
  return joined
}

interface InstalledPlugin {
  name: string
  version: string
  /** Normalized `owner/repo`, when the package declares a GitHub repository. */
  repo?: string
  /** True when declared in the profile but not resolvable in node_modules. */
  broken: boolean
}

/** Normalize a package `repository` field to `owner/repo`, if it is GitHub. */
function normalizeRepo(repository: unknown): string | undefined {
  if (repository === null || repository === undefined) return undefined
  if (typeof repository === 'object') {
    return normalizeRepo((repository as { url?: unknown }).url)
  }
  if (typeof repository !== 'string') return undefined
  const value = repository.trim()
  const https = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(value)
  if (https !== null) return `${https[1]}/${https[2]}`.toLowerCase()
  const shorthand = /^github:([\w.-]+)\/([\w.-]+)$/i.exec(value)
  if (shorthand !== null) return `${shorthand[1]}/${shorthand[2]}`.toLowerCase()
  return undefined
}

/** Enumerate the plugins installed in the web profile (top-level deps only). */
function listInstalledPlugins(): InstalledPlugin[] {
  const manifest = readProfileManifest()
  const result: InstalledPlugin[] = []
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const spec = manifest.dependencies?.[name] ?? ''
    try {
      const pkg = JSON.parse(readFileSync(
        join(profileWebDir(), 'node_modules', name, 'package.json'),
        'utf8',
      )) as { name?: string; version?: string; repository?: unknown }
      result.push({
        name: pkg.name ?? name,
        version: pkg.version ?? '',
        repo: normalizeRepo(pkg.repository),
        broken: false,
      })
    } catch {
      // Declared in the manifest but not resolvable: a broken install that
      // would fail dsh boot. Derive the repo from the github: spec when we can.
      const githubSpec = /^github:([^/]+\/[^/]+)$/.exec(spec)
      result.push({
        name,
        version: '',
        repo: githubSpec !== null ? githubSpec[1]!.toLowerCase() : undefined,
        broken: true,
      })
    }
  }
  return result
}

/** Remove a dependency (and its bundle entry) from the web profile manifest. */
function cleanupPlugin(name: string): string[] {
  const manifest = readProfileManifest()
  const deps = { ...(manifest.dependencies ?? {}) }
  delete deps[name]
  manifest.dependencies = deps
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  const without = bundles.filter(bundle => bundle !== name)
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: without } }
  writeProfileManifest(manifest)
  return bundles.length === without.length ? [] : [name]
}

/** Remove an installed plugin: profile dependency/bundle + on-disk artifacts. */
function uninstallPlugin(name: string, type: string, repoName: string): string {
  if (name === 'dsh-plugin-market') return 'refusing to uninstall the market itself'
  const manifest = readProfileManifest()
  const deps = { ...(manifest.dependencies ?? {}) }
  delete deps[name]
  manifest.dependencies = deps
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: bundles.filter(bundle => bundle !== name) } }
  writeProfileManifest(manifest)
  try {
    rmSync(join(profileWebDir(), 'node_modules', name), { recursive: true, force: true })
  } catch {
    // Best effort; the manifest is already clean.
  }
  const target = type === 'skill'
    ? join(dshHome(), 'skills', repoName)
    : type === 'preset'
      ? join(dshHome(), '.agent-presets', repoName)
      : type === 'script'
        ? join(dshHome(), 'marketplace', 'cache', repoName)
        : null
  if (target !== null) {
    try {
      rmSync(target, { recursive: true, force: true })
    } catch {
      // Best effort.
    }
  }
  return ''
}

interface InstallJob {
  status: 'running' | 'done' | 'error' | 'canceled'
  output: string
  exitCode: number | null
  joined: string[]
  child?: ChildProcess
}

const jobs = new Map<string, InstallJob>()

/** Run install steps sequentially, streaming each process into the job. */
function runSteps(job: InstallJob, steps: Array<{ argv: string[]; cwd: string }>, index: number): void {
  if (index >= steps.length) {
    try {
      job.joined = reconcileBundles()
    } catch (error) {
      job.output += `\nreconcile failed: ${error instanceof Error ? error.message : String(error)}`
    }
    job.status = 'done'
    return
  }
  const step = steps[index]!
  const child = spawn(step.argv[0]!, step.argv.slice(1), {
    cwd: step.cwd,
    shell: process.platform === 'win32',
  })
  job.child = child
  child.stdout?.on('data', (chunk: Buffer) => { job.output += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { job.output += chunk.toString('utf8') })
  child.on('error', (error: Error) => {
    job.status = 'error'
    job.output += `\n${error.message}`
  })
  child.on('close', (code: number | null) => {
    if (job.status === 'canceled') return
    job.exitCode = code
    if (code !== 0) {
      job.status = 'error'
      if (index === 0 && step.argv[0] === 'pnpm') {
        job.output += '\nIf pnpm blocked a build script, add the printed key to allowBuilds in the profile pnpm-workspace.yaml, then retry.'
      }
      return
    }
    runSteps(job, steps, index + 1)
  })
}

/** Minimal structural types for the webserver route surface. */
interface MarketRequest {
  url?: string
  method?: string
  on(event: 'data', cb: (chunk: Buffer) => void): void
  on(event: 'end', cb: () => void): void
}

interface MarketResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

interface WebServerLike {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (req: MarketRequest, res: MarketResponse) => void
  }): () => void
}

/** Services required by the install route. */
export const inject = ['webServer']

/**
 * Register the `/api/plugin-market` route.
 * @param ctx - Cordis context carrying the web server.
 * @returns disposer unregistered by the effect when the plugin disposes.
 */
export function apply(ctx: Context): void {
  const webServer = (ctx as Context & { webServer?: WebServerLike }).webServer
  if (webServer === undefined) return

  ctx.effect(() => {
    const disposeRoutes = webServer.register({
      kind: 'prefix',
      path: '/api/plugin-market',
      handler: (req, res) => {
        const json = (status: number, body: unknown): void => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }
        const method = req.method ?? 'GET'
        const path = (req.url ?? '/').split('?')[0] ?? '/'

        if (method === 'POST' && (path === '/api/plugin-market/install' || path === '/api/plugin-market/install/')) {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
          req.on('end', () => {
            let parsed: { source?: string; type?: string }
            try {
              parsed = JSON.parse(body) as { source?: string; type?: string }
            } catch {
              json(400, { ok: false, message: 'invalid JSON body' })
              return
            }
            const source = (parsed.source ?? '').trim()
            if (source.length === 0) {
              json(400, { ok: false, message: 'install needs a source' })
              return
            }
            const type = parsed.type === 'skill' || parsed.type === 'preset' || parsed.type === 'script'
              ? parsed.type
              : 'plugin'

            const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
            const job: InstallJob = { status: 'running', output: '', exitCode: null, joined: [] }
            jobs.set(jobId, job)

            const fullName = source.replace(/^github:/, '')
            const repoName = fullName.split('/')[1] ?? fullName
            const cloneUrl = `https://github.com/${fullName}.git`

            const steps: Array<{ argv: string[]; cwd: string }> = []
            if (type === 'skill') {
              const skillsDir = join(dshHome(), 'skills')
              mkdirSync(skillsDir, { recursive: true })
              steps.push({ argv: ['git', 'clone', '--depth', '1', cloneUrl, join(skillsDir, repoName)], cwd: dshHome() })
            } else if (type === 'preset') {
              const presetsDir = join(dshHome(), '.agent-presets')
              mkdirSync(presetsDir, { recursive: true })
              steps.push({ argv: ['git', 'clone', '--depth', '1', cloneUrl, join(presetsDir, repoName)], cwd: dshHome() })
            } else if (type === 'script') {
              const cacheDir = join(dshHome(), 'marketplace', 'cache')
              mkdirSync(cacheDir, { recursive: true })
              steps.push({ argv: ['git', 'clone', '--depth', '1', cloneUrl, join(cacheDir, repoName)], cwd: dshHome() })
              const script = process.platform === 'win32' ? 'install.ps1' : 'install.sh'
              steps.push({
                argv: process.platform === 'win32'
                  ? ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(cacheDir, repoName, script)]
                  : ['bash', join(cacheDir, repoName, script)],
                cwd: join(cacheDir, repoName),
              })
            } else {
              steps.push({ argv: ['pnpm', 'add', source], cwd: profileWebDir() })
            }

            runSteps(job, steps, 0)
            json(202, { ok: true, jobId })
          })
          return
        }

        if (method === 'POST' && (path === '/api/plugin-market/cleanup' || path === '/api/plugin-market/cleanup/')) {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
          req.on('end', () => {
            let parsed: { name?: string }
            try {
              parsed = JSON.parse(body) as { name?: string }
            } catch {
              json(400, { ok: false, message: 'invalid JSON body' })
              return
            }
            const name = (parsed.name ?? '').trim()
            if (name.length === 0) {
              json(400, { ok: false, message: 'cleanup needs a name' })
              return
            }
            const bundlesRemoved = cleanupPlugin(name)
            json(200, { ok: true, bundlesRemoved })
          })
          return
        }

        if (method === 'POST' && (path === '/api/plugin-market/uninstall' || path === '/api/plugin-market/uninstall/')) {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
          req.on('end', () => {
            let parsed: { name?: string; type?: string; repoName?: string }
            try {
              parsed = JSON.parse(body) as { name?: string; type?: string; repoName?: string }
            } catch {
              json(400, { ok: false, message: 'invalid JSON body' })
              return
            }
            const name = (parsed.name ?? '').trim()
            if (name.length === 0) {
              json(400, { ok: false, message: 'uninstall needs a name' })
              return
            }
            const message = uninstallPlugin(name, parsed.type === 'skill' || parsed.type === 'preset' || parsed.type === 'script' ? parsed.type : 'plugin', parsed.repoName ?? '')
            if (message.length > 0) {
              json(400, { ok: false, message })
              return
            }
            json(200, { ok: true })
          })
          return
        }

        if (method === 'GET' && (path === '/api/plugin-market/installed' || path === '/api/plugin-market/installed/')) {
          json(200, { ok: true, plugins: listInstalledPlugins(), bundles: readProfileManifest().dsh?.profile?.bundles ?? [] })
          return
        }

        const cancelMatch = /^\/api\/plugin-market\/job\/([^/]+)\/cancel$/.exec(path)
        if (method === 'POST' && cancelMatch !== null) {
          const job = jobs.get(decodeURIComponent(cancelMatch[1]!))
          if (job === undefined) {
            json(404, { ok: false, message: 'unknown job' })
            return
          }
          job.status = 'canceled'
          if (job.child !== undefined) {
            if (process.platform === 'win32' && job.child.pid !== undefined) {
              try {
                spawn('taskkill', ['/pid', String(job.child.pid), '/T', '/F'], { stdio: 'ignore' })
              } catch {
                job.child.kill()
              }
            } else {
              job.child.kill()
            }
          }
          json(200, { ok: true })
          return
        }

        const jobMatch = /^\/api\/plugin-market\/job\/([^/]+)$/.exec(path)
        if (method === 'GET' && jobMatch !== null) {
          const job = jobs.get(decodeURIComponent(jobMatch[1]!))
          if (job === undefined) {
            json(404, { ok: false, message: 'unknown job' })
            return
          }
          json(200, { ok: true, status: job.status, output: job.output, exitCode: job.exitCode, joined: job.joined })
          return
        }

        json(404, { ok: false, message: 'not found' })
      },
    })

    return () => { disposeRoutes() }
  }, 'plugin-market: install route')
}
