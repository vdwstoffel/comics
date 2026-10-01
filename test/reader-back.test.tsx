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
      return { ok: true, json: async () => ({ book: { id: 5, pageCount: 3 }, progress: { lastPage: 0, completed: false } }) }
    }
    return { ok: true, json: async () => ({ progress: { lastPage: 1, completed: false } }) }
  }) as unknown as typeof fetch
})

function Where() {
  const loc = useLocation()
  return <span data-testid="where">{loc.pathname}{loc.search}</span>
}

/** The reader, reached from `entries` - the last of which is the reader itself. */
function renderFrom(entries: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Where />
        <Routes>
          <Route path="/read/:id" element={<Reader />} />
          <Route path="/edition/:id" element={<p>the run</p>} />
          <Route path="/book/:id" element={<p>the issue page</p>} />
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
test('opened from the issue page, back returns there', async () => {
  renderFrom(['/edition/16', '/book/5', '/read/5'])
  fireEvent.click(await screen.findByLabelText('Back'))
  expect(screen.getByTestId('where')).toHaveTextContent('/book/5')
})

// A link straight to the reader has nothing behind it, and a back arrow that does nothing
// is worse than one that goes somewhere sensible.
test('opened cold, back goes to the issue page', async () => {
  renderFrom(['/read/5'])
  fireEvent.click(await screen.findByLabelText('Back'))
  expect(screen.getByTestId('where')).toHaveTextContent('/book/5')
})

// Middle-click, right-click and "open in new tab" all need a real destination.
test('back is a real link, whatever it does when clicked', async () => {
  renderFrom(['/edition/16', '/read/5'])
  expect(await screen.findByLabelText('Back')).toHaveAttribute('href', '/book/5')
})
