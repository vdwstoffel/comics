import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import settingsRoutes from '../server/routes/settings.js'
import { openDb } from '../server/db.js'
import { getDownloadConcurrency } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

async function setup() {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  const wake = vi.fn()
  app.decorate('downloader', { wake } as never)
  await app.register(settingsRoutes)
  return { app, db, wake, cleanup: async () => { await app.close() } }
}

test('a fresh install reports the default', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ url: '/api/settings' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ downloadConcurrency: 1 })
  } finally { await t.cleanup() }
})

test('a change is persisted and echoed back', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 3 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ downloadConcurrency: 3 })
    expect(getDownloadConcurrency(t.db)).toBe(3)
    expect((await t.app.inject({ url: '/api/settings' })).json().downloadConcurrency).toBe(3)
  } finally { await t.cleanup() }
})

// Without this, raising the limit while one download runs and three wait would start
// nothing until that download happened to end - the pool only re-reads on a wake.
test('raising the limit wakes the pool', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 4 } })
    expect(t.wake).toHaveBeenCalled()
  } finally { await t.cleanup() }
})

test('a value outside the range is refused, changes nothing, and wakes nothing', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 2 } })
    t.wake.mockClear()
    for (const bad of [0, 6, 99, -1]) {
      const res = await t.app.inject({
        method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: bad },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(getDownloadConcurrency(t.db)).toBe(2)
    expect(t.wake).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

test('a non-number is refused, changes nothing, and wakes nothing', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 2 } })
    t.wake.mockClear()
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 'three' },
    })
    expect(res.statusCode).toBe(400)
    expect(getDownloadConcurrency(t.db)).toBe(2)
    expect(t.wake).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

test('a patch with nothing in it is refused rather than silently doing nothing', async () => {
  const t = await setup()
  try {
    expect((await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: {} })).statusCode).toBe(400)
  } finally { await t.cleanup() }
})
