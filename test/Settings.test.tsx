import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Settings from '../src/pages/Settings'

const SETTINGS = { downloadConcurrency: 1, comicVineApiKey: 'stored-key' }

let posted: string[]
let bodies: string[]
beforeEach(() => {
  posted = []
  bodies = []
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method) { posted.push(`${init.method} ${url}`); bodies.push(String(init.body)) }
    if (init?.method === 'PATCH') {
      return { ok: true, json: async () => ({ ...SETTINGS, ...JSON.parse(String(init.body)) }) }
    }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Settings /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('the key field shows what is stored', async () => {
  draw()
  // findByLabelText resolves as soon as the input exists, which is on the very first
  // render - before the settings query has answered. The value only lands once the draft
  // is seeded from the response, so the value itself has to be waited for separately.
  await waitFor(() => expect(screen.getByLabelText(/api key/i)).toHaveValue('stored-key'))
})

test('saving sends the typed key and nothing else', async () => {
  draw()
  const field = await screen.findByLabelText(/api key/i)
  fireEvent.change(field, { target: { value: 'new-key' } })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))

  await waitFor(() => expect(posted).toContain('PATCH /api/settings'))
  expect(JSON.parse(bodies[0])).toEqual({ comicVineApiKey: 'new-key' })
})

// A rejected key and an unreachable Comic Vine look the same from here; the server's
// message is the only thing that tells them apart, so it is shown rather than a generic
// failure.
test('a refused key shows what the server said', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'PATCH') {
      return {
        ok: false, status: 400,
        json: async () => ({ error: 'Comic Vine did not accept that key: Invalid API Key' }),
      }
    }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch

  draw()
  fireEvent.change(await screen.findByLabelText(/api key/i), { target: { value: 'bad' } })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))

  expect(await screen.findByText(/Invalid API Key/)).toBeInTheDocument()
})

// What you typed is what you have to correct. Reverting it to the stored value on failure
// would make you retype the whole key to fix one character.
test('a refused key is left in the field to correct', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'PATCH') {
      return { ok: false, status: 400, json: async () => ({ error: 'nope' }) }
    }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch

  draw()
  const field = await screen.findByLabelText(/api key/i)
  fireEvent.change(field, { target: { value: 'typo-key' } })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))

  await screen.findByText(/nope/)
  expect(field).toHaveValue('typo-key')
})

// draftKey starts null until the settings query answers. Saving while it is still null
// submits the empty-string path, which skips verification by design and clears whatever
// key is stored - so Save must not be clickable before the query has landed.
test('save cannot fire before the settings query has resolved', async () => {
  let releaseGet: () => void = () => {}
  const gate = new Promise<void>((resolve) => { releaseGet = resolve })

  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method) { posted.push(`${init.method} ${url}`); bodies.push(String(init.body)) }
    if (init?.method === 'PATCH') return { ok: true, json: async () => SETTINGS }
    await gate
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch

  draw()
  const button = await screen.findByRole('button', { name: /save/i })
  expect(button).toBeDisabled()

  fireEvent.click(button)
  expect(posted).toEqual([])

  releaseGet()
  await waitFor(() => expect(button).toBeEnabled())
  expect(posted).toEqual([])
})

test('where to get a key is on the page', async () => {
  draw()
  const link = await screen.findByRole('link', { name: /comicvine\.gamespot\.com/i })
  expect(link).toHaveAttribute('href', 'https://comicvine.gamespot.com/api/')
})

test('the concurrency control shows what is stored', async () => {
  draw()
  expect(await screen.findByLabelText(/at once/i)).toHaveValue('1')
})

test('the control offers one through five and nothing else', async () => {
  draw()
  const select = await screen.findByLabelText(/at once/i) as HTMLSelectElement
  expect([...select.options].map((o) => o.value)).toEqual(['1', '2', '3', '4', '5'])
})

test('changing it patches the server', async () => {
  draw()
  fireEvent.change(await screen.findByLabelText(/at once/i), { target: { value: '3' } })
  await waitFor(() => expect(posted).toContain('PATCH /api/settings'))
  expect(JSON.parse(bodies[0])).toEqual({ downloadConcurrency: 3 })
})

// A dial with no caveat reads as "higher is better", which is not true.
test('the control says that more is not automatically faster', async () => {
  draw()
  expect(await screen.findByText(/not always faster|may not be faster/i)).toBeInTheDocument()
})

// The PATCH response already carries the stored value - that is what the echo is for.
// Relying only on `invalidateQueries` left the select showing the old number until that
// second round trip landed. This proves the select updates without it: the refetch
// invalidate triggers is deliberately held open and never resolves, so if the new value
// only ever arrived through that refetch, the assertion below would time out.
test('the select shows the patched value without waiting for the invalidated refetch', async () => {
  let settingsGets = 0
  let releaseSecondGet: () => void = () => {}
  const secondGetGate = new Promise<void>((resolve) => { releaseSecondGet = resolve })

  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'PATCH') {
      return { ok: true, json: async () => ({ ...SETTINGS, downloadConcurrency: 3 }) }
    }
    settingsGets += 1
    if (settingsGets > 1) await secondGetGate
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch

  draw()
  const select = await screen.findByLabelText(/at once/i) as HTMLSelectElement
  expect(select).toHaveValue('1')

  fireEvent.change(select, { target: { value: '3' } })
  await waitFor(() => expect(select).toHaveValue('3'))

  releaseSecondGet()
})
