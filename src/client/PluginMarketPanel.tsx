/** Sidebar footer action: a market badge, the market modal, and install toasts. */

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { IconArchiveOutline20, IconCloseOutline16, IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { MarketBrowser } from './MarketBrowser.tsx'
import { cancelJob, dismissJob, ensureSpinKeyframe, useInstallJobs, type InstallJob } from './installStore.ts'

type Props = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'pluginMarket'>
type MarketT = Props['t']

/* ---- footer action chrome (mirrors the official Cordis panel) ---- */
const layerWideStyle: React.CSSProperties = {
  position: 'relative', flex: 'none', display: 'flex', alignItems: 'center',
  width: '100%', height: 49, margin: '8px 0 0',
}
const layerRailStyle: React.CSSProperties = {
  position: 'relative', flex: 'none', display: 'flex', alignItems: 'center',
  width: 36, height: 36, margin: 0,
}
const footerButtonsWideStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', width: '100%',
}
const footerButtonsRailStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
}
const badgeBaseStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none',
  color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit', fontSize: 14,
  cursor: 'pointer', overflow: 'hidden',
}
const badgeWideStyle: React.CSSProperties = {
  ...badgeBaseStyle, width: '100%', height: 49, padding: '0 8px 0 6px', borderRadius: 12,
}
const badgeRailStyle: React.CSSProperties = {
  ...badgeBaseStyle, justifyContent: 'center', gap: 0, width: 36, height: 36,
  padding: 0, borderRadius: '50%',
}
const badgeLabelStyle: React.CSSProperties = {
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

/* ---- settings-style modal ---- */
const backdropStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.5)',
}
const modalStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  width: 'min(720px, calc(100vw - 48px))', height: 'min(80vh, 760px)',
  maxHeight: 'calc(100vh - 48px)', overflow: 'hidden',
  border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 16,
  background: 'var(--dsw-alias-bg-base)', boxShadow: 'var(--dsw-shadow-lv2)',
}
const headerStyle: React.CSSProperties = {
  flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  minHeight: 52, padding: '10px 14px', boxSizing: 'border-box',
  borderBottom: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)',
}
const titleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap',
}
const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 4,
  border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer',
}

/* ---- install toasts (top-right, below the session header utilities) ---- */
const toastStackStyle: React.CSSProperties = {
  position: 'fixed', top: 60, right: 16, zIndex: 60,
  display: 'flex', flexDirection: 'column', gap: 8, width: 340, maxWidth: 'calc(100vw - 32px)',
}
const toastStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12,
  background: 'var(--dsw-alias-bg-base)', boxShadow: 'var(--dsw-shadow-lv2)',
  color: 'var(--dsw-alias-label-primary)',
}
const toastHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer',
}
const toastBodyStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2,
}
const toastNameStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }
const toastStatusStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap',
}
const spinStyle: React.CSSProperties = { display: 'inline-flex', flexShrink: 0, animation: 'dsh-market-spin 1s linear infinite' }
const toastRestartStyle: React.CSSProperties = {
  flexShrink: 0, padding: '4px 10px', border: 0, borderRadius: 6,
  background: 'var(--dsw-alias-action-primary, #4c8dff)', color: '#fff', fontSize: 12, cursor: 'pointer',
}
const toastTerminateStyle: React.CSSProperties = {
  flexShrink: 0, padding: '4px 8px', border: 0, borderRadius: 6,
  background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, cursor: 'pointer',
}
const toastCloseStyle: React.CSSProperties = {
  flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 2,
  border: 0, borderRadius: 4, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer',
}
const toastChevronStyle: React.CSSProperties = {
  flexShrink: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 10, lineHeight: 1,
}
/* ---- expanded terminal panel ---- */
const toastTerminalStyle: React.CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)', background: 'rgba(0,0,0,0.22)',
}
const toastCommandRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11, lineHeight: 1.5,
}
const toastCommandPromptStyle: React.CSSProperties = { flexShrink: 0, color: 'var(--dsw-alias-state-success-primary)' }
const toastCommandTextStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap', overflowX: 'auto',
}
const toastOutputStyle: React.CSSProperties = {
  maxHeight: 220, overflowY: 'auto', padding: '8px 12px',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11, lineHeight: 1.5,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--dsw-alias-label-secondary)',
}

