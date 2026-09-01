import type { ReactNode } from 'react'
import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Upload from '../src/pages/Upload'

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      editions: [
        { id: 1, name: 'Batman (2016)', bookCount: 12 },
        { id: 2, name: 'Saga', bookCount: 60 },
      ],
    }),
  })) as unknown as typeof fetch
})

function renderUpload(ui: ReactNode = <Upload />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

test('Upload page renders an edition field and file input', () => {
  renderUpload()
  expect(screen.getByPlaceholderText('Edition name')).toBeInTheDocument()
  expect(screen.getByLabelText(/comic file/i)).toBeInTheDocument()
})

test('editions already in the library are offered in the dropdown', async () => {
  renderUpload()

  fireEvent.focus(screen.getByPlaceholderText('Edition name'))

  const options = await screen.findAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(['Batman (2016)12', 'Saga60'])
})
