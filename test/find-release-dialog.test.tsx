import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FindReleaseDialog from '../src/components/FindReleaseDialog'

// The Thor case this dialog exists for: the library calls the volume "Thor (2025)", the
// index posts it as "The Mortal Thor", and the gap already knows it is Comic Vine's #2.
const GROUPS = {
  groups: [
    { key: 'immortal-thor', name: 'The Immortal Thor', total: 26, kinds: {}, runs: [] },
    { key: 'mortal-thor', name: 'The Mortal Thor', total: 16, kinds: {}, runs: [] },
  ],
  totalGroups: 6,
  totalResults: 64,
}

const ROWS = {
  results: [
    { id: 901, title: 'The Mortal Thor #1 (2025)', url: 'https://g/1', category: 'Marvel Comics', number: '001', year: 2025 },
    { id: 902, title: 'The Mortal Thor #2 (2025)', url: 'https://g/2', category: 'Marvel Comics', number: '002', year: 2025 },
  ],
  total: 2,
}

let calls: string[] = []

function stub(byUrl: (url: string) => { ok?: boolean; status?: number; body: unknown }) {
  calls = []
  globalThis.fetch = vi.fn(async (url: string) => {
    calls.push(String(url))
    const { ok = true, status = 200, body } = byUrl(String(url))
    return { ok, status, json: async () => body }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  stub((url) => ({ body: url.includes('series=') ? ROWS : GROUPS }))
})

function draw(props: Partial<React.ComponentProps<typeof FindReleaseDialog>> = {}) {
  const onDownload = props.onDownload ?? vi.fn(async () => ({ queued: true }))
  const onClose = props.onClose ?? vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FindReleaseDialog
          gapLabel="Thor (2025) #2"
          seed={{ q: 'Thor', yearFrom: 2024 }}
          onDownload={onDownload}
          onClose={onClose}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onDownload, onClose }
}

// The gap is what the whole dialog is about, and it floats over a page that is no longer
// the one naming the comic.
test('the gap is named in the heading', async () => {
  draw()
  expect(screen.getByText(/Thor \(2025\) #2/)).toBeInTheDocument()
})

test('it opens on the seeded search, with the year floor applied', async () => {
  draw()
  await waitFor(() => expect(calls.length).toBeGreaterThan(0))
  expect(calls[0]).toContain('q=Thor')
  expect(calls[0]).toContain('yearFrom=2024')
})

// Grouped, not flat: searching "Thor" returns 64 rows with the wanted one at position 36,
// ordered alphabetically with no relevance ranking. Six headings is the readable shape.
test('results are series headings, and nothing opens by itself', async () => {
  draw()
  expect(await screen.findByRole('button', { name: /The Mortal Thor/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /The Immortal Thor/ })).toBeInTheDocument()
  expect(screen.queryByText('The Mortal Thor #2 (2025)')).toBeNull()
})

test('the count says how much the search found', async () => {
  draw()
  expect(await screen.findByText('64 in 6 series')).toBeInTheDocument()
})

test('opening a heading fetches that series rows', async () => {
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /The Mortal Thor/ }))
  expect(await screen.findByText('The Mortal Thor #2 (2025)')).toBeInTheDocument()
  expect(calls.some((u) => u.includes('series=mortal-thor'))).toBe(true)
})

// Selection is not commitment: a mis-click among near-identical titles should be fixable
// by clicking the right one, not by cancelling a download that already started.
test('picking a row does not download; the footer press does', async () => {
  const { onDownload } = draw()
  fireEvent.click(await screen.findByRole('button', { name: /The Mortal Thor/ }))
  fireEvent.click(await screen.findByRole('button', { name: /The Mortal Thor #2/ }))
  expect(onDownload).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(onDownload).toHaveBeenCalledWith(902))
})

test('download is not offered until something is picked', async () => {
  draw()
  await screen.findByRole('button', { name: /The Mortal Thor/ })
  expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled()
})

test('a started download closes the dialog', async () => {
  const { onClose } = draw()
  fireEvent.click(await screen.findByRole('button', { name: /The Mortal Thor/ }))
  fireEvent.click(await screen.findByRole('button', { name: /The Mortal Thor #2/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

// A failure you can correct in place beats one that makes you start the search over.
test('a refusal holds the dialog open, with the pick intact', async () => {
  const onDownload = vi.fn(async () => { throw new Error('could not read that post') })
  const { onClose } = draw({ onDownload })
  fireEvent.click(await screen.findByRole('button', { name: /The Mortal Thor/ }))
  const row = await screen.findByRole('button', { name: /The Mortal Thor #2/ })
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('button', { name: 'Download' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('could not read that post')
  expect(onClose).not.toHaveBeenCalled()
  expect(row).toHaveAttribute('aria-pressed', 'true')
})

// "Already queued" is the one refusal meaning the download you wanted is happening.
// Holding the dialog open for it invites a second press for the same comic.
test('already queued closes the dialog rather than reporting a failure', async () => {
  const onDownload = vi.fn(async () => {
    throw Object.assign(new Error('that issue is already queued'), { status: 409, reason: 'duplicate' })
  })
  const { onClose } = draw({ onDownload })
  fireEvent.click(await screen.findByRole('button', { name: /The Mortal Thor/ }))
  fireEvent.click(await screen.findByRole('button', { name: /The Mortal Thor #2/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

// This week can hold an issue with no volume name. Searching for nothing answers nothing,
// which would read as "not in the index" rather than "nothing asked".
test('an empty seed searches nothing', async () => {
  draw({ seed: { q: '' } })
  await new Promise((r) => setTimeout(r, 20))
  expect(calls).toEqual([])
})

// 3,101 indexed posts carry no parsed year, and a bounded query drops every one of them.
test('the year floor can be cleared, and the search re-runs without it', async () => {
  draw()
  await screen.findByRole('button', { name: /The Mortal Thor/ })
  fireEvent.click(screen.getByRole('button', { name: /Clear the year filter/ }))
  await waitFor(() => expect(calls.some((u) => u.includes('q=Thor') && !u.includes('yearFrom'))).toBe(true))
})

// Scraping lives on the search page, so an index that simply does not hold the comic is
// the one dead end worth leaving the page for.
test('nothing found offers the search page', async () => {
  stub(() => ({ body: { groups: [], totalGroups: 0, totalResults: 0 } }))
  draw()
  const link = await screen.findByRole('link', { name: /Search comics/ })
  expect(link).toHaveAttribute('href', '/search?q=Thor&yearFrom=2024')
})

// The server caps a group at 200 rows. A list that just stops is the one thing a dialog
// built to be trusted cannot do.
test('a truncated group says so', async () => {
  stub((url) => ({ body: url.includes('series=') ? { ...ROWS, total: 240 } : GROUPS }))
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /The Mortal Thor/ }))
  expect(await screen.findByText(/Showing 2 of 240/)).toBeInTheDocument()
})
