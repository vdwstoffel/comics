import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import Edition from '../src/pages/Edition'

/** The current url, so a test can see what the page has written into it. */
function Where() {
  const loc = useLocation()
  return <span data-testid="where">{loc.pathname}{loc.search}</span>
}

const EDITION = {
  id: 9,
  name: 'Amazing Spider-Man (2025)',
  seriesName: 'Amazing Spider-Man',
  summary: null,
}

const CV_EDITION = {
  id: 9,
  name: 'Vol 7',
  seriesName: 'Amazing Spider-Man',
  summary: null,
  cvName: 'The Amazing Spider-Man',
  cvStartYear: 2025,
}

let patched: { url: string; body: Record<string, unknown> }[]
let deleted: string[]
let posted: { url: string; body: string }[]

function mockFetch(edition: Record<string, unknown> = EDITION, books: unknown[] = []) {
  patched = []
  deleted = []
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    // Edition now reads useDownload() too, to know which missing issues are queued.
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    if (init?.method === 'DELETE') {
      deleted.push(String(url))
      return { ok: true, json: async () => ({ deleted: true, books: 3, seriesName: 'Amazing Spider-Man' }) }
    }
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ edition }) }
    }
    return { ok: true, json: async () => ({ edition, books }) }
  }) as unknown as typeof fetch
}

function issue(number: string, year: number | null) {
  return { id: Number(number), number, title: null, pageCount: 20, comicinfoSynced: false, year }
}

beforeEach(() => { mockFetch() })
afterEach(() => { cleanup() })

function renderPage(path = '/edition/9', client?: QueryClient, entries?: unknown[]) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={(entries ?? [path]) as never}>
        <Where />
        <Routes><Route path="/edition/:id" element={<Edition />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

/**
 * The page with the grid chosen. These tests are about what the grid draws - the whole
 * run at once - which is a different question from what the carousel centres on.
 */
function renderGrid(path = '/edition/9', client?: QueryClient) {
  const [base, query] = path.split('?')
  const params = new URLSearchParams(query)
  params.set('view', 'grid')
  return renderPage(`${base}?${params}`, client)
}

async function startEditing() {
  fireEvent.click(await screen.findByLabelText(/edit edition/i))
}

test('the edit row offers a series field holding the current series', async () => {
  renderPage()
  await startEditing()
  expect(screen.getByLabelText(/^series$/i)).toHaveValue('Amazing Spider-Man')
})

test('the series field is empty when the edition has no series', async () => {
  mockFetch({ ...EDITION, seriesName: null })
  renderPage()
  await startEditing()
  expect(screen.getByLabelText(/^series$/i)).toHaveValue('')
})

test('changing the series sends seriesName and leaves the name alone', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: 'Spider-Man' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({ seriesName: 'Spider-Man' })
})

test('changing the name still renames the edition', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/edition name/i), { target: { value: 'ASM (2025)' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({ name: 'ASM (2025)' })
})

test('saving with nothing changed neither renames nor moves the edition', async () => {
  renderPage()
  await startEditing()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument())
  expect(patched).toEqual([])
})

test('a blank name is refused', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/edition name/i), { target: { value: '  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(patched).toEqual([])
})

test('the editor is a dialog, not shown until the pencil is clicked', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Amazing Spider-Man (2025)' })
  expect(screen.queryByRole('heading', { name: /edit edition/i })).not.toBeInTheDocument()

  await startEditing()
  expect(screen.getByRole('heading', { name: /edit edition/i })).toBeInTheDocument()
})

test('cancelling the dialog closes it and saves nothing', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: 'Something Else' } })
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

  expect(screen.queryByRole('heading', { name: /edit edition/i })).not.toBeInTheDocument()
  expect(patched).toEqual([])
})

test('the dialog closes once a save succeeds', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: 'Spider-Man' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: /edit edition/i })).not.toBeInTheDocument())
})

test('a status in the url is sent to the edition endpoint', async () => {
  renderPage('/edition/9?status=unread')
  await waitFor(() => {
    const urls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/editions/9') && u.includes('readState=unread'))).toBe(true)
  })
})

test('a filtered edition says so and offers a way back to everything', async () => {
  renderPage('/edition/9?status=unread')
  expect(await screen.findByText(/showing unread issues/i)).toBeInTheDocument()
  const showAll = screen.getByRole('link', { name: /show all/i })
  expect(showAll).toHaveAttribute('href', '/edition/9')
})

test('an unfiltered edition shows no filter notice', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Amazing Spider-Man (2025)' })
  expect(screen.queryByText(/showing .* issues/i)).not.toBeInTheDocument()
})

test('the search link carries the series name and the first year in the edition', async () => {
  mockFetch(EDITION, [issue('2', 2025), issue('1', 2023), issue('3', 2024)])
  renderPage()
  const link = await screen.findByRole('link', { name: /find more/i })
  expect(link).toHaveAttribute('href', '/search?q=Amazing+Spider-Man&yearFrom=2023')
})

test('the search link falls back to the edition name when it has no series', async () => {
  mockFetch({ ...EDITION, seriesName: null }, [issue('1', 2025)])
  renderPage()
  const link = await screen.findByRole('link', { name: /find more/i })
  expect(link).toHaveAttribute('href', '/search?q=Amazing+Spider-Man+%282025%29&yearFrom=2025')
})

