import { stripHtml } from './html.js'

const BASE = 'https://comicvine.gamespot.com/api'
const UA = 'comic-app/0.1 (self-hosted personal comic library)'
const TYPE_PREFIX: Record<string, string> = { issue: '4000', volume: '4050' }

interface CvImage {
  thumb_url?: string
  original_url?: string
}
interface CvPerson {
  name?: string
  role?: string
}
interface CvResult {
  id?: number
  name?: string
  issue_number?: string
  cover_date?: string
  start_year?: string
  description?: string
  image?: CvImage
  volume?: { name?: string }
  publisher?: { name?: string }
  person_credits?: CvPerson[]
}
interface CvResponse {
  results?: CvResult | CvResult[]
}

export interface CvSearchResult {
  id?: number
  name?: string
  issueNumber?: string
  publisher?: string
  year?: string
  thumbnail?: string
}
export interface CvIssue {
  title?: string
  number?: string
  date?: string
  summary?: string
  writer?: string
  penciller?: string
  coverUrl?: string
}
export interface CvVolume {
  name?: string
  publisher?: string
  summary?: string
}

export interface ComicVineOptions {
  apiKey: string
  fetchImpl?: typeof fetch | ((url: string, init?: unknown) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>)
  now?: () => number
}

export interface ComicVineClient {
  search(query: string, type?: string): Promise<CvSearchResult[]>
  getIssue(id: number | string): Promise<CvIssue>
  getVolume(id: number | string): Promise<CvVolume>
}

export function createComicVine({ apiKey, fetchImpl = fetch, now = () => Date.now() }: ComicVineOptions): ComicVineClient {
  let lastCall = 0
  async function throttle() {
    const wait = 1000 - (now() - lastCall)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = now()
  }

  async function get(path: string, params: Record<string, string>): Promise<CvResponse> {
    if (!apiKey) throw new Error('Comic Vine API key not configured')
    await throttle()
    const qs = new URLSearchParams({ api_key: apiKey, format: 'json', ...params })
    const res = await fetchImpl(`${BASE}${path}?${qs}`, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`Comic Vine HTTP ${res.status}`)
    return (await res.json()) as CvResponse
  }

  const year = (d: string | undefined) => (d ? String(d).slice(0, 4) : undefined)
  const ym = (d: string | undefined) => (d ? String(d).slice(0, 7) : undefined)
  const credit = (list: CvPerson[] | undefined, roleRe: RegExp) => {
    const p = (list || []).find((c) => roleRe.test(c.role || ''))
    return p ? p.name : undefined
  }

  return {
    async search(query, type = 'issue') {
      const data = await get('/search/', { query, resources: type, limit: '10' })
      const results = (Array.isArray(data.results) ? data.results : []) as CvResult[]
      return results.map((r) => ({
        id: r.id,
        name: r.volume?.name || r.name,
        issueNumber: r.issue_number,
        publisher: r.publisher?.name,
        year: year(r.cover_date || r.start_year),
        thumbnail: r.image?.thumb_url,
      }))
    },
    async getIssue(id) {
      const data = await get(`/issue/${TYPE_PREFIX.issue}-${id}/`, {})
      const r = (data.results || {}) as CvResult
      return {
        title: r.name, number: r.issue_number, date: ym(r.cover_date),
        summary: stripHtml(r.description),
        writer: credit(r.person_credits, /writer/i),
        penciller: credit(r.person_credits, /pencil/i),
        coverUrl: r.image?.original_url,
      }
    },
    async getVolume(id) {
      const data = await get(`/volume/${TYPE_PREFIX.volume}-${id}/`, {})
      const r = (data.results || {}) as CvResult
      return { name: r.name, publisher: r.publisher?.name, summary: stripHtml(r.description) }
    },
  }
}
