import { test, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Library from '../src/pages/Library'

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ series: [{ id: 1, name: 'Batman', bookCount: 3 }] }),
  })) as unknown as typeof fetch
})

function renderWithProviders(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

test('Library renders series tiles from the API', async () => {
  renderWithProviders(<Library />)
  expect(await screen.findByText('Batman')).toBeInTheDocument()
  expect(screen.getByText(/3/)).toBeInTheDocument()
})
