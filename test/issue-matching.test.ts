import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { findMatchForIssue } from '../server/services/issueMatching.js'

/** Put a scraped row in the index. Titles are what the rule reads, so they are real ones. */
function indexRow(db: ReturnType<typeof openDb>, title: string, number: string | null, year: number | null) {
  return db.prepare(
    'INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)'
  ).run(title, `https://x.test/${title}`, 'Marvel Comics', number, year, '2026-09-13T00:00:00.000Z').lastInsertRowid as number
}

// getcomics writes " – " where Comic Vine writes ":", so the volume "Avengers: Armageddon"
// is posted as "Avengers – Armageddon #2 (2026)". That is still one issue of that volume,
// and the edition page has to offer Get for it rather than sending you to the search.
test('a volume spelled with a colon matches the scraped title spelled with a dash', () => {
  const db = openDb(':memory:')
  const rowId = indexRow(db, 'Avengers – Armageddon #2 (2026)', '002', 2026)

  const hit = findMatchForIssue(db, 'Avengers: Armageddon', {
    id: 1179747, number: '2', coverDate: '2026-09-01',
  })

  expect(hit).toEqual({ indexId: rowId, title: 'Avengers – Armageddon #2 (2026)' })
  db.close()
})

// The other half of that widening. A miniseries counts as one issue now, so the key has
// to be the whole name - otherwise "Thor – Ages of Thunder #1" would answer for Thor #1.
test('an offshoot does not match the volume it is named after', () => {
  const db = openDb(':memory:')
  indexRow(db, 'Thor – Ages of Thunder #1 (2008)', '001', 2008)

  const hit = findMatchForIssue(db, 'Thor', { id: 155200, number: '1', coverDate: '2008-06-01' })

  expect(hit).toBeNull()
  db.close()
})
