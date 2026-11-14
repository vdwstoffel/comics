import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import StorageSummary from '../src/components/StorageSummary'

// A 916 GB disk with 370 GB on it, of which the library is 42 GB. Every figure below
// formats to its own string, so a query matching one cannot be matching another.
const VIEW = {
  total: 916_000_000_000,
  free: 546_000_000_000,
  comics: 40_000_000_000,
  covers: 1_600_000_000,
  database: 400_000_000,
  temp: 0,
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => VIEW })) as unknown as typeof fetch
})
afterEach(() => cleanup())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><StorageSummary /></QueryClientProvider>)
}

test('the headline is what the library takes and what is left for more of it', async () => {
  draw()
  expect(await screen.findByText(/42 GB/)).toBeInTheDocument()
  expect(screen.getByText(/546 GB free of 916 GB/)).toBeInTheDocument()
})

test('each kind of file is listed with its own size', async () => {
  draw()
  expect(await screen.findByText('Comics')).toBeInTheDocument()
  expect(screen.getByText('40 GB')).toBeInTheDocument()
  expect(screen.getByText('1.6 GB')).toBeInTheDocument()
  expect(screen.getByText('400 MB')).toBeInTheDocument()
  expect(screen.getByText('0 B')).toBeInTheDocument()
})

// The library is 42 GB of the 370 GB in use here. A bar that drew the library against
// free space alone would say the disk is nearly empty on our account, when most of what
// is filling it belongs to something else on the server entirely.
test('the bar names the rest of the disk, not just the library', async () => {
  draw()
  const bar = await screen.findByRole('img', { name: /library/i })
  expect(bar).toHaveAccessibleName('42 GB library, 328 GB other files, 546 GB free')
})

test('a server that cannot say leaves the rest of the pane alone', async () => {
  globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
  draw()
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.queryByText(/free of/)).toBeNull()
})

// A collection waiting for review can be a whole run, and is counted while it waits.
test('collections waiting for review are listed only while there are some', async () => {
  draw()
  await screen.findByText('Comics')
  expect(screen.queryByText('Waiting for review')).toBeNull()
  cleanup()

  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ...VIEW, review: 2_300_000_000 }) })) as unknown as typeof fetch
  draw()
  expect(await screen.findByText('Waiting for review')).toBeInTheDocument()
  expect(screen.getByText('2.3 GB')).toBeInTheDocument()
})