/** One background-install toast: persistent, expandable terminal view. */
function InstallToast({ job, t }: { job: InstallJob; t: MarketT }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (job.status !== 'running') return
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [job.status])

  useEffect(() => {
    const node = outputRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [job.output, expanded])

  const elapsed = Math.max(0, Math.floor((now - job.startedAt) / 1000))
  const statusText = job.status === 'running' ? `${t('toast.running')} · ${t('install.elapsed', { seconds: elapsed })}`
    : job.status === 'done' ? t('toast.done')
      : job.status === 'error' ? t('toast.failed')
        : t('toast.canceled')

  return (
    <div style={toastStyle} role="status">
      <div
        style={toastHeaderStyle}
        aria-expanded={expanded}
        onClick={() => { setExpanded(value => !value) }}
      >
        {job.status === 'running' ? <span style={spinStyle}><IconLoadingOutline16 /></span> : null}
        <div style={toastBodyStyle}>
          <span style={toastNameStyle}>{job.name}</span>
          <span style={toastStatusStyle}>{statusText}</span>
        </div>
        {job.status === 'running' ? (
          <button type="button" style={toastTerminateStyle} onClick={event => { event.stopPropagation(); void cancelJob(job.id) }}>{t('install.terminate')}</button>
        ) : null}
        {job.status === 'done' ? (
          <button type="button" style={toastRestartStyle} onClick={event => { event.stopPropagation(); window.location.reload() }}>{t('toast.restart')}</button>
        ) : null}
        {job.status !== 'running' ? (
          <button type="button" style={toastCloseStyle} aria-label={t('toast.close.aria')} onClick={event => { event.stopPropagation(); dismissJob(job.id) }}>
            <IconCloseOutline16 size={14} />
          </button>
        ) : null}
        <span style={toastChevronStyle} aria-hidden>{expanded ? '▴' : '▾'}</span>
      </div>

      {expanded ? (
        <div style={toastTerminalStyle}>
          <div style={toastCommandRowStyle}>
            <span style={toastCommandPromptStyle}>$</span>
            <span style={toastCommandTextStyle}>pnpm add {job.source}</span>
          </div>
          <div ref={outputRef} style={toastOutputStyle}>
            {job.output.length > 0 ? job.output : t('toast.starting')}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Render the market badge, the modal it opens, and background install toasts. */
export function PluginMarketPanel({ wide, t }: Props): ReactNode {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const jobs = useInstallJobs()
  const background = jobs.filter(job => job.backgrounded)

  useEffect(() => { ensureSpinKeyframe() }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  const stop = (event: MouseEvent): void => { event.stopPropagation() }

  const badgeBackground = open
    ? 'var(--dsw-alias-interactive-bg-hover)'
    : hovered
      ? 'var(--dsw-alias-interactive-bg-hover-solid)'
      : 'transparent'
  const badgeStyle = { ...(wide ? badgeWideStyle : badgeRailStyle), background: badgeBackground }

  return (
    <div style={wide ? layerWideStyle : layerRailStyle}>
      <div style={wide ? footerButtonsWideStyle : footerButtonsRailStyle}>
        <button
          type="button"
          style={badgeStyle}
          aria-label={t('trigger.aria')}
          aria-expanded={open}
          onMouseEnter={() => { setHovered(true) }}
          onMouseLeave={() => { setHovered(false) }}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconArchiveOutline20 size={wide ? 16 : 18} />
          {wide ? <span style={badgeLabelStyle}>{t('trigger')}</span> : null}
        </button>
      </div>

      {open ? (
        <div style={backdropStyle} onClick={() => { setOpen(false) }}>
          <section style={modalStyle} role="dialog" aria-modal="true" aria-label={t('title')} onClick={stop}>
            <header style={headerStyle}>
              <span style={titleStyle}>{t('title')}</span>
              <button type="button" style={iconButtonStyle} aria-label={t('close')} onClick={() => { setOpen(false) }}>
                <IconCloseOutline16 size={16} />
              </button>
            </header>
            <MarketBrowser t={t} />
          </section>
        </div>
      ) : null}

      {background.length > 0 ? (
        <div style={toastStackStyle}>
          {background.map(job => <InstallToast key={job.id} job={job} t={t} />)}
        </div>
      ) : null}
    </div>
  )
}
