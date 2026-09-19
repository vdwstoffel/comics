import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import BookDetail from '../src/pages/BookDetail'
import { stubFullscreen } from './helpers/fullscreen'

const book = {
  id: 5,
  editionId: 1,
  title: 'Untitled',
  number: '1',
  pageCount: 20,
  comicinfoSynced: false,
  writer: 'Jonathan Hickman',
  penciller: 'Steve Epting',
  date: '2020-08',
  summary: 'Earths Mightiest Heroes expand their sphere of influence.',
  filePath: 'Vol 3/Avengers 001 (2020) (Digital) (Zone-Empire).cbz',
}

const edition = { id: 1, name: 'Vol 3', seriesName: 'Avengers' }

const tags = [
  { kind: 'character', value: 'Spider-Man', extId: 1443 },
  { kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 },
  { kind: 'team', value: 'Sinister Six' },
]

const HOBGOBLIN = {
  id: 7605,
  name: 'Hobgoblin (Kingsley)',
  realName: 'Roderick Kingsley',
  aliases: [],
  deck: 'A worthy heir of the Goblin legacy.',
  publisher: 'Marvel',
  siteUrl: 'https://comicvine.gamespot.com/hobgoblin/4005-7605/',
}

function characterUrls() {
  return (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/character?'))
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url.includes('/character?')) return { ok: true, json: async () => ({ character: HOBGOBLIN, verified: true }) }
    if (url === '/api/books/5' && !opts) return { ok: true, json: async () => ({ book, progress: { lastPage: 0, completed: false }, tags }) }
    if (url === '/api/books/5' && opts?.method === 'DELETE') return { ok: true, json: async () => ({ deleted: true, editionId: 1, editionRemoved: false }) }
    if (url === '/api/series') return { ok: true, json: async () => ({ series: [{ id: 1, name: 'Avengers' }] }) }
    if (url === '/api/editions') return { ok: true, json: async () => ({ editions: [edition] }) }
    if (url.includes('/comicvine/search')) return { ok: true, json: async () => ({ results: [{ id: 99, name: 'Batman', issueNumber: '1', year: '2011' }] }) }
    if (url === '/api/books/5/comicvine') return { ok: true, json: async () => ({ book: { ...book, title: 'Year One' } }) }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
})

function renderAt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/book/5']}>
        <Routes><Route path="/book/:id" element={<BookDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

test('read mode shows the summary as text with no edit fields', async () => {
  renderAt()
  expect(await screen.findByText(/Earths Mightiest Heroes/)).toBeInTheDocument()
  expect(screen.getByText('Jonathan Hickman')).toBeInTheDocument()
  expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  expect(screen.queryByText('Move')).not.toBeInTheDocument()
})

test('read mode puts the summary above the other details', async () => {
  const { container } = renderAt()
  await screen.findByText(/Earths Mightiest Heroes/)
  const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent)
  expect(headings[0]).toBe('Summary')
})

test('pencil reveals the metadata form', async () => {
  renderAt()
  fireEvent.click(await screen.findByLabelText('Edit metadata'))
  expect(await screen.findByDisplayValue('Untitled')).toBeInTheDocument()
  expect(screen.getByDisplayValue('Steve Epting')).toBeInTheDocument()
  expect(screen.getByText('Move')).toBeInTheDocument()
})

test('saving metadata sends a PATCH and returns to read mode', async () => {
  renderAt()
  fireEvent.click(await screen.findByLabelText('Edit metadata'))
  fireEvent.change(await screen.findByDisplayValue('Untitled'), { target: { value: 'Vol. 1' } })
  fireEvent.click(screen.getByText('Save metadata'))
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/books/5/metadata', expect.objectContaining({ method: 'PATCH' })))
  await waitFor(() => expect(screen.queryAllByRole('textbox')).toHaveLength(0))
})

