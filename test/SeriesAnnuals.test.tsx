import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SeriesAnnuals from '../src/pages/SeriesAnnuals'

const SERIES = {
  name: 'The Amazing Spider-Man',
  bookCount: 37,
  editions: [
    { id: 9, name: 'The Amazing Spider-Man (2025)', bookCount: 35 },
    // Deliberately the order the server gives: by name, which puts 2026 first because
    // the 2024 annual carries an article and the 2026 one does not.
    { id: 10, name: 'Amazing Spider-Man Annual (2026)', bookCount: 1 },
    { id: 11, name: 'The Amazing Spider-Man Annual (2024)', bookCount: 1 },
  ],
}

const BOOKS: Record<number, unknown[]> = {
  10: [{ id: 501, number: '1', title: null, readState: 'unread' }],
  11: [{ id: 502, number: '1', title: 'The Infinity Watch', readState: 'read' }],
}

function mockFetch() {
  globalThis.fetch = vi.fn(async (url: string) => {
    const at = String(url)
    const edition = /\/api\/editions\/(\d+)/.exec(at)?.[1]
    if (edition) {
      return {
        ok: true,
        json: async () => ({
          edition: { id: Number(edition), name: '', seriesName: null, summary: null },
          books: BOOKS[Number(edition)] ?? [],
        }),
      }
    }
    return { ok: true, json: async () => ({ series: SERIES }) }
  }) as unknown as typeof fetch
}

beforeEach(() => { mockFetch() })
afterEach(() => { cleanup() })

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/series/:name/annuals" element={<SeriesAnnuals />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

const PATH = '/series/The%20Amazing%20Spider-Man/annuals'

test('the page is headed Annuals and says how many there are', async () => {
  renderAt(PATH)
  expect(await screen.findByRole('heading', { name: 'Annuals' })).toBeInTheDocument()
  expect(screen.getByText('2 annuals')).toBeInTheDocument()
})

// The whole point of the page: an annual is issue #1 of its own volume nearly every
// time, so the number names none of them and the year names all of them.
test('each annual is named by its year rather than its issue number', async () => {
  renderAt(PATH)
  expect(await screen.findByText('2024')).toBeInTheDocument()
  expect(screen.getByText('2026')).toBeInTheDocument()
  expect(screen.queryByText('#1')).not.toBeInTheDocument()
})

test('the annuals are ordered by year, not by the name the server sorted on', async () => {
  renderAt(PATH)
  await screen.findByText('2024')
  const years = screen.getAllByText(/^20\d\d$/).map((el) => el.textContent)
  expect(years).toEqual(['2024', '2026'])
})

test('a comic with a title of its own says so beneath the year', async () => {
  renderAt(PATH)
  expect(await screen.findByText('The Infinity Watch')).toBeInTheDocument()
})

test('each annual opens the comic itself', async () => {
  renderAt(PATH)
  const tile = (await screen.findByText('2024')).closest('a')
  expect(tile).toHaveAttribute('href', '/book/502')
})

test('there is a link back to the series', async () => {
  renderAt(PATH)
  const back = await screen.findByRole('link', { name: /The Amazing Spider-Man/ })
  expect(back).toHaveAttribute('href', '/series/The%20Amazing%20Spider-Man')
})

test('the run itself is not listed here', async () => {
  renderAt(PATH)
  await screen.findByText('2024')
  expect(screen.queryByText('The Amazing Spider-Man (2025)')).not.toBeInTheDocument()
})
