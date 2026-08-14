/**
 * Builds `registry.json`: the FULL GitHub `dsh-plugin` topic snapshot, annotated
 * with each repo's install kind (plugin / skill / preset / script).
 *
 * GitHub search caps every single query at 1000 results, so the topic is
 * partitioned by disjoint star ranges — each range stays well under the cap and
 * together they cover every repo. Runs in GitHub Actions (schedule) with
 * GITHUB_TOKEN; repo file listings come from the jsDelivr data API (no GitHub
 * rate limits), with the GitHub contents API as the fallback.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXCLUDED = new Set(['deepseek-ai/deepseek-harness'])
const PER_PAGE = 100
const MAX_PAGES = 10 // per range; each range fits well under the 1000 cap
const CONCURRENCY = 8
const PAGE_DELAY_MS = 7000 // unauthenticated search limit is 10/min

/** Disjoint star ranges whose union covers every repo in the topic. */
const STAR_RANGES = ['stars:0..4', 'stars:5..9', 'stars:10..49', 'stars:50..199', 'stars:200..999', 'stars:>=1000']

const token = process.env.GITHUB_TOKEN?.trim()
const headers = {
  Accept: 'application/vnd.github+json',
  ...(token !== undefined && token !== '' ? { Authorization: `Bearer ${token}` } : {}),
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchRange(rangeQuery) {
  const found = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      q: `topic:dsh-plugin ${rangeQuery}`,
      sort: 'stars',
      order: 'desc',
      per_page: String(PER_PAGE),
      page: String(page),
    })
    let response = await fetch(`https://api.github.com/search/repositories?${params.toString()}`, { headers })
    if (response.status === 403) {
      const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
      const waitMs = Math.max(0, reset - Date.now()) + 1000
      console.log(`rate limited on ${rangeQuery} page ${page}, waiting ${Math.round(waitMs / 1000)}s`)
      await delay(waitMs)
      response = await fetch(`https://api.github.com/search/repositories?${params.toString()}`, { headers })
    }
    if (!response.ok) {
      throw new Error(`search failed: ${response.status} ${response.statusText} (${rangeQuery} page ${page})`)
    }
    const payload = await response.json()
    const items = payload.items ?? []
    for (const item of items) {
      if (item.full_name === undefined || EXCLUDED.has(item.full_name)) continue
      found.push({
        fullName: item.full_name,
        name: item.name ?? '',
        description: item.description ?? '',
        stars: item.stargazers_count ?? 0,
        htmlUrl: item.html_url ?? '',
        updatedAt: item.pushed_at ?? item.updated_at ?? '',
      })
    }
    if (items.length < PER_PAGE) break
    await delay(PAGE_DELAY_MS)
  }
  return found
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

// The market always lists itself, even if it ever falls outside the snapshot.
const SELF = {
  fullName: 'TheYoungChen/dsh-plugin-market',
  name: 'dsh-plugin-market',
  description: 'DeepSeek Harness plugin market - browse, search & install dsh-plugin topic plugins',
  stars: 1,
  htmlUrl: 'https://github.com/TheYoungChen/dsh-plugin-market',
  updatedAt: '',
}

const plugins = []
const seen = new Set()
for (const range of STAR_RANGES) {
  for (const plugin of await fetchRange(range)) {
    if (seen.has(plugin.fullName)) continue
    seen.add(plugin.fullName)
    plugins.push(plugin)
  }
}
if (!seen.has(SELF.fullName)) plugins.push(SELF)

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
