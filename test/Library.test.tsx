import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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
    '/api/series': { series: [{ id: 1, name: 'Batman', bookCount: 3 }] },
  })
})

afterEach(() => { cleanup() })

function renderWithProviders(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

const inProgressBook = {
  id: 7, seriesId: 1, title: 'Vol. 1', number: '1', pageCount: 10,
  comicinfoSynced: false, readState: 'reading', percent: 40, seriesName: 'Avengers',
}

test('Library shows a Continue reading section for in-progress books', async () => {
  globalThis.fetch = makeFetch({
    '/api/publishers': { publishers: [] },
    '/api/continue-reading': { books: [inProgressBook] },
    '/api/series': { series: [{ id: 1, name: 'Batman', bookCount: 3 }] },
  })

  renderWithProviders(<Library />)

  expect(await screen.findByText('Continue reading')).toBeInTheDocument()
  expect(screen.getByText('Vol. 1')).toBeInTheDocument()
  expect(screen.getByText('Avengers')).toBeInTheDocument()
  expect(screen.getByLabelText('In progress: 40%')).toBeInTheDocument()
})

test('Continue reading tiles link into the reader', async () => {
  globalThis.fetch = makeFetch({
    '/api/publishers': { publishers: [] },
    '/api/continue-reading': { books: [inProgressBook] },
    '/api/series': { series: [{ id: 1, name: 'Batman', bookCount: 3 }] },
  })

  renderWithProviders(<Library />)

  const tile = (await screen.findByText('Vol. 1')).closest('a')
  expect(tile).toHaveAttribute('href', '/read/7')
})

test('Continue reading follows the publisher filter', async () => {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/publishers')) return { ok: true, json: async () => ({ publishers: [{ name: 'DC', count: 1 }] }) }
    // Nothing DC is in progress; the unfiltered call still has the Marvel book.
    if (u.includes('/api/continue-reading')) {
      return { ok: true, json: async () => ({ books: u.includes('publisher=DC') ? [] : [inProgressBook] }) }
    }
    if (u.includes('/api/series')) return { ok: true, json: async () => ({ series: [{ id: 1, name: 'Batman', bookCount: 3 }] }) }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch

  renderWithProviders(<Library />)
  expect(await screen.findByText('Continue reading')).toBeInTheDocument()

  fireEvent.click(await screen.findByRole('button', { name: /DC/ }))

  await waitFor(() => expect(screen.queryByText('Continue reading')).not.toBeInTheDocument())
})

test('Library omits the Continue reading section when nothing is in progress', async () => {
  globalThis.fetch = makeFetch({
    '/api/publishers': { publishers: [] },
    '/api/continue-reading': { books: [] },
    '/api/series': { series: [{ id: 1, name: 'Batman', bookCount: 3 }] },
  })

  renderWithProviders(<Library />)

  expect(await screen.findByText('Batman')).toBeInTheDocument()
  expect(screen.queryByText('Continue reading')).not.toBeInTheDocument()
})

test('Library renders series tiles from the API', async () => {
  renderWithProviders(<Library />)
  expect(await screen.findByText('Batman')).toBeInTheDocument()
  expect(screen.getByText(/3/)).toBeInTheDocument()
})

test('Library shows publisher sidebar items when publishers exist', async () => {
  globalThis.fetch = makeFetch({
    '/api/publishers': { publishers: [{ name: 'DC', count: 2 }, { name: 'Marvel', count: 1 }] },
    '/api/series': { series: [{ id: 1, name: 'Batman', bookCount: 2 }] },
  })

  renderWithProviders(<Library />)

  expect(await screen.findByText('Publishers')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /DC/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Marvel/ })).toBeInTheDocument()
  expect(screen.getByText('All')).toBeInTheDocument()
})

test('Library filters series when a publisher is clicked', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const urlStr = String(url)
    if (urlStr.includes('/api/publishers')) {
      return { ok: true, json: async () => ({ publishers: [{ name: 'Marvel', count: 1 }] }) }
    }
    if (urlStr.includes('/api/series') && urlStr.includes('publisher=Marvel')) {
      return { ok: true, json: async () => ({ series: [{ id: 2, name: 'X-Men', bookCount: 5 }] }) }
    }
    if (urlStr.includes('/api/series')) {
      return { ok: true, json: async () => ({ series: [{ id: 1, name: 'Batman', bookCount: 3 }, { id: 2, name: 'X-Men', bookCount: 5 }] }) }
    }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
  globalThis.fetch = fetchMock

  renderWithProviders(<Library />)

  // Initially shows all series and publisher sidebar
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
