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
// The arc response names its issues and nothing else. These are the fields that put them
// in order and give a tile something to say beyond "Issue 1182995".
const ARC_ISSUE_FIELDS = 'id,issue_number,cover_date,store_date,volume'
const VOLUME_ISSUE_FIELDS = 'id,issue_number,name,cover_date,site_detail_url'
// What a candidate row under a search heading shows, and nothing more. The volume's own
// description is deliberately absent: a search returns ten of these, and the reading of a
// series happens on Comic Vine rather than here.
const VOLUME_SEARCH_FIELDS = 'id,name,start_year,publisher,count_of_issues,deck,image,site_detail_url'
/** Enough candidates to hold the one you meant, few enough not to bury the heading. */
const VOLUME_SEARCH_LIMIT = 10
// Comic Vine caps a list response at 100 regardless of what `limit` asks for.
const LIST_PAGE = 100
// What a release tile renders. `image` is here because covers are the point of the
// Latest tab, and they come back on the same request that lists the day - see the
// exception recorded in src/pages/Releases.tsx.
const RELEASE_FIELDS = 'id,issue_number,name,cover_date,store_date,image,site_detail_url,volume'
// Publisher is not on an issue record and /issues/ has no publisher filter, so the
// Marvel/DC split costs one batched volume lookup per day.
const VOLUME_PUBLISHER_FIELDS = 'id,publisher'

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
  store_date?: string
  start_year?: string
  count_of_issues?: number
  deck?: string
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
  number_of_total_results?: number
  /** Comic Vine's own outcome code. 1 is "OK"; everything else is a failure - see get(). */
  status_code?: number
  error?: string
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
/**
 * An issue as the arc page shows it. The arc response itself carries only id, title and
 * link; everything below the link comes from a second, batched lookup, so any of it may be
 * absent when that lookup fails.
 */
