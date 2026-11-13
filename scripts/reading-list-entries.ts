/**
 * Writes a reading list's file from a draft, with every value copied from Comic Vine.
 *
 * A reading list lives in code (server/readingLists), and an entry carries the issue's
 * volume, number and cover date so the app never has to ask Comic Vine about a list at
 * view time. Those values are Comic Vine's, never typed: a draft names each issue by its
 * Comic Vine id alone, and this script reads the rest and writes the module. Claude runs it
 * when asked for a list - see .claude/skills/reading-list.
 *
 *   npx tsx scripts/reading-list-entries.ts cbl <file.cbl>
 *       A .cbl reading list (ComicRack's format) as draft issues, ids taken from its
 *       <Database Name="cv"> entries. Printed as JSON to paste into a draft.
 *
 *   npx tsx scripts/reading-list-entries.ts volume <volumeId> <number|from-to>...
 *       Draft issues for numbers in one Comic Vine volume: `volume 55958 1-13 24.NOW`.
 *
 *   npx tsx scripts/reading-list-entries.ts write <draft.json> <server/readingLists/x.ts>
 *       Reads every issue in the draft from Comic Vine (a hundred to a request), checks
 *       each against the series and number the draft expected, and writes the module.
 *       Drafts are kept in scripts/reading-lists/, so a list can be changed and rewritten.
 *
 * The key comes from COMICVINE_KEY, or is read - read-only - from the app's settings in
 * data/library.sqlite. Nothing here writes to the database.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { createComicVine } from '../server/lib/comicvine.js'
import type { CvListedIssue } from '../server/lib/comicvine.js'

interface DraftIssue {
  cv: number
  extra?: boolean
  /** What the source called it, checked against Comic Vine and otherwise ignored. */
  series?: string
  number?: string
}

interface Draft {
  id: number
  slug: string
  name: string
  /** The module's export, e.g. hickmansAvengers. */
  exportName: string
  publisher?: string
  years?: string
  description?: string
  /** A phase holds its issues, or - where the guide splits it - sections that do. */
  phases: DraftPhase[]
}

interface DraftSection { name: string; note?: string | null; issues: DraftIssue[] }
type DraftPhase = DraftSection | { name: string; note?: string | null; sections: DraftSection[] }

const issuesOf = (phase: DraftPhase): DraftIssue[] =>
  'sections' in phase ? phase.sections.flatMap((s) => s.issues) : phase.issues

function comicVineKey(): string {
  if (process.env.COMICVINE_KEY) return process.env.COMICVINE_KEY
  const db = new Database('data/library.sqlite', { readonly: true, fileMustExist: true })
  try {
    const row = db.prepare("SELECT value FROM setting WHERE key = 'comic_vine_api_key'").get() as
      { value: string } | undefined
    if (!row?.value) throw new Error('no Comic Vine key: set COMICVINE_KEY or save one in Settings')
    return row.value.trim()
  } finally {
    db.close()
  }
}

const cv = () => createComicVine({ apiKey: comicVineKey() })

/** The attributes of every <Book> in a .cbl, with the Comic Vine ids from its <Database>. */
function fromCbl(path: string): DraftIssue[] {
  const xml = readFileSync(path, 'utf8')
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
  const issues: DraftIssue[] = []
  for (const book of xml.matchAll(/<Book\b([^>]*)>([\s\S]*?)<\/Book>/g)) {
    const db = /<Database\b[^>]*Name="cv"[^>]*\/?>/.exec(book[2])?.[0]
    const id = Number(db && attr(db, 'Issue'))
    if (!Number.isInteger(id) || id <= 0) {
      console.error(`no Comic Vine id: ${attr(book[1], 'Series')} #${attr(book[1], 'Number')}`)
      continue
    }
    issues.push({ cv: id, series: decodeXml(attr(book[1], 'Series') ?? ''), number: attr(book[1], 'Number') })
  }
  return issues
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

/** `1-13` is every whole number from one to thirteen; anything else names one issue. */
function expandNumbers(specs: string[]): string[] {
  return specs.flatMap((spec) => {
    const range = /^(\d+)-(\d+)$/.exec(spec)
    if (!range) return [spec]
    const out: string[] = []
    for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(String(n))
    return out
  })
}

async function fromVolume(volumeId: number, specs: string[]): Promise<DraftIssue[]> {
  const issues = await cv().listVolumeIssues(volumeId)
  return expandNumbers(specs).flatMap((number) => {
    const found = issues.find((i) => i.number === number)
    if (!found) {
      console.error(`volume ${volumeId} has no #${number}`)
      return []
    }
    return [{ cv: found.id, number }]
  })
}

const loose = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '')
/** Single quotes as the codebase writes them, or double for a name with an apostrophe in it. */
const quote = (s: string) => (s.includes("'") && !s.includes('"')
  ? `"${s.replace(/\\/g, '\\\\')}"`
  : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)

