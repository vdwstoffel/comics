import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Reader from '../src/pages/Reader'
import { stubFullscreen } from './helpers/fullscreen'

/** The server's idea of where you are, which the reader writes to and reads back. */
let savedPage = 0

beforeEach(() => {
  stubFullscreen()
  savedPage = 0
  globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/books/5' && !opts) {
      return { ok: true, json: async () => ({ book: { id: 5, editionId: 16, pageCount: 3 }, progress: { lastPage: savedPage, completed: false } }) }
    }
    if (url === '/api/books/5/progress') {
      savedPage = JSON.parse(String(opts!.body)).lastPage
      return { ok: true, json: async () => ({ progress: { lastPage: savedPage, completed: false } }) }
    }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
})

/** One visit to the reader, sharing a cache with every other visit, as the app does. */
function open(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/read/5']}>
        <Routes><Route path="/read/:id" element={<Reader />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('a comic re-opened in the same session resumes where you left off', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const first = open(qc)
  await screen.findByText('1 / 3')
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  await screen.findByText('3 / 3')
  await waitFor(() => expect(savedPage).toBe(2))
  first.unmount()

  open(qc)

  expect(await screen.findByText('3 / 3')).toBeInTheDocument()
})

test('re-opening a comic does not write an older page over your progress', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const first = open(qc)
  await screen.findByText('1 / 3')
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  await screen.findByText('2 / 3')
  await waitFor(() => expect(savedPage).toBe(1))
  first.unmount()

  open(qc)
  await screen.findByText(/\/ 3/)
  await new Promise((r) => setTimeout(r, 600))

  expect(savedPage).toBe(1)
})
