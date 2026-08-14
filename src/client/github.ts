/** GitHub `dsh-plugin` topic search client for the market. */

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

interface RawItem {
  full_name?: string
  name?: string
  description?: string | null
  stargazers_count?: number
  html_url?: string
}

/**
 * Fetch one page of the `dsh-plugin` topic, sorted by stars.
 * @param page - 1-based page number.
 * @param perPage - repositories per page (GitHub caps at 100).
 * @param search - optional free-text filter combined with the topic.
 * @returns the page plus the topic total.
 */
export async function fetchMarketPage(page: number, perPage: number, search = ''): Promise<MarketPage> {
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
    .map((item): MarketPlugin => ({
      fullName: item.full_name ?? '',
      name: item.name ?? '',
      description: item.description ?? '',
      stars: item.stargazers_count ?? 0,
      htmlUrl: item.html_url ?? '',
    }))
    .filter(item => item.fullName.length > 0 && !EXCLUDED.has(item.fullName))
  return { items, totalCount: payload.total_count ?? items.length }
}
