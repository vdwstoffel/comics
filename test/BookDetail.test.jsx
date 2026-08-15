import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import BookDetail from '../src/pages/BookDetail.jsx'

const book = { id: 5, seriesId: 1, title: 'Untitled', number: '1', pageCount: 20, comicinfoSynced: false }

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (url === '/api/books/5' && !opts) return { ok: true, json: async () => ({ book, progress: { lastPage: 0, completed: false } }) }
    if (url.includes('/comicvine/search')) return { ok: true, json: async () => ({ results: [{ id: 99, name: 'Batman', issueNumber: '1', year: '2011' }] }) }
    if (url === '/api/books/5/comicvine') return { ok: true, json: async () => ({ book: { ...book, title: 'Year One' } }) }
    return { ok: true, json: async () => ({}) }
  })
})

function renderAt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/book/5']}>
        <Routes><Route path="/book/:id" element={<BookDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

test('shows book, opens Comic Vine dialog, applies a match', async () => {
  renderAt()
  expect(await screen.findByText('Untitled')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Fetch metadata'))
  fireEvent.change(await screen.findByPlaceholderText('Search Comic Vine'), { target: { value: 'batman' } })
  fireEvent.click(screen.getByText('Search'))
  const candidate = await screen.findByText(/Batman/)
  fireEvent.click(candidate)
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/books/5/comicvine', expect.objectContaining({ method: 'POST' })))
})
