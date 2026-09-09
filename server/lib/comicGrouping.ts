import { deriveSeriesName } from './seriesName.js'

export type ReleaseKind = 'issue' | 'miniseries' | 'bundle' | 'collection' | 'other'

/** Two or more issues in one post: "#126 – 502". */
const RANGE = /#\s*-?\d[^\s]*\s*[–—-]\s*\d/
/** The other way a post says it holds more than one thing: "+ TPBs", "+ Annual". */
const PLUS = /\+\s*(tpbs?|annuals?|omnibus)/i
const COLLECTED = /\b(tpbs?|omnibus|epic collection|masterworks|complete collection|deluxe edition)\b/i
const NUMBERED = /#\s*-?\d/

/** A trailing "(TPB)", "(One Shot)", "(2011)" — repeated, since titles stack them. */
const TRAILING_PARENS = /\s*\([^)]*\)\s*$/
/** " – Subtitle": an offshoot of a series rather than a series of its own. */
const SUBTITLE = /\s+[–—-]\s+/

/**
 * What a scraped title is, as opposed to what series it belongs to.
 *
 * Order is the whole design: a post collecting issues #1-85 also says "+ TPBs", and it
 * is a bundle of issues, not a collected edition. Testing for a range first is what
 * keeps that straight.
 */
export function releaseKind(title: string): ReleaseKind {
  if (RANGE.test(title) || PLUS.test(title)) return 'bundle'
  if (COLLECTED.test(title)) return 'collection'
  if (!NUMBERED.test(title)) return 'other'
  // A subtitled, numbered issue is an offshoot — "Thor – Ages of Thunder #1" — not part
  // of the series' own numbering. Grouping is loose enough to file it under Thor, so
  // separating it here is what keeps a run of Thor from being interrupted by eight
  // unrelated #1s scattered across fifteen years.
  const beforeNumber = title.slice(0, title.indexOf('#'))
  return SUBTITLE.test(beforeNumber) ? 'miniseries' : 'issue'
}

/**
 * The series a title is displayed under, with its original casing.
 *
 * deriveSeriesName alone is not enough here: it was built for edition names, which are
 * already tidy, while these are scraped post titles carrying issue numbers, stacked
 * parentheticals and subtitles.
 */
function displayForm(title: string): string {
  const beforeNumber = title.includes('#') ? title.slice(0, title.indexOf('#')) : title
  let name = deriveSeriesName(beforeNumber.trim())
  // Stacked, so "(TPB) (2011)" comes off entirely rather than one layer per pass.
  let shorter = name.replace(TRAILING_PARENS, '')
  while (shorter !== name && shorter.trim()) {
    name = shorter
    shorter = name.replace(TRAILING_PARENS, '')
  }
  const [head] = name.split(SUBTITLE)
  // Stripping everything would file unrelated titles under one empty heading.
  return (head || name).replace(/\s+/g, ' ').trim() || title.trim()
}

/**
 * The bucket a title belongs in. Case-folded and stripped of a leading "The" so
 * "Ash And Thorn" and "Ash and Thorn", "Mighty Thor" and "The Mighty Thor", are not
 * filed as different series — which is exactly what they were before.
 */
export function seriesKey(title: string): string {
  const key = displayForm(title).replace(/^the\s+/i, '').toLowerCase()
  return key || displayForm(title).toLowerCase()
}

/**
 * The label a group wears. The key is case-folded, so the heading has to come from the
 * members; the commonest spelling is the one that looks least like a typo.
 */
export function displayName(titles: string[]): string {
  const counts = new Map<string, number>()
  for (const title of titles) {
    const form = displayForm(title)
    counts.set(form, (counts.get(form) ?? 0) + 1)
  }
  let best = ''
  let bestCount = -1
  // First past the post: ties go to the earliest, so the label is stable run to run.
  for (const [form, n] of counts) {
    if (n > bestCount) { best = form; bestCount = n }
  }
  return best
}