test('the search link omits the year when no issue has one', async () => {
  mockFetch(EDITION, [issue('1', null)])
  renderPage()
  const link = await screen.findByRole('link', { name: /find more/i })
  expect(link).toHaveAttribute('href', '/search?q=Amazing+Spider-Man')
})

test('Remove edition asks first, naming the edition and its file count', async () => {
  mockFetch(EDITION, [issue('1', 2025), issue('2', 2025), issue('3', 2025)])
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Remove edition' }))

  expect(await screen.findByRole('heading', { name: /remove edition "Amazing Spider-Man \(2025\)"\?/i })).toBeInTheDocument()
  expect(screen.getByText(/3 files will be deleted from disk/i)).toBeInTheDocument()
  expect(deleted).toEqual([])
})

test('confirming sends the DELETE for the edition', async () => {
  mockFetch(EDITION, [issue('1', 2025)])
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Remove edition' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

  await waitFor(() => expect(deleted).toEqual(['/api/editions/9']))
})

test('cancelling the edition removal sends nothing', async () => {
  mockFetch(EDITION, [issue('1', 2025)])
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Remove edition' }))
  fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))

  await waitFor(() => expect(screen.queryByRole('heading', { name: /remove edition/i })).not.toBeInTheDocument())
  expect(deleted).toEqual([])
})

// The page's book list is filtered by ?status=, but removing the edition takes every
// issue with it - so the confirm must count the whole edition, not the visible slice.
test('the removal counts every issue in the edition, not just the filtered ones', async () => {
  const all = [issue('1', 2025), issue('2', 2025), issue('3', 2025)]
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    if (init?.method === 'DELETE') return { ok: true, json: async () => ({ deleted: true, books: 3 }) }
    const filtered = String(url).includes('readState=unread')
    return { ok: true, json: async () => ({ edition: EDITION, books: filtered ? all.slice(0, 1) : all }) }
  }) as unknown as typeof fetch

  renderPage('/edition/9?status=unread')

  fireEvent.click(await screen.findByRole('button', { name: 'Remove edition' }))

  expect(await screen.findByText(/3 files will be deleted from disk/i)).toBeInTheDocument()
})

test('an edition named differently from its Comic Vine volume offers the name', async () => {
  mockFetch(CV_EDITION)
  renderPage()

  expect(await screen.findByRole('button', { name: /rename to The Amazing Spider-Man \(2025\)/i }))
    .toBeInTheDocument()
})

test('an edition already carrying its Comic Vine name offers nothing', async () => {
  mockFetch({ ...CV_EDITION, name: 'The Amazing Spider-Man (2025)' })
  renderPage()

  await screen.findByText(/The Amazing Spider-Man \(2025\)/)
  expect(screen.queryByRole('button', { name: /rename to/i })).not.toBeInTheDocument()
})

test('an edition with no volume resolved yet offers to look it up', async () => {
  mockFetch({ ...CV_EDITION, cvName: null, cvStartYear: null })
  renderPage()

  expect(await screen.findByRole('button', { name: /check comic vine/i })).toBeInTheDocument()
})

// Accepting the suggestion must send the series too: renameEdition restores the old
// series name from carryableMetadata, so a name-only PATCH leaves the series behind.
test('accepting the name sends the series alongside it', async () => {
  mockFetch(CV_EDITION)
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: /rename to/i }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({
    name: 'The Amazing Spider-Man (2025)',
    seriesName: 'The Amazing Spider-Man',
  })
})

// The wording has to change when the target name is already taken: renaming onto it is
// a merge on the server, not a plain rename. This needs the page to know what other
// editions exist, so it reuses the same /api/editions list EditionCombobox draws from.
test('an edition colliding with an existing name offers to merge instead of rename', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ edition: CV_EDITION }) }
    }
    if (String(url).startsWith('/api/editions/9')) {
      return { ok: true, json: async () => ({ edition: CV_EDITION, books: [] }) }
    }
    return {
      ok: true,
      json: async () => ({
        editions: [
          { id: 9, name: 'Vol 7' },
          { id: 42, name: 'The Amazing Spider-Man (2025)' },
        ],
      }),
    }
  }) as unknown as typeof fetch

  renderPage()

  expect(await screen.findByRole('button', { name: /merge into The Amazing Spider-Man \(2025\)/i }))
    .toBeInTheDocument()
})

// The label flips between "Rename to ..." and "Merge into ..." only once we know
// which one is true - so the button must stay disabled until the editions list has
// resolved. Clicking during that window while a collision in fact exists would tell
// the user they're renaming when the server will actually merge, moving every issue
// in this edition into another edition's folder.
test('the button stays disabled until we know whether this is a rename or a merge', async () => {
  let resolveEditions: () => void = () => {}
  const editionsPending = new Promise<void>((resolve) => { resolveEditions = resolve })

  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ edition: CV_EDITION }) }
    }
    if (String(url).startsWith('/api/editions/9')) {
      return { ok: true, json: async () => ({ edition: CV_EDITION, books: [] }) }
    }
    // The editions list resolves only once the test says so, simulating the window
    // between the edition loading and the collision check settling.
    await editionsPending
    return {
      ok: true,
      json: async () => ({
        editions: [
          { id: 9, name: 'Vol 7' },
          { id: 42, name: 'The Amazing Spider-Man (2025)' },
        ],
      }),
    }
  }) as unknown as typeof fetch

  renderPage()

  const button = await screen.findByRole('button', { name: /rename to The Amazing Spider-Man \(2025\)/i })
  expect(button).toBeDisabled()

  resolveEditions()

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /merge into The Amazing Spider-Man \(2025\)/i })).toBeEnabled())
})