test('cancel closes the form without saving', async () => {
  renderAt()
  fireEvent.click(await screen.findByLabelText('Edit metadata'))
  fireEvent.change(await screen.findByDisplayValue('Untitled'), { target: { value: 'Vol. 1' } })
  fireEvent.click(screen.getByText('Cancel'))
  await waitFor(() => expect(screen.queryAllByRole('textbox')).toHaveLength(0))
  expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/books/5/metadata', expect.anything())
})

test('shows book, opens Comic Vine dialog, applies a match', async () => {
  renderAt()
  expect(await screen.findByText('Untitled')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Fetch metadata'))
  fireEvent.change(await screen.findByPlaceholderText('Search Comic Vine'), { target: { value: 'batman' } })
  fireEvent.click(screen.getByText('Search'))
  const candidate = await screen.findByText(/Batman/)
  fireEvent.click(candidate)
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/books/5/comicvine', expect.objectContaining({ method: 'POST' })))
})

test('there is no manual embed button; saving handles it', async () => {
  renderAt()
  await screen.findByText(/Earths Mightiest Heroes/)
  expect(screen.queryByRole('button', { name: /embed/i })).not.toBeInTheDocument()
})

test('Read asks for fullscreen as part of the click that opens the reader', async () => {
  const fs = stubFullscreen()
  renderAt()

  fireEvent.click(await screen.findByRole('button', { name: 'Read' }))

  await waitFor(() => expect(fs.requestFullscreen).toHaveBeenCalled())
  fs.restore()
})

// The issue title makes a poor Comic Vine query - its search matches volumes - so the
// dialog opens on the series and issue number instead.
test('the Comic Vine dialog opens on the series and number, not the issue title', async () => {
  renderAt()
  fireEvent.click(await screen.findByText('Fetch metadata'))
  expect(await screen.findByDisplayValue('Avengers #1')).toBeInTheDocument()
})

test('Remove asks first, naming the issue and the single file that goes', async () => {
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: 'Remove issue' }))

  expect(await screen.findByRole('heading', { name: /remove "Untitled"\?/i })).toBeInTheDocument()
  expect(screen.getByText(/1 file will be deleted from disk/i)).toBeInTheDocument()
  // Nothing is sent until the confirm is clicked.
  expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/books/5', expect.objectContaining({ method: 'DELETE' }))
})

test('confirming the removal sends the DELETE', async () => {
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: 'Remove issue' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/books/5', expect.objectContaining({ method: 'DELETE' }),
  ))
})

test('cancelling the removal sends nothing', async () => {
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: 'Remove issue' }))
  fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))

  await waitFor(() => expect(screen.queryByRole('heading', { name: /remove/i })).not.toBeInTheDocument())
  expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/books/5', expect.objectContaining({ method: 'DELETE' }))
})

// --- character lookup -------------------------------------------------------

// An issue can credit thirty characters. Looking them all up to render chips nobody
// clicked would spend the hourly Comic Vine budget on a page view.
test('rendering the characters looks none of them up', async () => {
  renderAt()
  expect(await screen.findByText('Hobgoblin (Kingsley)')).toBeInTheDocument()
  expect(characterUrls()).toHaveLength(0)
})

test('clicking a character opens their card', async () => {
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: 'Hobgoblin (Kingsley)' }))
  expect(await screen.findByText('A worthy heir of the Goblin legacy.')).toBeInTheDocument()
  expect(screen.getByText('Roderick Kingsley')).toBeInTheDocument()
})

test('clicking a character looks up that character, once', async () => {
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: 'Spider-Man' }))
  await waitFor(() => expect(characterUrls()).toHaveLength(1))
  expect(characterUrls()[0]).toContain(`name=${encodeURIComponent('Spider-Man')}`)
})

// Teams and story arcs have no character lookup behind them, so they stay plain text
// rather than advertising a click that does nothing.
test('a team is not clickable', async () => {
  renderAt()
  expect(await screen.findByText('Sinister Six')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sinister Six' })).not.toBeInTheDocument()
})

test('the card closes again', async () => {
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: 'Hobgoblin (Kingsley)' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByText('A worthy heir of the Goblin legacy.')).not.toBeInTheDocument())
})

