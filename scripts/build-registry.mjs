/**
 * Builds `registry.json`: a full snapshot of the GitHub `dsh-plugin` topic.
 * Runs in GitHub Actions (with GITHUB_TOKEN) on a schedule; the browser reads
 * the result from a CDN so end users make zero API calls.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXCLUDED = new Set(['deepseek-ai/deepseek-harness'])
const PER_PAGE = 100
const MAX_PAGES = 30 // 3000 repositories cap, plenty for this topic

const token = process.env.GITHUB_TOKEN?.trim()
const headers = {
  Accept: 'application/vnd.github+json',
  ...(token !== undefined && token !== '' ? { Authorization: `Bearer ${token}` } : {}),
}

async function fetchPage(page) {
  const params = new URLSearchParams({
    q: 'topic:dsh-plugin',
    sort: 'stars',
    order: 'desc',
    per_page: String(PER_PAGE),
    page: String(page),
  })
  const response = await fetch(`https://api.github.com/search/repositories?${params.toString()}`, { headers })
  if (!response.ok) {
    throw new Error(`search failed: ${response.status} ${response.statusText}`)
  }
  const payload = await response.json()
  return { items: payload.items ?? [], total: payload.total_count ?? 0 }
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
}

plugins.sort((a, b) => b.stars - a.stars)
const registry = {
  generatedAt: new Date().toISOString(),
  totalCount: plugins.length,
  plugins,
}

const target = fileURLToPath(new URL('../registry.json', import.meta.url))
writeFileSync(target, `${JSON.stringify(registry, null, 2)}\n`)
console.log(`wrote ${target} with ${plugins.length} plugins`)
