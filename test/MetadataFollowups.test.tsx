import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import MetadataFollowups from '../src/pages/MetadataFollowups'

let posted: string[]
let bodies: string[]
beforeEach(() => {
  posted = []
  bodies = []
})
afterEach(() => cleanup())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings/metadata']}><MetadataFollowups /></MemoryRouter>
    </QueryClientProvider>,
  )
  // The client itself, for the one test that asserts on what a refresh invalidates.
  return { ...rendered, qc }
}

const SETTINGS = { downloadConcurrency: 1, comicVineApiKey: 'stored-key', hidePageBar: false }

type Followup = {
  bookId: number; title: string | null; fileName: string; bookCvId: number | null
  cvSiteUrl: string | null; addedAt: string; missing: string[]
  manual: boolean; typedIssueId: number | null; checkedAt: string | null; cvMissing: string[]
}
const FOLLOWUP: Followup = {
  bookId: 7, title: 'Absolute Batman 14', fileName: 'ab14.cbz', bookCvId: 1197227,
  cvSiteUrl: 'https://comicvine.gamespot.com/issue/4000-1197227/',
  addedAt: '2026-10-20T09:00:00Z', missing: ['summary'],
  manual: false, typedIssueId: null, checkedAt: null, cvMissing: [],
}

// Routes by URL: the plain beforeEach mock answers every GET with the settings object.
function serve(followups: Followup[]) {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method) { posted.push(`${init.method} ${url}`); bodies.push(String(init.body)) }
    if (url === '/api/metadata-followups' && !init?.method) {
      return { ok: true, json: async () => ({ followups }) }
    }
    if (init?.method === 'POST') return { ok: true, json: async () => ({ book: {}, changed: [] }) }
    if (init?.method === 'DELETE') return { ok: true, json: async () => ({ dismissed: true }) }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch
}

test('an empty list says there is nothing to follow up, under its heading', async () => {
  serve([])
  draw()
  expect(await screen.findByText(/nothing to follow up/i)).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: /metadata follow-ups/i })).toBeInTheDocument()
})

// The way back is part of the page's contract: it is reached from Settings and has no tab.
test('the page links back to Settings', async () => {
  serve([FOLLOWUP])
  draw()
  expect(await screen.findByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings')
})

// The user has to be able to judge whether the rule is drawn correctly, which means
// seeing which field put each comic here.
test('a row names what the comic is missing', async () => {
  serve([{ ...FOLLOWUP, missing: ['date', 'credits'] }])
  draw()
  expect(await screen.findByText(/date, credits/i)).toBeInTheDocument()
})

// The rework in one test: this comic was matched from search, and the old list - keyed on
// a hand-typed id - would never have shown it.
test('a comic that was never typed by hand is listed all the same', async () => {
  serve([FOLLOWUP])
  draw()
  expect(await screen.findByRole('link', { name: 'Absolute Batman 14' })).toBeInTheDocument()
  expect(screen.queryByText(/linked by hand/i)).toBeNull()
})

test('a hand-typed comic says so, with what Comic Vine lacked', async () => {
  serve([{ ...FOLLOWUP, manual: true, typedIssueId: 1197227, checkedAt: '2026-10-22T09:00:00Z', cvMissing: ['description'] }])
  draw()
  expect(await screen.findByText(/linked by hand/i)).toBeInTheDocument()
  expect(screen.getByText(/comic vine had no description/i)).toBeInTheDocument()
})

test('a hand-typed id that was later corrected is shown beside the current one', async () => {
  serve([{ ...FOLLOWUP, manual: true, typedIssueId: 999, checkedAt: null }])
  draw()
  expect(await screen.findByText(/typed 999/i)).toBeInTheDocument()
  expect(screen.getByText(/never read/i)).toBeInTheDocument()
})

test('a row links the comic and the Comic Vine record', async () => {
  serve([FOLLOWUP])
  draw()
  expect(await screen.findByRole('link', { name: 'Absolute Batman 14' })).toHaveAttribute('href', '/book/7')
  expect(screen.getByRole('link', { name: /1197227/ })).toHaveAttribute('href', FOLLOWUP.cvSiteUrl)
})

test('an untitled comic falls back to its file name', async () => {
  serve([{ ...FOLLOWUP, title: null }])
  draw()
  expect(await screen.findByRole('link', { name: 'ab14.cbz' })).toBeInTheDocument()
})

// A typed id can be weeks old and already corrected; posting it would undo the correction.
test('refresh posts the book current id', async () => {
  serve([{ ...FOLLOWUP, manual: true, typedIssueId: 999, bookCvId: 1197227 }])
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /refresh/i }))
  await waitFor(() => expect(posted).toContain('POST /api/books/7/comicvine'))
  // No `manual` flag: a refresh is not a new hand-entry.
  expect(JSON.parse(bodies[0])).toEqual({ issueId: 1197227 })
})

// A refresh rewrites the book, so the library list - where a summary Comic Vine has
// finally filled in would show - is stale. The KEY is the assertion: the list is cached
// under ['library-books', publisher, status] (Library.tsx) and nothing here observed
// which key was invalidated, which is how a wrong one survived two rounds of fixing.
test('a refresh invalidates the library list under the key it is cached as', async () => {
  serve([FOLLOWUP])
  const { qc } = draw()
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  fireEvent.click(await screen.findByRole('button', { name: /refresh/i }))

  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['library-books'] }))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['metadata-followups'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['book', FOLLOWUP.bookId] })
})

// A disabled button invites a second click and explains nothing.
test('an unlinked comic offers no Refresh, and says why', async () => {
  serve([{ ...FOLLOWUP, bookCvId: null, cvSiteUrl: null }])
  draw()
  expect(await screen.findByText(/not linked to comic vine/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull()
})

// What a refresh fails with during an outage. The server says whose failure it was; the
// page adds what is true of any failure - nothing was written, so the comic is still
// listed. "Internal Server Error", which is what Fastify's default body produced, read as
// a fault in Comix at the exact moment the user needed to know it was Comic Vine.
function serveRefreshFailure(status: number, error: string) {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (url === '/api/metadata-followups' && !init?.method) {
      return { ok: true, json: async () => ({ followups: [FOLLOWUP] }) }
    }
    if (init?.method === 'POST') return { ok: false, status, json: async () => ({ error }) }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch
}

test('a refresh Comic Vine could not answer says so, and keeps the comic listed', async () => {
  serveRefreshFailure(502, 'Comic Vine could not be read, so nothing was changed (HTTP 500).')
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /refresh/i }))

  expect(await screen.findByText(/comic vine could not be read/i)).toBeInTheDocument()
  expect(screen.getByText(/stays on this list/i)).toBeInTheDocument()
  expect(screen.queryByText(/internal server error/i)).toBeNull()
  expect(screen.getByRole('link', { name: 'Absolute Batman 14' })).toBeInTheDocument()
})

// A different problem with a different fix: the id is wrong, and no amount of waiting
// for Comic Vine will help.
test('an id Comic Vine does not have is reported as that, not as an outage', async () => {
  serveRefreshFailure(404, 'Comic Vine has no issue with that id.')
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /refresh/i }))

  expect(await screen.findByText(/no issue with that id/i)).toBeInTheDocument()
  expect(screen.queryByText(/could not be read/i)).toBeNull()
})

test('dismiss calls the delete route', async () => {
  serve([FOLLOWUP])
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /dismiss/i }))
  await waitFor(() => expect(posted).toEqual(['DELETE /api/metadata-followups/7']))
})