// isLoading (v5: isPending && isFetching) only covers the initial fetch - if that fetch
// errors, isLoading flips back to false with no data ever having arrived, so gating on
// it alone would re-enable a "Rename to ..." button whose real answer is still unknown.
// The gate has to be "do we have the data at all", which stays true through pending,
// error, and any future paused state alike.
test('the button stays disabled if the editions list fails to load', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ edition: CV_EDITION }) }
    }
    if (String(url).startsWith('/api/editions/9')) {
      return { ok: true, json: async () => ({ edition: CV_EDITION, books: [] }) }
    }
    // The editions list fails outright. renderPage's QueryClient sets retry: false, so
    // this settles into an error state promptly rather than retrying.
    return { ok: false, status: 500, json: async () => ({}) }
  }) as unknown as typeof fetch

  renderPage()

  const button = await screen.findByRole('button', { name: /rename to The Amazing Spider-Man \(2025\)/i })
  await waitFor(() => expect(button).toBeDisabled())
})

// Missing-issue placeholders. Venom (2025) runs #250-261 on Comic Vine; owning only #255
// should read as a run with holes, not as a one-issue shelf.
const VOLUME_ISSUES = {
  volumeId: 167333,
  owned: 1,
  total: 3,
  extras: [],
  issues: [
    { id: 1136140, number: '250', name: 'Naked and Afraid', siteUrl: 'https://cv/250', owned: false },
    { id: 1159231, number: '255', name: 'Death Spiral', siteUrl: 'https://cv/255', owned: true, bookId: 77 },
    { id: 1173391, number: '259', name: null, siteUrl: 'https://cv/259', owned: false },
  ],
}

// `downloadOk` lets a test make the press itself fail (a 409 from "no unique match",
// a 502 from an unreadable post, and so on all look the same to the page: res.ok is
// false and api.ts's json() throws). Defaults to true so existing callers, which only
// care that the POST was made, are unaffected.
function mockFetchWithIssues(
  issuesBody: unknown,
  edition: Record<string, unknown> = EDITION,
  books: unknown[] = [],
  downloadOk = true,
) {
  posted = []
  deleted = []
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    // A comic can be removed from the run itself now, so this has to answer a DELETE.
    if (init?.method === 'DELETE') {
      deleted.push(String(url))
      return { ok: true, json: async () => ({ deleted: true, editionId: 9, editionRemoved: false }) }
    }
    // Must return here: the download URL itself contains "/issues"
    // (/api/editions/9/issues/1/download), so falling through would answer a download
    // POST with the whole issues body instead of the endpoint's real { started, status }
    // shape.
    if (init?.method === 'POST') {
      posted.push({ url: String(url), body: String(init.body ?? '') })
      return downloadOk
        ? { ok: true, json: async () => ({ started: true, status: { running: true } }) }
        : { ok: false, status: 409, json: async () => ({ error: 'no unique match for that issue' }) }
    }
    if (String(url).includes('/issues')) return { ok: true, json: async () => issuesBody }
    if (init?.method === 'PATCH') return { ok: true, json: async () => ({ edition }) }
    if (String(url).includes('/api/editions?') || String(url).endsWith('/api/editions')) {
      return { ok: true, json: async () => ({ editions: [] }) }
    }
    return { ok: true, json: async () => ({ edition, books }) }
  }) as unknown as typeof fetch
}

test('an issue the volume has but the library does not shows as missing', async () => {
  mockFetchWithIssues(VOLUME_ISSUES)
  renderGrid()

  expect(await screen.findByText('#250')).toBeInTheDocument()
  expect(screen.getAllByText(/missing/i).length).toBe(2)
})

