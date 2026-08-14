/** Plugin discovery: static registry (CDN-first) with a GitHub search API fallback. */

/** One discoverable plugin repository. */
export interface MarketPlugin {
  /** `owner/repo`, also the pnpm `github:` install spec. */
  fullName: string
  /** Repository name without the owner. */
  name: string
  /** GitHub description, or empty when the repo has none. */
  description: string
  /** Star count, for a lightweight popularity signal. */
  stars: number
  /** Browser URL of the repository. */
  htmlUrl: string
}

/** One page of the market plus the topic's total repository count. */
export interface MarketPage {
  items: MarketPlugin[]
  totalCount: number
}

/** Repos tagged `dsh-plugin` that are not the harness itself. */
const EXCLUDED = new Set(['deepseek-ai/deepseek-harness'])

/** The repo that hosts this plugin and its generated registry. */
const REGISTRY_REPO = 'TheYoungChen/dsh-plugin-market'

interface RawItem {
  full_name?: string
  name?: string
  description?: string | null
  stargazers_count?: number
  html_url?: string
}

function toPlugin(item: RawItem): MarketPlugin {
  return {
    fullName: item.full_name ?? '',
    name: item.name ?? '',
    description: item.description ?? '',
    stars: item.stargazers_count ?? 0,
    htmlUrl: item.html_url ?? '',
  }
}

/* ---- static registry (CDN first, raw fallback) ---- */

let registryCache: MarketPage | null = null

/** Drop the cached registry so the next load re-fetches it (the refresh button). */
export function invalidateRegistry(): void {
  registryCache = null
}

async function fetchRegistry(): Promise<MarketPage> {
  if (registryCache !== null) return registryCache
  const urls = [
    `https://cdn.jsdelivr.net/gh/${REGISTRY_REPO}@main/registry.json`,
    `https://raw.githubusercontent.com/${REGISTRY_REPO}/main/registry.json`,
  ]
  let lastError: unknown = new Error('registry unavailable')
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) {
        lastError = new Error(`registry ${response.status}`)
        continue
      }
      const payload = (await response.json()) as { plugins?: RawItem[] }
      const items = (payload.plugins ?? [])
        .map(toPlugin)
        .filter(item => item.fullName.length > 0 && !EXCLUDED.has(item.fullName))
      registryCache = { items, totalCount: items.length }
      return registryCache
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('registry unavailable')
}

/* ---- GitHub search API (fallback + registry generation source) ---- */

async function searchApi(page: number, perPage: number, search: string): Promise<MarketPage> {
  const term = search.trim().length > 0 ? `topic:dsh-plugin ${search.trim()}` : 'topic:dsh-plugin'
  const params = new URLSearchParams({
    q: term,
    sort: 'stars',
    order: 'desc',
    per_page: String(perPage),
    page: String(page),
  })
  const response = await fetch(`https://api.github.com/search/repositories?${params.toString()}`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) {
    throw new Error(`GitHub search failed: ${response.status} ${response.statusText}`)
  }
  const payload = (await response.json()) as { total_count?: number; items?: RawItem[] }
  const items = (payload.items ?? [])
    .map(toPlugin)
    .filter(item => item.fullName.length > 0 && !EXCLUDED.has(item.fullName))
  return { items, totalCount: payload.total_count ?? items.length }
}

/** Case-insensitive free-text match against a plugin's name and description. */
function matches(item: MarketPlugin, term: string): boolean {
  const needle = term.toLowerCase()
  return item.fullName.toLowerCase().includes(needle)
    || item.name.toLowerCase().includes(needle)
    || item.description.toLowerCase().includes(needle)
}

/**
 * Fetch one page of the market. Prefers the static registry (CDN), falling back
 * to the GitHub search API. With the registry the whole list is fetched once and
 * then filtered/sorted/paginated locally — no API rate limits.
 */
export async function fetchMarketPage(page: number, perPage: number, search = ''): Promise<MarketPage> {
  try {
    const registry = await fetchRegistry()
    const term = search.trim()
    const filtered = term.length === 0 ? registry.items : registry.items.filter(item => matches(item, term))
    const sorted = [...filtered].sort((a, b) => b.stars - a.stars)
    const start = (page - 1) * perPage
    return { items: sorted.slice(start, start + perPage), totalCount: sorted.length }
  } catch {
    return searchApi(page, perPage, search)
  }
}

/** Fetch the latest `version` from a repo's root package.json (base64 contents API). */
export async function fetchLatestVersion(fullName: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://api.github.com/repos/${fullName}/contents/package.json`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return undefined
    const payload = (await response.json()) as { content?: string; encoding?: string }
    if (payload.content === undefined || payload.encoding !== 'base64') return undefined
    const text = atob(payload.content.replace(/\n/g, ''))
    const pkg = JSON.parse(text) as { version?: string }
    return pkg.version
  } catch {
    return undefined
  }
}
