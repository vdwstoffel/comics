import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Volume from '../src/pages/Volume'

const CV_URL = 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/'

const EDITIONS = [
  { id: 83, name: 'The Amazing Spider-Man by Wells and Romita Jr. (2022)', bookCount: 3 },
  { id: 84, name: 'Amazing Spider-Man By Zeb Wells (2023)', bookCount: 9 },
  { id: 85, name: 'Amazing Spider-Man: The 8 Deaths Of Spider-Man (2025)', bookCount: 1 },
]

function book(id: number, title: string, date: string, editionId = 84) {
  return { id, editionId, title, number: null, pageCount: 30, date, readState: 'unread' }
}

const SHELF = {
  shelf: {
    key: 'volume:142577', volumeId: 142577, name: 'The Amazing Spider-Man (2022)',
    editions: EDITIONS, bookCount: 13, siteUrl: CV_URL, holdsIssues: false,
  },
  books: [
    book(1, 'Volume1: World Without Love', '2022-10-01', 83),
    book(2, 'Volume 2: The New Sinister', '2023-02-01'),
    book(3, 'TPB', '2025-07-01'),
  ],
}

const EMPTY_QUEUE = { active: [], queue: [], history: [] }

function mockFetch(body: unknown, ok = true) {
  globalThis.fetch = vi.fn(async (url: string) => (
    String(url).includes('/api/downloads')
      ? { ok: true, status: 200, json: async () => EMPTY_QUEUE }
      : { ok, status: ok ? 200 : 404, json: async () => body }
  )) as unknown as typeof fetch
}

beforeEach(() => { mockFetch(SHELF) })
afterEach(() => { cleanup() })

function renderAt(path: string, state?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: path.split('?')[0], search: path.includes('?') ? `?${path.split('?')[1]}` : '', state }]}>
        <Routes><Route path="/volume/:volumeId" element={<Volume />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

test('the shelf opens on the first comic of the run', async () => {
  renderAt('/volume/142577')
  expect(await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })).toBeInTheDocument()
  expect(screen.getByText(/13 issues/)).toBeInTheDocument()
  // The earliest trade by date, out of the first of the three collections. Note the
  // title has no space after "Volume" - match the fixture, not a tidier version of it.
  const centre = document.querySelector('[data-testid="carousel-current"]')!
  expect(centre).toHaveTextContent('Volume1: World Without Love')
})

test('the covers view lists every trade in date order', async () => {
  renderAt('/volume/142577?view=grid')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  const titles = [...document.querySelectorAll('.cover-tile__title')].map((e) => e.textContent)
  expect(titles).toEqual(['Volume1: World Without Love', 'Volume 2: The New Sinister', 'TPB'])
})

test('the sidebar names the collections and links out to Comic Vine', async () => {
  renderAt('/volume/142577')
  const zeb = await screen.findByRole('link', { name: /Zeb Wells/ })
  expect(zeb.closest('.edition-side__collections')).toBeTruthy()
  expect(zeb).toHaveAttribute('href', '/edition/84')
  expect(screen.getByRole('link', { name: /Comic Vine/ })).toHaveAttribute('href', CV_URL)
})

// Spec §5.3: seventy missing-issue tiles above thirteen trades would bury the thing
// you opened the shelf for.
test('a collections-only shelf has no gaps and asks Comic Vine for no run', async () => {
  renderAt('/volume/142577')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  expect(document.querySelector('.edition-side__section')).toBeNull()
  const urls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => String(c[0]))
  expect(urls.some((u) => u.includes('/issues'))).toBe(false)
})

// Review Focus 5: a bookmark can outlive the editions that made it.
test('a volume that no longer has a shelf says so instead of blanking', async () => {
  mockFetch({ error: 'volume not found' }, false)
  renderAt('/volume/999999')
  expect(await screen.findByText(/not found/i)).toBeInTheDocument()
})

test('a status in the url is sent on and carried into the tiles', async () => {
  renderAt('/volume/142577?status=unread')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
  expect(url).toContain('readState=unread')
})

test('there is a link back to the library', async () => {
  renderAt('/volume/142577')
  expect(await screen.findByRole('link', { name: /library/i })).toHaveAttribute('href', '/')
})

// Spec §2.3/§5.3. A run owned as issues AND as a trade is one shelf, and that shelf is
// a run with gaps in it. The live library cannot make this case yet - no edition holds
// the 2022 issues - so the fixture constructs it.
const MIXED = {
  shelf: {
    key: 'volume:163325', volumeId: 163325, name: 'The Amazing Spider-Man (2025)',
    editions: [
      { id: 16, name: 'The Amazing Spider-Man (2025)', bookCount: 3, comicvineId: 163325 },
      { id: 90, name: 'Amazing Spider-Man By Joe Kelly (2026)', bookCount: 1, comicvineId: 170000 },
    ],
    bookCount: 4, siteUrl: null, holdsIssues: true,
  },
  books: [
    { id: 11, editionId: 16, title: 'Issue one', number: '1', pageCount: 30, date: '2025-01-01', readState: 'unread' },
    { id: 12, editionId: 16, title: 'Issue two', number: '2', pageCount: 30, date: '2025-02-01', readState: 'unread' },
    { id: 13, editionId: 16, title: 'Issue three', number: '3', pageCount: 30, date: '2025-03-01', readState: 'unread' },
    { id: 14, editionId: 90, title: 'Vol. 1: Collected', number: null, pageCount: 120, date: '2026-01-01', readState: 'unread' },
  ],
}