test('missing issues keep their place in the run', async () => {
  mockFetchWithIssues(VOLUME_ISSUES)
  renderGrid()

  await screen.findByText('#250')
  const numbers = screen.getAllByText(/^#(250|255|259)$/).map((n) => n.textContent)
  expect(numbers).toEqual(['#250', '#255', '#259'])
})

test('the header counts the whole run, not just what you have', async () => {
  mockFetchWithIssues(VOLUME_ISSUES)
  renderPage()

  expect(await screen.findByText(/1 of 3 issues/i)).toBeInTheDocument()
})

// A comic you own must never disappear because Comic Vine has not heard of it.
test('a book Comic Vine does not list still appears', async () => {
  mockFetchWithIssues({ ...VOLUME_ISSUES, extras: [{ bookId: 99, number: 'Annual 1', title: 'Annual' }] })
  renderGrid()

  expect(await screen.findByText('Annual')).toBeInTheDocument()
})

test('an edition with no volume shows only the books, no placeholders', async () => {
  mockFetchWithIssues({ volumeId: null, issues: [], extras: [{ bookId: 5, number: '1', title: 'Issue one' }], owned: 0, total: 0 })
  renderGrid()

  expect(await screen.findByText('Issue one')).toBeInTheDocument()
  expect(screen.queryByText(/missing/i)).not.toBeInTheDocument()
})

// A placeholder has no read state, so it cannot honestly survive a read-status filter.
// Waiting for the book to render first is what makes this a real assertion: a bare negative
// check inside waitFor passes on the first tick, before any query has resolved.
test('placeholders drop out when a read filter is on', async () => {
  mockFetchWithIssues(VOLUME_ISSUES, EDITION, [
    { id: 77, number: '255', title: 'Death Spiral', pageCount: 20, comicinfoSynced: false, year: 2026 },
  ])
  renderPage('/edition/9?status=unread')

  expect(await screen.findByText('Death Spiral')).toBeInTheDocument()
  expect(screen.queryByText(/missing/i)).not.toBeInTheDocument()
  expect(screen.queryByText('#250')).not.toBeInTheDocument()
})

// ---- cache surface ----

// When the run was last read is bookkeeping nobody acts on, and it was spending a line of
// the header to say it - three lines, wrapped, in a phone's width.
test('the run does not say when it was last read', async () => {
  mockFetchWithIssues({ ...VOLUME_ISSUES, fetchedAt: '2026-09-04T10:00:00.000Z' })
  renderPage()

  await screen.findByRole('button', { name: /refresh/i })
  expect(screen.queryByText(/as of/i)).toBeNull()
})

test('refreshing the run asks Comic Vine again', async () => {
  const urls: string[] = []
  globalThis.fetch = vi.fn(async (url: string) => {
    urls.push(String(url))
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    if (String(url).includes('/issues')) {
      return { ok: true, json: async () => ({ ...VOLUME_ISSUES, fetchedAt: '2026-09-04T10:00:00.000Z' }) }
    }
    if (String(url).includes('/api/editions?') || String(url).endsWith('/api/editions')) {
      return { ok: true, json: async () => ({ editions: [] }) }
    }
    return { ok: true, json: async () => ({ edition: EDITION, books: [] }) }
  }) as unknown as typeof fetch
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: /refresh/i }))

  await waitFor(() => expect(urls.some((u) => u.includes('refresh=1'))).toBe(true))
})

// That the run could not be re-read is news, and is still said - just without dating it.
test('a run served from a stale cache says so', async () => {
  mockFetchWithIssues({ ...VOLUME_ISSUES, fetchedAt: '2020-01-01T00:00:00.000Z', stale: true })
  renderPage()

  expect(await screen.findByText(/could not reach comic vine/i)).toBeInTheDocument()
  expect(screen.queryByText(/as of/i)).toBeNull()
})

// Regression: uploading into an edition put the comic in the database, on disk, with a
// thumbnail — and the page did not draw it. The grid renders from the run query, which
// was cached for five minutes and matched by none of the page's invalidations, so its
// `extras` predated the upload. Which books you own is live data and cannot be served
// from a cache chosen for Comic Vine's issue list.
test('a comic uploaded into the edition shows up on coming back to the page', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockFetchWithIssues({ ...VOLUME_ISSUES, extras: [], fetchedAt: '2026-09-04T10:00:00.000Z' })
  const first = renderGrid('/edition/9', qc)
  await screen.findByText('#250')
  first.unmount()

  // The upload happened between the two visits.
  mockFetchWithIssues({
    ...VOLUME_ISSUES,
    extras: [{ bookId: 46, number: null, title: 'Just uploaded' }],
    fetchedAt: '2026-09-04T10:00:00.000Z',
  })
  renderGrid('/edition/9', qc)

  expect(await screen.findByText('Just uploaded')).toBeInTheDocument()
})

// A comic with no metadata yet has no title and no issue number, and "#?" tells you
// nothing about which comic you are looking at. The filename is what you uploaded.
test('a comic with no metadata is labelled with its filename', async () => {
  mockFetchWithIssues(
    { ...VOLUME_ISSUES, extras: [{ bookId: 46, number: null, title: null }] },
    EDITION,
    [{ id: 46, number: null, title: null, pageCount: 3, comicinfoSynced: false, year: null,
       filePath: 'Venom/Venom (2025)/Venom 999 (2026).cbz' }],
  )
  renderGrid()

  expect(await screen.findByText('Venom 999 (2026)')).toBeInTheDocument()
  expect(screen.queryByText('#?')).not.toBeInTheDocument()
})

// The same gap exists on an edition with no volume, which renders the plain book grid.
test('a metadata-less comic in a volumeless edition is labelled with its filename too', async () => {
  mockFetchWithIssues(
    { volumeId: null, issues: [], extras: [], owned: 0, total: 0 },
    EDITION,
    [{ id: 47, number: null, title: null, pageCount: 3, comicinfoSynced: false, year: null,
       filePath: 'Unsorted/Some Comic 001.cbz' }],
  )
  renderGrid()

  expect(await screen.findByText('Some Comic 001')).toBeInTheDocument()
})

/* ── The link to the volume on Comic Vine ──────────────────────────────────── */

const CV_URL = 'https://comicvine.gamespot.com/venom/4050-167333/'

test('an edition links out to its volume on Comic Vine', async () => {
  mockFetchWithIssues({ ...VOLUME_ISSUES, fetchedAt: '2026-09-04T10:00:00.000Z', siteUrl: CV_URL })
  renderPage()
  const link = await screen.findByRole('link', { name: /on Comic Vine/i })
  expect(link).toHaveAttribute('href', CV_URL)
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
})

