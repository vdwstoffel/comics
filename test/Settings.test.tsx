import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import ComicVineSection from '../src/pages/settings/ComicVineSection'
import DownloadsSection from '../src/pages/settings/DownloadsSection'
import ReadingSection from '../src/pages/settings/ReadingSection'

const SETTINGS = { downloadConcurrency: 1, comicVineApiKey: 'stored-key', hidePageBar: false }
/* The sidebar tests draw the whole app, which brings the download bar with it; nothing
   here is about downloads, so it is served empty. */
const NO_DOWNLOADS = { active: [], queue: [], history: [] }

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
    if (String(url).includes('/api/downloads')) return { ok: true, json: async () => NO_DOWNLOADS }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

/** One section on its own, which is how the router draws them: one pane at a time. */
function draw(section: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{section}</MemoryRouter>
    </QueryClientProvider>,
  )
  // The client itself, for the one test that asserts on what a refresh invalidates.
  return { ...rendered, qc }
}

/** The whole app at a url, so the sidebar tests exercise the real routes. */
function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The sidebar, named so the header's own Settings link cannot be mistaken for it. */
const sidebar = () => screen.getByRole('navigation', { name: 'Settings sections' })

// --- The sidebar -------------------------------------------------------------------------

test('the sidebar lists the sections', async () => {
  renderAt('/settings')
  await waitFor(() => expect(sidebar()).toBeInTheDocument())
  expect(within(sidebar()).getAllByRole('link').map((a) => a.textContent))
    .toEqual(['Comic Vine', 'Downloads', 'Reading'])
})

// /settings is the link in the header, so it has to land somewhere rather than on a
// sidebar beside an empty pane.
test('/settings opens on Comic Vine', async () => {
  renderAt('/settings')
  expect(await screen.findByLabelText(/api key/i)).toBeInTheDocument()
  expect(within(sidebar()).getByRole('link', { name: 'Comic Vine' }))
    .toHaveAttribute('aria-current', 'page')
})

// The point of the whole change: one section at a time, not all four down one scroll.
test('a section shows its own controls and not another section\'s', async () => {
  renderAt('/settings/downloads')
  expect(await screen.findByLabelText(/at once/i)).toBeInTheDocument()
  expect(screen.queryByLabelText(/api key/i)).toBeNull()
  expect(screen.queryByLabelText(/hide the page bar/i)).toBeNull()
})

test('clicking a sidebar entry swaps the pane', async () => {
  renderAt('/settings')
  await screen.findByLabelText(/api key/i)

  fireEvent.click(within(sidebar()).getByRole('link', { name: 'Reading' }))

  expect(await screen.findByLabelText(/hide the page bar/i)).toBeInTheDocument()
  expect(screen.queryByLabelText(/api key/i)).toBeNull()
  expect(within(sidebar()).getByRole('link', { name: 'Reading' }))
    .toHaveAttribute('aria-current', 'page')
})

// The point of folding the old /downloads page in here: the dial and the queue it
// governs are one pane, not a setting in one place and its effect in another.
test('the dial and the queue it governs are on the same pane', async () => {
  renderAt('/settings/downloads')
  expect(await screen.findByLabelText(/at once/i)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: /now downloading/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Queue' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument()
})

test('each section has a url of its own', async () => {
  renderAt('/settings/reading')
  expect(await screen.findByLabelText(/hide the page bar/i)).toBeInTheDocument()
})

// --- Missing metadata in the sidebar -----------------------------------------------------

function serve(count: number) {
  const followups = Array.from({ length: count }, (_, i) => ({
    bookId: i + 1, title: `Comic ${i + 1}`, fileName: `c${i + 1}.cbz`, bookCvId: 1000 + i,
    cvSiteUrl: null, addedAt: '2026-10-20T09:00:00Z', missing: ['summary'],
    manual: false, typedIssueId: null, checkedAt: null, cvMissing: [],
  }))
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method) { posted.push(`${init.method} ${url}`); return { ok: true, json: async () => ({ dismissed: true }) } }
    if (String(url) === '/api/metadata-followups') return { ok: true, json: async () => ({ followups }) }
    if (String(url).includes('/api/downloads')) return { ok: true, json: async () => NO_DOWNLOADS }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch
}

test('the entry carries how many comics are missing metadata', async () => {
  serve(16)
  renderAt('/settings')
  const entry = await within(sidebar()).findByRole('link', { name: /missing metadata/i })
  expect(within(entry).getByLabelText('16 comics')).toHaveTextContent('16')
})

test('one comic is not "1 comics"', async () => {
  serve(1)
  renderAt('/settings')
  const entry = await within(sidebar()).findByRole('link', { name: /missing metadata/i })
  expect(within(entry).getByLabelText('1 comic')).toBeInTheDocument()
})

