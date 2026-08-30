import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import BookDetail from '../src/pages/BookDetail'
import { stubFullscreen } from './helpers/fullscreen'

const book = {
  id: 5,
  editionId: 1,
  title: 'Untitled',
  number: '1',
  pageCount: 20,
  comicinfoSynced: false,
  writer: 'Jonathan Hickman',
  penciller: 'Steve Epting',
  date: '2020-08',
  summary: 'Earths Mightiest Heroes expand their sphere of influence.',
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/books/5' && !opts) return { ok: true, json: async () => ({ book, progress: { lastPage: 0, completed: false } }) }
    if (url === '/api/series') return { ok: true, json: async () => ({ series: [{ id: 1, name: 'Avengers' }] }) }
    if (url.includes('/comicvine/search')) return { ok: true, json: async () => ({ results: [{ id: 99, name: 'Batman', issueNumber: '1', year: '2011' }] }) }
    if (url === '/api/books/5/comicvine') return { ok: true, json: async () => ({ book: { ...book, title: 'Year One' } }) }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
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

test('read mode shows the summary as text with no edit fields', async () => {
  renderAt()
  expect(await screen.findByText(/Earths Mightiest Heroes/)).toBeInTheDocument()
  expect(screen.getByText('Jonathan Hickman')).toBeInTheDocument()
  expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  expect(screen.queryByText('Move')).not.toBeInTheDocument()
})

test('read mode puts the summary above the other details', async () => {
  const { container } = renderAt()
  await screen.findByText(/Earths Mightiest Heroes/)
  const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent)
  expect(headings[0]).toBe('Summary')
})

test('pencil reveals the metadata form', async () => {
  renderAt()
  fireEvent.click(await screen.findByLabelText('Edit metadata'))
  expect(await screen.findByDisplayValue('Untitled')).toBeInTheDocument()
  expect(screen.getByDisplayValue('Steve Epting')).toBeInTheDocument()
  expect(screen.getByText('Move')).toBeInTheDocument()
})

test('saving metadata sends a PATCH and returns to read mode', async () => {
  renderAt()
  fireEvent.click(await screen.findByLabelText('Edit metadata'))
  fireEvent.change(await screen.findByDisplayValue('Untitled'), { target: { value: 'Vol. 1' } })
  fireEvent.click(screen.getByText('Save metadata'))
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/books/5/metadata', expect.objectContaining({ method: 'PATCH' })))
  await waitFor(() => expect(screen.queryAllByRole('textbox')).toHaveLength(0))
})

test('cancel closes the form without saving', async () => {
  renderAt()
  fireEvent.click(await screen.findByLabelText('Edit metadata'))
  fireEvent.change(await screen.findByDisplayValue('Untitled'), { target: { value: 'Vol. 1' } })
  fireEvent.click(screen.getByText('Cancel'))
  await waitFor(() => expect(screen.queryAllByRole('textbox')).toHaveLength(0))
  expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/books/5/metadata', expect.anything())
})

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

test('there is no manual embed button; saving handles it', async () => {
  renderAt()
  await screen.findByText(/Earths Mightiest Heroes/)
  expect(screen.queryByRole('button', { name: /embed/i })).not.toBeInTheDocument()
})

test('Read asks for fullscreen as part of the click that opens the reader', async () => {
  const fs = stubFullscreen()
  renderAt()

  fireEvent.click(await screen.findByRole('button', { name: 'Read' }))

  await waitFor(() => expect(fs.requestFullscreen).toHaveBeenCalled())
  fs.restore()
})