test('an edition with no Comic Vine volume offers no link to one', async () => {
  mockFetchWithIssues({ volumeId: null, issues: [], extras: [], owned: 0, total: 0, siteUrl: null })
  renderPage()
  await screen.findByText(/Amazing Spider-Man \(2025\)/)
  expect(screen.queryByRole('link', { name: /on Comic Vine/i })).not.toBeInTheDocument()
})

// The link must not depend on Comic Vine having given us a run: an edition whose run we
// could not read is exactly when you most want to go and look it up.
test('the link still shows when Comic Vine gave us no run to draw', async () => {
  mockFetchWithIssues({ volumeId: 167333, issues: [], extras: [], owned: 0, total: 0, unavailable: true, siteUrl: CV_URL })
  renderPage()
  expect(await screen.findByRole('link', { name: /on Comic Vine/i })).toHaveAttribute('href', CV_URL)
})

/* ── Getting a missing issue ───────────────────────────────────────────────── */

const MATCHED = {
  ...VOLUME_ISSUES,
  fetchedAt: '2026-09-04T10:00:00.000Z',
  issues: [
    { id: 1, number: '1', owned: false, match: { indexId: 77, title: 'Venom #1 (2025)' } },
    // Cover date deliberately a year ahead of the scraped release (see YEAR_SLACK in
    // server/lib/issueMatch.ts) - this is the fixture Finding 1's yearFrom bug hid in.
    { id: 2, number: '2', owned: false, match: null, coverDate: '2026-01-15' },
  ],
  extras: [],
  owned: 0,
  total: 2,
}

