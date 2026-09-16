import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'

const RUNNING = {
  active: [{
    id: 1, fileName: 'Knull 005 (2026).cbz',
    received: 20_000_000, total: 50_000_000, startedAt: '2026-09-09T00:00:00Z',
  }],
  queue: [], history: [],
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/downloads')) return { ok: true, json: async () => RUNNING }
    if (u.includes('/api/series')) return { ok: true, json: async () => ({ series: [] }) }
    if (u.includes('/api/editions')) return { ok: true, json: async () => ({ editions: [] }) }
    if (u.includes('/api/books/')) return { ok: true, json: async () => ({ book: { id: 1, pageCount: 1 }, progress: { lastPage: 0, completed: false } }) }
    if (u.includes('/api/releases')) return { ok: true, json: async () => ({ day: '2026-09-09', fetchedAt: null, publishers: [] }) }
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
      return { ok: true, json: async () => ({ queued: true }) }
    }
    if (u.includes('/api/downloads')) {
      return { ok: true, json: async () => (running ? RUNNING : { active: [], queue: [], history: [] }) }
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

// --- the header tabs ------------------------------------------------------

// Library and Latest releases are peers, not a brand and a link: the two things you
// browse, side by side, with the one you are on marked.
test('the header offers Library and Latest releases as tabs', async () => {
  renderAt('/')
  expect(await screen.findByRole('link', { name: 'Library' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('link', { name: 'Latest releases' })).toHaveAttribute('href', '/releases')
})

test('the library tab is marked when you are on the library', async () => {
  renderAt('/')
  expect(await screen.findByRole('link', { name: 'Library', current: 'page' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Latest releases' })).not.toHaveAttribute('aria-current')
})

test('the latest releases tab is marked when you are on it', async () => {
  renderAt('/releases')
  expect(await screen.findByRole('link', { name: 'Latest releases', current: 'page' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Library' })).not.toHaveAttribute('aria-current')
})

// A page that is neither marks neither, rather than leaving the library lit while you
// are somewhere else entirely.
test('neither tab is marked on a page that is neither', async () => {
  renderAt('/upload')
  await screen.findByRole('link', { name: 'Library' })
  expect(screen.queryByRole('link', { current: 'page' })).toBeNull()
})
