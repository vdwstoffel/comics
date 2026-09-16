import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import DownloadBar from '../src/components/DownloadBar'

const view = (over: Partial<{ active: unknown[]; queue: unknown[]; history: unknown[] }> = {}) => ({
  active: [], queue: [], history: [], ...over,
})

function stub(body: unknown) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch
}
afterEach(() => cleanup())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DownloadBar /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const ACTIVE = { id: 1, label: 'Wolverine #27', fileName: 'w27.cbz', received: 500_000, total: 1_000_000, startedAt: '2026-09-15T00:00:00Z' }

test('an idle server with nothing queued shows no bar', async () => {
  stub(view())
  draw()
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
})

test('a running download is reported with its progress', async () => {
  stub(view({ active: [ACTIVE] }))
  draw()
  expect(await screen.findByRole('status')).toHaveTextContent(/Wolverine #27/)
  expect(screen.getByRole('status')).toHaveTextContent(/50%/)
})

test('a download whose size the server never gave shows what has arrived', async () => {
  stub(view({ active: [{ ...ACTIVE, total: 0 }] }))
  draw()
  expect(await screen.findByRole('status')).toHaveTextContent('0.5 MB')
  expect(screen.getByRole('status')).not.toHaveTextContent('%')
})

test('what is waiting is counted', async () => {
  stub(view({ active: [ACTIVE], queue: [{ id: 2, state: 'queued', label: 'a' }, { id: 3, state: 'queued', label: 'b' }] }))
  draw()
  expect(await screen.findByRole('status')).toHaveTextContent(/2 queued/)
})

test('the bar links to the queue page', async () => {
  stub(view({ active: [ACTIVE] }))
  draw()
  expect(await screen.findByRole('link', { name: /queue/i })).toHaveAttribute('href', '/downloads')
})

// The bar holds the app's only link to /downloads. Hiding it the moment the queue empties
// hid it exactly when it was needed: a download that failed its retry lands in history
// with nothing running, and the user was told nothing at all.
test('a failure nobody has dealt with keeps the bar up, and says what went wrong', async () => {
  stub(view({ history: [{ id: 9, state: 'failed', label: 'Wolverine #27', error: '404 Not Found', attempts: 2 }] }))
  draw()

  const bar = await screen.findByRole('status')
  expect(bar).toHaveTextContent(/failed/i)
  expect(bar).toHaveTextContent(/Wolverine #27/)
  expect(bar).toHaveTextContent(/404 Not Found/)
  expect(screen.getByRole('link', { name: /queue/i })).toHaveAttribute('href', '/downloads')
})

// A stylesheet keys off this; the class existed with nothing ever setting it.
test('the failed bar is marked as such', async () => {
  stub(view({ history: [{ id: 9, state: 'failed', label: 'Wolverine #27', error: 'boom', attempts: 2 }] }))
  draw()
  expect(await screen.findByRole('status')).toHaveClass('download-bar--failed')
})

// Nothing went wrong, so there is nothing to keep on screen.
test('a download that finished leaves no bar behind', async () => {
  stub(view({ history: [{ id: 9, state: 'done', label: 'Wolverine #27', bookId: 3, attempts: 1 }] }))
  draw()
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
})

// The running download is what the bar is for; an older failure does not displace it.
test('a running download is reported even with a failure behind it in history', async () => {
  stub(view({ active: [ACTIVE], history: [{ id: 9, state: 'failed', label: 'older', error: 'boom', attempts: 2 }] }))
  draw()

  const bar = await screen.findByRole('status')
  expect(bar).toHaveTextContent(/Downloading/)
  expect(bar).not.toHaveTextContent(/older/)
})

// A cancel is recorded as a failure, because there is no separate cancelled state. It is
// still the one failure that must not be reported: the user stopped it on purpose, and a
// persistent "Download failed - cancelled" on every page is telling them their own
// deliberate act went wrong.
test('a download the user cancelled raises no failure bar', async () => {
  stub(view({ history: [{ id: 9, state: 'failed', label: 'Wolverine #27', error: 'cancelled', attempts: 1 }] }))
  draw()
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
})
