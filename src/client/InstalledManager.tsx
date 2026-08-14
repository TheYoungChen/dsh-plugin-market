/** Settings tab: installed plugins split into user-installed vs built-in layers. */

import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanupInstall, fetchInstalled, uninstallInstall, type InstalledPlugin } from './api.ts'

type Props = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'pluginMarket'>
type MarketT = Props['t']

const sectionStyle: React.CSSProperties = {
  margin: '12px 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)',
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 8,
  border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10,
  background: 'var(--dsw-alias-bg-base)',
}
const rowNameStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 13, overflowWrap: 'anywhere' }
const rowMetaStyle: React.CSSProperties = {
  flexShrink: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums',
}
const actionStyle: React.CSSProperties = {
  padding: '4px 10px', border: 0, borderRadius: 6, fontSize: 12, cursor: 'pointer',
}
const dangerActionStyle: React.CSSProperties = {
  ...actionStyle, background: 'transparent', color: 'var(--dsw-alias-state-error-primary)',
}
const subtleStyle: React.CSSProperties = { flexShrink: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
const emptyStyle: React.CSSProperties = { padding: '10px 0', margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }

/** The layered "plugin management" view for the Settings → Plugins page. */
export function InstalledManager({ t }: Props): ReactNode {
  const [report, setReport] = useState<{ plugins: InstalledPlugin[]; bundles: string[] } | null>(null)
  const [confirmingUninstall, setConfirmingUninstall] = useState<InstalledPlugin | null>(null)

  const refresh = (force: boolean): void => {
    void fetchInstalled(force).then(setReport, () => {})
  }
  useEffect(() => { refresh(false) }, [])

  const onUninstall = async (plugin: InstalledPlugin): Promise<void> => {
    setConfirmingUninstall(null)
    try {
      await uninstallInstall(plugin.name, 'plugin', plugin.name.replace(/^@[^/]+\//, ''))
    } catch {
      // The refresh below reflects reality either way.
    }
    refresh(true)
  }

  const onCleanup = async (plugin: InstalledPlugin): Promise<void> => {
    try {
      await cleanupInstall(plugin.name)
    } catch {
      // The refresh below reflects reality either way.
    }
    refresh(true)
  }

  const plugins = report?.plugins ?? []
  const userPlugins = plugins.filter(plugin => !plugin.broken)
  const brokenPlugins = plugins.filter(plugin => plugin.broken)
  const systemBundles = (report?.bundles ?? []).filter(bundle => !plugins.some(plugin => plugin.name === bundle))

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 14px 14px' }}>
      <h3 style={sectionStyle}>{t('manager.userSection')} ({userPlugins.length})</h3>
      {userPlugins.length === 0 ? <p style={emptyStyle}>{t('manager.empty')}</p> : null}
      {userPlugins.map(plugin => (
        <div style={rowStyle} key={plugin.name}>
          <span style={rowNameStyle}>{plugin.name}</span>
          <span style={rowMetaStyle}>{plugin.version !== '' ? `v${plugin.version}` : ''}</span>
          {confirmingUninstall?.name === plugin.name ? (
            <>
              <button type="button" style={dangerActionStyle} onClick={() => { void onUninstall(plugin) }}>{t('uninstall.confirm.start')}</button>
              <button type="button" style={actionStyle} onClick={() => { setConfirmingUninstall(null) }}>{t('confirm.cancel')}</button>
            </>
          ) : (
            <button type="button" style={dangerActionStyle} onClick={() => { setConfirmingUninstall(plugin) }}>{t('uninstall')}</button>
          )}
        </div>
      ))}

      {brokenPlugins.length > 0 ? (
        <>
          <h3 style={sectionStyle}>{t('manager.brokenSection')} ({brokenPlugins.length})</h3>
          {brokenPlugins.map(plugin => (
            <div style={rowStyle} key={plugin.name}>
              <span style={{ ...rowNameStyle, color: 'var(--dsw-alias-state-error-primary)' }}>{plugin.name}</span>
              <span style={rowMetaStyle}>{t('broken')}</span>
              <button type="button" style={dangerActionStyle} onClick={() => { void onCleanup(plugin) }}>{t('cleanup')}</button>
            </div>
          ))}
        </>
      ) : null}

      <h3 style={sectionStyle}>{t('manager.systemSection')} ({systemBundles.length})</h3>
      {systemBundles.length === 0 ? <p style={emptyStyle}>{t('manager.emptySystem')}</p> : null}
      {systemBundles.map(bundle => (
        <div style={rowStyle} key={bundle}>
          <span style={rowNameStyle}>{bundle}</span>
          <span style={subtleStyle}>{t('manager.builtin')}</span>
        </div>
      ))}
    </div>
  )
}
