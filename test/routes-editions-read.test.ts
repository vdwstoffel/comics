import { test, expect } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook } from '../server/models/books.js'
import { getProgress, setProgress } from '../server/models/progress.js'
import type { Config } from '../server/config.js'

type Db = ReturnType<typeof openDb>

function seed(db: Db) {
  const run = upsertEdition(db, { name: 'The Immortal Thor (2023)', folder: 'Thor/The Immortal Thor (2023)', seriesName: 'Thor' })
  const books = [20, 23, 22].map((pageCount, i) =>
    insertBook(db, { editionId: run.id, filePath: `Thor/The Immortal Thor (2023)/${i + 1}.cbz`, pageCount, fileSize: 1 })!)
  const annual = upsertEdition(db, { name: 'The Immortal Thor Annual (2024)', folder: 'Thor/The Immortal Thor Annual (2024)', seriesName: 'Thor' })
  const annualBook = insertBook(db, { editionId: annual.id, filePath: 'Thor/The Immortal Thor Annual (2024)/1.cbz', pageCount: 30, fileSize: 1 })!
  return { run, books, annualBook }
}

async function server(db: Db) {
  const app = Fastify()
  app.decorate('db', db)
  app.decorate('config', { comicsDir: '/tmp/comics', thumbsDir: '/tmp/thumbs' } as Config)
  await app.register(editionRoutes)
  return app
}

// A run read as collections and replaced by its single issues: every issue is one you
// have read, and pressing through them one at a time is the chore this saves.
test('marking a run read marks every comic in it read, on its last page', async () => {
  const db = openDb(':memory:')
  const { run, books } = seed(db)
  const app = await server(db)

  const res = await app.inject({ method: 'PUT', url: `/api/editions/${run.id}/progress`, payload: { completed: true } })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ marked: 3 })
  for (const book of books) {
    expect(getProgress(db, book.id)).toMatchObject({ completed: true, lastPage: book.pageCount - 1 })
  }
  await app.close(); db.close()
})

// The annual sits inside the run on the page, but it is its own edition's comic - and one
// you may not have read just because you read the run.
test('marking a run read leaves the comics of other editions alone', async () => {
  const db = openDb(':memory:')
  const { run, annualBook } = seed(db)
  const app = await server(db)

  await app.inject({ method: 'PUT', url: `/api/editions/${run.id}/progress`, payload: { completed: true } })

  expect(getProgress(db, annualBook.id).completed).toBe(false)
  await app.close(); db.close()
})

test('marking a run unread clears every comic in it back to the start', async () => {
  const db = openDb(':memory:')
  const { run, books } = seed(db)
  for (const book of books) setProgress(db, book.id, { lastPage: book.pageCount - 1, completed: true })
  const app = await server(db)

  const res = await app.inject({ method: 'PUT', url: `/api/editions/${run.id}/progress`, payload: { completed: false } })

  expect(res.json()).toEqual({ marked: 3 })
  for (const book of books) expect(getProgress(db, book.id)).toMatchObject({ completed: false, lastPage: 0 })
  await app.close(); db.close()
})

test('a run that is not there is a 404', async () => {
  const db = openDb(':memory:')
  const app = await server(db)
  const res = await app.inject({ method: 'PUT', url: '/api/editions/999/progress', payload: { completed: true } })
  expect(res.statusCode).toBe(404)
  await app.close(); db.close()
})

// Anything but a real true or false is refused rather than read as one: a stray value
// must not wipe the place you were at in thirty comics.
test('a body that does not say read or unread is refused and changes nothing', async () => {
  const db = openDb(':memory:')
  const { run, books } = seed(db)
  setProgress(db, books[0]!.id, { lastPage: 7, completed: false })
  const app = await server(db)

  const res = await app.inject({ method: 'PUT', url: `/api/editions/${run.id}/progress`, payload: { completed: 'yes' } })

  expect(res.statusCode).toBe(400)
  expect(getProgress(db, books[0]!.id).lastPage).toBe(7)
  await app.close(); db.close()
})
