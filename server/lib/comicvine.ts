import { stripHtml, toBlocks } from './html.js'
import type { Block } from './html.js'

const BASE = 'https://comicvine.gamespot.com/api'
const UA = 'comic-app/0.1 (self-hosted personal comic library)'
const TYPE_PREFIX: Record<string, string> = { issue: '4000', volume: '4050', character: '4005', storyArc: '4045' }

// Everything the character card renders. `description` is the ~30KB profile behind the
// expander; it comes down with the card so opening it costs no second request. What stays
// out is `issue_credits` (576 entries for Hobgoblin alone) and `volume_credits` — nothing
// renders them and they would dwarf everything else.
const CHARACTER_FIELDS =
  'id,name,real_name,aliases,deck,description,publisher,first_appeared_in_issue,count_of_issue_appearances,image,site_detail_url'

// `issues` is the point of the arc page. `description` stays out — the arc page shows the
// one-line deck and links out for the rest.
const STORY_ARC_FIELDS = 'id,name,deck,publisher,image,site_detail_url,issues'

interface CvImage {
  thumb_url?: string
  small_url?: string
  medium_url?: string
  original_url?: string
}
interface CvPerson {
  name?: string
  role?: string
}
interface CvNamedItem {
  id?: number
  name?: string
}
interface CvResult {
  id?: number
  name?: string
  issue_number?: string
  cover_date?: string
  start_year?: string
  description?: string
  image?: CvImage
  volume?: { name?: string; id?: number }
  publisher?: { name?: string }
  person_credits?: CvPerson[]
  character_credits?: CvNamedItem[]
  team_credits?: CvNamedItem[]
  story_arc_credits?: CvNamedItem[]
  site_detail_url?: string
}
interface CvCharacterResult {
  id?: number
  name?: string
  real_name?: string
  aliases?: string
  deck?: string
  description?: string
  publisher?: { name?: string }
  first_appeared_in_issue?: { id?: number; name?: string; issue_number?: string }
  count_of_issue_appearances?: number
  image?: CvImage
  site_detail_url?: string
}
interface CvStoryArcResult {
  id?: number
  name?: string
  deck?: string
  publisher?: { name?: string }
  image?: CvImage
  site_detail_url?: string
  issues?: Array<{ id?: number; name?: string; site_detail_url?: string }>
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
  cover?: string
}
export interface CvCredit {
  name: string
  role: string
}

/** A credited character or story arc: the name we display, plus the id that identifies WHICH
 *  one it is. Comic Vine's search can't tell four Hobgoblins apart; this can. */
export interface CvNamedRef {
  id?: number
  name: string
}

