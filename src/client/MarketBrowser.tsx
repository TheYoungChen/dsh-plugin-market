/** Shared market browser: search + paginated list + install flow. */

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { IconLoadingOutline16, IconRightUpOutline16, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { fetchLatestVersion, fetchMarketPage, invalidateRegistry, type MarketPlugin, type PluginType } from './github.ts'
import { fetchInstalled, type InstalledPlugin } from './api.ts'
import {
  backgroundJob, beginInstall, cancelJob, dismissJob, ensureSpinKeyframe,
  useInstallJobs, type InstallJob,
} from './installStore.ts'

/** Repositories fetched per page. */
const PER_PAGE = 20
/** The profile the install targets; the web surface boots as `web`. */
const DEFAULT_PROFILE = 'web'
/** Official guide for authoring and publishing a plugin. */
const GUIDE_URL = 'https://github.com/deepseek-ai/deepseek-harness'

type MarketT = PropsLocale<'pluginMarket'>['t']

interface MarketBrowserProps {
  readonly t: MarketT
}

type View =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly plugins: MarketPlugin[]; readonly totalCount: number; readonly page: number }

/** Ticking elapsed-seconds display for a live install. */
function useElapsed(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [active])
  return Math.max(0, Math.floor((now - startedAt) / 1000))
}

/* ---- list chrome ---- */
const searchStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '6px 9px',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, color: 'var(--dsw-alias-label-tertiary)',
}
const searchInputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'var(--dsw-alias-label-primary)',
  fontSize: 13, outline: 'none', fontFamily: 'inherit',
}
const bodyStyle: React.CSSProperties = {
  flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px',
}
const statusTextStyle: React.CSSProperties = {
  padding: '12px 0', margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '18px',
}
const cardsStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0, listStyle: 'none',
}
const cardStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
  border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12,
  background: 'var(--dsw-alias-bg-base)',
}
const cardBodyStyle: React.CSSProperties = { flex: 1, minWidth: 0 }
const cardNameStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)', textDecoration: 'none', overflowWrap: 'anywhere',
}
const cardNameTextStyle: React.CSSProperties = { overflowWrap: 'anywhere' }
const cardDescStyle: React.CSSProperties = {
  margin: '5px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)',
  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
}
const cardTrailingStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0,
}
const starsStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12,
  color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
}
const starGlyphStyle: React.CSSProperties = { color: '#e3b341', fontSize: 13, lineHeight: 1 }
const installButtonStyle: React.CSSProperties = {
  padding: '5px 12px', border: 0, borderRadius: 8,
  background: 'var(--dsw-alias-action-primary, #4c8dff)', color: '#fff', fontSize: 13, cursor: 'pointer',
}
const installedButtonStyle: React.CSSProperties = {
  padding: '5px 12px', border: 0, borderRadius: 8,
  background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13, cursor: 'default',
}
const installedTagStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
  borderRadius: 999, fontSize: 11, lineHeight: '16px',
  background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)',
  whiteSpace: 'nowrap',
}
const typeBadgeStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', marginLeft: 8, padding: '1px 7px',
  borderRadius: 999, fontSize: 11, lineHeight: '16px',
  border: '1px solid currentColor', background: 'transparent', whiteSpace: 'nowrap',
}
const typeBadgeColors: Record<Exclude<PluginType, 'other'>, string> = {
  plugin: 'var(--dsw-alias-state-business-primary, #4c8dff)',
  skill: 'var(--dsw-alias-state-success-primary, #2f9e6e)',
  preset: '#8b5cf6',
  script: 'var(--dsw-alias-state-warning-primary, #d97706)',
}
const paginationStyle: React.CSSProperties = {
  flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
  padding: '10px 14px', borderTop: '1px solid var(--dsw-alias-border-l2)',
}
const pageButtonStyle: React.CSSProperties = {
  padding: '5px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
  background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 13, cursor: 'pointer',
}
const pageIndicatorStyle: React.CSSProperties = {
  fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums',
}
const countStyle: React.CSSProperties = {
  margin: '0 0 8px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums',
}
const guideStyle: React.CSSProperties = {
  flexShrink: 0, fontSize: 13, color: 'var(--dsw-alias-state-business-primary, #4c8dff)',
  textDecoration: 'none', whiteSpace: 'nowrap',
}