test('a missing issue the index can supply offers to get it', async () => {
  mockFetchWithIssues(MATCHED)
  renderGrid()
  expect(await screen.findByRole('button', { name: /Get #1/i })).toBeInTheDocument()
})

// The year floor must be backed off by one from the cover year: Comic Vine's cover
// dates run ahead of the scraped release year, so a floor set to the cover year exactly
// (yearFrom=2026) would filter out the very row posted as "(2025)" that Find exists to
// surface. This is exactly the bug Finding 1 fixed - a stringContaining assertion here
// let it hide, because the MATCHED fixture used to carry no coverDate at all.
test('a missing issue with no certain match offers to find it instead, floor backed off by a year', async () => {
  mockFetchWithIssues(MATCHED)
  renderPage()
  const find = await screen.findByRole('link', { name: /Find #2/i })
  expect(find).toHaveAttribute('href', '/search?q=Amazing+Spider-Man&yearFrom=2025')
})

test('a missing issue with no certain match offers no get button', async () => {
  mockFetchWithIssues(MATCHED)
  renderGrid()
  await screen.findByRole('button', { name: /Get #1/i })
  expect(screen.queryByRole('button', { name: /Get #2/i })).not.toBeInTheDocument()
})

test('pressing get asks the server to download that issue into this edition', async () => {
  mockFetchWithIssues(MATCHED)
  renderGrid()
  fireEvent.click(await screen.findByRole('button', { name: /Get #1/i }))
  await waitFor(() => {
    expect(posted.some((p) => p.url.includes('/api/editions/9/issues/1/download'))).toBe(true)
  })
})

// Spec §8: a failed press reports on its own tile, not as a page-wide error - two
// missing issues can be mid-press independently, and only the one that failed should
// say so.
test('a failed press shows the error on that tile', async () => {
  mockFetchWithIssues(MATCHED, EDITION, [], false)
  renderGrid()
  fireEvent.click(await screen.findByRole('button', { name: /Get #1/i }))
  expect(await screen.findByText(/could not get that one/i)).toBeInTheDocument()
})

// --- get all -----------------------------------------------------------------

const THREE_MATCHED = {
  ...MATCHED,
  issues: [
    { id: 1, number: '1', owned: false, match: { indexId: 77, title: 'Venom #1 (2025)' } },
    { id: 2, number: '2', owned: false, match: { indexId: 78, title: 'Venom #2 (2025)' } },
    { id: 3, number: '3', owned: false, match: null, coverDate: '2026-01-15' },
    { id: 4, number: '4', owned: true, bookId: 77 },
    { id: 5, number: '5', owned: false, match: { indexId: 79, title: 'Venom #5 (2025)' } },
  ],
  owned: 1,
  total: 5,
}

// The count is the point of the label: a run with thirty gaps and a run with three are
// very different presses, and the number is what tells them apart before you commit.
test('the header offers to get every gap the index can fill, and says how many', async () => {
  mockFetchWithIssues(THREE_MATCHED)
  renderPage()
  expect(await screen.findByRole('button', { name: /Get all 3/i })).toBeInTheDocument()
})

test('pressing get all asks the server to walk the whole volume', async () => {
  mockFetchWithIssues(THREE_MATCHED)
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Get all 3/i }))

  await waitFor(() => {
    expect(posted.some((p) => p.url.includes('/api/editions/9/issues/download-all'))).toBe(true)
  })
})

// Every gap here is one the rule refused to close, so there is nothing to take in bulk
// and a button saying "Get all 0" would only be something to press and be ignored.
test('a volume whose gaps are all ambiguous offers no get all', async () => {
  mockFetchWithIssues({
    ...MATCHED,
    issues: [{ id: 2, number: '2', owned: false, match: null, coverDate: '2026-01-15' }],
    owned: 0,
    total: 1,
  })
  renderGrid()

  await screen.findByRole('link', { name: /Find #2/i })
  expect(screen.queryByRole('button', { name: /Get all/i })).not.toBeInTheDocument()
})

test('a volume with no gaps at all offers no get all', async () => {
  mockFetchWithIssues({
    ...MATCHED,
    issues: [{ id: 1, number: '1', owned: true, bookId: 77 }],
    owned: 1,
    total: 1,
  })
  renderPage()

  await screen.findByText('1 of 1 issues')
  expect(screen.queryByRole('button', { name: /Get all/i })).not.toBeInTheDocument()
})

// An issue already in the queue is one the walk would only be told to skip, so it is not
// counted: press Get on two of three and the button offers the one that is left.
test('the count leaves out what is already queued', async () => {
  posted = []
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/downloads')) {
      return {
        ok: true,
        json: async () => ({
          active: [],
          queue: [{ id: 1, position: 0, state: 'queued', url: 'u', cvIssueId: 1, attempts: 0, queuedAt: 'now' }],
          history: [],
        }),
      }
    }
    if (init?.method === 'POST') {
      posted.push({ url: String(url), body: String(init.body ?? '') })
      return { ok: true, json: async () => ({ queued: 2 }) }
    }
    if (String(url).includes('/issues')) return { ok: true, json: async () => THREE_MATCHED }
    return { ok: true, json: async () => ({ edition: EDITION, books: [] }) }
  }) as unknown as typeof fetch

  renderPage()
  expect(await screen.findByRole('button', { name: /Get all 2/i })).toBeInTheDocument()
})

const UPCOMING = {
  publishers: [
    {
      name: 'Marvel',
      weeks: [
        {
          week: '2026-10-28',
          issues: [
            {
              sourceId: '1',
              headline: 'The Amazing Spider-Man (2025) #16',
              seriesName: 'The Amazing Spider-Man',
              number: '16',
              releaseDate: '2026-10-28',
              coverUrl: null,
              siteUrl: 'https://marvel.com/16',
              creators: null,
            },
            {
              sourceId: '2',
              headline: 'Daredevil (2025) #12',
              seriesName: 'Daredevil',
              number: '12',
              releaseDate: '2026-10-28',
              coverUrl: null,
              siteUrl: 'https://marvel.com/dd12',
              creators: null,
            },
          ],
        },
      ],
    },
    { name: 'DC Comics', weeks: [], unsupported: true },
  ],
}

/** The edition, its run, and Marvel's calendar - everything the page reads at once. */
function mockFetchWithUpcoming(upcoming: unknown, edition: Record<string, unknown> = CV_EDITION) {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    if (String(url).includes('/api/releases/upcoming')) {
      return { ok: true, json: async () => upcoming }
    }
    // Coming soon lives in the carousel's sidebar now, and the carousel needs a run to
    // walk before there is a sidebar beside it.
    if (String(url).includes('/issues')) {
      return {
        ok: true,
        json: async () => ({
          issues: [{ id: 1, number: '1', owned: false }],
          extras: [], owned: 0, total: 1, fetchedAt: '2026-09-04T10:00:00.000Z',
        }),
      }
    }
    // Only the editions LIST - "/api/editions/9" is this edition's own detail and must
    // fall through, or the page renders with no edition at all.
    if (String(url).includes('/api/editions?') || String(url).endsWith('/api/editions')) {
      return { ok: true, json: async () => ({ editions: [] }) }
    }
    return { ok: true, json: async () => ({ edition, books: [] }) }
  }) as unknown as typeof fetch
}

test('coming soon names each solicited issue of this volume and the week it lands', async () => {
  mockFetchWithUpcoming(UPCOMING)
  renderPage()

  expect(await screen.findByRole('button', { name: /coming soon \(1\)/i })).toBeInTheDocument()
  expect(screen.getByText('#16')).toBeInTheDocument()
  expect(screen.getByText('28 Oct 2026')).toBeInTheDocument()
})

// Counted as well as absent: the heading says how many there are, so one row rather than
// two is the whole assertion, and a filter that let Daredevil through would show it.
test('coming soon leaves out an issue of another series', async () => {
  mockFetchWithUpcoming(UPCOMING)
  renderPage()

  await screen.findByRole('button', { name: /coming soon \(1\)/i })
  expect(screen.queryByText('#12')).not.toBeInTheDocument()
})

test('there is no coming soon heading when nothing is solicited for this volume', async () => {
  mockFetchWithUpcoming({ publishers: [{ name: 'Marvel', weeks: [] }] })
  renderPage()

  // The run renders from the same load, so by the time it is on screen the calendar
  // has been answered too - an absence checked before that would pass for the wrong reason.
  expect(await screen.findByTestId('carousel-current')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument())
})

/* ── The run as a carousel ─────────────────────────────────────────────────── */

/** A run of three you own, read up to but not including the last. */
const PART_READ = {
  ...VOLUME_ISSUES,
  issues: [
    { id: 1, number: '1', owned: true, bookId: 11 },
    { id: 2, number: '2', owned: true, bookId: 12 },
    { id: 3, number: '3', owned: true, bookId: 13 },
  ],
  extras: [],
  owned: 3,
  total: 3,
}

const PART_READ_BOOKS = [
  { id: 11, number: '1', title: 'One', pageCount: 22, comicinfoSynced: false, readState: 'read' },
  { id: 12, number: '2', title: 'Two', pageCount: 22, comicinfoSynced: false, readState: 'read' },
  { id: 13, number: '3', title: 'Three', pageCount: 22, comicinfoSynced: false, readState: 'unread' },
]

// The whole point of the redesign: 35 issues and the one you want is the one you have not
// read, which was previously at the bottom of a long scroll.
test('the page opens on the first issue you have not read', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage()

  expect(await screen.findByTestId('carousel-current')).toHaveTextContent('#3')
})

test('a run you have read all of opens on its newest issue', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS.map((b) => ({ ...b, readState: 'read' })))
  renderPage()

  expect(await screen.findByTestId('carousel-current')).toHaveTextContent('#3')
})

test('a gap counts as unread, so the run opens on the issue you are missing', async () => {
  mockFetchWithIssues(
    { ...PART_READ, issues: [
      { id: 1, number: '1', owned: true, bookId: 11 },
      { id: 2, number: '2', owned: false },
      { id: 3, number: '3', owned: true, bookId: 13 },
    ] },
    EDITION,
    PART_READ_BOOKS,
  )
  renderPage()

  expect(await screen.findByTestId('carousel-current')).toHaveTextContent('#2')
})

test('the arrows walk the run', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage()

  await screen.findByTestId('carousel-current')
  fireEvent.click(screen.getByRole('button', { name: /previous issue/i }))
  expect(screen.getByTestId('carousel-current')).toHaveTextContent('#2')
})

test('the issue below the cover is the one centred', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage()

  expect(await screen.findByRole('heading', { name: /#3.*Three/ })).toBeInTheDocument()
})

/* ── The wall of covers ────────────────────────────────────────────────────── */

// One control, not a pair. The run is how a volume is read; the covers are a way of
// finding one comic in it, which you ask for and then leave.
test('the covers are one press away, and show the whole run at once', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: /show covers/i }))

  expect(screen.getByText('One')).toBeInTheDocument()
  expect(screen.getByText('Two')).toBeInTheDocument()
  expect(screen.getByText('Three')).toBeInTheDocument()
  expect(screen.queryByTestId('carousel-current')).toBeNull()
})

test('and one press back, without having to pick one', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderGrid()

  fireEvent.click(await screen.findByRole('button', { name: /hide covers/i }))

  expect(await screen.findByTestId('carousel-current')).toBeInTheDocument()
})

// A volume always opens as the run. Asking for the covers on one volume is not a statement
// about how you want to read the next.
test('a volume opens as the run however the last one was left', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  const first = renderGrid()
  await screen.findByText('One')
  first.unmount()

  renderPage()
  expect(await screen.findByTestId('carousel-current')).toBeInTheDocument()
})

// A placeholder has no read state, so a filtered page has no run - and with no run there
// is nothing for a carousel to walk.
test('a read filter leaves only the covers, with nothing to switch to', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage('/edition/9?status=unread')

  expect(await screen.findByText('One')).toBeInTheDocument()
  expect(screen.queryByTestId('carousel-current')).toBeNull()
  expect(screen.queryByRole('button', { name: /covers/i })).toBeNull()
})

/* ── The sidebar ───────────────────────────────────────────────────────────── */

test('the gaps are listed beside the comic, with the way to fill each one', async () => {
  mockFetchWithIssues(THREE_MATCHED)
  renderPage()

  const missing = await screen.findByRole('button', { name: /missing \(4\)/i })
  expect(missing).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Get all 3/i })).toBeInTheDocument()
})

