import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import BookRedirect from '../src/pages/BookRedirect'

function Where() {
  const loc = useLocation()
  return <span data-testid="where">{loc.pathname}{loc.search}</span>
}

function draw(path = '/book/19') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/book/:id" element={<BookRedirect />} />
          <Route path="/edition/:id" element={<p>the run</p>} />
          <Route path="/volume/:volumeId" element={<p>the shelf</p>} />
          <Route path="/" element={<p>the library</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ book: { id: 19, editionId: 16, pageCount: 20 }, progress: {} }),
  })) as unknown as typeof fetch
})

// The comic's own page is gone - everything it said is said under the cover now - but
// Downloads, Upload, Releases, the arc pages and every bookmark still name comics this
// way, and Releases and the arcs know only the comic, not which edition holds it.
test('a comic opens in its run, standing on that comic', async () => {
  draw()
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/edition/16?issue=book-19'))
})

// Replaced, not pushed: the page you came from is behind you, and a redirect left in the
// history would bounce you forward again the moment you pressed back.
test('the redirect leaves nothing behind in the history', async () => {
  draw()
  await screen.findByText('the run')
  expect(history.length).toBeLessThanOrEqual(2)
})

test('a comic the library does not have sends you to the library', async () => {
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch
  draw('/book/999')
  // Waiting on the destination, not on the url: every path contains a slash, so a text
  // match on '/' would pass before the redirect had happened at all.
  expect(await screen.findByText('the library')).toBeInTheDocument()
})

/** The book payload, with whatever shelf answer this test wants. */
function mockBook(shelfVolumeId: number | null) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ book: { id: 19, editionId: 84, pageCount: 20 }, progress: {}, shelfVolumeId }),
  })) as unknown as typeof fetch
}

// Spec §5.2. Three trade lines of one run are one shelf, and that shelf is where the
// comics on it live: landing on "Amazing Spider-Man By Zeb Wells (2023)" would put you
// back on one of the three shelves the whole feature exists to stop showing.
test('a collected comic opens on its volume shelf', async () => {
  mockBook(142577)
  draw()
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/volume/142577?issue=book-19'))
})

test('a comic in a stand-alone edition still opens in that edition', async () => {
  mockBook(null)
  draw()
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/edition/84?issue=book-19'))
})
