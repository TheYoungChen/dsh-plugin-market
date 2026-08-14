/** Plugin discovery: static registry (CDN-first) with a GitHub search API fallback. */

/** Installable extension kinds, detected from each repo's root files. */
export type PluginType = 'plugin' | 'skill' | 'preset' | 'script' | 'other'
/** Category filter: everything, or one install kind. */
export type PluginCategory = 'all' | PluginType
/** Sort order for the market list. */
export type MarketSort = 'stars' | 'updated'

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
  /** Last push timestamp (ISO), for the "latest" sort. */
  updatedAt?: string
  /** Detected install kind, when the registry knows it. */
  type?: PluginType
}

/** One page of the market plus the topic's total repository count. */
export interface MarketPage {
  items: MarketPlugin[]
  totalCount: number
  /** Category tally over the full registry (not search-filtered). */
  counts: Record<string, number>
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
  pushed_at?: string | null
  updated_at?: string | null
  type?: PluginType
}

function toPlugin(item: RawItem): MarketPlugin {
  const updatedAt = item.pushed_at ?? item.updated_at ?? ''
  return {
    fullName: item.full_name ?? '',
    name: item.name ?? '',
    description: item.description ?? '',
    stars: item.stargazers_count ?? 0,
    htmlUrl: item.html_url ?? '',
    ...(updatedAt !== '' ? { updatedAt } : {}),
    ...(item.type !== undefined ? { type: item.type } : {}),
  }
}

/**
 * Fetch with a hard timeout so a blocked CDN or API never hangs the market;
 * callers fall back to the next source when this aborts.
 */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => { controller.abort() }, ms)
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

/* ---- static registry (CDN first, raw fallback, localStorage last-known) ---- */

let registryCache: MarketPage | null = null
const REGISTRY_STORAGE_KEY = 'dsh-market-registry-v1'

function readStoredRegistry(): MarketPage | null {
  try {
    const raw = window.localStorage.getItem(REGISTRY_STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { items?: MarketPlugin[]; totalCount?: number }
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null
    return { items: parsed.items, totalCount: parsed.totalCount ?? parsed.items.length }
  } catch {
    return null
  }
}

function writeStoredRegistry(page: MarketPage): void {
  try {
    window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify({ items: page.items, totalCount: page.totalCount }))
  } catch {
    // Quota or privacy mode — the in-memory cache still covers this session.
  }
}

/** Drop the cached registry so the next load re-fetches it (the refresh button). */
export function invalidateRegistry(): void {
  registryCache = null
  try {
    window.localStorage.removeItem(REGISTRY_STORAGE_KEY)
  } catch {
    // ignore
  }
}

async function fetchRegistry(): Promise<MarketPage> {
  if (registryCache !== null) return registryCache
  const stored = readStoredRegistry()
  if (stored !== null) {
    registryCache = stored
    return stored
  }
  const urls = [
    `https://cdn.jsdelivr.net/gh/${REGISTRY_REPO}@main/registry.json`,
    `https://raw.githubusercontent.com/${REGISTRY_REPO}/main/registry.json`,
  ]
  let lastError: unknown = new Error('registry unavailable')
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, 2500)
      if (!response.ok) {
        lastError = new Error(`registry ${response.status}`)
        continue
      }
      const payload = (await response.json()) as { plugins?: RawItem[] }
      const items = (payload.plugins ?? [])
        .map(toPlugin)
        .filter(item => item.fullName.length > 0 && !EXCLUDED.has(item.fullName))
      registryCache = { items, totalCount: items.length }
      writeStoredRegistry(registryCache)
      return registryCache
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('registry unavailable')
}

/* ---- GitHub search API (fallback) ---- */

async function searchApi(page: number, perPage: number, search: string): Promise<MarketPage> {
  const term = search.trim().length > 0 ? `topic:dsh-plugin ${search.trim()}` : 'topic:dsh-plugin'
  const params = new URLSearchParams({
    q: term,
    sort: 'stars',
    order: 'desc',
    per_page: String(perPage),
    page: String(page),
  })
  const response = await fetchWithTimeout(`https://api.github.com/search/repositories?${params.toString()}`, 6000)
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
 * @param category - filter by install kind ('all' shows everything).
 * @param sort - 'stars' (most popular) or 'updated' (most recent push).
 */
export async function fetchMarketPage(
  page: number,
  perPage: number,
  search = '',
  category: PluginCategory = 'all',
  sort: MarketSort = 'stars',
): Promise<MarketPage> {
  try {
    const registry = await fetchRegistry()
    const counts: Record<string, number> = { all: registry.items.length }
    for (const item of registry.items) {
      const key = item.type ?? 'other'
      counts[key] = (counts[key] ?? 0) + 1
    }
    const term = search.trim().toLowerCase()
    const filtered = registry.items.filter(item => {
      if (category !== 'all' && (item.type ?? 'other') !== category) return false
      return term.length === 0 || matches(item, term)
    })
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'updated') return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
      return b.stars - a.stars
    })
    const start = (page - 1) * perPage
    return { items: sorted.slice(start, start + perPage), totalCount: sorted.length, counts }
  } catch {
    const fallback = await searchApi(page, perPage, search)
    return { ...fallback, counts: { all: fallback.totalCount } }
  }
}

/** Fetch the latest `version` from a repo's root package.json (base64 contents API). */
export async function fetchLatestVersion(fullName: string): Promise<string | undefined> {
  try {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${fullName}/contents/package.json`, 6000)
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