const RUN = {
  volumeId: 163325,
  issues: [
    { id: 901, number: '1', owned: true, bookId: 11 },
    { id: 902, number: '2', owned: true, bookId: 12 },
    { id: 903, number: '3', owned: true, bookId: 13 },
    { id: 904, number: '4', owned: false, match: null },
  ],
  extras: [], owned: 3, total: 4, siteUrl: null,
}

function mockMixed() {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    const body = u.includes('/api/downloads') ? EMPTY_QUEUE : u.includes('/issues') ? RUN : MIXED
    return { ok: true, status: 200, json: async () => body }
  }) as unknown as typeof fetch
}

test('a shelf holding the volume issues draws the run, then the collections', async () => {
  mockMixed()
  renderAt('/volume/163325?view=grid')

  expect(await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2025)' })).toBeInTheDocument()
  const titles = [...document.querySelectorAll('.cover-tile__title')].map((e) => e.textContent)
  // The three issues you own, then the trade that collects them - one shelf.
  expect(titles).toContain('Issue one')
  expect(titles).toContain('Vol. 1: Collected')
})

test('a gap in the owned run is listed as missing, and a trade is not', async () => {
  mockMixed()
  renderAt('/volume/163325')
  // The run arrives after the shelf does, so wait for the section itself rather than
  // for the heading above it.
  const heading = await screen.findByRole('button', { name: /Missing \(1\)/ })
  expect(heading.closest('.edition-side__section')).toHaveTextContent('#4')
})

test('the run is read from the edition that holds the volume issues', async () => {
  mockMixed()
  renderAt('/volume/163325')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2025)' })
  const urls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => String(c[0]))
  expect(urls.some((u) => u.includes('/api/editions/16/issues'))).toBe(true)
  expect(urls.some((u) => u.includes('/api/editions/90/issues'))).toBe(false)
})

// Spec §5.2 Goal: the shelf is the home shelf for its books. Sending the click back to
// "Amazing Spider-Man By Zeb Wells (2023)" scatters you across the three shelves the
// gathering exists to replace.
test('the comic on screen opens straight into the reader', async () => {
  renderAt('/volume/142577')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  const open = document.querySelector('.issue-carousel__open')!
  expect(open).toHaveAttribute('href', '/read/1')
})

// Spec §5.2 / the plan: BookRedirect and the reader both emit ?issue=book-N for a
// collected comic, so the shelf has to know which comic you came back for.
test('the shelf opens standing on the comic you came back for', async () => {
  renderAt('/volume/142577?issue=book-2')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  const centre = document.querySelector('[data-testid="carousel-current"]')!
  expect(centre).toHaveTextContent('Volume 2: The New Sinister')
})

// The 2022 run was the only volume in the library drawn as a bare list: no carousel,
// no issue detail, no covers toggle. It is a volume like any other.
test('the shelf opens on the run, the way an edition does', async () => {
  renderAt('/volume/142577')
  // The carousel centres one comic and names it, rather than listing thirteen at once.
  expect(await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })).toBeInTheDocument()
  expect(document.querySelector('.edition-run')).toBeTruthy()
  expect(screen.getByRole('button', { name: /covers/i })).toBeInTheDocument()
})

test('the covers toggle flips to the grid and back', async () => {
  renderAt('/volume/142577')
  fireEvent.click(await screen.findByRole('button', { name: /Show covers/i }))
  expect(screen.getByText('Volume 2: The New Sinister')).toBeInTheDocument()
  expect(document.querySelector('.edition-run')).toBeNull()
})

// Standing on a trade, the thing worth saying is which of the three paperback lines
// it came out of.
test('the comic on screen says which collection it is from', async () => {
  renderAt('/volume/142577?issue=book-2')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  const detail = document.querySelector('.edition-run__detail')!
  expect(detail).toHaveTextContent('Amazing Spider-Man By Zeb Wells (2023)')
})

test('there is no Get all and no Refresh on a shelf of trades', async () => {
  renderAt('/volume/142577')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  expect(screen.queryByRole('button', { name: /Get all/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Refresh/ })).not.toBeInTheDocument()
})

test('the back link returns to where you came from', async () => {
  renderAt('/volume/142577', { from: { href: '/series/The%20Amazing%20Spider-Man', label: 'The Amazing Spider-Man' } })
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  const back = document.querySelector('.back-link')!
  expect(back).toHaveTextContent('The Amazing Spider-Man')
  expect(back).toHaveAttribute('href', '/series/The%20Amazing%20Spider-Man')
})

test('with nowhere named, the back link goes to the library', async () => {
  renderAt('/volume/142577')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  const back = document.querySelector('.back-link')!
  expect(back).toHaveTextContent('Library')
  expect(back).toHaveAttribute('href', '/')
})
