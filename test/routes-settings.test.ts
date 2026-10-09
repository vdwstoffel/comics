import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import settingsRoutes from '../server/routes/settings.js'
import { openDb } from '../server/db.js'
import { getDownloadConcurrency, getComicVineKey, getHidePageBar } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

async function setup(cvOk = true) {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  const wake = vi.fn()
  app.decorate('downloader', { wake } as never)

  // The route builds its own client from the candidate key; the stub goes in through
  // global fetch, the way every other route suite here does it.
  const origFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url))
    return cvOk
      ? { ok: true, json: async () => ({ status_code: 1, results: [] }) }
      : { ok: true, json: async () => ({ status_code: 100, error: 'Invalid API Key' }) }
  }) as unknown as typeof fetch

  await app.register(settingsRoutes)
  return {
    app, db, wake, calls,
    cleanup: async () => { globalThis.fetch = origFetch; await app.close() },
  }
}

test('a fresh install reports the default', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ url: '/api/settings' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ downloadConcurrency: 1, comicVineApiKey: '', hidePageBar: false })
  } finally { await t.cleanup() }
})

test('a change is persisted and echoed back', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 3 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ downloadConcurrency: 3, comicVineApiKey: '', hidePageBar: false })
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

test('a verified key is stored and echoed back', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'abc123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().comicVineApiKey).toBe('abc123')
    expect(getComicVineKey(t.db)).toBe('abc123')
  } finally { await t.cleanup() }
})

// The whole point of verifying on save: a typo is refused while you are still looking at
// the field, and what was already working is left alone.
test('a key Comic Vine rejects is refused and changes nothing', async () => {
  const t = await setup(false)
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'bad' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/did not accept that key/i)
    expect(res.json().error).toMatch(/Invalid API Key/)
    expect(getComicVineKey(t.db)).toBe('')
  } finally { await t.cleanup() }
})

test('a stored key survives a failed attempt to replace it', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'good' } })
    expect(getComicVineKey(t.db)).toBe('good')

    // Comic Vine now rejects everything.
    globalThis.fetch = (async () => ({
      ok: true, json: async () => ({ status_code: 100, error: 'Invalid API Key' }),
    })) as unknown as typeof fetch

    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'bad' },
    })
    expect(res.statusCode).toBe(400)
    expect(getComicVineKey(t.db)).toBe('good')
  } finally { await t.cleanup() }
})

// There is nothing to verify, and refusing to clear would leave no way back to an
// unconfigured install.
test('clearing the key stores nothing and never calls Comic Vine', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'abc123' } })
    const before = t.calls.length

    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: '' },
    })
    expect(res.statusCode).toBe(200)
    expect(getComicVineKey(t.db)).toBe('')
    expect(t.calls.length).toBe(before)
  } finally { await t.cleanup() }
})

test('a patch that names only one setting leaves the other alone', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 4 } })
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'abc123' } })

    const res = await t.app.inject({ url: '/api/settings' })
    expect(res.json()).toEqual({ downloadConcurrency: 4, comicVineApiKey: 'abc123', hidePageBar: false })
  } finally { await t.cleanup() }
})

// Saving a key has nothing to do with the download queue.
test('saving a key does not wake the download pool', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'abc123' } })
    expect(t.wake).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

test('a key that is not a string is refused', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 42 },
    })
    expect(res.statusCode).toBe(400)
  } finally { await t.cleanup() }
})

// A bare number, string or boolean has no fields to name; the route must refuse it the
// same way an empty object is refused, not throw trying to use `in` on it.
test('a body that is not an object is refused rather than crashing the request', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 2 } })
    t.wake.mockClear()
    const res = await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: 5 as unknown as string })
    expect(res.statusCode).toBe(400)
    expect(getDownloadConcurrency(t.db)).toBe(2)
    expect(getComicVineKey(t.db)).toBe('')
    expect(t.wake).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

// The two settings are independent: a good number is applied and wakes the pool even
// when the key in the same patch is rejected.
test('a patch with a good number and a bad key keeps the number and rejects the key', async () => {
  const t = await setup(false)
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings',
      payload: { downloadConcurrency: 3, comicVineApiKey: 'bad' },
    })
    expect(res.statusCode).toBe(400)
    expect(getDownloadConcurrency(t.db)).toBe(3)
    expect(getComicVineKey(t.db)).toBe('')
    expect(t.wake).toHaveBeenCalled()
  } finally { await t.cleanup() }
})

test('hiding the page bar is persisted and echoed back', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { hidePageBar: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().hidePageBar).toBe(true)
    expect(getHidePageBar(t.db)).toBe(true)
    expect((await t.app.inject({ url: '/api/settings' })).json().hidePageBar).toBe(true)
  } finally { await t.cleanup() }
})

test('showing the page bar again is persisted too', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { hidePageBar: true } })
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { hidePageBar: false },
    })
    expect(res.json().hidePageBar).toBe(false)
    expect(getHidePageBar(t.db)).toBe(false)
  } finally { await t.cleanup() }
})

// The field is a flag, and a truthy string is the shape a careless caller sends. Taking
// it would store a preference the caller never actually expressed.
test('a hidePageBar that is not a boolean is refused', async () => {
  const t = await setup()
  try {
    for (const bad of ['true', 1, null, {}]) {
      const res = await t.app.inject({
        method: 'PATCH', url: '/api/settings', payload: { hidePageBar: bad },
      })
      expect(res.statusCode).toBe(400)
      // Named, so this cannot pass on the "nothing to update" refusal an unknown field gets.
      expect(res.json().error).toMatch(/hidePageBar/)
    }
    expect(getHidePageBar(t.db)).toBe(false)
  } finally { await t.cleanup() }
})

// Each control saves on its own, knowing nothing about the others.
test('hiding the page bar leaves the other settings alone', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 4 } })
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { hidePageBar: true },
    })
    expect(res.json()).toEqual({ downloadConcurrency: 4, comicVineApiKey: '', hidePageBar: true })
  } finally { await t.cleanup() }
})

// Saving a reading preference has nothing to do with the download queue.
test('hiding the page bar does not wake the pool', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { hidePageBar: true } })
    expect(t.wake).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})