function entryLine(issue: CvListedIssue, extra: boolean): string {
  const fields = [
    `cv: ${issue.id}`,
    `volume: ${quote(issue.volumeName ?? '')}`,
    `volumeId: ${issue.volumeId}`,
    `number: ${quote(issue.number ?? '')}`,
    ...(issue.coverDate ? [`coverDate: ${quote(issue.coverDate)}`] : []),
    ...(issue.name ? [`title: ${quote(issue.name)}`] : []),
    ...(extra ? ['extra: true'] : []),
  ]
  return `        { ${fields.join(', ')} },`
}

async function write(draftPath: string, outPath: string): Promise<void> {
  const draft = JSON.parse(readFileSync(draftPath, 'utf8')) as Draft
  const ids = draft.phases.flatMap((p) => issuesOf(p).map((i) => i.cv))
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dupes.length) throw new Error(`issues listed twice: ${[...new Set(dupes)].join(', ')}`)

  const read = new Map((await cv().listIssuesByIds(ids)).map((i) => [i.id, i]))
  const missing = ids.filter((id) => !read.has(id))
  if (missing.length) throw new Error(`Comic Vine does not know: ${missing.join(', ')}`)

  // The source's own names are a check, not data: a mismatch is the source being wrong
  // about an id, which is the one mistake this file must not inherit.
  for (const issue of draft.phases.flatMap(issuesOf)) {
    const got = read.get(issue.cv)!
    if (issue.number != null && issue.number !== got.number) {
      console.error(`#${issue.cv}: draft says #${issue.number}, Comic Vine says #${got.number} (${got.volumeName})`)
    }
    if (issue.series && !loose(got.volumeName ?? '').startsWith(loose(issue.series).slice(0, 6))) {
      console.error(`#${issue.cv}: draft says ${issue.series}, Comic Vine says ${got.volumeName} #${got.number}`)
    }
    if (got.volumeId == null) throw new Error(`#${issue.cv} has no volume on Comic Vine`)
  }

  const cover = read.get(ids[0])?.imageUrl
  const lines = [
    "import type { ReadingList } from './types.js'",
    '',
    `// Written by scripts/reading-list-entries.ts from ${draftPath} and Comic Vine.`,
    '// Change the draft and write it again; never edit the entries.',
    `export const ${draft.exportName}: ReadingList = {`,
    `  id: ${draft.id},`,
    `  slug: ${quote(draft.slug)},`,
    `  name: ${quote(draft.name)},`,
    ...(draft.publisher ? [`  publisher: ${quote(draft.publisher)},`] : []),
    ...(draft.years ? [`  years: ${quote(draft.years)},`] : []),
    ...(draft.description ? [`  description: ${quote(draft.description)},`] : []),
    ...(cover ? [`  cover: ${quote(cover)},`] : []),
    '  phases: [',
    ...draft.phases.flatMap((phase) => [
      '    {',
      `      name: ${quote(phase.name)},`,
      ...(phase.note ? [`      note: ${quote(phase.note)},`] : []),
      ...('sections' in phase
        ? [
          '      sections: [',
          ...phase.sections.flatMap((section) => [
            '        {',
            `          name: ${quote(section.name)},`,
            ...(section.note ? [`          note: ${quote(section.note)},`] : []),
            '          issues: [',
            ...section.issues.map((i) => `    ${entryLine(read.get(i.cv)!, !!i.extra)}`),
            '          ],',
            '        },',
          ]),
          '      ],',
        ]
        : [
          '      issues: [',
          ...phase.issues.map((i) => entryLine(read.get(i.cv)!, !!i.extra)),
          '      ],',
        ]),
      '    },',
    ]),
    '  ],',
    '}',
    '',
  ]
  writeFileSync(outPath, lines.join('\n'))

  for (const phase of draft.phases) {
    const issues = issuesOf(phase)
    const extras = issues.filter((i) => i.extra).length
    console.error(`${phase.name}: ${issues.length - extras} core, ${extras} extra`)
  }
  console.error(`wrote ${outPath}`)
}

const [command, ...args] = process.argv.slice(2)
if (command === 'cbl' && args[0]) {
  console.log(JSON.stringify(fromCbl(args[0]), null, 2))
} else if (command === 'volume' && args.length >= 2) {
  console.log(JSON.stringify(await fromVolume(Number(args[0]), args.slice(1)), null, 2))
} else if (command === 'write' && args.length === 2) {
  await write(args[0], args[1])
} else {
  console.error('usage: reading-list-entries.ts cbl <file.cbl> | volume <id> <numbers...> | write <draft.json> <out.ts>')
  process.exit(1)
}
