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
