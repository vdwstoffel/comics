import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Reader from '../src/pages/Reader'

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/books/5' && !opts) return { ok: true, json: async () => ({ book: { id: 5, pageCount: 3 }, progress: { lastPage: 0, completed: false } }) }
    return { ok: true, json: async () => ({ progress: { lastPage: 1, completed: false } }) }
  }) as unknown as typeof fetch
})

function renderReader() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/read/5']}>
        <Routes><Route path="/read/:id" element={<Reader />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

test('renders first page and advances, saving progress', async () => {
  renderReader()
  expect(await screen.findByText('1 / 3')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(await screen.findByText('2 / 3')).toBeInTheDocument()
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/books/5/progress', expect.objectContaining({ method: 'PUT' })))
})
