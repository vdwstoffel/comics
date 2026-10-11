import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Series from '../src/pages/Series'

const SERIES = {
  name: 'Amazing Spider-Man',
  bookCount: 5,
  editions: [
    { id: 9, name: 'Amazing Spider-Man (2025)', bookCount: 3 },
    { id: 8, name: 'Amazing Spider-Man by Nick Spencer Omnibus', bookCount: 2 },
  ],
}

function mockFetch(body: unknown, ok = true) {
  globalThis.fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body })) as unknown as typeof fetch
}

beforeEach(() => { mockFetch({ series: SERIES }) })
afterEach(() => { cleanup() })

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/series/:name" element={<Series />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

test('shows the series name as the heading', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  expect(await screen.findByRole('heading', { name: 'Amazing Spider-Man' })).toBeInTheDocument()
})

test('lists each edition under its own name', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  expect(await screen.findByText('Amazing Spider-Man (2025)')).toBeInTheDocument()
  expect(screen.getByText('Amazing Spider-Man by Nick Spencer Omnibus')).toBeInTheDocument()
})

test('each edition links to its edition page', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  const tile = (await screen.findByText('Amazing Spider-Man (2025)')).closest('a')
  expect(tile).toHaveAttribute('href', '/edition/9')
})

test('each edition shows its own issue count', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  expect(await screen.findByText('3 issues')).toBeInTheDocument()
  expect(screen.getByText('2 issues')).toBeInTheDocument()
})

test('says how many editions the series has', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  expect(await screen.findByText(/2 editions/)).toBeInTheDocument()
})

test('a series name with spaces is requested url-encoded', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  await screen.findByRole('heading', { name: 'Amazing Spider-Man' })
  const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
  expect(url).toBe('/api/series/Amazing%20Spider-Man')
})

test('an unknown series reports that it was not found', async () => {
  mockFetch({ error: 'series not found' }, false)
  renderAt('/series/Aquaman')
  expect(await screen.findByText(/not found/i)).toBeInTheDocument()
})

test('a status in the url is sent with the series request', async () => {
  renderAt('/series/Amazing%20Spider-Man?status=unread')
  await screen.findByRole('heading', { name: 'Amazing Spider-Man' })
  const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
  expect(url).toContain('readState=unread')
})

test('edition links carry the status onwards', async () => {
  renderAt('/series/Amazing%20Spider-Man?status=unread')
  const tile = (await screen.findByText('Amazing Spider-Man (2025)')).closest('a')
  expect(tile).toHaveAttribute('href', '/edition/9?status=unread')
})

test('Remove series asks first, naming its editions, issues and file count', async () => {
  renderAt('/series/Amazing%20Spider-Man')

  fireEvent.click(await screen.findByRole('button', { name: 'Remove series' }))

  // Scoped to the dialog: the page subtitle carries the same wording.
  const dialog = within(await screen.findByTestId('confirm-delete-backdrop'))
  expect(dialog.getByRole('heading', { name: /remove series "Amazing Spider-Man"\?/i })).toBeInTheDocument()
  expect(dialog.getByText('2 editions · 5 issues')).toBeInTheDocument()
  expect(dialog.getByText(/5 files will be deleted from disk/i)).toBeInTheDocument()
})

