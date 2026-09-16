import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Downloads from '../src/pages/Downloads'

const VIEW = {
  active: [{ id: 1, label: 'Wolverine #27', fileName: 'w27.cbz', received: 500_000, total: 1_000_000, startedAt: '2026-09-15T00:00:00Z' }],
  queue: [
    { id: 1, position: 0, state: 'running', url: 'u1', label: 'Wolverine #27', attempts: 0, queuedAt: 'q' },
    { id: 2, position: 1, state: 'queued', url: 'u2', label: 'Iron Man #9', attempts: 0, queuedAt: 'q' },
  ],
  history: [
    { id: 9, position: 0, state: 'failed', url: 'u9', label: 'Black Cat #14', attempts: 2, error: 'no link', queuedAt: 'q', finishedAt: 'f' },
  ],
}

let posted: string[]
beforeEach(() => {
  posted = []
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method) posted.push(`${init.method} ${url}`)
    return { ok: true, json: async () => (init?.method ? {} : VIEW) }
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Downloads /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('what is downloading now is shown with its progress', async () => {
  draw()
  // "Wolverine #27" legitimately appears twice - once as this summary line, once as its
  // own row in the queue below - so the query is scoped to the summary section rather
  // than left to match the whole page.
  const now = await screen.findByRole('region', { name: /now downloading/i })
  expect(await within(now).findByText(/Wolverine #27/)).toBeInTheDocument()
  expect(within(now).getByText(/50%/)).toBeInTheDocument()
})

test('what is waiting is listed', async () => {
  draw()
  expect(await screen.findByText(/Iron Man #9/)).toBeInTheDocument()
})

test('a failed download is listed with its error and offers a retry', async () => {
  draw()
  expect(await screen.findByText(/Black Cat #14/)).toBeInTheDocument()
  expect(screen.getByText(/no link/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /retry/i }))
  await waitFor(() => expect(posted).toContain('POST /api/downloads/queue/9/retry'))
})

test('clearing the history asks the server to', async () => {
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /clear/i }))
  await waitFor(() => expect(posted).toContain('DELETE /api/downloads/history'))
})

test('cancelling a queued download asks the server to', async () => {
  draw()
  await screen.findByText(/Iron Man #9/)
  const row = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('Iron Man'))!
  fireEvent.click(within(row).getByRole('button', { name: /cancel/i }))
  await waitFor(() => expect(posted).toContain('DELETE /api/downloads/queue/2'))
})
