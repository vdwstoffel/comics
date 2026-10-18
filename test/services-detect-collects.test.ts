import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition, getEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { detectCollects } from '../server/services/detectCollects.js'
import type { ComicVineClient, CvVolume, CvIssue, CvVolumeMatch } from '../server/lib/comicvine.js'
import type { Db } from '../server/types.js'

const ZEB_WELLS_DESC = '<p>Series of trade paperbacks collecting <a data-ref-id="4050-142577">The Amazing Spider-Man</a></p>'
const EIGHT_DEATHS_ISSUE = '<p><em>COLLECTING: Amazing Spider-Man (2022) 61-70</em></p>'

/** Comic Vine, stubbed. Nothing here reaches the network. */
function stubCv(over: Partial<ComicVineClient> = {}): ComicVineClient {
  return {
    searchVolumes: async () => [],
    getIssue: async () => ({ credits: [], characters: [], teams: [], storyArcs: [] } as CvIssue),
    getVolume: async () => ({} as CvVolume),
    listVolumeIssues: async () => [],
    getCharacter: async () => ({ aliases: [] }) as never,
    getStoryArc: async () => ({ issues: [] }) as never,
    listIssuesOnSale: async () => [],
    getVolumePublishers: async () => new Map(),
    verifyKey: async () => {},
    ...over,
  } as ComicVineClient
}

function seedCollection(db: Db, name: string, comicvineId: number) {
  const edition = upsertEdition(db, { name, folder: name })
  updateEdition(db, edition.id, { comicvineId })
  const book = insertBook(db, { editionId: edition.id, filePath: `${name}/1.cbz`, pageCount: 10, fileSize: 100 })!
  updateBook(db, book.id, { comicvineId: 1123097 })
  return edition
}

test('a linked reference in the volume description is the proposal', async () => {
  const db = openDb(':memory:')
  const edition = seedCollection(db, 'Amazing Spider-Man By Zeb Wells (2023)', 150443)
  const cv = stubCv({
    getVolume: async (id) => (Number(id) === 150443
      ? ({ descriptionHtml: ZEB_WELLS_DESC } as CvVolume)
      : ({ name: 'The Amazing Spider-Man', startYear: 2022, siteUrl: 'https://cv/4050-142577/' } as CvVolume)),
  })

  const proposal = await detectCollects({ db, cv }, edition.id)
  expect(proposal).toEqual({
    volumeId: 142577,
    name: 'The Amazing Spider-Man',
    startYear: 2022,
    siteUrl: 'https://cv/4050-142577/',
  })
  db.close()
})

// The 8 Deaths of Spider-Man has an empty volume description. Source two is the whole
// reason it can be detected at all.
test('an empty volume description falls back to the trade issue description', async () => {
  const db = openDb(':memory:')
  const edition = seedCollection(db, 'Amazing Spider-Man: The 8 Deaths Of Spider-Man (2025)', 165956)
  const cv = stubCv({
    getVolume: async (id) => (Number(id) === 165956
      ? ({ descriptionHtml: '' } as CvVolume)
      : ({ name: 'The Amazing Spider-Man', startYear: 2022, siteUrl: 'https://cv/4050-142577/' } as CvVolume)),
    getIssue: async () => ({
      summary: 'x', credits: [], characters: [], teams: [], storyArcs: [],
      descriptionHtml: EIGHT_DEATHS_ISSUE,
    } as unknown as CvIssue),
    searchVolumes: async () => ([
      { id: 2127, name: 'The Amazing Spider-Man', startYear: 1963 },
      { id: 142577, name: 'Amazing Spider-Man', startYear: 2022 },
    ] as CvVolumeMatch[]),
  })

  const proposal = await detectCollects({ db, cv }, edition.id)
  expect(proposal?.volumeId).toBe(142577)
  db.close()
})

test('the search answer must match the year, not just the name', async () => {
  const db = openDb(':memory:')
  const edition = seedCollection(db, 'Some Trade (2025)', 165956)
  const cv = stubCv({
    getVolume: async () => ({ descriptionHtml: '' } as CvVolume),
    getIssue: async () => ({
      credits: [], characters: [], teams: [], storyArcs: [],
      descriptionHtml: EIGHT_DEATHS_ISSUE,
    } as unknown as CvIssue),
    // Right name, wrong run: 1963 is not the volume the line names.
    searchVolumes: async () => ([{ id: 2127, name: 'Amazing Spider-Man', startYear: 1963 }] as CvVolumeMatch[]),
  })

  expect(await detectCollects({ db, cv }, edition.id)).toBeNull()
  db.close()
})

test('nothing to go on proposes nothing', async () => {
  const db = openDb(':memory:')
  const edition = seedCollection(db, 'Mystery Trade (2025)', 999)
  const cv = stubCv({ getVolume: async () => ({ descriptionHtml: '' } as CvVolume) })
  expect(await detectCollects({ db, cv }, edition.id)).toBeNull()
  db.close()
})

// Spec §4: "wait for a yes". Detection offers; only a confirmation writes.
test('detection never writes the column', async () => {
  const db = openDb(':memory:')
  const edition = seedCollection(db, 'Amazing Spider-Man By Zeb Wells (2023)', 150443)
  const cv = stubCv({
    getVolume: async (id) => (Number(id) === 150443
      ? ({ descriptionHtml: ZEB_WELLS_DESC } as CvVolume)
      : ({ name: 'The Amazing Spider-Man', startYear: 2022 } as CvVolume)),
  })

  await detectCollects({ db, cv }, edition.id)
  const back = getEdition(db, edition.id)!
  expect(back.collectsVolumeId).toBeNull()
  expect(back.collectsCheckedAt).toBeNull()
  db.close()
})

test('an edition that collects itself is not a proposal', async () => {
  const db = openDb(':memory:')
  const edition = seedCollection(db, 'Self Referencing (2025)', 142577)
  const cv = stubCv({ getVolume: async () => ({ descriptionHtml: ZEB_WELLS_DESC } as CvVolume) })
  expect(await detectCollects({ db, cv }, edition.id)).toBeNull()
  db.close()
})
