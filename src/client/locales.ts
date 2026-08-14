/** Plugin market UI dictionaries. */

export const NS = 'pluginMarket'

/** Simplified Chinese market messages. */
export const zh = {
  'trigger': '插件市场',
  'trigger.aria': '插件市场',
  'title': '插件市场',
  'search': '搜索插件…',
  'loading': '加载中…',
  'error': '加载失败：{message}',
  'retry': '重试',
  'empty': '没有找到插件',
  'stars': '{count} stars',
  'install': '安装',
  'confirm.title': '安装 {name}',
  'confirm.body': '将把 {source} 安装到 profile “{profile}”，重启 dsh 后生效。',
  'confirm.start': '确认安装',
  'confirm.cancel': '取消',
  'installing.title': '正在安装 {name}',
  'installing.running': '安装中…',
  'installing.done': '安装完成，重启 dsh 后生效',
  'installing.failed': '安装失败',
  'installing.output': '安装输出',
  'installing.close': '关闭',
  'page': '第 {page} / {total} 页',
  'prev': '上一页',
  'next': '下一页',
  'close': '关闭',
  'open.aria': '在 GitHub 打开 {name}',
  'count': '共 {total} 个插件',
  'guide': '如何发布插件',
  'install.elapsed': '已 {seconds} 秒',
  'install.background': '后台下载',
  'install.terminate': '终止',
  'install.canceled': '已取消',
  'toast.running': '后台安装中',
  'toast.done': '安装完成',
  'toast.failed': '安装失败',
  'toast.canceled': '已取消',
  'toast.restart': '重启并生效',
  'toast.close.aria': '关闭通知',
} satisfies Record<string, string>

/** Translation keys owned by the plugin market namespace. */
export type PluginMarketKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin market UI copy. */
    pluginMarket: PluginMarketKey
  }
}

/** English market messages. */
export const en = {
  'trigger': 'Plugin Market',
  'trigger.aria': 'Plugin market',
  'title': 'Plugin Market',
  'search': 'Search plugins…',
  'loading': 'Loading…',
  'error': 'Load failed: {message}',
  'retry': 'Retry',
  'empty': 'No plugins found',
  'stars': '{count} stars',
  'install': 'Install',
  'confirm.title': 'Install {name}',
  'confirm.body': 'It will install {source} into the “{profile}” profile and take effect after restarting dsh.',
  'confirm.start': 'Install',
  'confirm.cancel': 'Cancel',
  'installing.title': 'Installing {name}',
  'installing.running': 'Installing…',
  'installing.done': 'Installed — restart dsh to activate',
  'installing.failed': 'Install failed',
  'installing.output': 'Install output',
  'installing.close': 'Close',
  'page': 'Page {page} / {total}',
  'prev': 'Previous',
  'next': 'Next',
  'close': 'Close',
  'open.aria': 'Open {name} on GitHub',
  'count': '{total} plugins',
  'guide': 'How to publish',
  'install.elapsed': '{seconds}s',
  'install.background': 'Background',
  'install.terminate': 'Cancel',
  'install.canceled': 'Canceled',
  'toast.running': 'Installing in background',
  'toast.done': 'Installed',
  'toast.failed': 'Install failed',
  'toast.canceled': 'Canceled',
  'toast.restart': 'Restart to apply',
  'toast.close.aria': 'Dismiss',
} satisfies Record<PluginMarketKey, string>