// Scoped to the sidebar on purpose: the page opens centred on #1, which is itself a gap,
// so the same offer is on screen twice - once where you are and once in the list of every
// gap. This test is about the list.
test('pressing get in the list downloads that issue into this edition', async () => {
  mockFetchWithIssues(THREE_MATCHED)
  renderPage()

  const sidebar = await screen.findByRole('complementary')
  fireEvent.click(within(sidebar).getByRole('button', { name: /^Get #1$/i }))

  await waitFor(() => {
    expect(posted.some((p) => p.url.includes('/api/editions/9/issues/1/download'))).toBe(true)
  })
})

// Landing on a gap has to put its Get button in front of you - that is the reason a gap
// counts as unread when the page chooses where to open.
test('a centred gap offers to fill itself', async () => {
  mockFetchWithIssues(MATCHED)
  renderPage()

  await screen.findByTestId('carousel-current')
  expect(screen.getByTestId('issue-identity')).toHaveTextContent(/Get/)
})

/* ── Coming back to the issue you were on ─────────────────────────────────── */

// Which issue is centred lives in the url, so that stepping back into the run - from the
// reader, from the issue's page - puts you where you were rather than wherever the
// opening rule would start you today.
test('the centred issue is named in the url', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage()

  await screen.findByTestId('carousel-current')
  fireEvent.click(screen.getByRole('button', { name: /previous issue/i }))

  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('issue=issue-2'))
})

test('a url naming an issue opens on it, whatever the opening rule would say', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage('/edition/9?issue=issue-1')

  expect(await screen.findByTestId('carousel-current')).toHaveTextContent('#1')
})