/* ---- install confirm / progress dialogs ---- */
const dialogBackdropStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)',
}
const dialogStyle: React.CSSProperties = {
  width: 'min(520px, calc(100vw - 32px))', padding: 16,
  border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12,
  background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
  boxShadow: 'var(--dsw-shadow-lv2)',
}
const dialogTitleStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 14 }
const dialogBodyStyle: React.CSSProperties = {
  margin: '0 0 8px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere',
}
const commandStyle: React.CSSProperties = {
  display: 'block', padding: '8px 10px', marginBottom: 12, overflowX: 'auto',
  borderRadius: 6, background: 'rgba(0,0,0,0.3)', fontSize: 12, whiteSpace: 'nowrap',
}
const outputStyle: React.CSSProperties = {
  display: 'block', padding: '8px 10px', margin: '8px 0', maxHeight: 220, overflowY: 'auto',
  borderRadius: 6, background: 'rgba(0,0,0,0.3)', fontSize: 11, whiteSpace: 'pre-wrap',
  fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word',
}
const runningStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px', fontSize: 13,
  color: 'var(--dsw-alias-label-secondary)',
}
const spinStyle: React.CSSProperties = { display: 'inline-flex', animation: 'dsh-market-spin 1s linear infinite' }
const outputLabelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }
const actionsStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 }
const actionButtonStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6,
  background: 'transparent', color: 'inherit', fontSize: 12, cursor: 'pointer', textDecoration: 'none',
}
const dangerButtonStyle: React.CSSProperties = { ...actionButtonStyle, color: 'var(--dsw-alias-state-error-primary)' }
const primaryButtonStyle: React.CSSProperties = {
  ...actionButtonStyle, borderColor: 'transparent',
  background: 'var(--dsw-alias-action-primary, #4c8dff)', color: '#fff',
}
const errorTextStyle: React.CSSProperties = {
  margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)',
}
const successTextStyle: React.CSSProperties = {
  margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-success-primary)',
}

/** Compare two version strings, ignoring a leading `v`. */
function versionDiffers(a: string, b: string): boolean {
  const norm = (value: string): string => value.replace(/^v/, '')
  return norm(a) !== norm(b)
}

/** Install-kind label for the type badge. */
function typeLabel(type: PluginType | undefined, t: MarketT): string | null {
  switch (type) {
    case 'plugin': return t('type.plugin')
    case 'skill': return t('type.skill')
    case 'preset': return t('type.preset')
    case 'script': return t('type.script')
    default: return null
  }
}

/** Confirm-dialog body key for an install kind. */
function confirmBodyKey(type: PluginType | undefined): 'confirm.body.plugin' | 'confirm.body.skill' | 'confirm.body.preset' | 'confirm.body.script' {
  return type === 'skill' ? 'confirm.body.skill'
    : type === 'preset' ? 'confirm.body.preset'
      : type === 'script' ? 'confirm.body.script'
        : 'confirm.body.plugin'
}

/** User-facing command for the confirm dialog, per install kind. */
function confirmCommand(plugin: MarketPlugin, profile: string): string {
  const repo = plugin.fullName
  switch (plugin.type ?? 'plugin') {
    case 'skill': return `git clone --depth 1 https://github.com/${repo}.git ~/.dsh/skills/${plugin.name}`
    case 'preset': return `git clone --depth 1 https://github.com/${repo}.git ~/.dsh/.agent-presets/${plugin.name}`
    case 'script': return `git clone --depth 1 https://github.com/${repo}.git && 运行仓库内 install 脚本`
    default: return `dsh plugin --profile ${profile} add github:${repo}`
  }
}

/** Actual command shown on the live install dialog, per install kind. */
function installCommand(job: InstallJob, profile: string): string {
  const fullName = job.source.replace(/^github:/, '')
  switch (job.type) {
    case 'skill': return `git clone --depth 1 https://github.com/${fullName}.git ~/.dsh/skills/${job.name}`
    case 'preset': return `git clone --depth 1 https://github.com/${fullName}.git ~/.dsh/.agent-presets/${job.name}`
    case 'script': return `git clone --depth 1 https://github.com/${fullName}.git && 运行仓库内 install 脚本`
    default: return `pnpm add ${job.source}`
  }
}

