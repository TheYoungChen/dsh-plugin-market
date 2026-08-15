/** Plugin market browser plugin: sidebar footer action + Settings Plugins tab. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { PluginMarketPanel } from './PluginMarketPanel.tsx'
import { MarketSettingsTab, type MarketSettingsTabInjected } from './MarketSettingsTab.tsx'
import { en, zh, type PluginMarketKey } from './locales.ts'

export type { PluginMarketKey } from './locales.ts'
export type { MarketPlugin, MarketPage } from './github.ts'

/** Dictionary namespace owned by this plugin. */
export const NS = 'pluginMarket'

/** Services required by the sidebar footer-action and Settings tab registrations. */
export const inject = ['slots', 'locale', 'remote']

/** Register the market entry above Settings, the Plugins tab, and the dictionaries. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-market: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'plugin-market',
    order: 50,
    locale: NS,
  }, PluginMarketPanel))

  const injected = (): MarketSettingsTabInjected => ({
    list: async (): Promise<PluginInventorySnapshot> => {
      const result = await ctx.remote.pluginInventory.list()
      if (!result.ok) {
        throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'market',
    order: 20,
    label: () => t('title'),
    locale: NS,
    inject: injected,
  }, MarketSettingsTab))
}