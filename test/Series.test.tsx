import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Series from '../src/pages/Series'

const SERIES = {
  name: 'Amazing Spider-Man',
  bookCount: 5,
  editions: [
    { id: 9, name: 'Amazing Spider-Man (2025)', bookCount: 3 },
    { id: 8, name: 'Amazing Spider-Man by Nick Spencer Omnibus', bookCount: 2 },
  ],
}

function mockFetch(body: unknown, ok = true) {
  globalThis.fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body })) as unknown as typeof fetch
}

beforeEach(() => { mockFetch({ series: SERIES }) })
afterEach(() => { cleanup() })

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/series/:name" element={<Series />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

test('shows the series name as the heading', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  expect(await screen.findByRole('heading', { name: 'Amazing Spider-Man' })).toBeInTheDocument()
})

test('lists each edition under its own name', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  expect(await screen.findByText('Amazing Spider-Man (2025)')).toBeInTheDocument()
  expect(screen.getByText('Amazing Spider-Man by Nick Spencer Omnibus')).toBeInTheDocument()
})

test('each edition links to its edition page', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  const tile = (await screen.findByText('Amazing Spider-Man (2025)')).closest('a')
  expect(tile).toHaveAttribute('href', '/edition/9')
})

test('each edition shows its own issue count', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  expect(await screen.findByText('3 issues')).toBeInTheDocument()
  expect(screen.getByText('2 issues')).toBeInTheDocument()
})

test('says how many editions the series has', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  expect(await screen.findByText(/2 editions/)).toBeInTheDocument()
})

test('a series name with spaces is requested url-encoded', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  await screen.findByRole('heading', { name: 'Amazing Spider-Man' })
  const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
  expect(url).toBe('/api/series/Amazing%20Spider-Man')
})

test('an unknown series reports that it was not found', async () => {
  mockFetch({ error: 'series not found' }, false)
  renderAt('/series/Aquaman')
  expect(await screen.findByText(/not found/i)).toBeInTheDocument()
})

test('a status in the url is sent with the series request', async () => {
  renderAt('/series/Amazing%20Spider-Man?status=unread')
  await screen.findByRole('heading', { name: 'Amazing Spider-Man' })
  const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
  expect(url).toContain('readState=unread')
})

test('edition links carry the status onwards', async () => {
  renderAt('/series/Amazing%20Spider-Man?status=unread')
  const tile = (await screen.findByText('Amazing Spider-Man (2025)')).closest('a')
  expect(tile).toHaveAttribute('href', '/edition/9?status=unread')
})
