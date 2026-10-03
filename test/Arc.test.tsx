import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Arc from '../src/pages/Arc'

// An arc as the page receives it: one issue you have, one gap the index can fill, and one
// gap nothing uniquely matches. A tie-in from another volume is the usual case, not an
// edge one - most of what an arc is missing belongs to some other series.
const ARC = {
  stale: false,
  fetchedAt: '2026-09-14T12:00:00.000Z',
  arc: {
    id: 56676,
    name: 'Death Spiral',
    publisher: 'Marvel',
    siteUrl: 'https://cv/arc',
    issues: [
      { id: 1156915, number: '1', volumeName: 'Death Spiral', siteUrl: 'https://cv/1',
        owned: true, bookId: 7, readState: 'read', percent: 100 },
      { id: 1158149, number: '14', volumeName: 'Black Cat', coverDate: '2026-11-01',
        siteUrl: 'https://cv/2', owned: false, match: { indexId: 5, title: 'Black Cat #14 (2026)' } },
      { id: 1158150, number: '3', volumeName: 'Venom', coverDate: '2026-11-01',
        siteUrl: 'https://cv/3', owned: false, match: null },
    ],
  },
}

let posted: string[] = []
/** Every write the page makes, so a reorder can be checked by what it sent. */
let sent: Array<{ method: string; url: string; body: unknown }> = []

function stub(arc: unknown = ARC, queue: unknown[] = []) {
  posted = []
  sent = []
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (init?.method && init.method !== 'GET') {
      sent.push({ method: init.method, url: u, body: init.body ? JSON.parse(init.body) : undefined })
    }
    if (init?.method === 'PUT') return { ok: true, json: async () => ({ ordered: true }) }
    if (init?.method === 'DELETE') return { ok: true, json: async () => ({ ordered: false }) }
    if (init?.method === 'POST') {
      posted.push(u)
      return { ok: true, json: async () => ({ queued: true }) }
    }
    if (u.includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue, history: [] }) }
    }
    // The rail down the side of every library page asks for all four of these. It is not
    // what these tests are about; an empty library draws an empty rail.
    if (u.includes('/api/publishers')) return { ok: true, json: async () => ({ publishers: [] }) }
    if (u.includes('/api/editions')) return { ok: true, json: async () => ({ editions: [] }) }
    if (u.includes('/api/read-states')) return { ok: true, json: async () => ({ readStates: [] }) }
    if (u.endsWith('/api/arcs')) return { ok: true, json: async () => ({ arcs: [] }) }
    return { ok: true, json: async () => arc }
  }) as unknown as typeof fetch
}

beforeEach(() => stub())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/arc/Death%20Spiral']}>
        <Routes><Route path="/arc/:name" element={<Arc />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// The same offer the volume page makes, in the same words, on the page where you notice
// the gap: an arc you are reading through is exactly where a hole in it shows up.
test('a gap the index can fill offers to get it', async () => {
  draw()
  expect(await screen.findByRole('button', { name: 'Get Black Cat #14' })).toBeInTheDocument()
})

test('pressing get asks the server for that issue', async () => {
  draw()
  fireEvent.click(await screen.findByRole('button', { name: 'Get Black Cat #14' }))
  await waitFor(() => expect(posted).toEqual(['/api/arcs/issues/1158149/download']))
})

// The button never guesses. Nothing scraped can be this issue, so the page sends you to
// look by eye rather than offering a press that would refuse.
test('a gap nothing uniquely matches offers Find instead', async () => {
  draw()
  expect(await screen.findByRole('link', { name: 'Find Venom #3' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Get Venom #3' })).not.toBeInTheDocument()
})

// Find opens the search on the issue's OWN series, not the arc - the arc is not a series
// and searching the index for it returns nothing.
test('Find searches for the volume the issue belongs to', async () => {
  draw()
  const find = await screen.findByRole('link', { name: 'Find Venom #3' })
  expect(find).toHaveAttribute('href', expect.stringContaining('q=Venom'))
})

// A second press would only 409 on the server. The queue is the server's, so a row put
// there by any page - or by a previous visit - has to show here.
test('an issue already in the queue says so instead of offering again', async () => {
  stub(ARC, [{ id: 1, position: 0, state: 'queued', url: 'u', attempts: 0, cvIssueId: 1158149 }])
  draw()
  expect(await screen.findByRole('button', { name: /Queued/ })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Get Black Cat #14' })).not.toBeInTheDocument()
})

// A comic you have opens in the reader; offering to fetch it again would be a button with
// nothing to do.
test('an issue you own carries no get button', async () => {
  draw()
  expect(await screen.findByText('Death Spiral #1')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Get Death Spiral #1/ })).not.toBeInTheDocument()
})

// Comic Vine records no reading order for an arc, so the run the page draws is
// reconstructed from dates. When a publisher printed a different order, this is the way
// to say so.
test('an arc offers to be put in your own order', async () => {
  draw()
  expect(await screen.findByRole('button', { name: 'Reorder' })).toBeInTheDocument()
})

// The run is a tile grid, and dragging across a grid needs geometry the list form does
// not. Reordering swaps to a list, where up and down are also the keyboard path.
test('reordering lists the run with a way to move each issue', async () => {
  draw()
  fireEvent.click(await screen.findByRole('button', { name: 'Reorder' }))

  expect(screen.getByRole('button', { name: 'Move Black Cat #14 up' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Move Black Cat #14 down' })).toBeInTheDocument()
})

test('moving an issue and saving sends the run in the order you left it', async () => {
  draw()
  fireEvent.click(await screen.findByRole('button', { name: 'Reorder' }))
  fireEvent.click(screen.getByRole('button', { name: 'Move Death Spiral #1 down' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save order' }))

  await waitFor(() => expect(sent).toContainEqual({
    method: 'PUT',
    url: '/api/arcs/Death%20Spiral/order',
    body: { issueIds: [1158149, 1156915, 1158150] },
  }))
})

test('an arc still in Comic Vine order offers no way to reset it', async () => {
  draw()
  await screen.findByRole('button', { name: 'Reorder' })
  expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument()
})

test('an arc in your order says so and offers to put it back', async () => {
  stub({ ...ARC, ordered: true })
  draw()
  expect(await screen.findByRole('button', { name: 'Reset to Comic Vine order' })).toBeInTheDocument()
})

test('resetting asks the server to forget your order', async () => {
  stub({ ...ARC, ordered: true })
  draw()
  fireEvent.click(await screen.findByRole('button', { name: 'Reset to Comic Vine order' }))

  await waitFor(() => expect(sent).toContainEqual({
    method: 'DELETE', url: '/api/arcs/Death%20Spiral/order', body: undefined,
  }))
})
