/** Module-level store of install jobs, shared by the modal and the toast. */

import { useEffect, useState } from 'react'
import { cancelInstall, pollInstall, startInstall } from './api.ts'

export type InstallStatus = 'running' | 'done' | 'error' | 'canceled'

export interface InstallJob {
  readonly id: string
  readonly name: string
  readonly source: string
  /** Install kind routing the node half ('plugin' | 'skill' | 'preset' | 'script'). */
  readonly type: string
  readonly status: InstallStatus
  readonly output: string
  readonly startedAt: number
  readonly backgrounded: boolean
}

const jobs = new Map<string, InstallJob>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function patch(id: string, update: Partial<InstallJob>): void {
  const current = jobs.get(id)
  if (current === undefined) return
  jobs.set(id, { ...current, ...update })
  notify()
}

/** Subscribe to any store change. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Current jobs (a fresh array per call; hooks re-render via subscribe). */
export function getJobs(): readonly InstallJob[] {
  return [...jobs.values()]
}

/** React hook: the live list of install jobs. */
export function useInstallJobs(): readonly InstallJob[] {
  const [snapshot, setSnapshot] = useState<readonly InstallJob[]>(() => getJobs())
  useEffect(() => subscribe(() => { setSnapshot(getJobs()) }), [])
  return snapshot
}

async function poll(id: string): Promise<void> {
  for (;;) {
    const current = jobs.get(id)
    if (current === undefined || current.status === 'canceled') return
    try {
      const state = await pollInstall(id)
      const after = jobs.get(id)
      if (after === undefined || after.status === 'canceled') return
      const status: InstallStatus =
        state.status === 'done' ? 'done'
          : state.status === 'error' ? 'error'
            : state.status === 'canceled' ? 'canceled'
              : 'running'
      patch(id, { status, output: state.output })
      if (state.status !== 'running') return
    } catch (error) {
      patch(id, { status: 'error', output: error instanceof Error ? error.message : String(error) })
      return
    }
    await new Promise(resolve => window.setTimeout(resolve, 600))
  }
}

/** Start an install and return its job id (synthetic on a failed start). */
export async function beginInstall(name: string, source: string, type = 'plugin'): Promise<string> {
  let id: string
  try {
    id = await startInstall(source, type)
  } catch (error) {
    id = `error-${Date.now().toString(36)}`
    jobs.set(id, {
      id, name, source, type, status: 'error', backgrounded: false, startedAt: Date.now(),
      output: error instanceof Error ? error.message : String(error),
    })
    notify()
    return id
  }
  jobs.set(id, { id, name, source, type, status: 'running', output: '', backgrounded: false, startedAt: Date.now() })
  notify()
  void poll(id)
  return id
}

/** Move a job to the background (dismiss the modal, keep the toast). */
export function backgroundJob(id: string): void {
  patch(id, { backgrounded: true })
}

/** Cancel a running job (kills the underlying `pnpm add`). */
export async function cancelJob(id: string): Promise<void> {
  patch(id, { status: 'canceled' })
  try {
    await cancelInstall(id)
  } catch {
    // Local state already reads canceled; the server may have already finished.
  }
}

/** Remove a job from the store (toast dismissed or modal closed after finish). */
export function dismissJob(id: string): void {
  jobs.delete(id)
  notify()
}

let spinInjected = false
/** Inject the spinner keyframes once, for the loading glyph animation. */
export function ensureSpinKeyframe(): void {
  if (spinInjected || typeof document === 'undefined') return
  spinInjected = true
  const style = document.createElement('style')
  style.textContent = '@keyframes dsh-market-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'
  document.head.appendChild(style)
}
