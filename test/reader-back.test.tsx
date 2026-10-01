import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import Reader from '../src/pages/Reader'
import { stubFullscreen } from './helpers/fullscreen'

beforeEach(() => {
  stubFullscreen()
  globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/books/5' && !opts) {
      return { ok: true, json: async () => ({ book: { id: 5, editionId: 16, pageCount: 3 }, progress: { lastPage: 0, completed: false } }) }
    }
    return { ok: true, json: async () => ({ progress: { lastPage: 1, completed: false } }) }
  }) as unknown as typeof fetch
})

function Where() {
  const loc = useLocation()
  return <span data-testid="where">{loc.pathname}{loc.search}</span>
}

/** The reader, reached from `entries` - the last of which is the reader itself. */
function renderFrom(entries: (string | { pathname: string; state?: unknown })[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Where />
        <Routes>
          <Route path="/read/:id" element={<Reader />} />
          <Route path="/edition/:id" element={<p>the run</p>} />
          <Route path="/arcs/:name" element={<p>an arc</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// Opened from the carousel, back belongs to the carousel - on the issue it was showing.
// The issue page was never visited on the way in, and landing on it meant two more presses
// to get back to the run.
test('back returns to the page the comic was opened from', async () => {
  renderFrom(['/edition/16?issue=issue-77', '/read/5'])
  fireEvent.click(await screen.findByLabelText('Back'))
  expect(screen.getByTestId('where')).toHaveTextContent('/edition/16?issue=issue-77')
})

// From a grid tile you go through the issue's page, so that is where back belongs.
test('opened from somewhere else in the app, back returns there', async () => {
  renderFrom(['/edition/16', '/arcs/Gang%20War', '/read/5'])
  fireEvent.click(await screen.findByLabelText('Back'))
  expect(screen.getByTestId('where')).toHaveTextContent('/arcs/Gang%20War')
})

// Middle-click, right-click and "open in new tab" all need a real destination.
test('back is a real link, whatever it does when clicked', async () => {
  renderFrom(['/edition/16', '/read/5'])
  expect(await screen.findByLabelText('Back')).toHaveAttribute('href', '/edition/16?issue=book-5')
})

// Opened straight off the shelf, where there is no issue page and no run on the way in.
// Closing the comic should leave you in its run rather than back on the shelf: the shelf
// is where you pick what to read, and you have just read it.
test('a comic opened from the shelf closes into its run, on that issue', async () => {
  renderFrom([{ pathname: '/read/5', state: { back: 'run' } }])
  fireEvent.click(await screen.findByLabelText('Back'))
  expect(screen.getByTestId('where')).toHaveTextContent('/edition/16?issue=book-5')
})

test('that back is a real link to the run', async () => {
  renderFrom([{ pathname: '/read/5', state: { back: 'run' } }])
  expect(await screen.findByLabelText('Back')).toHaveAttribute('href', '/edition/16?issue=book-5')
})

// There is no issue page to fall back to any more - the run is where a comic lives.
test('opened cold, back goes to the run', async () => {
  renderFrom(['/read/5'])
  fireEvent.click(await screen.findByLabelText('Back'))
  expect(screen.getByTestId('where')).toHaveTextContent('/edition/16?issue=book-5')
})
