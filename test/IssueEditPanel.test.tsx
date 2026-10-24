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
let postedBodies: Record<string, unknown>[]
// What the apply route answers; each test sets the one it needs.
let postReply: { ok: boolean; status?: number; json: () => Promise<unknown> }

beforeEach(() => {
  patched = []
  put = []
  posted = []
  postedBodies = []
  postReply = { ok: true, json: async () => ({ book: BOOK }) }
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
      postedBodies.push(init.body ? JSON.parse(String(init.body)) : {})
      return postReply
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

const BOUND: ApiBook = { ...BOOK, comicvineId: 1234567 }
const REFRESH = /refresh from comic vine/i

test('the refresh button is absent on a book with no Comic Vine id', () => {
  draw()
  expect(screen.queryByRole('button', { name: REFRESH })).toBeNull()
})

test('a refresh that changed nothing says so, and does not claim a refresh', async () => {
  postReply = { ok: true, json: async () => ({ book: BOUND, changed: [] }) }
  draw({ book: BOUND })
  fireEvent.click(screen.getByRole('button', { name: REFRESH }))

  expect(await screen.findByText(/comic vine had nothing new/i)).toBeInTheDocument()
  expect(posted[0]).toContain('/api/books/19/comicvine')
  // No `manual`: it would re-stamp the reminder's created_at.
  expect(postedBodies[0]).toEqual({ issueId: 1234567 })
})

test('a refresh names what changed', async () => {
  postReply = { ok: true, json: async () => ({ book: BOUND, changed: ['date', 'credits'] }) }
  draw({ book: BOUND })
  fireEvent.click(screen.getByRole('button', { name: REFRESH }))

  expect(await screen.findByText(/date, credits/i)).toBeInTheDocument()
  expect(screen.queryByText(/nothing new/i)).toBeNull()
})

test('a refresh that fails says so rather than claiming nothing changed', async () => {
  postReply = { ok: false, status: 500, json: async () => ({}) }
  draw({ book: BOUND })
  fireEvent.click(screen.getByRole('button', { name: REFRESH }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/refresh failed/i)
  expect(screen.queryByText(/nothing new/i)).toBeNull()
})

// The same server fix reaches this panel with no change to it: the message it prints is
// whatever the route explained. Before, a Comic Vine outage printed "Internal Server
// Error" here too.
test('a refresh Comic Vine could not answer shows what the server explained', async () => {
  postReply = {
    ok: false, status: 502,
    json: async () => ({ error: 'Comic Vine could not be read, so nothing was changed (HTTP 500).' }),
  }
  draw({ book: BOUND })
  fireEvent.click(screen.getByRole('button', { name: REFRESH }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/comic vine could not be read/i)
  expect(screen.queryByText(/internal server error/i)).toBeNull()
})

test('a typed id reaches the apply route flagged manual', async () => {
  draw()
  fireEvent.click(screen.getByRole('button', { name: /fetch metadata/i }))
  fireEvent.change(await screen.findByLabelText(/comic vine id or link/i), { target: { value: '1234567' } })
  fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))

  await waitFor(() => expect(postedBodies).toHaveLength(1))
  expect(postedBodies[0]).toEqual({ issueId: 1234567, manual: true })
})

// Spec §3.4 on the feature's primary surface. The dialog closes, the book looks untouched
// and a Refresh button quietly appears - without a word, that is indistinguishable from an
// apply that worked.
test('an apply that only bound the link says the metadata did not arrive', async () => {
  postReply = { ok: true, json: async () => ({ book: BOUND, metadataApplied: false }) }
  draw()
  fireEvent.click(screen.getByRole('button', { name: /fetch metadata/i }))
  fireEvent.change(await screen.findByLabelText(/comic vine id or link/i), { target: { value: '1234567' } })
  fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))

  expect(await screen.findByText(/comic vine could not be read/i)).toBeInTheDocument()
  expect(screen.getByText(/settings list/i)).toBeInTheDocument()
})

test('an apply that applied metadata says nothing of the sort', async () => {
  postReply = { ok: true, json: async () => ({ book: BOUND, metadataApplied: true }) }
  draw()
  fireEvent.click(screen.getByRole('button', { name: /fetch metadata/i }))
  fireEvent.change(await screen.findByLabelText(/comic vine id or link/i), { target: { value: '1234567' } })
  fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))

  await waitFor(() => expect(screen.queryByRole('heading', { name: /fetch from comic vine/i })).toBeNull())
  expect(screen.queryByText(/could not be read/i)).toBeNull()
})

// The dialog unmounts on close; this panel does not, so the mutation's error outlives it.
test('reopening the dialog does not greet you with the last id\'s error', async () => {
  postReply = { ok: false, status: 404, json: async () => ({ error: 'Comic Vine has no issue with that id.' }) }
  draw()
  fireEvent.click(screen.getByRole('button', { name: /fetch metadata/i }))
  fireEvent.change(await screen.findByLabelText(/comic vine id or link/i), { target: { value: '999' } })
  fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))
  await screen.findByText('Comic Vine has no issue with that id.')

  fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
  fireEvent.click(screen.getByRole('button', { name: /fetch metadata/i }))

  await screen.findByRole('heading', { name: /fetch from comic vine/i })
  expect(screen.queryByText('Comic Vine has no issue with that id.')).toBeNull()
})

test('a mistyped id shows the server\'s message, not a generic failure', async () => {
  postReply = { ok: false, status: 404, json: async () => ({ error: 'Comic Vine has no issue with that id.' }) }
  draw()
  fireEvent.click(screen.getByRole('button', { name: /fetch metadata/i }))
  fireEvent.change(await screen.findByLabelText(/comic vine id or link/i), { target: { value: '999' } })
  fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))

  expect(await screen.findByText('Comic Vine has no issue with that id.')).toBeInTheDocument()
  // The dialog stays open so the id can be corrected.
  expect(screen.getByRole('heading', { name: /fetch from comic vine/i })).toBeInTheDocument()
})