// An entry that is empty every time you open it teaches you to stop opening it.
test('the entry is absent when nothing is missing metadata', async () => {
  serve(0)
  renderAt('/settings')
  await screen.findByLabelText(/api key/i)
  expect(within(sidebar()).queryByRole('link', { name: /missing metadata/i })).toBeNull()
})

test('the entry opens the list', async () => {
  serve(3)
  renderAt('/settings')
  fireEvent.click(await within(sidebar()).findByRole('link', { name: /missing metadata/i }))
  expect(await screen.findByRole('link', { name: 'Comic 1' })).toBeInTheDocument()
})

// Bulk upload links straight at this url, and it predates the sidebar.
test('/settings/metadata still lands on the list', async () => {
  serve(3)
  renderAt('/settings/metadata')
  expect(await screen.findByRole('link', { name: 'Comic 1' })).toBeInTheDocument()
  expect(sidebar()).toBeInTheDocument()
})

// --- Comic Vine --------------------------------------------------------------------------

test('the key field shows what is stored', async () => {
  draw(<ComicVineSection />)
  // findByLabelText resolves as soon as the input exists, which is on the very first
  // render - before the settings query has answered. The value only lands once the draft
  // is seeded from the response, so the value itself has to be waited for separately.
  await waitFor(() => expect(screen.getByLabelText(/api key/i)).toHaveValue('stored-key'))
})

test('saving sends the typed key and nothing else', async () => {
  draw(<ComicVineSection />)
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

  draw(<ComicVineSection />)
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

  draw(<ComicVineSection />)
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

  draw(<ComicVineSection />)
  const button = await screen.findByRole('button', { name: /save/i })
  expect(button).toBeDisabled()

  fireEvent.click(button)
  expect(posted).toEqual([])

  releaseGet()
  await waitFor(() => expect(button).toBeEnabled())
  expect(posted).toEqual([])
})

test('where to get a key is on the page', async () => {
  draw(<ComicVineSection />)
  const link = await screen.findByRole('link', { name: /comicvine\.gamespot\.com/i })
  expect(link).toHaveAttribute('href', 'https://comicvine.gamespot.com/api/')
})

// --- Downloads ---------------------------------------------------------------------------

test('the concurrency control shows what is stored', async () => {
  draw(<DownloadsSection />)
  expect(await screen.findByLabelText(/at once/i)).toHaveValue('1')
})

test('the control offers one through five and nothing else', async () => {
  draw(<DownloadsSection />)
  const select = await screen.findByLabelText(/at once/i) as HTMLSelectElement
  expect([...select.options].map((o) => o.value)).toEqual(['1', '2', '3', '4', '5'])
})

test('changing it patches the server', async () => {
  draw(<DownloadsSection />)
  fireEvent.change(await screen.findByLabelText(/at once/i), { target: { value: '3' } })
  await waitFor(() => expect(posted).toContain('PATCH /api/settings'))
  expect(JSON.parse(bodies[0])).toEqual({ downloadConcurrency: 3 })
})

// A dial with no caveat reads as "higher is better", which is not true.
test('the control says that more is not automatically faster', async () => {
  draw(<DownloadsSection />)
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

  draw(<DownloadsSection />)
  const select = await screen.findByLabelText(/at once/i) as HTMLSelectElement
  expect(select).toHaveValue('1')

  fireEvent.change(select, { target: { value: '3' } })
  await waitFor(() => expect(select).toHaveValue('3'))

  releaseSecondGet()
})

// --- Reading -----------------------------------------------------------------------------

test('the page-bar checkbox is clear on an install that never set it', async () => {
  draw(<ReadingSection />)
  await waitFor(() => expect(screen.getByLabelText(/hide the page bar/i)).not.toBeChecked())
})

test('the page-bar checkbox shows what is stored', async () => {
  globalThis.fetch = vi.fn(async () => (
    { ok: true, json: async () => ({ ...SETTINGS, hidePageBar: true }) }
  )) as unknown as typeof fetch
  draw(<ReadingSection />)
  await waitFor(() => expect(screen.getByLabelText(/hide the page bar/i)).toBeChecked())
})

test('ticking the box saves that and nothing else', async () => {
  draw(<ReadingSection />)
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
  draw(<ReadingSection />)
  await waitFor(() => expect(screen.getByLabelText(/hide the page bar/i)).toBeChecked())
  fireEvent.click(screen.getByLabelText(/hide the page bar/i))
  await waitFor(() => expect(posted).toContain('PATCH /api/settings'))
  expect(JSON.parse(bodies[0])).toEqual({ hidePageBar: false })
})
