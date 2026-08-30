import type { ComicMeta } from '../types.js'

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decode(m[1].trim()) : undefined
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function encode(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * ComicInfo names one tag per creator role. Comic Vine sends free-text roles, so each
 * tag owns the pattern that maps onto it and the role name we store it back under.
 * Roles with no tag here (letterers' variants, "assistant", …) simply are not written.
 */
const CREDIT_TAGS: Array<{ tag: string; matches: RegExp; role: string }> = [
  { tag: 'Writer', matches: /^writer$/, role: 'writer' },
  { tag: 'Penciller', matches: /^pencill?er$/, role: 'penciller' },
  { tag: 'Inker', matches: /^inker$/, role: 'inker' },
  { tag: 'Colorist', matches: /^colou?rist$/, role: 'colorist' },
  { tag: 'Letterer', matches: /^letterer$/, role: 'letterer' },
  { tag: 'CoverArtist', matches: /^cover(\s*artist)?$/, role: 'cover' },
  { tag: 'Editor', matches: /^editor$/, role: 'editor' },
]

/** A comma-separated tag read back as a list, or undefined when the tag is absent. */
function list(xml: string, name: string): string[] | undefined {
  const raw = tag(xml, name)
  if (!raw) return undefined
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return items.length ? items : undefined
}

function creditsFrom(xml: string): ComicMeta['credits'] {
  const credits: Array<{ name: string; role: string }> = []
  for (const { tag: name, role } of CREDIT_TAGS) {
    for (const person of list(xml, name) ?? []) credits.push({ name: person, role })
  }
  return credits.length ? credits : undefined
}

export function parseComicInfo(xml: string): ComicMeta {
  const year = tag(xml, 'Year')
  const month = tag(xml, 'Month')
  const date = year ? (month ? `${year}-${String(month).padStart(2, '0')}` : year) : undefined
  return {
    title: tag(xml, 'Title'),
    series: tag(xml, 'Series'),
    number: tag(xml, 'Number'),
    writer: tag(xml, 'Writer'),
    penciller: tag(xml, 'Penciller'),
    summary: tag(xml, 'Summary'),
    publisher: tag(xml, 'Publisher'),
    date,
    credits: creditsFrom(xml),
    characters: list(xml, 'Characters'),
    teams: list(xml, 'Teams'),
    storyArcs: list(xml, 'StoryArc'),
  }
}

export function buildComicInfo(m: ComicMeta): string {
  const parts = ['<?xml version="1.0" encoding="utf-8"?>', '<ComicInfo>']
  const add = (name: string, val: unknown) => { if (val != null && val !== '') parts.push(`  <${name}>${encode(val)}</${name}>`) }
  const addList = (name: string, items?: string[]) => { if (items?.length) add(name, items.join(', ')) }
  add('Title', m.title)
  add('Series', m.series)
  add('Number', m.number)

  // One tag per role listing everyone credited with it. The flat writer/penciller stand
  // in only where the credits name nobody for that role, so a book that never went
  // through Comic Vine still gets its two creators written.
  const flat: Record<string, string | undefined> = { Writer: m.writer, Penciller: m.penciller }
  for (const { tag: name, matches } of CREDIT_TAGS) {
    const credited = (m.credits ?? [])
      .filter((c) => matches.test(c.role.trim().toLowerCase()))
      .map((c) => c.name)
    const named = credited.length ? credited : [flat[name]].filter((v): v is string => !!v)
    addList(name, [...new Set(named)])
  }

  add('Summary', m.summary)
  add('Publisher', m.publisher)
  if (m.date) {
    const [y, mo] = String(m.date).split('-')
    add('Year', y)
    if (mo) add('Month', String(Number(mo)))
  }
  addList('Characters', m.characters)
  addList('Teams', m.teams)
  addList('StoryArc', m.storyArcs)
  parts.push('</ComicInfo>')
  return parts.join('\n')
}
