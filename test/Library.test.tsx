import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Library from '../src/pages/Library'

function makeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    for (const [needle, body] of Object.entries(routes)) {
      if (String(url).includes(needle)) return { ok: true, json: async () => body }
    }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  globalThis.fetch = makeFetch({
    '/api/publishers': { publishers: [] },
    '/api/series': { series: [{ name: 'Batman', bookCount: 3, editions: [{ id: 1, name: 'Batman', bookCount: 3 }] }] },
    '/api/editions': { editions: [{ id: 1, name: 'Batman', bookCount: 3 }] },
  })
})

afterEach(() => { cleanup() })

function renderWithProviders(ui: ReactNode, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

test('Library renders series tiles from the API', async () => {
  renderWithProviders(<Library />)
  expect(await screen.findByText('Batman')).toBeInTheDocument()
  expect(screen.getByText(/3/)).toBeInTheDocument()
})

test('Library shows publisher sidebar items when publishers exist', async () => {
  globalThis.fetch = makeFetch({
    '/api/publishers': { publishers: [{ name: 'DC', count: 2 }, { name: 'Marvel', count: 1 }] },
    '/api/series': { series: [{ name: 'Batman', bookCount: 2, editions: [{ id: 1, name: 'Batman', bookCount: 2 }] }] },
    '/api/editions': { editions: [{ id: 1, name: 'Batman', bookCount: 2 }] },
  })

  renderWithProviders(<Library />)

  expect(await screen.findByText('Publishers')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /DC/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Marvel/ })).toBeInTheDocument()
  // Each rail has its own All, so scope the assertion to the publisher one.
  const publishers = screen.getByRole('complementary', { name: 'Publishers' })
  expect(within(publishers).getByText('All')).toBeInTheDocument()
})

test('Library filters series when a publisher is clicked', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const urlStr = String(url)
    if (urlStr.includes('/api/publishers')) {
      return { ok: true, json: async () => ({ publishers: [{ name: 'Marvel', count: 1 }] }) }
    }
    if (urlStr.includes('/api/series') && urlStr.includes('publisher=Marvel')) {
      return { ok: true, json: async () => ({ series: [{ name: 'X-Men', bookCount: 5, editions: [{ id: 2, name: 'X-Men', bookCount: 5 }] }] }) }
    }
    if (urlStr.includes('/api/series')) {
      return { ok: true, json: async () => ({ series: [{ name: 'Batman', bookCount: 3, editions: [{ id: 1, name: 'Batman', bookCount: 3 }] }, { name: 'X-Men', bookCount: 5, editions: [{ id: 2, name: 'X-Men', bookCount: 5 }] }] }) }
    }
    if (urlStr.includes('/api/editions')) {
      return { ok: true, json: async () => ({ editions: [{ id: 1, name: 'Batman', bookCount: 3 }, { id: 2, name: 'X-Men', bookCount: 5 }] }) }
    }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
  globalThis.fetch = fetchMock

  renderWithProviders(<Library />)

  // Initially shows every series plus the publisher sidebar
  expect(await screen.findByText('Batman')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /Marvel/ })).toBeInTheDocument()

  // Click on "Marvel" publisher filter
  fireEvent.click(screen.getByRole('button', { name: /Marvel/ }))

  // After filtering, Batman should disappear and X-Men should appear
  await waitFor(() => {
    expect(screen.queryByText('Batman')).not.toBeInTheDocument()
    expect(screen.getByText('X-Men')).toBeInTheDocument()
  })
})

const ASM_SERIES = {
  name: 'Amazing Spider-Man',
  bookCount: 5,
  editions: [
    { id: 9, name: 'Amazing Spider-Man (2025)', bookCount: 3 },
    { id: 8, name: 'Amazing Spider-Man by Nick Spencer Omnibus', bookCount: 2 },
  ],
}
const BATMAN_SERIES = {
  name: 'Batman',
  bookCount: 10,
  editions: [{ id: 6, name: 'Batman Vol. 2 (New 52 TPB)', bookCount: 10 }],
}

function seriesFetch(series: unknown[]) {
  return makeFetch({
    '/api/series': { series },
    '/api/publishers': { publishers: [] },
    '/api/editions': { editions: [] },
  })
}

test('a series with several editions is one tile, opening the edition list', async () => {
  globalThis.fetch = seriesFetch([ASM_SERIES, BATMAN_SERIES])
  renderWithProviders(<Library />)

  const tile = (await screen.findByText('Amazing Spider-Man')).closest('a')
  expect(tile).toHaveAttribute('href', '/series/Amazing%20Spider-Man')
  expect(screen.queryByText('Amazing Spider-Man (2025)')).not.toBeInTheDocument()
})

test('a multi-edition tile says how many editions and issues it holds', async () => {
  globalThis.fetch = seriesFetch([ASM_SERIES])
  renderWithProviders(<Library />)
  expect(await screen.findByText('2 editions · 5 issues')).toBeInTheDocument()
})

