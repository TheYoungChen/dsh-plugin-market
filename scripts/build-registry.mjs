/**
 * Builds `registry.json`: a full snapshot of the GitHub `dsh-plugin` topic,
 * annotated with each repo's install kind (plugin / skill / preset / script).
 *
 * Runs in GitHub Actions (schedule) with GITHUB_TOKEN. Repo file listings come
 * from the jsDelivr data API (no GitHub rate limits); the GitHub contents API
 * is the fallback when a repo has never been served by jsDelivr.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXCLUDED = new Set(['deepseek-ai/deepseek-harness'])
const PER_PAGE = 100
const MAX_PAGES = 10 // GitHub search caps at 1000 results; the star-sorted head is the registry
const CONCURRENCY = 8

const token = process.env.GITHUB_TOKEN?.trim()
const headers = {
  Accept: 'application/vnd.github+json',
  ...(token !== undefined && token !== '' ? { Authorization: `Bearer ${token}` } : {}),
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchPage(page, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    const params = new URLSearchParams({
      q: 'topic:dsh-plugin',
      sort: 'stars',
      order: 'desc',
      per_page: String(PER_PAGE),
      page: String(page),
    })
    const response = await fetch(`https://api.github.com/search/repositories?${params.toString()}`, { headers })
    if (response.status === 403 && attempt < retries) {
      const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
      const waitMs = Math.max(0, reset - Date.now()) + 1000
      console.log(`rate limited on page ${page}, waiting ${Math.round(waitMs / 1000)}s`)
      await delay(waitMs)
      continue
    }
    if (!response.ok) {
      throw new Error(`search failed: ${response.status} ${response.statusText}`)
    }
    const payload = await response.json()
    return { items: payload.items ?? [] }
  }
}

/** Map a root file listing to an install kind. */
function detectType(fileNames) {
  const names = new Set(fileNames)
  if (names.has('SKILL.md')) return 'skill'
  if (names.has('preset.yml') || names.has('agent.cordis.yml')) return 'preset'
  if (names.has('package.json')) return 'plugin'
  if (names.has('install.sh') || names.has('install.ps1')) return 'script'
  return 'other'
}

/** Root file names for one repo: jsDelivr data API first, GitHub contents fallback. */
async function rootFiles(fullName) {
  try {
    const res = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${fullName}@main`, {
      headers: { 'User-Agent': 'dsh-market-registry' },
    })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.files)) return data.files.map(file => file.name)
    }
  } catch {
    // fall through to GitHub contents
  }
  if (token === undefined || token === '') return []
  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}/contents/`, { headers })
    if (res.ok) {
      const files = await res.json()
      if (Array.isArray(files)) return files.map(file => file.name)
    }
  } catch {
    // ignore; the plugin stays 'other'
  }
  return []
}

async function detectTypeFor(fullName) {
  return detectType(await rootFiles(fullName))
}

const plugins = []
for (let page = 1; page <= MAX_PAGES; page++) {
  const { items } = await fetchPage(page)
  for (const item of items) {
    if (item.full_name === undefined || EXCLUDED.has(item.full_name)) continue
    plugins.push({
      fullName: item.full_name,
      name: item.name ?? '',
      description: item.description ?? '',
      stars: item.stargazers_count ?? 0,
      htmlUrl: item.html_url ?? '',
    })
  }
  if (items.length < PER_PAGE) break
  await delay(7000) // stay under the search API rate limit
}

// The market always lists itself, even when the star-sorted head overflows the
// 1000-result search cap.
const SELF = {
  fullName: 'TheYoungChen/dsh-plugin-market',
  name: 'dsh-plugin-market',
  description: 'DeepSeek Harness plugin market - browse, search & install dsh-plugin topic plugins',
  stars: 1,
  htmlUrl: 'https://github.com/TheYoungChen/dsh-plugin-market',
}
if (!plugins.some(plugin => plugin.fullName === SELF.fullName)) plugins.push(SELF)

let cursor = 0
async function worker() {
  while (cursor < plugins.length) {
    const index = cursor++
    const plugin = plugins[index]
    plugin.type = await detectTypeFor(plugin.fullName)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

plugins.sort((a, b) => b.stars - a.stars)
const registry = {
  generatedAt: new Date().toISOString(),
  totalCount: plugins.length,
  plugins,
}

const target = fileURLToPath(new URL('../registry.json', import.meta.url))
writeFileSync(target, `${JSON.stringify(registry, null, 2)}\n`)
console.log(`wrote ${target} with ${plugins.length} plugins`)
const byType = plugins.reduce((acc, p) => { acc[p.type] = (acc[p.type] ?? 0) + 1; return acc }, {})
console.log('types:', JSON.stringify(byType))
