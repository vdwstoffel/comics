import type { ReactNode } from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDownload } from '../src/lib/useDownload'

const RUNNING = {
  active: [{
    id: 1, fileName: 'Knull 005 (2026).cbz',
    received: 20_000_000, total: 50_000_000, startedAt: '2026-09-09T00:00:00Z',
  }],
  queue: [], history: [],
}
const DONE = {
  active: [], queue: [],
  history: [{
    id: 1, position: 0, state: 'done' as const, url: 'https://x.test/dls/tok',
    fileName: 'Knull 005 (2026).cbz', bookId: 42, attempts: 1,
    queuedAt: '2026-09-09T00:00:00Z', startedAt: '2026-09-09T00:00:00Z', finishedAt: '2026-09-09T00:01:00Z',
  }],
}
const IDLE = { active: [], queue: [], history: [] }

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
  await waitFor(() => expect(result.current.active).toHaveLength(1))
  expect(result.current.active[0].fileName).toBe('Knull 005 (2026).cbz')
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
  await waitFor(() => expect(first.result.current.history[0]?.bookId).toBe(42))

  // Whatever the completion did has been done; prove a remount does not redo it.
  const spy = vi.spyOn(qc, 'invalidateQueries')
  first.unmount()
  renderHook(() => useDownload(), { wrapper })
  await new Promise((r) => setTimeout(r, 300))
  expect(spy).not.toHaveBeenCalled()
})

test('a finished run appears in history', async () => {
  served = DONE
  const { result } = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(result.current.history[0]).toMatchObject({ bookId: 42, fileName: 'Knull 005 (2026).cbz' }))
})

test('a run still going does not appear in history', async () => {
  served = RUNNING
  const { result } = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(result.current.active).toHaveLength(1))
  expect(result.current.history).toHaveLength(0)
})

test('a later run finishing invalidates the library again, even after an earlier one already has', async () => {
  served = DONE
  const { result } = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(result.current.history[0]?.bookId).toBe(42))

  const spy = vi.spyOn(qc, 'invalidateQueries')
  served = {
    active: [], queue: [],
    history: [{ ...DONE.history[0], id: 2, bookId: 43, finishedAt: '2026-09-09T00:05:00Z' }],
  }
  await qc.refetchQueries({ queryKey: ['download'] })
  await waitFor(() => expect(spy).toHaveBeenCalled())
})

// `retry` reuses the row id - it only clears `finishedAt` and resets `attempts` - so a
// guard keyed on id alone would skip the refresh for a download that failed and was then
// retried successfully. The comic would land on disk while the library never heard about
// it.
test('a retried download that then succeeds still refreshes the library', async () => {
  const FAILED_ROW = {
    id: 1, position: 0, state: 'failed' as const, url: 'https://x.test/dls/tok',
    fileName: 'Knull 005 (2026).cbz', attempts: 1, error: 'network error',
    queuedAt: '2026-09-09T00:00:00Z', startedAt: '2026-09-09T00:00:00Z',
    finishedAt: '2026-09-09T00:01:00Z',
  }
  served = { active: [], queue: [], history: [FAILED_ROW] }
  const { result } = renderHook(() => useDownload(), { wrapper })
  await waitFor(() => expect(result.current.history[0]?.state).toBe('failed'))

  // The retry succeeds: same row id, but restamped `done` with a later `finishedAt`.
  const spy = vi.spyOn(qc, 'invalidateQueries')
  served = {
    active: [], queue: [],
    history: [{
      ...FAILED_ROW, state: 'done' as const, error: undefined, bookId: 43, attempts: 2,
      finishedAt: '2026-09-09T00:05:00Z',
    }],
  }
  await qc.refetchQueries({ queryKey: ['download'] })
  await waitFor(() => expect(result.current.history[0]?.bookId).toBe(43))
  expect(spy).toHaveBeenCalled()
})
