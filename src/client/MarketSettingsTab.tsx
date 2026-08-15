/** Market tab contributed to the Plugins settings section. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MarketBrowser } from './MarketBrowser.tsx'
import { InstalledLayers } from './InstalledLayers.tsx'

/** Registration-side injected face: full runtime bundle inventory. */
export interface MarketSettingsTabInjected {
  list: () => Promise<PluginInventorySnapshot>
}

type Props = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'pluginMarket'> & Partial<InjectFace<MarketSettingsTabInjected>>

/** Render the layered installed view on top, then the market list below. */
export function MarketSettingsTab({ t, list }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
      <InstalledLayers t={t} list={list} />
      <div style={{ marginTop: 8, borderTop: '1px solid var(--dsw-alias-border-l2)' }} />
      <MarketBrowser t={t} />
    </div>
  )
}