export interface CvArcIssue {
  id: number
  name?: string
  siteUrl?: string
  number?: string
  volumeName?: string
  coverDate?: string
  /** The day it reached shops. Runs about two months behind the cover date. */
  storeDate?: string
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
export interface CvVolumeIssue {
  id: number
  number?: string
  name?: string
  coverDate?: string
  siteUrl?: string
}

/** An issue as the Latest tab lists it: one day's on-sale comics. */
export interface CvReleaseIssue {
  id: number
  number?: string
  name?: string
  coverDate?: string
  storeDate?: string
  volumeId: number
  volumeName?: string
  coverUrl?: string
  siteUrl?: string
}

/**
 * A volume as a search offers it: enough to tell which of six Thors you meant, plus the
 * link that answers everything else. Comic Vine ranks these by relevance and we keep that
 * order - the right volume is routinely third, and no re-rank we could write here would
 * beat a guess the reader can make by eye.
 */
export interface CvVolumeMatch {
  id: number
  name?: string
  startYear?: number
  publisher?: string
  issueCount?: number
  deck?: string
  thumbnail?: string
  siteUrl?: string
}

export interface CvVolume {
  name?: string
  publisher?: string
  summary?: string
  startYear?: number
  siteUrl?: string
}

export interface ComicVineOptions {
  /**
   * A getter rather than a string when the key can change while the process runs. Three
   * route plugins build their client once, at registration, and would otherwise hold the
   * key that existed at boot forever. Resolved per request, inside `get`.
   */
  apiKey: string | (() => string)
  fetchImpl?: typeof fetch | ((url: string, init?: unknown) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>)
  now?: () => number
}

export interface ComicVineClient {
  search(query: string, type?: string): Promise<CvSearchResult[]>
  searchVolumes(query: string): Promise<CvVolumeMatch[]>
  getIssue(id: number | string): Promise<CvIssue>
  getVolume(id: number | string): Promise<CvVolume>
  listVolumeIssues(volumeId: number | string): Promise<CvVolumeIssue[]>
  getCharacter(id: number | string): Promise<CvCharacter>
  getStoryArc(id: number | string): Promise<CvStoryArc>
  listIssuesOnSale(day: string): Promise<CvReleaseIssue[]>
  getVolumePublishers(ids: number[]): Promise<Map<number, string | undefined>>
  /** Resolves when Comic Vine accepts the key; throws carrying its reason when it does not. */
  verifyKey(): Promise<void>
}

export function createComicVine({ apiKey, fetchImpl = fetch, now = () => Date.now() }: ComicVineOptions): ComicVineClient {
  // Normalised once so `get` has a single shape to call. A literal is still accepted: every
  // client test and the settings route's verification pass one, and a thunk there would be
  // churn for no gain.
  const readKey = typeof apiKey === 'function' ? apiKey : () => apiKey

  let lastCall = 0
  async function throttle() {
    const wait = 1000 - (now() - lastCall)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = now()
  }

  async function get(path: string, params: Record<string, string>): Promise<CvResponse> {
    const key = readKey()
    if (!key) throw new Error('Comic Vine API key not configured')
    await throttle()
    const qs = new URLSearchParams({ api_key: key, format: 'json', ...params })
    const res = await fetchImpl(`${BASE}${path}?${qs}`, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`Comic Vine HTTP ${res.status}`)
    const data = (await res.json()) as CvResponse
    // Comic Vine answers a rate limit, a bad key or a malformed filter with HTTP 200 and
    // the failure in the body; `status_code` 1 is its only success. Checked here so every
    // caller is covered at once - listIssuesOnSale in particular would otherwise read the
    // absent `results` as a genuinely quiet Wednesday, return [], and have that cached as
    // a real empty day. A response with no status_code at all is taken as success: the
    // field is what signals failure, and absence is not a failure signal.
    if (data.status_code != null && data.status_code !== 1) {
      throw new Error(`Comic Vine error ${data.status_code}${data.error ? `: ${data.error}` : ''}`)
    }
    return data
  }

  const year = (d: string | undefined) => (d ? String(d).slice(0, 4) : undefined)
  const ym = (d: string | undefined) => (d ? String(d).slice(0, 7) : undefined)
  const credit = (list: CvPerson[] | undefined, roleRe: RegExp) => {
    const p = (list || []).find((c) => roleRe.test(c.role || ''))
    return p ? p.name : undefined
  }

  /**
   * Fetch a set of records by id, keyed by id. One request per 100 ids, because Comic
   * Vine caps a list response at 100 however many the filter names - an 86-issue
   * crossover is one call, not 86 against a one-per-second throttle.
   *
   * A chunk that fails is skipped rather than thrown: whatever the other chunks returned
   * beats losing the lot. What that costs differs by caller, and callers must know which
   * they are. For getStoryArc it is an enrichment - the arc still renders, just in id
   * order. For getVolumePublishers it is not: a volume whose publisher stayed unknown is
   * dropped from the day, so a swallowed chunk silently deletes real issues from the
   * page. routes/releases.ts therefore compares the returned map's size against the ids
   * it asked for, and refuses to cache - and flags stale - when they disagree.
   */
  async function byIds(path: string, fieldList: string, ids: number[]): Promise<Map<number, CvResult>> {
    const found = new Map<number, CvResult>()
    for (let i = 0; i < ids.length; i += LIST_PAGE) {
      try {
        const data = await get(path, {
          filter: `id:${ids.slice(i, i + LIST_PAGE).join('|')}`,
          field_list: fieldList,
          limit: String(LIST_PAGE),
        })
        for (const row of (Array.isArray(data.results) ? data.results : []) as CvResult[]) {
          if (row.id != null) found.set(row.id, row)
        }
      } catch {
        // Whatever the other chunks returned still beats losing everything.
      }
    }
    return found
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
    async searchVolumes(query) {
      const data = await get('/search/', {
        query,
        resources: 'volume',
        limit: String(VOLUME_SEARCH_LIMIT),
        field_list: VOLUME_SEARCH_FIELDS,
      })
      const results = (Array.isArray(data.results) ? data.results : []) as CvResult[]
      // A result with no id names no volume and has nothing to link to; drop it rather
      // than render a row that goes nowhere.
      return results.flatMap((r) => {
        if (r.id == null) return []
        const started = Number(r.start_year)
        return [{
          id: r.id,
          name: r.name,
          startYear: Number.isInteger(started) ? started : undefined,
          publisher: r.publisher?.name,
          issueCount: r.count_of_issues,
          deck: r.deck,
          // thumb_url is the 104x160 avatar, which is the size this row wants.
          thumbnail: r.image?.thumb_url || r.image?.small_url,
          siteUrl: r.site_detail_url,
        }]
      })
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

      const issues: CvArcIssue[] = (r.issues || []).flatMap((i) =>
        i.id == null ? [] : [{ id: i.id, name: i.name ?? undefined, siteUrl: i.site_detail_url }])

      // The issues arrive unordered and carry nothing to sort on, so fetch the dates. This
      // is an enrichment, not the page: if the lookup fails the arc still renders, in id
      // order and labelled by the few titles Comic Vine bothered to record.
      const detail = await byIds('/issues/', ARC_ISSUE_FIELDS, issues.map((i) => i.id))
      for (const issue of issues) {
        const d = detail.get(issue.id)
        if (!d) continue
        issue.number = d.issue_number
        issue.volumeName = d.volume?.name
        issue.coverDate = d.cover_date
        issue.storeDate = d.store_date
      }

      // Cover dates run about two months ahead of on-sale dates, so an arc where only some
      // issues carry a store date sorts on cover dates throughout — mixing the two scales
      // would shuffle the halves into each other.
      const byStore = issues.length > 0 && issues.every((i) => i.storeDate)
      const day = (i: CvArcIssue) => (byStore ? i.storeDate : i.coverDate) || ''

      issues.sort((a, b) => {
        const ad = day(a)
        const bd = day(b)
        // An undated issue can't be placed at all; it goes last rather than first.
        if (!ad !== !bd) return ad ? -1 : 1
        if (ad !== bd) return ad < bd ? -1 : 1
        // Same Wednesday: the series the arc is named for reads before its tie-ins.
        const vol = (a.volumeName || '').localeCompare(b.volumeName || '')
        if (vol !== 0) return vol
        const an = Number(a.number)
        const bn = Number(b.number)
        if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn
        // With no detail at all every comparison lands here, which is the old id order.
        return a.id - b.id
      })

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
      const started = Number(r.start_year)
      return {
        name: r.name,
        publisher: r.publisher?.name,
        summary: stripHtml(r.description),
        startYear: Number.isInteger(started) ? started : undefined,
        siteUrl: r.site_detail_url,
      }
    },

    /**
     * Every issue Comic Vine lists for a volume, in issue order.
     *
     * The list has to come from Comic Vine rather than being inferred as 1..N: Marvel keeps
     * legacy numbering across relaunches, so Venom (2025) runs #250-261. Numbers sort
     * numerically - text order puts #10 between #1 and #2 - with the raw string as the
     * tiebreak so a lettered or unnumbered issue still lands somewhere stable.
     *
     * Paging is not optional. A response is capped at 100 and The Amazing Spider-Man (1963)
     * has 651 issues, so a single request would truncate it in silence.
     */
    async listVolumeIssues(volumeId) {
      const issues: CvVolumeIssue[] = []
      let offset = 0
      let total = Infinity

      while (offset < total) {
        const data = await get('/issues/', {
          filter: `volume:${volumeId}`,
          field_list: VOLUME_ISSUE_FIELDS,
          limit: String(LIST_PAGE),
          offset: String(offset),
        })
        const page = (Array.isArray(data.results) ? data.results : []) as CvResult[]
        total = data.number_of_total_results ?? page.length
        for (const r of page) {
          if (r.id == null) continue
          issues.push({
            id: r.id,
            number: r.issue_number,
            name: r.name ?? undefined,
            coverDate: r.cover_date,
            siteUrl: r.site_detail_url,
          })
        }
        // A page that comes back empty would otherwise spin forever against a wrong total.
        if (page.length === 0) break
        offset += page.length
      }

      return issues.sort((a, b) => {
        const an = Number(a.number)
        const bn = Number(b.number)
        if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn
        if (Number.isFinite(an) !== Number.isFinite(bn)) return Number.isFinite(an) ? -1 : 1
        return (a.number ?? '').localeCompare(b.number ?? '')
      })
    },
    async listIssuesOnSale(day) {
      const issues: CvReleaseIssue[] = []
      let offset = 0
      let total = Infinity

      // Paged one day at a time rather than over a date range: rows sharing a store_date
      // have no deterministic tiebreak, so a range paged by offset returns some rows
      // twice and skips others (measured: 26 of 300). One day has an exact total.
      while (offset < total) {
        const data = await get('/issues/', {
          filter: `store_date:${day}|${day}`,
          field_list: RELEASE_FIELDS,
          limit: String(LIST_PAGE),
          offset: String(offset),
        })
        const page = (Array.isArray(data.results) ? data.results : []) as CvResult[]
        total = data.number_of_total_results ?? page.length
        for (const r of page) {
          if (r.id == null || r.volume?.id == null) continue
          issues.push({
            id: r.id,
            ...(r.issue_number == null ? {} : { number: r.issue_number }),
            ...(r.name == null ? {} : { name: r.name }),
            ...(r.cover_date == null ? {} : { coverDate: r.cover_date }),
            ...(r.store_date == null ? {} : { storeDate: r.store_date }),
            volumeId: r.volume.id,
            ...(r.volume.name == null ? {} : { volumeName: r.volume.name }),
            // small_url reads as a cover in a grid; thumb_url is a 104x160 avatar.
            ...((r.image?.small_url || r.image?.thumb_url) == null
              ? {} : { coverUrl: r.image?.small_url || r.image?.thumb_url }),
            ...(r.site_detail_url == null ? {} : { siteUrl: r.site_detail_url }),
          })
        }
        // A page that comes back empty would otherwise spin forever against a wrong total.
        if (page.length === 0) break
        offset += page.length
      }

      return issues
    },
    async getVolumePublishers(ids) {
      const rows = await byIds('/volumes/', VOLUME_PUBLISHER_FIELDS, ids)
      // Every id that came back is in the map, publisher or not: "asked and had none"
      // must stay distinguishable from "never asked".
      return new Map([...rows].map(([id, r]) => [id, r.publisher?.name]))
    },

    /**
     * The smallest request Comic Vine will answer: one row, one field. Its only purpose is
     * the answer `get` already extracts - a rejected key comes back as HTTP 200 with
     * status_code 100, which `get` turns into a throw carrying Comic Vine's own wording.
     */
    async verifyKey(): Promise<void> {
      await get('/issues/', { limit: '1', field_list: 'id' })
    },
  }
}
