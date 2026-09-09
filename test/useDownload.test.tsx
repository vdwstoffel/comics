import type { ReactNode } from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDownload } from '../src/lib/useDownload'

const RUNNING = {
  running: true, url: 'https://x.test/dls/tok', fileName: 'Knull 005 (2026).cbz',
  received: 20_000_000, total: 50_000_000, error: null, bookId: null,
  startedAt: '2026-09-09T00:00:00Z', finishedAt: null,
}
const DONE = {
  ...RUNNING, running: false, received: 50_000_000, bookId: 42,
  finishedAt: '2026-09-09T00:01:00Z',
}
const IDLE = {
  running: false, url: null, fileName: null, received: 0, total: 0,
  error: null, bookId: null, startedAt: null, finishedAt: null,
}

let served: unknown
let polls: number

function stub() {
  polls = 0
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/api/downloads')) { polls++; return { ok: true, json: async () => served } }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
}

let qc: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  stub()
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { cleanup() })

test('a run in flight is picked up with nothing telling the hook to look', async () => {
  served = RUNNING
  const { result } = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(result.current.status?.running).toBe(true))
})

test('an in-flight run keeps being polled', async () => {
  served = RUNNING
  renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(polls).toBeGreaterThan(2), { timeout: 3000 })
})

test('an idle server is asked once and then left alone', async () => {
  served = IDLE
  renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(polls).toBe(1))
  await new Promise((r) => setTimeout(r, 1200))
  expect(polls).toBe(1)
})

test('a finished run invalidates the library so the new comic shows up', async () => {
  served = DONE
  qc.setQueryData(['series'], { series: [] })
  renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(qc.getQueryState(['series'])?.isInvalidated).toBe(true))
})

test('a run already dealt with is not invalidated again when the page remounts', async () => {
  served = DONE
  const first = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(first.result.current.result?.bookId).toBe(42))

  // Whatever the completion did has been done; prove a remount does not redo it.
  qc.setQueryData(['series'], { series: [] })
  first.unmount()
  renderHook(() => useDownload(), { wrapper })
  await new Promise((r) => setTimeout(r, 300))
  expect(qc.getQueryState(['series'])?.isInvalidated).toBe(false)
})

test('a finished run is offered as a result to show', async () => {
  served = DONE
  const { result } = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(result.current.result).toMatchObject({ bookId: 42, fileName: 'Knull 005 (2026).cbz' }))
})

test('a run still going is not offered as a result', async () => {
  served = RUNNING
  const { result } = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(result.current.status?.running).toBe(true))
  expect(result.current.result).toBeNull()
})

test('dismissing a result puts it away', async () => {
  served = DONE
  const { result } = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(result.current.result).not.toBeNull())
  act(() => result.current.dismiss())
  await waitFor(() => expect(result.current.result).toBeNull())
})

test('a dismissed result stays dismissed when the page remounts', async () => {
  served = DONE
  const first = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(first.result.current.result).not.toBeNull())
  act(() => first.result.current.dismiss())
  first.unmount()

  const second = renderHook(() => useDownload(), { wrapper })
  await new Promise((r) => setTimeout(r, 300))
  expect(second.result.current.result).toBeNull()
})

test('a fresh run after a dismissed one is shown again', async () => {
  served = DONE
  const { result } = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(result.current.result).not.toBeNull())
  act(() => result.current.dismiss())
  await waitFor(() => expect(result.current.result).toBeNull())

  served = { ...DONE, bookId: 43, finishedAt: '2026-09-09T00:05:00Z' }
  await qc.refetchQueries({ queryKey: ['download'] })
  await waitFor(() => expect(result.current.result?.bookId).toBe(43))
})
