# dsh-plugin-market

一个 DeepSeek Harness（dsh）插件市场 bundle 插件：在 Web UI 左侧「设置」上方新增「插件市场」入口（同时集成到 设置 → 插件 → 插件市场 标签页），分页浏览 GitHub [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic 里的全部插件，支持搜索、一键安装与实时进度。

![GitHub Stars](https://img.shields.io/github/stars/TheYoungChen/dsh-plugin-market?logo=github&label=Stars)
![License](https://img.shields.io/github/license/TheYoungChen/dsh-plugin-market?label=License)
![Last Commit](https://img.shields.io/github/last-commit/TheYoungChen/dsh-plugin-market?label=Last%20Commit)
![Repo Size](https://img.shields.io/github/repo-size/TheYoungChen/dsh-plugin-market?label=Size)

## 📸 截图

![插件市场弹窗](docs/screenshots/market-modal.png)

![设置 → 插件 → 插件市场](docs/screenshots/settings-tab.png)

![安装进度（可终止 / 后台下载）](docs/screenshots/install-progress.png)

## ⚡ 一键安装（复制即用）

**喂给 AI 的一句话**（AI 具备命令执行能力即可，无需解释）：

> 安装 dsh-plugin-market：运行 `dsh plugin --profile web add github:TheYoungChen/dsh-plugin-market`，然后重启 `dsh web`。

**或者直接复制命令：**

```bash
dsh plugin --profile web add github:TheYoungChen/dsh-plugin-market && dsh web
```

> 本插件无 `prepare` 构建脚本、`lib/` 已预编译，git 安装零额外构建；安装完成后重启 dsh 生效。

## 功能

- **双入口**：侧边栏「设置」上方的入口按钮；设置 → 插件 → 插件市场 标签页，内容一致
- **浏览 / 搜索 / 分页**：聚合 `dsh-plugin` topic 全部插件，按 star 排序，关键字搜索，每页 20 条，带「刷新」按钮
- **静态索引 + CDN**：数据优先来自 GitHub Action 每 2 小时生成的 `registry.json`（jsDelivr CDN 分发，国内快），终端零 API 调用、零限流；索引不可用时自动回退搜索 API
- **已安装识别 + 更新**：读 profile 真实依赖 + `repository` 归属校验，已装的插件置顶；自动对比最新版本，有新版显示「更新」按钮，一键覆盖升级
- **一键安装**：确认框 → 真实执行 `pnpm add github:<owner/repo>`（等价于官方 `dsh plugin add`），自动把声明 `dsh.bundle` 的依赖 reconcile 进 `dsh.profile.bundles` 层栈
- **安装可视化**：实时日志 + 已用时长，可随时**终止**（真正杀掉进程）或转**后台下载**
- **后台通知**：右上角常驻状态条（不遮挡会话页头），运行中可终止、可点击展开为终端面板看实时日志；完成后带「立即重启」按钮，手动关闭
- **统计与指引**：插件总数统计、「如何发布插件」引导链接

## 安装类型

市场按仓库根文件自动识别类型并打上徽章，安装时走对应方式：

| 类型 | 判定 | 安装方式 |
|---|---|---|
| 插件 | 根目录含 `package.json` | `pnpm add` 进 profile（官方路径） |
| Skill | 根目录含 `SKILL.md` | 克隆到 `~/.dsh/skills/<名>/` |
| 预设 | `preset.yml` / `agent.cordis.yml` | 克隆到 `~/.dsh/.agent-presets/<名>/` |
| 脚本 | `install.sh` / `install.ps1` | 克隆后执行安装脚本（需确认信任） |

## 工作原理

- **node half**（`src/index.ts`）：在宿主注册同源路由 `/api/plugin-market/*`。安装时在 `$DSH_HOME/profiles/web` 里 `spawn pnpm add github:<owner/repo>`，并把声明 `dsh.bundle` 的依赖 reconcile 进 `dsh.profile.bundles` 层栈；进度通过轮询 `GET /api/plugin-market/job/<id>` 返回，`POST /api/plugin-market/job/<id>/cancel` 可终止进程树。
- **client half**（`src/client/`）：注册 `sidebar.footer.action` 与 `settings.plugins.tab` 槽位；`MarketBrowser` 是共享的浏览/安装组件，`installStore` 管理前后台安装任务，后台任务以右上角 toast 呈现。

两者都只用官方机制（bundle 层栈 + 用户 patch 层 + webServer 路由），不改官方仓库、不依赖私有内部包。

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

- 静态索引每 2 小时由 CI 更新一次，新发布的插件最迟 2 小时进索引（可在仓库 Actions 里手动触发 `update-registry`）。
- 版本检测对已安装插件按需读取 GitHub `package.json`，受未鉴权速率限制（约 60 次/小时）。
- 安装进度为轮询式（~600ms 一次），非逐字节流式。

## License

[MIT](LICENSE) — Copyright (c) 2025 TheYoungChen
