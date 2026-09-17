import { test, expect, afterEach } from 'vitest'
import { api } from '../src/api'

const origFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = origFetch })

// The server explains its own refusals, and for a key save that explanation is the entire
// value of the round trip. Reaching the page as "400" would waste it.
test('a refusal carries the server message rather than the status', async () => {
  globalThis.fetch = (async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'Comic Vine did not accept that key: Invalid API Key' }),
  })) as unknown as typeof fetch

  await expect(api.updateSettings({ comicVineApiKey: 'nope' }))
    .rejects.toThrow(/did not accept that key: Invalid API Key/)
})

test('a refusal with no json body still reports the status', async () => {
  globalThis.fetch = (async () => ({
    ok: false,
    status: 502,
    json: async () => { throw new Error('not json') },
  })) as unknown as typeof fetch

  await expect(api.updateSettings({ comicVineApiKey: 'nope' })).rejects.toThrow('502')
})

test('a refusal whose body has no error field still reports the status', async () => {
  globalThis.fetch = (async () => ({
    ok: false, status: 500, json: async () => ({ something: 'else' }),
  })) as unknown as typeof fetch

  await expect(api.updateSettings({ comicVineApiKey: 'nope' })).rejects.toThrow('500')
})

test('one setting can be patched without naming the other', async () => {
  let sent = ''
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent = init.body
    return { ok: true, json: async () => ({ downloadConcurrency: 1, comicVineApiKey: 'abc' }) }
  }) as unknown as typeof fetch

  await api.updateSettings({ comicVineApiKey: 'abc' })
  expect(JSON.parse(sent)).toEqual({ comicVineApiKey: 'abc' })
})
