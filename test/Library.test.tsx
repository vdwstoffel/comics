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

// A single-edition tile keeps the edition's own name, since it opens that edition.
test('a series with one edition links straight to that edition', async () => {
  globalThis.fetch = seriesFetch([BATMAN_SERIES])
  renderWithProviders(<Library />)

  const tile = (await screen.findByText('Batman Vol. 2 (New 52 TPB)')).closest('a')
  expect(tile).toHaveAttribute('href', '/edition/6')
  expect(screen.getByText('10 issues')).toBeInTheDocument()
})

test('a single-edition tile shows that edition\'s cover', async () => {
  globalThis.fetch = seriesFetch([BATMAN_SERIES])
  renderWithProviders(<Library />)
  const img = await screen.findByAltText('Batman Vol. 2 (New 52 TPB)')
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

function statusFetch(series: unknown[] = [ASM_SERIES]) {
  calls = []
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    calls.push(u)
    const body =
      u.includes('/api/read-states') ? READ_STATES
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
  for (const label of ['Unread', 'Reading', 'Read']) {
    expect(within(status).getByText(label)).toBeInTheDocument()
  }
  expect(within(status).getByRole('button', { name: /Unread/ })).toHaveTextContent('4')
})

test('choosing Unread asks the server for series with unread issues', async () => {
  statusFetch()
  renderWithProviders(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: /Unread/ }))

  await waitFor(() => expect(gridCalls().some((c) => c.includes('readState=unread'))).toBe(true))
})

test('choosing a status clears the publisher filter', async () => {
  statusFetch()
  renderWithProviders(<Library />)

  fireEvent.click(await screen.findByRole('button', { name: /Marvel/ }))
  await waitFor(() => expect(gridCalls().some((c) => c.includes('publisher=Marvel'))).toBe(true))

  fireEvent.click(screen.getByRole('button', { name: /Unread/ }))
  await waitFor(() => {
    const last = gridCalls()[gridCalls().length - 1]
    expect(last).toContain('readState=unread')
    expect(last).not.toContain('publisher=')
  })
})

test('choosing a publisher clears the status filter', async () => {
  statusFetch()
  renderWithProviders(<Library />)

  fireEvent.click(await screen.findByRole('button', { name: /Unread/ }))
  await waitFor(() => expect(gridCalls().some((c) => c.includes('readState=unread'))).toBe(true))

  fireEvent.click(screen.getByRole('button', { name: /Marvel/ }))
  await waitFor(() => {
    const last = gridCalls()[gridCalls().length - 1]
    expect(last).toContain('publisher=Marvel')
    expect(last).not.toContain('readState=')
  })
})

test('an active status is carried into the tile links', async () => {
  statusFetch([BATMAN_SERIES])
  renderWithProviders(<Library />, '/?status=unread')

  const tile = (await screen.findByText('Batman Vol. 2 (New 52 TPB)')).closest('a')
  expect(tile).toHaveAttribute('href', '/edition/6?status=unread')
})

test('a multi-edition tile carries the status too', async () => {
  statusFetch([ASM_SERIES])
  renderWithProviders(<Library />, '/?status=read')

  const tile = (await screen.findByText('Amazing Spider-Man')).closest('a')
  expect(tile).toHaveAttribute('href', '/series/Amazing%20Spider-Man?status=read')
})

test('the status in the url drives the request and the active rail item', async () => {
  statusFetch()
  renderWithProviders(<Library />, '/?status=reading')

  await waitFor(() => expect(gridCalls().some((c) => c.includes('readState=reading'))).toBe(true))
})

test('choosing a status puts it in the url', async () => {
  statusFetch()
  renderWithProviders(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: /Unread/ }))

  const tile = await screen.findByText('Amazing Spider-Man')
  expect(tile.closest('a')).toHaveAttribute('href', expect.stringContaining('status=unread'))
})