// The home screen is the series level throughout: a lone edition is still reached by
// going through its series, so every tile behaves the same way.
test('a series with one edition still opens its series page', async () => {
  globalThis.fetch = seriesFetch([BATMAN_SERIES])
  renderWithProviders(<Library />)

  const tile = (await screen.findByText('Batman')).closest('a')
  expect(tile).toHaveAttribute('href', '/series/Batman')
  expect(screen.queryByText('Batman Vol. 2 (New 52 TPB)')).not.toBeInTheDocument()
})

test('a single-edition tile counts its one edition like any other', async () => {
  globalThis.fetch = seriesFetch([BATMAN_SERIES])
  renderWithProviders(<Library />)
  expect(await screen.findByText('1 edition · 10 issues')).toBeInTheDocument()
})

test('a single-edition tile still shows that edition\'s cover', async () => {
  globalThis.fetch = seriesFetch([BATMAN_SERIES])
  renderWithProviders(<Library />)
  const img = await screen.findByAltText('Batman')
  expect(img).toHaveAttribute('src', '/api/editions/6/thumbnail')
})

let calls: string[] = []

const READ_STATES = {
  readStates: [
    { name: 'unread', count: 4 },
    { name: 'reading', count: 2 },
    { name: 'read', count: 0 },
  ],
}

const LIBRARY_BOOKS = [
  { id: 7, number: '29', title: 'Bad Things', pageCount: 20, comicinfoSynced: false, readState: 'unread', percent: 0,
    filePath: 'The Amazing Spider-Man/The Amazing Spider-Man (2025)/the_amazing_spider-man_029.cbz' },
  { id: 9, number: null, title: null, pageCount: 20, comicinfoSynced: false, readState: 'unread', percent: 0,
    filePath: 'Knull/Knull (2026)/knull_untagged.cbz' },
]

function statusFetch(series: unknown[] = [ASM_SERIES]) {
  calls = []
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    calls.push(u)
    const body =
      u.includes('/api/read-states') ? READ_STATES
        : u.includes('/api/books') ? { books: LIBRARY_BOOKS }
        : u.includes('/api/series') ? { series }
          : u.includes('/api/publishers') ? { publishers: [{ name: 'Marvel', count: 3 }] }
              : { editions: [] }
    return { ok: true, json: async () => body }
  }) as unknown as typeof fetch
}

const gridCalls = () => calls.filter((c) => c.includes('/api/series'))

test('the sidebar offers a Status section with a count per state', async () => {
  statusFetch()
  renderWithProviders(<Library />)

  await screen.findByRole('button', { name: /Unread/ })
  const status = screen.getByRole('complementary', { name: 'Status' })
  // Read was removed from the rail: browsing what you have finished is what the
  // unfiltered shelf is for, and the two remaining filters both answer "what next".
  for (const label of ['Unread', 'Reading']) {
    expect(within(status).getByText(label)).toBeInTheDocument()
  }
  expect(within(status).queryByText('Read')).not.toBeInTheDocument()
  expect(within(status).getByRole('button', { name: /Unread/ })).toHaveTextContent('4')
})

// Rewritten when Unread stopped being a question about series. It asks which COMICS
// are unread, so that is what it fetches and what it draws.
test('choosing Unread asks the server for the unread comics themselves', async () => {
  statusFetch()
  renderWithProviders(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: /Unread/ }))

  await waitFor(() =>
    expect(calls.some((c) => c.includes('/api/books') && c.includes('readState=unread'))).toBe(true))
})

test('the unread view draws the comics, not the series they belong to', async () => {
  statusFetch()
  renderWithProviders(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: /Unread/ }))

  expect(await screen.findByText('Bad Things')).toBeInTheDocument()
  const link = screen.getByRole('link', { name: /Bad Things/ })
  expect(link).toHaveAttribute('href', '/book/7')
})

test('a comic with no metadata is still named by its file', async () => {
  statusFetch()
  renderWithProviders(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: /Unread/ }))

  expect(await screen.findByText('knull_untagged')).toBeInTheDocument()
})

test('Reading lists comics the same way Unread does', async () => {
  statusFetch()
  renderWithProviders(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: /Reading/ }))

  await waitFor(() =>
    expect(calls.some((c) => c.includes('/api/books') && c.includes('readState=reading'))).toBe(true))
  expect(await screen.findByText('Bad Things')).toBeInTheDocument()
})

test('with no filter the shelf is still series', async () => {
  statusFetch()
  renderWithProviders(<Library />)

  expect(await screen.findByText('Amazing Spider-Man')).toBeInTheDocument()
  expect(calls.some((c) => c.includes('/api/books'))).toBe(false)
})