/** The market list, shared by the sidebar modal and the Settings tab. */
export function MarketBrowser({ t }: MarketBrowserProps): ReactNode {
  const [view, setView] = useState<View>({ status: 'idle' })
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState<MarketPlugin | null>(null)
  const [foregroundId, setForegroundId] = useState<string | null>(null)
  const jobs = useInstallJobs()
  const [installed, setInstalled] = useState<readonly InstalledPlugin[]>([])
  const [latestVersions, setLatestVersions] = useState<Record<string, string>>({})
  const refreshedDone = useRef(new Set<string>())

  useEffect(() => { ensureSpinKeyframe() }, [])
  useEffect(() => {
    void fetchInstalled().then(setInstalled, () => {})
  }, [])
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === 'done' && !refreshedDone.current.has(job.id)) {
        refreshedDone.current.add(job.id)
        void fetchInstalled().then(setInstalled, () => {})
      }
    }
  }, [jobs])

  useEffect(() => {
    for (const item of installed) {
      const repo = item.repo
      if (repo === undefined) continue
      void fetchLatestVersion(repo).then(version => {
        if (version !== undefined) {
          setLatestVersions(prev => (prev[repo] === version ? prev : { ...prev, [repo]: version }))
        }
      }, () => {})
    }
  }, [installed])

  const foreground = jobs.find(job => job.id === foregroundId) ?? null
  const elapsed = useElapsed(foreground?.startedAt ?? Date.now(), foreground?.status === 'running')

  const load = (page: number, search: string): void => {
    setView({ status: 'loading' })
    void fetchMarketPage(page, PER_PAGE, search).then(
      result => setView({ status: 'ready', plugins: result.items, totalCount: result.totalCount, page }),
      (error: unknown) => setView({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  useEffect(() => {
    if (view.status !== 'idle') return
    load(1, '')
  }, [view.status])

  useEffect(() => {
    const timer = window.setTimeout(() => { load(1, query.trim()) }, 400)
    return () => { window.clearTimeout(timer) }
  }, [query])

  const stop = (event: MouseEvent): void => { event.stopPropagation() }

  const installedInfo = (plugin: MarketPlugin): InstalledPlugin | undefined => installed.find(item =>
    (item.repo !== undefined && item.repo.toLowerCase() === plugin.fullName.toLowerCase())
    || item.name.toLowerCase() === plugin.name.toLowerCase(),
  )

  const isUpdate = (plugin: MarketPlugin): boolean => {
    const info = installedInfo(plugin)
    if (info === undefined) return false
    const latest = latestVersions[plugin.fullName]
    return latest !== undefined && info.version !== '' && versionDiffers(info.version, latest)
  }

  const onConfirmInstall = async (plugin: MarketPlugin): Promise<void> => {
    const source = `github:${plugin.fullName}`
    const type = plugin.type ?? 'plugin'
    setConfirming(null)
    const id = await beginInstall(plugin.name, source, type)
    setForegroundId(id)
  }

  const page = view.status === 'ready' ? view.page : 1
  const totalPages = view.status === 'ready' ? Math.max(1, Math.ceil(view.totalCount / PER_PAGE)) : 1
  const sortedPlugins = view.status === 'ready'
    ? [...view.plugins].sort((a, b) => Number(installedInfo(b) !== undefined) - Number(installedInfo(a) !== undefined))
    : []

  return (
    <>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 0' }}>
        <label style={{ ...searchStyle, flex: 1 }}>
          <IconSearchOutline16 aria-hidden="true" />
          <input
            type="search"
            style={searchInputStyle}
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={event => { setQuery(event.currentTarget.value) }}
          />
        </label>
        <button type="button" style={actionButtonStyle} onClick={() => { invalidateRegistry(); load(1, query.trim()) }}>{t('refresh')}</button>
        <a style={guideStyle} href={GUIDE_URL} target="_blank" rel="noreferrer noopener">{t('guide')}</a>
      </div>

      <div style={bodyStyle}>
        {view.status === 'ready' ? <p style={countStyle}>{t('count', { total: view.totalCount })}</p> : null}
        {view.status === 'loading' ? <p style={statusTextStyle}>{t('loading')}</p> : null}
        {view.status === 'error' ? (
          <div role="alert">
            <p style={errorTextStyle}>{t('error', { message: view.message })}</p>
            <button type="button" style={actionButtonStyle} onClick={() => { load(page, query.trim()) }}>{t('retry')}</button>
          </div>
        ) : null}
        {view.status === 'ready' && view.plugins.length === 0
          ? <p style={statusTextStyle}>{t('empty')}</p>
          : null}
        {view.status === 'ready' && view.plugins.length > 0 ? (
          <ul style={cardsStyle}>
            {sortedPlugins.map(plugin => {
              const info = installedInfo(plugin)
              const badge = typeLabel(plugin.type, t)
              return (
                <li style={cardStyle} key={plugin.fullName} data-market-plugin={plugin.fullName}>
                  <div style={cardBodyStyle}>
                    <a
                      style={cardNameStyle}
                      href={plugin.htmlUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={t('open.aria', { name: plugin.fullName })}
                    >
                      <span style={cardNameTextStyle}>{plugin.fullName}</span>
                      <IconRightUpOutline16 size={12} />
                    </a>
                    {badge !== null ? (
                      <span style={{ ...typeBadgeStyle, color: typeBadgeColors[plugin.type as Exclude<PluginType, 'other'>] }}>{badge}</span>
                    ) : null}
                    <p style={cardDescStyle}>{plugin.description}</p>
                  </div>
                  <div style={cardTrailingStyle}>
                    {info !== undefined ? (
                      <span style={installedTagStyle}>
                        {isUpdate(plugin) && latestVersions[plugin.fullName] !== undefined
                          ? `v${info.version} → v${latestVersions[plugin.fullName]}`
                          : t('installed') + (info.version !== '' ? ` v${info.version}` : '')}
                      </span>
                    ) : null}
                    <span style={starsStyle}>
                      <span style={starGlyphStyle} aria-hidden>★</span>
                      {plugin.stars}
                    </span>
                    {info !== undefined ? (
                      isUpdate(plugin) ? (
                        <button
                          type="button"
                          style={installButtonStyle}
                          data-market-install={plugin.fullName}
                          onClick={() => { setConfirming(plugin) }}
                        >{t('update')}</button>
                      ) : (
                        <button type="button" disabled style={installedButtonStyle}>{t('installed')}</button>
                      )
                    ) : (
                      <button
                        type="button"
                        style={installButtonStyle}
                        data-market-install={plugin.fullName}
                        onClick={() => { setConfirming(plugin) }}
                      >{t('install')}</button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>

      {view.status === 'ready' && view.plugins.length > 0 ? (
        <footer style={paginationStyle}>
          <button type="button" style={pageButtonStyle} disabled={page <= 1} onClick={() => { load(page - 1, query.trim()) }}>{t('prev')}</button>
          <span style={pageIndicatorStyle}>{t('page', { page, total: totalPages })}</span>
          <button type="button" style={pageButtonStyle} disabled={page >= totalPages} onClick={() => { load(page + 1, query.trim()) }}>{t('next')}</button>
        </footer>
      ) : null}

      {confirming !== null ? (
        <div style={dialogBackdropStyle} onClick={() => { setConfirming(null) }}>
          <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={isUpdate(confirming) ? t('confirm.title.update', { name: confirming.name }) : t('confirm.title', { name: confirming.name })} onClick={stop}>
            <h3 style={dialogTitleStyle}>{isUpdate(confirming) ? t('confirm.title.update', { name: confirming.name }) : t('confirm.title', { name: confirming.name })}</h3>
            <p style={dialogBodyStyle}>{t(confirmBodyKey(confirming.type), { source: `github:${confirming.fullName}`, profile: DEFAULT_PROFILE, name: confirming.name })}</p>
            <code style={commandStyle}>{confirmCommand(confirming, DEFAULT_PROFILE)}</code>
            {confirming.type === 'script' ? <p style={errorTextStyle}>{t('confirm.scriptWarning')}</p> : null}
            <div style={actionsStyle}>
              <button type="button" style={actionButtonStyle} onClick={() => { setConfirming(null) }}>{t('confirm.cancel')}</button>
              <button type="button" style={primaryButtonStyle} onClick={() => { void onConfirmInstall(confirming) }}>{t('confirm.start')}</button>
            </div>
          </div>
        </div>
      ) : null}

      {foreground !== null ? (
        <div style={dialogBackdropStyle}>
          <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={t('installing.title', { name: foreground.name })}>
            <h3 style={dialogTitleStyle}>{t('installing.title', { name: foreground.name })}</h3>
            <code style={commandStyle}>{installCommand(foreground, DEFAULT_PROFILE)}</code>
            {foreground.status === 'running' ? (
              <p style={runningStyle}>
                <span style={spinStyle}><IconLoadingOutline16 /></span>
                {t('install.running')} {t('install.elapsed', { seconds: elapsed })}
              </p>
            ) : null}
            {foreground.status === 'done' ? <p style={successTextStyle}>{t('installing.done')}</p> : null}
            {foreground.status === 'error' ? <p style={errorTextStyle}>{t('installing.failed')}</p> : null}
            {foreground.status === 'canceled' ? <p style={errorTextStyle}>{t('install.canceled')}</p> : null}
            {foreground.output.length > 0 ? (
              <>
                <span style={outputLabelStyle}>{t('installing.output')}</span>
                <code style={outputStyle}>{foreground.output}</code>
              </>
            ) : null}
            <div style={actionsStyle}>
              {foreground.status === 'running' ? (
                <>
                  <button type="button" style={dangerButtonStyle} onClick={() => { void cancelJob(foreground.id) }}>{t('install.terminate')}</button>
                  <button type="button" style={primaryButtonStyle} onClick={() => { backgroundJob(foreground.id); setForegroundId(null) }}>{t('install.background')}</button>
                </>
              ) : (
                <button type="button" style={primaryButtonStyle} onClick={() => { dismissJob(foreground.id); setForegroundId(null) }}>{t('installing.close')}</button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
