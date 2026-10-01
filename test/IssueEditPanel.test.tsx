import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import IssueEditPanel from '../src/components/IssueEditPanel'
import type { ApiBook } from '../src/api'

const BOOK: ApiBook = {
  id: 19, editionId: 16, title: 'Death to the Tyrant', number: '1',
  pageCount: 37, comicinfoSynced: false, writer: 'Joe Kelly', date: '2025-06',
}

let patched: { url: string; body: Record<string, unknown> }[]
let put: { url: string; body: Record<string, unknown> }[]
let posted: string[]

beforeEach(() => {
  patched = []
  put = []
  posted = []
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ book: BOOK }) }
    }
    if (init?.method === 'PUT') {
      put.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ book: BOOK, edition: { id: 9, name: 'Venom (2025)' } }) }
    }
    if (init?.method === 'POST') {
      posted.push(String(url))
      return { ok: true, json: async () => ({ book: BOOK }) }
    }
    if (String(url).includes('/api/editions')) {
      return { ok: true, json: async () => ({ editions: [
        { id: 16, name: 'The Amazing Spider-Man (2025)' },
        { id: 9, name: 'Venom (2025)' },
      ] }) }
    }
    return { ok: true, json: async () => ({ results: [] }) }
  }) as unknown as typeof fetch
})

function draw(props: Partial<ComponentProps<typeof IssueEditPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IssueEditPanel book={BOOK} onClose={() => {}} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// Everything the comic's own page could do to a comic, now that there is no such page.
test('edits the metadata by hand', async () => {
  draw()
  fireEvent.change(screen.getByLabelText(/^writer$/i), { target: { value: 'Dan Slott' } })
  fireEvent.click(screen.getByRole('button', { name: /save metadata/i }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].url).toContain('/api/books/19')
  expect(patched[0].body).toMatchObject({ writer: 'Dan Slott' })
})

test('moves the comic to another edition', async () => {
  draw()
  fireEvent.change(await screen.findByLabelText(/^edition$/i), { target: { value: 'Venom (2025)' } })
  fireEvent.click(screen.getByRole('button', { name: /^move$/i }))

  await waitFor(() => expect(put).toHaveLength(1))
  expect(put[0].url).toContain('/api/books/19/edition')
  expect(put[0].body).toEqual({ name: 'Venom (2025)' })
})

test('offers to match the comic against Comic Vine', async () => {
  draw()
  fireEvent.click(screen.getByRole('button', { name: /fetch metadata/i }))
  expect(await screen.findByRole('heading', { name: /fetch from comic vine/i })).toBeInTheDocument()
})

test('closes without saving anything', () => {
  const onClose = vi.fn()
  draw({ onClose })
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(patched).toEqual([])
})
