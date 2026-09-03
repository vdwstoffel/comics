import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Arcs from '../src/pages/Arcs'
import Arc from '../src/pages/Arc'

const ARCS = [{ name: 'Death Spiral', owned: 3 }, { name: 'Court of Owls', owned: 1 }]

const OWLS = {
  id: 42125, name: 'Court of Owls', deck: 'Owls in Gotham.', publisher: 'DC',
  imageUrl: 'https://cv/owls.jpg', siteUrl: 'https://cv/owls',
  issues: [{ id: 1, name: 'Owls One', siteUrl: 'https://cv/o1', owned: true, bookId: 9 }],
}

const ARC = {
  id: 56676,
  name: 'Death Spiral',
  deck: 'A nine part crossover.',
  publisher: 'Marvel',
  imageUrl: 'https://cv/death-spiral.jpg',
  siteUrl: 'https://comicvine.gamespot.com/death-spiral/4045-56676/',
  issues: [
    { id: 1156915, name: 'Part One', siteUrl: 'https://cv/one', owned: true, bookId: 43 },
    { id: 1158149, name: 'Part Two', siteUrl: 'https://cv/two', owned: true, bookId: 41 },
    { id: 9999999, name: 'Part Three', siteUrl: 'https://cv/three', owned: false },
  ],
}

function stub(routes: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    for (const [needle, body] of Object.entries(routes)) {
      if (String(url).includes(needle)) return { ok: true, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

beforeEach(() => stub({
  'Court%20of%20Owls': { arc: OWLS },
  '/api/arcs/': { arc: ARC },
  '/api/arcs': { arcs: ARCS },
  '/api/publishers': { publishers: [] },
  '/api/editions': { editions: [] },
  '/api/read-states': { readStates: [] },
}))

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/arcs" element={<Arcs />} />
          <Route path="/arcs/:name" element={<Arc />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// --- the arcs view ----------------------------------------------------------

test('the arcs view lists every arc in the library', async () => {
  renderAt('/arcs')
  const main = await screen.findByRole('main')
  expect(await within(main).findByText('Death Spiral')).toBeInTheDocument()
  expect(within(main).getByText('Court of Owls')).toBeInTheDocument()
})

// An arc is a comic like any other on this screen, so it wears the same tile.
test('an arc wears its Comic Vine cover', async () => {
  renderAt('/arcs')
  const main = await screen.findByRole('main')
  const cover = await within(main).findByRole('img', { name: 'Death Spiral' })
  expect(cover).toHaveAttribute('src', 'https://cv/death-spiral.jpg')
})

test('an arc counts what you own against the whole arc', async () => {
  renderAt('/arcs')
  const main = await screen.findByRole('main')
  expect(await within(main).findByText('3 of 3 issues')).toBeInTheDocument()
})

test('clicking an arc goes to its page', async () => {
  renderAt('/arcs')
  const main = await screen.findByRole('main')
  expect(await within(main).findByRole('link', { name: /Death Spiral/ })).toHaveAttribute('href', '/arcs/Death%20Spiral')
})

test('an empty library says so instead of showing nothing', async () => {
  stub({ '/api/arcs': { arcs: [] }, '/api/publishers': { publishers: [] }, '/api/editions': { editions: [] }, '/api/read-states': { readStates: [] } })
  renderAt('/arcs')
  expect(await screen.findByText(/no story arcs/i)).toBeInTheDocument()
})

// --- one arc ----------------------------------------------------------------

test('the arc page names the arc and keeps its blurb', async () => {
  renderAt('/arcs/Death%20Spiral')
  expect(await screen.findByRole('heading', { name: 'Death Spiral' })).toBeInTheDocument()
  expect(screen.getByText('A nine part crossover.')).toBeInTheDocument()
})

test('an issue you own shows its cover and links into your library', async () => {
  renderAt('/arcs/Death%20Spiral')
  const link = await screen.findByRole('link', { name: /Part One/ })
  expect(link).toHaveAttribute('href', '/book/43')
  expect(within(link).getByRole('img')).toHaveAttribute('src', '/api/books/43/thumbnail')
})

// A cover you have not bought is a spoiler. The tile stays, the art does not.
test('an issue you do not own shows no cover art', async () => {
  renderAt('/arcs/Death%20Spiral')
  const link = await screen.findByRole('link', { name: /Part Three/ })
  expect(within(link).queryByRole('img')).toBeNull()
})

test('an issue you do not own is still clickable, out to Comic Vine', async () => {
  renderAt('/arcs/Death%20Spiral')
  const link = await screen.findByRole('link', { name: /Part Three/ })
  expect(link).toHaveAttribute('href', 'https://cv/three')
  expect(link).toHaveAttribute('target', '_blank')
})

test('a missing issue says it is missing', async () => {
  renderAt('/arcs/Death%20Spiral')
  const link = await screen.findByRole('link', { name: /Part Three/ })
  expect(within(link).getByText(/missing/i)).toBeInTheDocument()
})

test('the issues stay in reading order', async () => {
  renderAt('/arcs/Death%20Spiral')
  const main = await screen.findByRole('main')
  await within(main).findByRole('heading', { name: 'Death Spiral' })
  const titles = within(main).getAllByRole('link').map((a) => a.textContent)
  expect(titles.filter((t) => t?.includes('Part'))).toEqual([
    expect.stringContaining('Part One'),
    expect.stringContaining('Part Two'),
    expect.stringContaining('Part Three'),
  ])
})

test('the arc page counts what you have against the whole arc', async () => {
  renderAt('/arcs/Death%20Spiral')
  expect(await screen.findByText(/2 of 3/)).toBeInTheDocument()
})

test('the arc page keeps its link to Comic Vine', async () => {
  renderAt('/arcs/Death%20Spiral')
  expect(await screen.findByRole('link', { name: /on Comic Vine/i }))
    .toHaveAttribute('href', 'https://comicvine.gamespot.com/death-spiral/4045-56676/')
})

test('an arc that cannot be loaded says so', async () => {
  stub({ '/api/publishers': { publishers: [] }, '/api/editions': { editions: [] }, '/api/read-states': { readStates: [] } })
  renderAt('/arcs/Nothing')
  expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument()
})