test('confirming sends the DELETE for the series', async () => {
  renderAt('/series/Amazing%20Spider-Man')

  fireEvent.click(await screen.findByRole('button', { name: 'Remove series' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/series/Amazing%20Spider-Man', expect.objectContaining({ method: 'DELETE' }),
  ))
})

// Every series is now reached by clicking through from the home screen, so the way back
// has to be on the page - the edition page has carried the same link all along.
test('there is a link back to the library', async () => {
  renderAt('/series/Amazing%20Spider-Man')
  const back = await screen.findByRole('link', { name: /library/i })
  expect(back).toHaveAttribute('href', '/')
})

const WITH_ANNUALS = {
  name: 'The Amazing Spider-Man',
  bookCount: 7,
  editions: [
    { id: 9, name: 'The Amazing Spider-Man (2025)', bookCount: 5 },
    { id: 10, name: 'Amazing Spider-Man Annual (2026)', bookCount: 1 },
    { id: 11, name: 'Amazing Spider-Man Annual (2027)', bookCount: 1 },
  ],
}

test('the annuals of a run are collapsed into one tile', async () => {
  mockFetch({ series: WITH_ANNUALS })
  renderAt('/series/The%20Amazing%20Spider-Man')

  expect(await screen.findByText('Annuals')).toBeInTheDocument()
  expect(screen.queryByText('Amazing Spider-Man Annual (2026)')).not.toBeInTheDocument()
  expect(screen.getByText('The Amazing Spider-Man (2025)')).toBeInTheDocument()
})

test('the annuals tile counts the issues behind it', async () => {
  mockFetch({ series: WITH_ANNUALS })
  renderAt('/series/The%20Amazing%20Spider-Man')

  expect(await screen.findByText('2 issues')).toBeInTheDocument()
})

// Every other tile on this grid opens a page; a tile that unfolded in place instead was
// the one odd thing on the shelf.
test('the annuals tile opens the annuals page', async () => {
  mockFetch({ series: WITH_ANNUALS })
  renderAt('/series/The%20Amazing%20Spider-Man')

  const tile = (await screen.findByText('Annuals')).closest('a')
  expect(tile).toHaveAttribute('href', '/series/The%20Amazing%20Spider-Man/annuals')
})

test('the annuals tile carries the status onwards', async () => {
  mockFetch({ series: WITH_ANNUALS })
  renderAt('/series/The%20Amazing%20Spider-Man?status=unread')

  const tile = (await screen.findByText('Annuals')).closest('a')
  expect(tile).toHaveAttribute('href', '/series/The%20Amazing%20Spider-Man/annuals?status=unread')
})

// The same rule the shelf applies to a series holding one volume: a tile that opens onto
// a single tile is a click that buys nothing.
test('a lone annual is drawn as itself, with no annuals tile', async () => {
  mockFetch({
    series: {
      name: 'The Amazing Spider-Man',
      bookCount: 6,
      editions: [
        { id: 9, name: 'The Amazing Spider-Man (2025)', bookCount: 5 },
        { id: 10, name: 'Amazing Spider-Man Annual (2026)', bookCount: 1 },
      ],
    },
  })
  renderAt('/series/The%20Amazing%20Spider-Man')

  expect(await screen.findByText('Amazing Spider-Man Annual (2026)')).toBeInTheDocument()
  expect(screen.queryByText('Annuals')).not.toBeInTheDocument()
})

// The shelf's own behaviour is covered in OtherVolumes.test.tsx. This is the one thing
// only the series page can answer: that it is mounted, and told which series it is for.
test('the series page offers the volumes Comic Vine has and the library does not', async () => {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/api/comicvine/volumes')) {
      return { ok: true, status: 200, json: async () => ({
        volumes: [{ id: 2127, name: 'The Amazing Spider-Man', startYear: 1963, publisher: 'Marvel', issueCount: 651, siteUrl: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-2127/' }],
        fetchedAt: null, stale: false,
      }) }
    }
    return { ok: true, status: 200, json: async () => ({ series: SERIES }) }
  }) as unknown as typeof fetch

  renderAt('/series/Amazing%20Spider-Man')

  expect(await screen.findByText('1963')).toBeInTheDocument()
  const calls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => String(c[0]))
  expect(calls).toContain('/api/comicvine/volumes?series=Amazing%20Spider-Man')
})

// A ?status= filter narrows which editions are listed, the same way it narrows the
// confirm's count. Recognising what is already shelved has to see the whole series, or
// a volume you own reappears below as something new.
test('a volume hidden by a status filter is still not offered as new', async () => {
  const shelved = { id: 9, name: 'The Amazing Spider-Man (2025)', bookCount: 3, comicvineId: 163325 }
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/comicvine/volumes')) {
      return { ok: true, status: 200, json: async () => ({
        volumes: [
          { id: 2127, name: 'The Amazing Spider-Man', startYear: 1963, publisher: 'Marvel', issueCount: 651, siteUrl: 'https://comicvine.gamespot.com/x/4050-2127/' },
          { id: 163325, name: 'The Amazing Spider-Man', startYear: 2025, publisher: 'Marvel', issueCount: 36, siteUrl: 'https://comicvine.gamespot.com/x/4050-163325/' },
        ],
        fetchedAt: null, stale: false,
      }) }
    }
    // Everything unread has been read, so the filter hides the run it belongs to.
    const editions = u.includes('readState=unread') ? [] : [shelved]
    return { ok: true, status: 200, json: async () => ({
      series: { name: 'The Amazing Spider-Man', bookCount: 3, editions },
    }) }
  }) as unknown as typeof fetch

  renderAt('/series/The%20Amazing%20Spider-Man?status=unread')

  await waitFor(() => {
    const years = screen.getAllByTestId('other-volume-year').map((el) => el.textContent)
    expect(years).toEqual(['1963'])
  })
})