// A run that has changed under a bookmarked link, or a hand-typed one: there is no such
// issue to open, and the opening rule is a better answer than an empty page.
test('a url naming an issue the run does not have falls back to the opening rule', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage('/edition/9?issue=issue-999')

  expect(await screen.findByTestId('carousel-current')).toHaveTextContent('#3')
})

// Walking a run of thirty-five issues must not put thirty-five entries in the history,
// or pressing back once would walk you all the way home one cover at a time.
test('walking the run does not pile up history', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage()

  await screen.findByTestId('carousel-current')
  const before = history.length
  fireEvent.click(screen.getByRole('button', { name: /previous issue/i }))
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('issue=issue-2'))

  expect(history.length).toBe(before)
})

/* ── Removing an issue without leaving the run ────────────────────────────── */

test('an issue can be removed from the run itself, and asks first', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage()

  await screen.findByTestId('carousel-current')
  fireEvent.click(within(screen.getByTestId('issue-identity')).getByRole('button', { name: /remove issue/i }))

  // Named by its story title, as the issue's own page names it, falling back to its
  // number for the many issues that have none.
  expect(await screen.findByRole('heading', { name: /remove "Three"/i })).toBeInTheDocument()
  expect(deleted).toEqual([])
})

test('confirming deletes that comic', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage()

  await screen.findByTestId('carousel-current')
  fireEvent.click(within(screen.getByTestId('issue-identity')).getByRole('button', { name: /remove issue/i }))
  fireEvent.click(await screen.findByRole('button', { name: /^remove$/i }))

  await waitFor(() => expect(deleted).toEqual(['/api/books/13']))
})

// The comic goes but its place in the run does not: it becomes a gap, with the way to
// fill it, and you are still standing on it. Leaving the page for the library - which is
// what the issue's own page does - would be losing your place to undo a mistake.
test('removing an issue leaves you on it, and re-reads the run', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage()

  await screen.findByTestId('carousel-current')
  fireEvent.click(within(screen.getByTestId('issue-identity')).getByRole('button', { name: /remove issue/i }))
  fireEvent.click(await screen.findByRole('button', { name: /^remove$/i }))

  await waitFor(() => expect(deleted).toHaveLength(1))
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/edition/9'))
  expect(screen.getByTestId('carousel-current')).toHaveTextContent('#3')
})

// A gap is an absence already. There is no file to delete and nothing to ask about.
test('a gap offers no removal', async () => {
  mockFetchWithIssues(MATCHED)
  renderPage()

  await screen.findByTestId('carousel-current')
  expect(within(screen.getByTestId('issue-identity')).queryByRole('button', { name: /remove issue/i })).toBeNull()
})

// The shelf knows a comic by its id, not by Comic Vine's id for the issue it fills, so
// closing a comic opened from the shelf asks for the run by `book-<id>`.
test('a url naming a book opens on the issue that book fills', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage('/edition/9?issue=book-11')

  expect(await screen.findByTestId('carousel-current')).toHaveTextContent('#1')
})

test('a url naming a book the run does not hold falls back to the opening rule', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage('/edition/9?issue=book-999')

  expect(await screen.findByTestId('carousel-current')).toHaveTextContent('#3')
})

/* ── The grid as a way into the carousel ──────────────────────────────────── */

// The grid is for finding a comic among thirty-five, not a place to stay: picking one
// shows it in the carousel, which is where everything about it is now.
test('picking a cover in the grid opens it in the carousel', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderGrid()

  fireEvent.click(await screen.findByRole('link', { name: /Two/ }))

  expect(await screen.findByTestId('carousel-current')).toHaveTextContent('#2')
})

// Nothing beside the run in the grid: every gap is already a tile in it with its own Get,
// and what is not published yet is not part of finding a comic you have.
test('the grid carries no sidebar', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderGrid()

  await screen.findByText('One')
  expect(screen.queryByRole('complementary')).toBeNull()
})

// --- the way back ------------------------------------------------------------

// A run is reached from the library, from a series, from the follows shelf and from an
// issue's details. "Back to Library" was right on one of those routes and a lie on the
// rest - it announced the home shelf and then delivered it.
test('the way out names the page you came from', async () => {
  renderPage('/edition/9', undefined, [
    { pathname: '/edition/9', state: { from: { href: '/series/Amazing%20Spider-Man', label: 'Amazing Spider-Man' } } },
  ])
  expect(await screen.findByRole('link', { name: /Amazing Spider-Man/ })).toBeInTheDocument()
})

test('a run opened cold still offers the library', async () => {
  renderPage()
  const back = await screen.findByText(/← Library/)
  expect(back).toHaveAttribute('href', '/')
})

// The run rewrites its own query string whenever the carousel moves or the covers open,
// and a replaced history entry carries no state. Read live, the way back would be lost
// the moment you touched anything on the page.
test('the way back survives the page writing to its own url', async () => {
  mockFetchWithIssues(PART_READ, EDITION, PART_READ_BOOKS)
  renderPage('/edition/9', undefined, [
    { pathname: '/edition/9', state: { from: { href: '/following', label: 'Following' } } },
  ])
  expect(await screen.findByText(/← Following/)).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: /show covers/i }))
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('view=grid'))
  expect(screen.getByText(/← Following/)).toBeInTheDocument()
})
