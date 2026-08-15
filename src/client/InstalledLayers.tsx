/** Collapsible layered installed view: user-installed on top, built-in below. */

import { useEffect, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { cleanupInstall, fetchInstalled, uninstallInstall, type InstalledPlugin } from './api.ts'
import { pushNotice } from './installStore.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

type MarketT = PropsLocale<'pluginMarket'>['t']

interface InstalledLayersProps {
  readonly t: MarketT
  /** Full runtime bundle inventory; falls back to profile bundles when unavailable. */
  readonly list?: () => Promise<PluginInventorySnapshot>
}

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
  background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
const sectionCountStyle: React.CSSProperties = {
  flexShrink: 0, padding: '1px 7px', borderRadius: 999, fontSize: 11,
  background: 'var(--dsw-alias-action-primary, #4c8dff)', color: '#fff',
}
const chevronStyle: React.CSSProperties = { marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
  border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10,
  background: 'var(--dsw-alias-bg-base)', marginTop: 6,
}
const rowNameStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 13, overflowWrap: 'anywhere' }
const rowMetaStyle: React.CSSProperties = {
  flexShrink: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums',
}
const actionStyle: React.CSSProperties = {
  flexShrink: 0, padding: '4px 10px', border: 0, borderRadius: 6, fontSize: 12, cursor: 'pointer',
}
const dangerActionStyle: React.CSSProperties = {
  ...actionStyle, background: 'transparent', color: 'var(--dsw-alias-state-error-primary)',
}
const statusDotStyle: React.CSSProperties = {
  flexShrink: 0, width: 8, height: 8, borderRadius: '50%',
  background: 'var(--dsw-alias-state-success-primary)',
}
const emptyStyle: React.CSSProperties = { padding: '10px 0', margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }

/** One collapsible group. */
function LayerSection({
  title, count, open, onToggle, children,
}: {
  title: string; count: number; open: boolean; onToggle: () => void; children: ReactNode
}): ReactNode {
  return (
    <section style={{ marginTop: 8 }}>
      <button type="button" style={sectionHeaderStyle} aria-expanded={open} onClick={onToggle}>
        <span>{title}</span>
        <span style={sectionCountStyle}>{count}</span>
        <span style={chevronStyle} aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open ? children : null}
    </section>
  )
}

/** User-installed + built-in plugin layers, matching the Agent preset layout. */
export function InstalledLayers({ t, list }: InstalledLayersProps): ReactNode {
  const [plugins, setPlugins] = useState<readonly InstalledPlugin[]>([])
  const [inventory, setInventory] = useState<PluginInventorySnapshot | null>(null)
  const [userOpen, setUserOpen] = useState(true)
  const [systemOpen, setSystemOpen] = useState(false)
  const [confirmingUninstall, setConfirmingUninstall] = useState<InstalledPlugin | null>(null)

  const refresh = (force: boolean): void => {
    void fetchInstalled(force).then(report => setPlugins(report.plugins), () => {})
    if (list !== undefined) {
      void list().then(setInventory, () => {})
    }
  }
  useEffect(() => { refresh(false) }, [list])

  const onUninstall = async (plugin: InstalledPlugin): Promise<void> => {
    setConfirmingUninstall(null)
    try {
      await uninstallInstall(plugin.name, 'plugin', plugin.name.replace(/^@[^/]+\//, ''))
      pushNotice(t('uninstall.notice', { name: plugin.name }))
    } catch {
      // The refresh below reflects reality either way.
    }
    refresh(true)
  }

  const onCleanup = async (plugin: InstalledPlugin): Promise<void> => {
    try {
      await cleanupInstall(plugin.name)
      pushNotice(t('cleanup.notice', { name: plugin.name }))
    } catch {
      // The refresh below reflects reality either way.
    }
    refresh(true)
  }

  const userPlugins = plugins.filter(plugin => !plugin.broken)
  const brokenPlugins = plugins.filter(plugin => plugin.broken)
  const inventoryEntries = inventory?.entries ?? []
  const userNames = new Set(userPlugins.map(plugin => plugin.name))
  const systemEntries = inventoryEntries.filter(entry => !userNames.has(entry.moduleName))

  return (
    <div>
      <LayerSection
        title={t('manager.userSection')}
        count={userPlugins.length}
        open={userOpen}
        onToggle={() => { setUserOpen(value => !value) }}
      >
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
            <p style={{ ...emptyStyle, marginTop: 4 }}>{t('manager.brokenSection')} ({brokenPlugins.length})</p>
            {brokenPlugins.map(plugin => (
              <div style={rowStyle} key={plugin.name}>
                <span style={{ ...rowNameStyle, color: 'var(--dsw-alias-state-error-primary)' }}>{plugin.name}</span>
                <span style={rowMetaStyle}>{t('broken')}</span>
                <button type="button" style={dangerActionStyle} onClick={() => { void onCleanup(plugin) }}>{t('cleanup')}</button>
              </div>
            ))}
          </>
        ) : null}
      </LayerSection>

      <LayerSection
        title={t('manager.systemSection')}
        count={systemEntries.length}
        open={systemOpen}
        onToggle={() => { setSystemOpen(value => !value) }}
      >
        {systemEntries.length === 0 ? <p style={emptyStyle}>{t('manager.emptySystem')}</p> : null}
        {systemEntries.map(entry => (
          <div style={rowStyle} key={entry.entryId}>
            {entry.enabled ? <span style={statusDotStyle} aria-hidden /> : null}
            <span style={rowNameStyle}>{entry.moduleName}</span>
            <span style={rowMetaStyle}>{entry.enabled ? t('manager.builtin') : t('manager.disabledSystem')}</span>
          </div>
        ))}
      </LayerSection>
    </div>
  )
}