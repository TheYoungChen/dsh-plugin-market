# dsh-plugin-market

一个 DeepSeek Harness（dsh）插件市场 bundle 插件：在 Web UI 左侧「设置」上方新增「插件市场」入口（同时集成到 设置 → 插件 → 插件市场 标签页），分页浏览 GitHub [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic 里的全部插件，支持搜索、一键安装与实时进度。

## 功能

- **双入口**：侧边栏「设置」上方的入口按钮；设置 → 插件 → 插件市场 标签页，内容一致
- **浏览 / 搜索 / 分页**：聚合 `dsh-plugin` topic 全部插件，按 star 排序，关键字搜索，每页 20 条
- **一键安装**：确认框 → 真实执行 `pnpm add github:<owner/repo>`（等价于官方 `dsh plugin add`），自动把声明 `dsh.bundle` 的依赖 reconcile 进 `dsh.profile.bundles` 层栈
- **安装可视化**：实时日志 + 已用时长，可随时**终止**（真正杀掉 pnpm 进程）或转**后台下载**
- **后台通知**：右上角常驻状态条，运行中可终止；完成后带「重启并生效」按钮、3 秒自动消失，也可手动关闭
- **统计与指引**：插件总数统计、「如何发布插件」引导链接

## 工作原理

- **node half**（`src/index.ts`）：在宿主注册同源路由 `/api/plugin-market/*`。安装时在 `$DSH_HOME/profiles/web` 里 `spawn pnpm add github:<owner/repo>`，并把声明 `dsh.bundle` 的依赖 reconcile 进 `dsh.profile.bundles` 层栈；进度通过轮询 `GET /api/plugin-market/job/<id>` 返回，`POST /api/plugin-market/job/<id>/cancel` 可终止进程树。
- **client half**（`src/client/`）：注册 `sidebar.footer.action` 与 `settings.plugins.tab` 槽位；`MarketBrowser` 是共享的浏览/安装组件，`installStore` 管理前后台安装任务，后台任务以右上角 toast 呈现。

两者都只用官方机制（bundle 层栈 + 用户 patch 层 + webServer 路由），不改官方仓库、不依赖私有内部包。

## 安装

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:TheYoungChen/dsh-plugin-market

# 或从 npm 安装（若已发布）
dsh plugin --profile web add dsh-plugin-market
```

装完重启 dsh，左侧「设置」上方出现「插件市场」入口。

> `lib/` 已预构建（无 `prepare` 脚本），git 安装无需额外构建步骤。

## 安装行为与注意事项

- 安装源固定为 `github:<owner/repo>`，装进 `web` profile，**重启 dsh 后生效**（bundle 插件进层栈，配置在启动时解析）。
- git 托管的插件若带构建脚本（`prepare`），pnpm ≥10 默认拦截：进度里报 `allowBuilds` 时，按提示把对应 key 加进 `~/.dsh/profiles/web/pnpm-workspace.yaml` 再重装。
- 安装第三方插件前请自查其源码、权限与许可证；本市场只提供发现与安装入口，不做安全背书。

## 从源码改/重建

```sh
cd dsh-plugin-market
pnpm install          # 装 tsdown / react / @types/react 等 devDeps
pnpm build            # 产出 lib/index.mjs + lib/index.js
```

`tsdown.config.ts` 是自包含的（不引用官方 monorepo preset）：node half 走 ESM、client half 走 `window.__ModuleLoader__.load` 的 CJS 包裹。

## 结构

```
cordis.patch.yml              # insert 一行：挂载本包（ui-plugin-market）
package.json                  # dsh.bundle + dsh.client manifest
tsdown.config.ts              # 自包含构建（node ESM + client CJS）
src/index.ts                  # node half：/api/plugin-market 安装/进度/取消路由
src/client/index.ts           # client half：注册 sidebar.footer.action + settings.plugins.tab
src/client/PluginMarketPanel.tsx  # 侧边栏入口 + 市场弹窗 + 后台安装 toast
src/client/MarketBrowser.tsx  # 共享浏览组件（搜索/分页/确认/进度弹窗）
src/client/MarketSettingsTab.tsx  # 设置页标签页包装
src/client/installStore.ts    # 前后台安装任务状态管理
src/client/github.ts          # GitHub dsh-plugin topic 拉取
src/client/api.ts             # 安装 + 进度轮询 + 取消
src/client/locales.ts         # 中英文案
```

## 已知限制

- GitHub 搜索接口未鉴权有速率限制（约 10 次/分钟），翻页/搜索频繁时可能触发 403，稍等即可。
- 安装进度为轮询式（~600ms 一次），非逐字节流式。