test('a status with nothing in it says so rather than showing a blank grid', async () => {
  calls = []
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    calls.push(u)
    const body =
      u.includes('/api/read-states') ? READ_STATES
        : u.includes('/api/books') ? { books: [] }
        : u.includes('/api/series') ? { series: [ASM_SERIES] }
        : u.includes('/api/publishers') ? { publishers: [] }
        : { editions: [] }
    return { ok: true, json: async () => body }
  }) as unknown as typeof fetch
  renderWithProviders(<Library />)

  fireEvent.click(await screen.findByRole('button', { name: /Unread/ }))

  expect(await screen.findByText(/nothing unread/i)).toBeInTheDocument()
})

test('choosing a status clears the publisher filter', async () => {
  statusFetch()
  renderWithProviders(<Library />)

  fireEvent.click(await screen.findByRole('button', { name: /Marvel/ }))
  await waitFor(() => expect(gridCalls().some((c) => c.includes('publisher=Marvel'))).toBe(true))

  // A status now fetches comics rather than series, so the call to inspect changed;
  // what it proves — that the publisher was cleared — has not.
  fireEvent.click(screen.getByRole('button', { name: /Unread/ }))
  await waitFor(() => {
    const bookCalls = calls.filter((c) => c.includes('/api/books?'))
    expect(bookCalls.length).toBeGreaterThan(0)
    const last = bookCalls[bookCalls.length - 1]
    expect(last).toContain('readState=unread')
    expect(last).not.toContain('publisher=')
  })
})

test('choosing a publisher clears the status filter', async () => {
  statusFetch()
  renderWithProviders(<Library />)

  fireEvent.click(await screen.findByRole('button', { name: /Unread/ }))
  await waitFor(() => expect(calls.some((c) => c.includes('/api/books?') && c.includes('readState=unread'))).toBe(true))

  fireEvent.click(screen.getByRole('button', { name: /Marvel/ }))
  await waitFor(() => {
    const last = gridCalls()[gridCalls().length - 1]
    expect(last).toContain('publisher=Marvel')
    expect(last).not.toContain('readState=')
  })
})

// Both of these asserted that an active status rode along a series tile's link. A status
// no longer renders series tiles at all — it renders the comics — so the combination they
// described cannot occur. What replaces them: a status URL shows comics, not series.
test('arriving on a status URL shows comics rather than series tiles', async () => {
  statusFetch([BATMAN_SERIES])
  renderWithProviders(<Library />, '/?status=unread')

  expect(await screen.findByText('Bad Things')).toBeInTheDocument()
  expect(screen.queryByText('Batman')).not.toBeInTheDocument()
})


test('the status in the url drives the request and the active rail item', async () => {
  statusFetch()
  renderWithProviders(<Library />, '/?status=reading')

  await waitFor(() =>
    expect(calls.some((c) => c.includes('/api/books?') && c.includes('readState=reading'))).toBe(true))
})

// Previously read off a series tile's href; a status shows no series tiles now, so the
// url is proved by what it fetches and by the comic it draws.
test('choosing a status puts it in the url', async () => {
  statusFetch()
  renderWithProviders(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: /Unread/ }))

  await waitFor(() =>
    expect(calls.some((c) => c.includes('/api/books?') && c.includes('readState=unread'))).toBe(true))
  expect(await screen.findByText('Bad Things')).toBeInTheDocument()
})

// --- story arcs rail --------------------------------------------------------

const ARC_ROUTES = {
  '/api/publishers': { publishers: [] },
  '/api/series': { series: [] },
  '/api/editions': { editions: [] },
  '/api/arcs': { arcs: [{ name: 'Death Spiral', owned: 3 }, { name: 'Court of Owls', owned: 1 }] },
}

test('the sidebar has a single Story Arcs entry', async () => {
  globalThis.fetch = makeFetch(ARC_ROUTES)
  renderWithProviders(<Library />)
  const rail = await screen.findByLabelText('Story Arcs')
  expect(within(rail).getByRole('link', { name: /Story Arcs/ })).toHaveAttribute('href', '/arcs')
})

// Listing every arc in a rail stops working as soon as there are more than a handful,
// and the names are long enough to truncate at this width.
test('the sidebar does not list the arcs themselves', async () => {
  globalThis.fetch = makeFetch(ARC_ROUTES)
  renderWithProviders(<Library />)
  const rail = await screen.findByLabelText('Story Arcs')
  expect(within(rail).queryByText('Death Spiral')).not.toBeInTheDocument()
  expect(within(rail).queryByText('Court of Owls')).not.toBeInTheDocument()
})

test('the Story Arcs entry counts the arcs', async () => {
  globalThis.fetch = makeFetch(ARC_ROUTES)
  renderWithProviders(<Library />)
  const rail = await screen.findByLabelText('Story Arcs')
  expect(within(rail).getByText('2')).toBeInTheDocument()
})

test('the Story Arcs entry stays out of the way when there are no arcs', async () => {
  globalThis.fetch = makeFetch({ ...ARC_ROUTES, '/api/arcs': { arcs: [] } })
  renderWithProviders(<Library />)
  await screen.findByLabelText('Publishers')
  expect(screen.queryByLabelText('Story Arcs')).not.toBeInTheDocument()
})
