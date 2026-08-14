/** Market tab contributed to the Plugins settings section. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MarketBrowser } from './MarketBrowser.tsx'

type Props = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'pluginMarket'>

/** Render the market list inside the Plugins tab chrome. */
export function MarketSettingsTab({ t }: Props) {
  return <MarketBrowser t={t} />
}