// ── Where this issue falls in its story arc ───────────────────────────────────────────

function stubArcs(arcs: unknown[]) {
  const inner = globalThis.fetch as unknown as typeof fetch
  globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/books/5/arcs') return { ok: true, json: async () => ({ arcs }) }
    return (inner as unknown as (u: string, o?: RequestInit) => unknown)(url, opts)
  }) as unknown as typeof fetch
}

test('an issue in a story arc shows where it falls in the run', async () => {
  stubArcs([{ name: '"Avengers" Armageddon', arcId: 61350, position: 2, total: 6 }])
  renderAt()

  expect(await screen.findByText('Part 2 of 6')).toBeInTheDocument()
  expect(screen.getByText('"Avengers" Armageddon')).toBeInTheDocument()
})

test('the arc position links through to the arc', async () => {
  stubArcs([{ name: '"Avengers" Armageddon', arcId: 61350, position: 2, total: 6 }])
  renderAt()

  const link = await screen.findByRole('link', { name: /Armageddon/ })
  expect(link).toHaveAttribute('href', '/arcs/%22Avengers%22%20Armageddon')
})

test('an issue in two arcs shows its place in each', async () => {
  stubArcs([
    { name: 'Death Spiral', arcId: 1, position: 2, total: 9 },
    { name: 'Armageddon', arcId: 2, position: 1, total: 6 },
  ])
  renderAt()

  expect(await screen.findByText('Part 2 of 9')).toBeInTheDocument()
  expect(screen.getByText('Part 1 of 6')).toBeInTheDocument()
})

// A tie-in Comic Vine does not list back has no position. Naming the arc is still worth
// doing; inventing a part number is not.
test('an arc with no known position is named without a part number', async () => {
  stubArcs([{ name: 'Death Spiral', arcId: 1, total: 9 }])
  renderAt()

  expect(await screen.findByText('Death Spiral')).toBeInTheDocument()
  expect(screen.queryByText(/Part \d+ of/)).not.toBeInTheDocument()
})

test('an issue in no story arc shows no arc section', async () => {
  stubArcs([])
  renderAt()

  await screen.findByRole('button', { name: 'Read' })
  expect(screen.queryByText('Story arc')).not.toBeInTheDocument()
})

// The arc position costs a Comic Vine read on a cold cache, so the page must not wait on
// it - the issue is readable the moment its own data lands.
test('the page is readable before the arc position arrives', async () => {
  let release: (v: unknown) => void = () => {}
  const pending = new Promise((r) => { release = r })
  const inner = globalThis.fetch as unknown as typeof fetch
  globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/books/5/arcs') { await pending; return { ok: true, json: async () => ({ arcs: [] }) } }
    return (inner as unknown as (u: string, o?: RequestInit) => unknown)(url, opts)
  }) as unknown as typeof fetch

  renderAt()

  expect(await screen.findByRole('button', { name: 'Read' })).toBeInTheDocument()
  expect(screen.getByText('Earths Mightiest Heroes expand their sphere of influence.')).toBeInTheDocument()
  release(null)
})

// The chips at the foot of the page name the same arcs; they should reach it too.
test('the story arc chips link to the arc page', async () => {
  const inner = globalThis.fetch as unknown as typeof fetch
  globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/books/5/arcs') return { ok: true, json: async () => ({ arcs: [] }) }
    if (url === '/api/books/5' && !opts) {
      return { ok: true, json: async () => ({
        book, progress: { lastPage: 0, completed: false },
        tags: [...tags, { kind: 'story_arc', value: 'Death Spiral' }],
      }) }
    }
    return (inner as unknown as (u: string, o?: RequestInit) => unknown)(url, opts)
  }) as unknown as typeof fetch

  renderAt()

  const chip = await screen.findByRole('link', { name: 'Death Spiral' })
  expect(chip).toHaveAttribute('href', '/arcs/Death%20Spiral')
})
