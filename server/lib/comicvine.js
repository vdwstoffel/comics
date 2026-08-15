import { stripHtml } from './html.js'

const BASE = 'https://comicvine.gamespot.com/api'
const UA = 'comic-app/0.1 (self-hosted personal comic library)'
const TYPE_PREFIX = { issue: '4000', volume: '4050' }

export function createComicVine({ apiKey, fetchImpl = fetch, now = () => Date.now() }) {
  let lastCall = 0
  async function throttle() {
    const wait = 1000 - (now() - lastCall)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = now()
  }

  async function get(path, params) {
    if (!apiKey) throw new Error('Comic Vine API key not configured')
    await throttle()
    const qs = new URLSearchParams({ api_key: apiKey, format: 'json', ...params })
    const res = await fetchImpl(`${BASE}${path}?${qs}`, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`Comic Vine HTTP ${res.status}`)
    return res.json()
  }

  const year = (d) => (d ? String(d).slice(0, 4) : undefined)
  const ym = (d) => (d ? String(d).slice(0, 7) : undefined)
  const credit = (list, roleRe) => {
    const p = (list || []).find((c) => roleRe.test(c.role || ''))
    return p ? p.name : undefined
  }

  return {
    async search(query, type = 'issue') {
      const data = await get('/search/', { query, resources: type, limit: '10' })
      return (data.results || []).map((r) => ({
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
      const r = data.results || {}
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
      const r = data.results || {}
      return { name: r.name, publisher: r.publisher?.name, summary: stripHtml(r.description) }
    },
  }
}
