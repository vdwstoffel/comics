import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'

const RUNNING = {
  running: true, url: 'https://x.test/dls/tok', fileName: 'Knull 005 (2026).cbz',
  received: 20_000_000, total: 50_000_000, error: null, bookId: null,
  startedAt: '2026-09-09T00:00:00Z', finishedAt: null,
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/downloads')) return { ok: true, json: async () => RUNNING }
    if (u.includes('/api/series')) return { ok: true, json: async () => ({ series: [] }) }
    if (u.includes('/api/editions')) return { ok: true, json: async () => ({ editions: [] }) }
    if (u.includes('/api/books/')) return { ok: true, json: async () => ({ book: { id: 1, pageCount: 1 }, progress: { lastPage: 0, completed: false } }) }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup() })

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('a running download is reported on the library page', async () => {
  renderAt('/')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Downloading/i))
})

test('a running download is reported on the upload page', async () => {
  renderAt('/upload')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Downloading/i))
})

test('a running download is reported on the search page', async () => {
  renderAt('/search')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Downloading/i))
})

test('the reader is left alone', async () => {
  renderAt('/read/1')
  await new Promise((r) => setTimeout(r, 250))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('starting a download puts it on the bar straight away', async () => {
  let running = false
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/downloads') && init?.method === 'POST') {
      running = true
      return { ok: true, json: async () => ({ started: true, status: {} }) }
    }
    if (u.includes('/api/downloads')) {
      return { ok: true, json: async () => (running ? RUNNING : { ...RUNNING, running: false, finishedAt: null, fileName: null }) }
    }
    return { ok: true, json: async () => ({ editions: [] }) }
  }) as unknown as typeof fetch

  renderAt('/upload')
  fireEvent.change(await screen.findByPlaceholderText(/paste a link/i), {
    target: { value: 'https://x.test/dls/tok' },
  })
  fireEvent.click(screen.getByRole('button', { name: /^download$/i }))

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Downloading/i))
})
