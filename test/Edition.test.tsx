import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Edition from '../src/pages/Edition'

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

function renderPage(path = '/edition/9', client?: QueryClient) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/edition/:id" element={<Edition />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
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
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
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
  renderPage()

  expect(await screen.findByText('#250')).toBeInTheDocument()
  expect(screen.getAllByText(/missing/i).length).toBe(2)
})

test('missing issues keep their place in the run', async () => {
  mockFetchWithIssues(VOLUME_ISSUES)
  renderPage()

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
  renderPage()

  expect(await screen.findByText('Annual')).toBeInTheDocument()
})

test('an edition with no volume shows only the books, no placeholders', async () => {
  mockFetchWithIssues({ volumeId: null, issues: [], extras: [{ bookId: 5, number: '1', title: 'Issue one' }], owned: 0, total: 0 })
  renderPage()

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

test('the run says when it was last read from Comic Vine', async () => {
  mockFetchWithIssues({ ...VOLUME_ISSUES, fetchedAt: '2026-09-04T10:00:00.000Z' })
  renderPage()

  expect(await screen.findByText(/as of/i)).toBeInTheDocument()
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

test('a run served from a stale cache says so', async () => {
  mockFetchWithIssues({ ...VOLUME_ISSUES, fetchedAt: '2020-01-01T00:00:00.000Z', stale: true })
  renderPage()

  expect(await screen.findByText(/could not reach comic vine/i)).toBeInTheDocument()
})

// Regression: uploading into an edition put the comic in the database, on disk, with a
// thumbnail — and the page did not draw it. The grid renders from the run query, which
// was cached for five minutes and matched by none of the page's invalidations, so its
// `extras` predated the upload. Which books you own is live data and cannot be served
// from a cache chosen for Comic Vine's issue list.
test('a comic uploaded into the edition shows up on coming back to the page', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockFetchWithIssues({ ...VOLUME_ISSUES, extras: [], fetchedAt: '2026-09-04T10:00:00.000Z' })
  const first = renderPage('/edition/9', qc)
  await screen.findByText('#250')
  first.unmount()

  // The upload happened between the two visits.
  mockFetchWithIssues({
    ...VOLUME_ISSUES,
    extras: [{ bookId: 46, number: null, title: 'Just uploaded' }],
    fetchedAt: '2026-09-04T10:00:00.000Z',
  })
  renderPage('/edition/9', qc)

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
  renderPage()

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
  renderPage()

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
  renderPage()
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
  renderPage()
  await screen.findByRole('button', { name: /Get #1/i })
  expect(screen.queryByRole('button', { name: /Get #2/i })).not.toBeInTheDocument()
})

test('pressing get asks the server to download that issue into this edition', async () => {
  mockFetchWithIssues(MATCHED)
  renderPage()
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
  renderPage()
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
  renderPage()

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
