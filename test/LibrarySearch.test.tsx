import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import LibrarySearch from '../src/pages/LibrarySearch'

/** The current url, so a test can see what the page has written into it. */
function Where() {
  const loc = useLocation()
  return <span data-testid="where">{loc.pathname}{loc.search}</span>
}

const BOOK = {
  id: 1, editionId: 1, editionName: 'Thanos', seriesName: 'Thanos', arcs: [],
  title: 'Thanos', number: '1', pageCount: 20, comicinfoSynced: false,
  readState: 'unread' as const, percent: 0,
  shelfKey: 'edition:1', shelfName: 'Thanos', shelfVolumeId: null,
}

let results: unknown[]
let requested: string[]

function show(url = '/library/search?q=thanos') {
  requested = []
  globalThis.fetch = vi.fn(async (input: string) => {
    const path = String(input)
    const body = path.startsWith('/api/books?') ? (requested.push(path), { books: results })
      : path === '/api/read-states' ? { readStates: [{ name: 'unread', count: 1 }, { name: 'read', count: 1 }] }
      : path === '/api/publishers' ? { publishers: [] }
      : path === '/api/editions' ? { editions: [] }
      : path === '/api/arcs' ? { arcs: [] }
      : { follows: [] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}><LibrarySearch /><Where /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => { results = [BOOK] })

test('results draw on the shelves the library uses', async () => {
  // Two collected-edition lines of one run: two edition ids and names, one shelf key. Both
  // books carry the same series name too, so a count of the grid's children would be 1
  // whichever way they were grouped; what tells the groupings apart is the tile drawn.
  const run = { shelfKey: 'volume:7', shelfName: 'Infinity Gauntlet', shelfVolumeId: 7, seriesName: 'Infinity Gauntlet' }
  results = [
    { ...BOOK, id: 1, editionId: 1, editionName: 'Infinity Gauntlet TPB', number: '1', ...run },
    { ...BOOK, id: 2, editionId: 2, editionName: 'Infinity Gauntlet Omnibus', number: '2', ...run },
  ]
  const { container } = show()
  await waitFor(() => expect(container.querySelector('.tile-grid')).not.toBeNull())
  // Grouped by shelf this is one volume, which the series tile draws as a volume tile
  // linking to the run. Grouped by edition it would be two volumes of one series, drawn as
  // a series tile that says "2 volumes" and links to neither.
  expect(container.querySelectorAll('.volume-tile')).toHaveLength(1)
  expect(container.querySelector('.series-tile')).toBeNull()
  expect(screen.queryByText('2 volumes')).toBeNull()
  expect(screen.getByRole('link', { name: 'Infinity Gauntlet' })).toHaveAttribute('href', '/volume/7')
})

test('a finished run is not called unread, and its name does not open an unread view', async () => {
  results = [{ ...BOOK, readState: 'read' as const, percent: 100, shelfVolumeId: 3 }]
  const { container } = show()
  const name = await screen.findByRole('link', { name: 'Thanos' })
  expect(name).toHaveAttribute('href', '/volume/3')
  expect(container.textContent).not.toMatch(/\d+ unread/)
})

test('a series of several volumes does not call its comics unread', async () => {
  results = [
    { ...BOOK, id: 1, editionId: 1, shelfKey: 'edition:1' },
    { ...BOOK, id: 2, editionId: 2, shelfKey: 'edition:2' },
  ]
  show()
  expect(await screen.findByText('2 volumes')).toBeInTheDocument()
})

test('the search rail offers Read as well as Unread', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Read' }))
  expect(screen.getByTestId('where')).toHaveTextContent('status=read')
})

test('a credit match says who and in what role', async () => {
  results = [{ ...BOOK, matched: { role: 'writer', name: 'Chris Claremont' } }]
  show('/library/search?q=claremont')
  expect(await screen.findByText('written by Chris Claremont')).toBeInTheDocument()
})

test('a cover credit reads as cover by, not as a role in the abstract', async () => {
  results = [{ ...BOOK, matched: { role: 'cover', name: 'Chip Zdarsky' } }]
  show('/library/search?q=zdarsky')
  expect(await screen.findByText('cover by Chip Zdarsky')).toBeInTheDocument()
})

// Comic Vine's roles reach the database as it spelled them, which is not how ComicInfo's
// seven fixed names are spelled: "penciler" with one l, and roles ComicInfo has no tag for.
// None of them may fall to a bare "<role> by", which reads as a fault in the page.
test.each([
  ['penciller', 'pencils by'],
  ['penciler', 'pencils by'],
  ['artist', 'art by'],
  ['inker', 'inks by'],
  ['colorist', 'colors by'],
  ['letterer', 'lettered by'],
  ['editor', 'edited by'],
  ['plotter', 'plotted by'],
  ['scripter', 'scripted by'],
  ['translator', 'translated by'],
  ['production', 'production by'],
  ['other', 'credited to'],
  ['unknown', 'credited to'],
])('a %s credit reads as "%s"', async (role, wording) => {
  results = [{ ...BOOK, matched: { role, name: 'Chip Zdarsky' } }]
  show('/library/search?q=zdarsky')
  expect(await screen.findByText(`${wording} Chip Zdarsky`)).toBeInTheDocument()
})

test('a role nobody planned for still gets a line, in the role\'s own words', async () => {
  results = [{ ...BOOK, matched: { role: 'assistant', name: 'Chip Zdarsky' } }]
  show('/library/search?q=zdarsky')
  expect(await screen.findByText('assistant by Chip Zdarsky')).toBeInTheDocument()
})

test('a name match says nothing extra', async () => {
  results = [{ ...BOOK, matched: 'name' }]
  const { container } = show()
  await waitFor(() => expect(container.querySelector('.tile-grid')).not.toBeNull())
  expect(container.querySelector('.search-match')).toBeNull()
  expect(screen.queryByText(/ by /)).toBeNull()
})

test('the query comes from the url, so a reload keeps the results', async () => {
  show('/library/search?q=knull')
  await waitFor(() => expect(requested.length).toBeGreaterThan(0))
  expect(new URLSearchParams(requested[0].split('?')[1]).get('q')).toBe('knull')
  // Unfiltered unless asked: a search is a question about the whole library.
  expect(requested[0]).not.toContain('readState')
  expect(requested[0]).not.toContain('publisher')
})

test('pressing a read-state filter puts it in the url and in the question', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Unread' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/library/search?q=thanos&status=unread')
  await waitFor(() => expect(requested.some((r) => r.includes('readState=unread'))).toBe(true))
})

test('a status in the url is applied on arrival', async () => {
  show('/library/search?q=thanos&status=unread')
  await waitFor(() => expect(requested.length).toBeGreaterThan(0))
  expect(requested[0]).toContain('readState=unread')
})

test('nothing matching offers the download search, carrying the query', async () => {
  results = []
  show('/library/search?q=knull')
  expect(await screen.findByText(/Nothing in your library matches "knull"/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Look for it in Get comics/ })).toHaveAttribute('href', '/search?q=knull')
})

test('the tab is named for the search', async () => {
  show('/library/search?q=knull')
  await waitFor(() => expect(document.title).toBe('knull — Comix'))
})
