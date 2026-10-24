import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Settings from '../src/pages/Settings'

const SETTINGS = { downloadConcurrency: 1, comicVineApiKey: 'stored-key', hidePageBar: false }

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
  const rendered = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Settings /></MemoryRouter>
    </QueryClientProvider>,
  )
  // The client itself, for the one test that asserts on what a refresh invalidates.
  return { ...rendered, qc }
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

test('the page-bar checkbox is clear on an install that never set it', async () => {
  draw()
  await waitFor(() => expect(screen.getByLabelText(/hide the page bar/i)).not.toBeChecked())
})

test('the page-bar checkbox shows what is stored', async () => {
  globalThis.fetch = vi.fn(async () => (
    { ok: true, json: async () => ({ ...SETTINGS, hidePageBar: true }) }
  )) as unknown as typeof fetch
  draw()
  await waitFor(() => expect(screen.getByLabelText(/hide the page bar/i)).toBeChecked())
})

test('ticking the box saves that and nothing else', async () => {
  draw()
  fireEvent.click(await screen.findByLabelText(/hide the page bar/i))
  await waitFor(() => expect(posted).toContain('PATCH /api/settings'))
  expect(JSON.parse(bodies[0])).toEqual({ hidePageBar: true })
})

test('clearing the box saves the bar back', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method) { posted.push(`${init.method} ${url}`); bodies.push(String(init.body)) }
    if (init?.method === 'PATCH') {
      return { ok: true, json: async () => ({ ...SETTINGS, ...JSON.parse(String(init.body)) }) }
    }
    return { ok: true, json: async () => ({ ...SETTINGS, hidePageBar: true }) }
  }) as unknown as typeof fetch
  draw()
  await waitFor(() => expect(screen.getByLabelText(/hide the page bar/i)).toBeChecked())
  fireEvent.click(screen.getByLabelText(/hide the page bar/i))
  await waitFor(() => expect(posted).toContain('PATCH /api/settings'))
  expect(JSON.parse(bodies[0])).toEqual({ hidePageBar: false })
})

// --- The pointer to the metadata follow-ups page ----------------------------------------
// Row behaviour (Refresh, Dismiss, the three states) is covered in MetadataFollowups.test.tsx
// against the shared FollowupList; here is what is particular to the Settings section.

function serve(count: number) {
  const followups = Array.from({ length: count }, (_, i) => ({
    bookId: i + 1, title: `Comic ${i + 1}`, fileName: `c${i + 1}.cbz`, bookCvId: 1000 + i,
    cvSiteUrl: null, addedAt: '2026-10-20T09:00:00Z', missing: ['summary'],
    manual: false, typedIssueId: null, checkedAt: null, cvMissing: [],
  }))
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method) { posted.push(`${init.method} ${url}`); return { ok: true, json: async () => ({ dismissed: true }) } }
    if (url === '/api/metadata-followups') return { ok: true, json: async () => ({ followups }) }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch
}

test('the entry shows how many comics are missing metadata', async () => {
  serve(16)
  draw()
  expect(await screen.findByRole('link', { name: /metadata follow-ups.*16 comics/i })).toBeInTheDocument()
})

test('the entry links to the follow-ups page', async () => {
  serve(3)
  draw()
  expect(await screen.findByRole('link', { name: /metadata follow-ups/i })).toHaveAttribute('href', '/settings/metadata')
})

test('one comic is not "1 comics"', async () => {
  serve(1)
  draw()
  expect(await screen.findByRole('link', { name: /1 comic$/i })).toBeInTheDocument()
})

test('the entry is absent when nothing is missing metadata', async () => {
  serve(0)
  draw()
  await screen.findByLabelText(/api key/i)
  expect(screen.queryByText(/follow-ups/i)).toBeNull()
  expect(screen.queryByRole('link', { name: /metadata/i })).toBeNull()
})

// The old test here asserted no rows were drawn in Settings. The user has since asked for
// the rows back as a last section, paged, so what matters now is that a page is drawn and
// the settings above it are still reachable.
test('only the first page of rows is drawn, and the settings above it remain', async () => {
  serve(17)
  draw()
  expect(await screen.findByRole('link', { name: 'Comic 1' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^dismiss/i })).toHaveLength(5)
  expect(screen.queryByRole('link', { name: 'Comic 6' })).toBeNull()
  expect(screen.getByLabelText(/at once/i)).toBeInTheDocument()
})

test('Missing metadata is the last section, after Reading', async () => {
  serve(3)
  draw()
  const heading = await screen.findByRole('heading', { name: 'Missing metadata' })
  const headings = screen.getAllByRole('heading', { level: 2 })
  expect(headings.map((h) => h.textContent)).toEqual(['Comic Vine', 'Downloads', 'Reading', 'Missing metadata'])
  expect(headings[headings.length - 1]).toBe(heading)
})

test('the position and total are shown, and the controls move between pages', async () => {
  serve(17)
  draw()
  expect(await screen.findByText('1–5 of 17')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByText('6–10 of 17')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Comic 6' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Comic 1' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  // The last page is short, and its text must say so rather than "16–20 of 17".
  expect(screen.getByText('16–17 of 17')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^dismiss/i })).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(screen.getByText('11–15 of 17')).toBeInTheDocument()
})

test('no pagination controls when everything fits on one page', async () => {
  serve(5)
  draw()
  await screen.findByRole('link', { name: 'Comic 5' })
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
  expect(screen.queryByText(/ of 5$/)).toBeNull()
})

test('a row in the Settings section can be dismissed', async () => {
  serve(2)
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /dismiss comic 1 /i }))
  await waitFor(() => expect(posted).toEqual(['DELETE /api/metadata-followups/1']))
})
