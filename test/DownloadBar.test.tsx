import type { ReactNode } from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import DownloadBar from '../src/components/DownloadBar'

const RUNNING = {
  running: true, url: 'https://x.test/dls/tok', fileName: 'Knull 005 (2026).cbz',
  received: 20_000_000, total: 50_000_000, error: null, bookId: null,
  startedAt: '2026-09-09T00:00:00Z', finishedAt: null,
}
const DONE = {
  ...RUNNING, running: false, received: 50_000_000, bookId: 42,
  finishedAt: '2026-09-09T00:01:00Z',
}
const FAILED = { ...DONE, bookId: null, error: 'file too large' }
const IDLE = {
  running: false, url: null, fileName: null, received: 0, total: 0,
  error: null, bookId: null, startedAt: null, finishedAt: null,
}

let served: unknown
function stub() {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/api/downloads')) return { ok: true, json: async () => served }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
}

let qc: QueryClient
function mount(): ReactNode {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter><DownloadBar /></MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => { stub(); qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }) })
afterEach(() => { cleanup() })

const bar = () => screen.queryByRole('status')

test('nothing is shown when no download has ever run', async () => {
  served = IDLE
  render(mount())
  await new Promise((r) => setTimeout(r, 200))
  expect(bar()).not.toBeInTheDocument()
})

test('a running download shows what it is and how far along', async () => {
  served = RUNNING
  render(mount())
  await waitFor(() => expect(bar()).toBeInTheDocument())
  expect(bar()).toHaveTextContent('Knull 005 (2026).cbz')
  expect(bar()).toHaveTextContent('40%')
  expect(bar()).toHaveTextContent('20.0 MB of 50.0 MB')
})

test('a download whose size the server never gave shows what has arrived', async () => {
  served = { ...RUNNING, total: 0 }
  render(mount())
  await waitFor(() => expect(bar()).toHaveTextContent('20.0 MB'))
  expect(bar()).not.toHaveTextContent('%')
})

test('a finished download offers the comic it produced', async () => {
  served = DONE
  render(mount())
  await waitFor(() => expect(bar()).toBeInTheDocument())
  expect(bar()).toHaveTextContent('Knull 005 (2026).cbz')
  expect(screen.getByRole('link', { name: /view comic/i })).toHaveAttribute('href', '/book/42')
})

test('a failed download says why and offers no comic', async () => {
  served = FAILED
  render(mount())
  await waitFor(() => expect(bar()).toHaveTextContent('file too large'))
  expect(screen.queryByRole('link', { name: /view comic/i })).not.toBeInTheDocument()
})

test('a result can be dismissed', async () => {
  served = DONE
  render(mount())
  await waitFor(() => expect(bar()).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
  await waitFor(() => expect(bar()).not.toBeInTheDocument())
})

test('a dismissed result does not come back when you move to another page', async () => {
  served = DONE
  const first = render(mount())
  await waitFor(() => expect(bar()).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
  await waitFor(() => expect(bar()).not.toBeInTheDocument())

  first.unmount()
  render(mount())
  await new Promise((r) => setTimeout(r, 250))
  expect(bar()).not.toBeInTheDocument()
})

test('a download still running cannot be dismissed', async () => {
  served = RUNNING
  render(mount())
  await waitFor(() => expect(bar()).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
})

test('a download that started on another page is reported here too', async () => {
  served = RUNNING
  render(mount())
  await waitFor(() => expect(bar()).toHaveTextContent(/Downloading/i))
})
