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
import { readFileSync, writeFileSync } from 'node:fs'
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

interface InstallJob {
  status: 'running' | 'done' | 'error' | 'canceled'
  output: string
  exitCode: number | null
  joined: string[]
  child?: ChildProcess
}

const jobs = new Map<string, InstallJob>()

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
            let parsed: { source?: string }
            try {
              parsed = JSON.parse(body) as { source?: string }
            } catch {
              json(400, { ok: false, message: 'invalid JSON body' })
              return
            }
            const source = (parsed.source ?? '').trim()
            if (source.length === 0) {
              json(400, { ok: false, message: 'install needs a source' })
              return
            }

            const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
            const job: InstallJob = { status: 'running', output: '', exitCode: null, joined: [] }
            jobs.set(jobId, job)

            const child = spawn('pnpm', ['add', source], {
              cwd: profileWebDir(),
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
              if (code === 0) {
                try {
                  job.joined = reconcileBundles()
                } catch (error) {
                  job.output += `\nreconcile failed: ${error instanceof Error ? error.message : String(error)}`
                }
                job.status = 'done'
              } else {
                job.status = 'error'
                if (/^git\+|^github:|\.git(?:#|$)/.test(source)) {
                  job.output += '\nIf pnpm blocked a build script, add the printed key to allowBuilds in the profile pnpm-workspace.yaml, then retry.'
                }
              }
            })
            json(202, { ok: true, jobId })
          })
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