export interface CvIssue {
  title?: string
  number?: string
  date?: string
  year?: number
  summary?: string
  writer?: string
  penciller?: string
  credits: CvCredit[]
  characters: CvNamedRef[]
  teams: string[]
  storyArcs: CvNamedRef[]
  coverUrl?: string
  siteUrl?: string
  volumeId?: number
}
export interface CvCharacter {
  id?: number
  name?: string
  realName?: string
  aliases: string[]
  deck?: string
  publisher?: string
  firstAppearance?: string
  appearanceCount?: number
  imageUrl?: string
  siteUrl?: string
  /** The full profile, parsed into blocks so no Comic Vine HTML reaches the page. */
  profile: Block[]
}
/** An issue as a story arc lists it. Comic Vine gives no number, volume or date here. */
export interface CvArcIssue {
  id: number
  name?: string
  siteUrl?: string
}
export interface CvStoryArc {
  id?: number
  name?: string
  deck?: string
  publisher?: string
  imageUrl?: string
  siteUrl?: string
  issues: CvArcIssue[]
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
  getCharacter(id: number | string): Promise<CvCharacter>
  getStoryArc(id: number | string): Promise<CvStoryArc>
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
        // Big enough to read as art in a grid; thumb_url is a 104x160 avatar.
        cover: r.image?.small_url || r.image?.thumb_url,
      }))
    },
    async getIssue(id) {
      const data = await get(`/issue/${TYPE_PREFIX.issue}-${id}/`, {
        field_list: 'name,issue_number,cover_date,description,person_credits,character_credits,team_credits,story_arc_credits,image,site_detail_url,volume',
      })
      const r = (data.results || {}) as CvResult

      // Expand multi-role strings like "writer, cover" into one entry per role
      const credits: CvCredit[] = []
      for (const p of r.person_credits || []) {
        if (!p.name) continue
        const roles = (p.role || 'unknown').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
        for (const role of roles) {
          credits.push({ name: p.name, role })
        }
      }

      const names = (list: CvNamedItem[] | undefined) =>
        (list || []).map((x) => x.name).filter((n): n is string => !!n)
      const refs = (list: CvNamedItem[] | undefined): CvNamedRef[] =>
        (list || []).flatMap((x) => (x.name ? [{ id: x.id, name: x.name }] : []))

      const coverDate = r.cover_date
      const yearNum = coverDate ? parseInt(String(coverDate).slice(0, 4), 10) : undefined

      return {
        title: r.name, number: r.issue_number, date: ym(r.cover_date),
        year: yearNum && !isNaN(yearNum) ? yearNum : undefined,
        summary: stripHtml(r.description),
        writer: credit(r.person_credits, /writer/i),
        penciller: credit(r.person_credits, /pencil/i),
        credits,
        characters: refs(r.character_credits),
        teams: names(r.team_credits),
        storyArcs: refs(r.story_arc_credits),
        coverUrl: r.image?.original_url,
        siteUrl: r.site_detail_url,
        volumeId: r.volume?.id,
      }
    },
    async getCharacter(id) {
      const data = await get(`/character/${TYPE_PREFIX.character}-${id}/`, { field_list: CHARACTER_FIELDS })
      const r = (data.results || {}) as CvCharacterResult

      const fa = r.first_appeared_in_issue
      const firstAppearance = fa?.name
        ? fa.issue_number ? `${fa.name} #${fa.issue_number}` : fa.name
        : undefined

      return {
        id: r.id,
        name: r.name,
        realName: r.real_name,
        // Comic Vine packs aliases into one newline-separated string.
        aliases: (r.aliases || '').split('\n').map((a) => a.trim()).filter(Boolean),
        deck: r.deck,
        publisher: r.publisher?.name,
        firstAppearance,
        appearanceCount: r.count_of_issue_appearances,
        // small_url reads as a portrait; thumb_url is a 104x160 avatar.
        imageUrl: r.image?.small_url || r.image?.thumb_url,
        siteUrl: r.site_detail_url,
        profile: toBlocks(r.description),
      }
    },
    async getStoryArc(id) {
      const data = await get(`/story_arc/${TYPE_PREFIX.storyArc}-${id}/`, { field_list: STORY_ARC_FIELDS })
      const r = (data.results || {}) as CvStoryArcResult

      // The issues arrive unordered and carry no number, volume or date to sort on. Ascending
      // id recovers reading order, because issues enter Comic Vine roughly as published.
      const issues = (r.issues || [])
        .flatMap((i) => (i.id == null ? [] : [{ id: i.id, name: i.name, siteUrl: i.site_detail_url }]))
        .sort((a, b) => a.id - b.id)

      return {
        id: r.id,
        name: r.name,
        deck: r.deck,
        publisher: r.publisher?.name,
        imageUrl: r.image?.medium_url || r.image?.original_url,
        siteUrl: r.site_detail_url,
        issues,
      }
    },
    async getVolume(id) {
      const data = await get(`/volume/${TYPE_PREFIX.volume}-${id}/`, {})
      const r = (data.results || {}) as CvResult
      return { name: r.name, publisher: r.publisher?.name, summary: stripHtml(r.description) }
    },
  }
}
