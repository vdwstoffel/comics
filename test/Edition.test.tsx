import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Edition from '../src/pages/Edition'

const EDITION = {
  id: 9,
  name: 'Amazing Spider-Man (2025)',
  seriesName: 'Amazing Spider-Man',
  summary: null,
}

const CV_EDITION = {
  id: 9,
  name: 'Vol 7',
  seriesName: 'Amazing Spider-Man',
  summary: null,
  cvName: 'The Amazing Spider-Man',
  cvStartYear: 2025,
}

let patched: { url: string; body: Record<string, unknown> }[]
let deleted: string[]

function mockFetch(edition: Record<string, unknown> = EDITION, books: unknown[] = []) {
  patched = []
  deleted = []
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      deleted.push(String(url))
      return { ok: true, json: async () => ({ deleted: true, books: 3, seriesName: 'Amazing Spider-Man' }) }
    }
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ edition }) }
    }
    return { ok: true, json: async () => ({ edition, books }) }
  }) as unknown as typeof fetch
}

function issue(number: string, year: number | null) {
  return { id: Number(number), number, title: null, pageCount: 20, comicinfoSynced: false, year }
}

beforeEach(() => { mockFetch() })
afterEach(() => { cleanup() })

function renderPage(path = '/edition/9') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/edition/:id" element={<Edition />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

async function startEditing() {
  fireEvent.click(await screen.findByLabelText(/edit edition/i))
}

test('the edit row offers a series field holding the current series', async () => {
  renderPage()
  await startEditing()
  expect(screen.getByLabelText(/^series$/i)).toHaveValue('Amazing Spider-Man')
})

test('the series field is empty when the edition has no series', async () => {
  mockFetch({ ...EDITION, seriesName: null })
  renderPage()
  await startEditing()
  expect(screen.getByLabelText(/^series$/i)).toHaveValue('')
})

test('changing the series sends seriesName and leaves the name alone', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: 'Spider-Man' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({ seriesName: 'Spider-Man' })
})

test('changing the name still renames the edition', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/edition name/i), { target: { value: 'ASM (2025)' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({ name: 'ASM (2025)' })
})

test('saving with nothing changed neither renames nor moves the edition', async () => {
  renderPage()
  await startEditing()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument())
  expect(patched).toEqual([])
})

test('a blank name is refused', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/edition name/i), { target: { value: '  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(patched).toEqual([])
})

test('the editor is a dialog, not shown until the pencil is clicked', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Amazing Spider-Man (2025)' })
  expect(screen.queryByRole('heading', { name: /edit edition/i })).not.toBeInTheDocument()

  await startEditing()
  expect(screen.getByRole('heading', { name: /edit edition/i })).toBeInTheDocument()
})

test('cancelling the dialog closes it and saves nothing', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: 'Something Else' } })
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

  expect(screen.queryByRole('heading', { name: /edit edition/i })).not.toBeInTheDocument()
  expect(patched).toEqual([])
})

test('the dialog closes once a save succeeds', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: 'Spider-Man' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: /edit edition/i })).not.toBeInTheDocument())
})

test('a status in the url is sent to the edition endpoint', async () => {
  renderPage('/edition/9?status=unread')
  await waitFor(() => {
    const urls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/editions/9') && u.includes('readState=unread'))).toBe(true)
  })
})

test('a filtered edition says so and offers a way back to everything', async () => {
  renderPage('/edition/9?status=unread')
  expect(await screen.findByText(/showing unread issues/i)).toBeInTheDocument()
  const showAll = screen.getByRole('link', { name: /show all/i })
  expect(showAll).toHaveAttribute('href', '/edition/9')
})

test('an unfiltered edition shows no filter notice', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Amazing Spider-Man (2025)' })
  expect(screen.queryByText(/showing .* issues/i)).not.toBeInTheDocument()
})

test('the search link carries the series name and the first year in the edition', async () => {
  mockFetch(EDITION, [issue('2', 2025), issue('1', 2023), issue('3', 2024)])
  renderPage()
  const link = await screen.findByRole('link', { name: /find more/i })
  expect(link).toHaveAttribute('href', '/search?q=Amazing+Spider-Man&yearFrom=2023')
})

test('the search link falls back to the edition name when it has no series', async () => {
  mockFetch({ ...EDITION, seriesName: null }, [issue('1', 2025)])
  renderPage()
  const link = await screen.findByRole('link', { name: /find more/i })
  expect(link).toHaveAttribute('href', '/search?q=Amazing+Spider-Man+%282025%29&yearFrom=2025')
})

test('the search link omits the year when no issue has one', async () => {
  mockFetch(EDITION, [issue('1', null)])
  renderPage()
  const link = await screen.findByRole('link', { name: /find more/i })
  expect(link).toHaveAttribute('href', '/search?q=Amazing+Spider-Man')
})

test('Remove edition asks first, naming the edition and its file count', async () => {
  mockFetch(EDITION, [issue('1', 2025), issue('2', 2025), issue('3', 2025)])
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Remove edition' }))

  expect(await screen.findByRole('heading', { name: /remove edition "Amazing Spider-Man \(2025\)"\?/i })).toBeInTheDocument()
  expect(screen.getByText(/3 files will be deleted from disk/i)).toBeInTheDocument()
  expect(deleted).toEqual([])
})

test('confirming sends the DELETE for the edition', async () => {
  mockFetch(EDITION, [issue('1', 2025)])
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Remove edition' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

  await waitFor(() => expect(deleted).toEqual(['/api/editions/9']))
})

test('cancelling the edition removal sends nothing', async () => {
  mockFetch(EDITION, [issue('1', 2025)])
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Remove edition' }))
  fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))

  await waitFor(() => expect(screen.queryByRole('heading', { name: /remove edition/i })).not.toBeInTheDocument())
  expect(deleted).toEqual([])
})

// The page's book list is filtered by ?status=, but removing the edition takes every
// issue with it - so the confirm must count the whole edition, not the visible slice.
test('the removal counts every issue in the edition, not just the filtered ones', async () => {
  const all = [issue('1', 2025), issue('2', 2025), issue('3', 2025)]
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return { ok: true, json: async () => ({ deleted: true, books: 3 }) }
    const filtered = String(url).includes('readState=unread')
    return { ok: true, json: async () => ({ edition: EDITION, books: filtered ? all.slice(0, 1) : all }) }
  }) as unknown as typeof fetch

  renderPage('/edition/9?status=unread')

  fireEvent.click(await screen.findByRole('button', { name: 'Remove edition' }))

  expect(await screen.findByText(/3 files will be deleted from disk/i)).toBeInTheDocument()
})

test('an edition named differently from its Comic Vine volume offers the name', async () => {
  mockFetch(CV_EDITION)
  renderPage()

  expect(await screen.findByRole('button', { name: /rename to The Amazing Spider-Man \(2025\)/i }))
    .toBeInTheDocument()
})

test('an edition already carrying its Comic Vine name offers nothing', async () => {
  mockFetch({ ...CV_EDITION, name: 'The Amazing Spider-Man (2025)' })
  renderPage()

  await screen.findByText(/The Amazing Spider-Man \(2025\)/)
  expect(screen.queryByRole('button', { name: /rename to/i })).not.toBeInTheDocument()
})

test('an edition with no volume resolved yet offers to look it up', async () => {
  mockFetch({ ...CV_EDITION, cvName: null, cvStartYear: null })
  renderPage()

  expect(await screen.findByRole('button', { name: /check comic vine/i })).toBeInTheDocument()
})

// Accepting the suggestion must send the series too: renameEdition restores the old
// series name from carryableMetadata, so a name-only PATCH leaves the series behind.
test('accepting the name sends the series alongside it', async () => {
  mockFetch(CV_EDITION)
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: /rename to/i }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({
    name: 'The Amazing Spider-Man (2025)',
    seriesName: 'The Amazing Spider-Man',
  })
})

// The wording has to change when the target name is already taken: renaming onto it is
// a merge on the server, not a plain rename. This needs the page to know what other
// editions exist, so it reuses the same /api/editions list EditionCombobox draws from.
test('an edition colliding with an existing name offers to merge instead of rename', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ edition: CV_EDITION }) }
    }
    if (String(url).startsWith('/api/editions/9')) {
      return { ok: true, json: async () => ({ edition: CV_EDITION, books: [] }) }
    }
    return {
      ok: true,
      json: async () => ({
        editions: [
          { id: 9, name: 'Vol 7' },
          { id: 42, name: 'The Amazing Spider-Man (2025)' },
        ],
      }),
    }
  }) as unknown as typeof fetch

  renderPage()

  expect(await screen.findByRole('button', { name: /merge into The Amazing Spider-Man \(2025\)/i }))
    .toBeInTheDocument()
})

// The label flips between "Rename to ..." and "Merge into ..." only once we know
// which one is true - so the button must stay disabled until the editions list has
// resolved. Clicking during that window while a collision in fact exists would tell
// the user they're renaming when the server will actually merge, moving every issue
// in this edition into another edition's folder.
test('the button stays disabled until we know whether this is a rename or a merge', async () => {
  let resolveEditions: () => void = () => {}
  const editionsPending = new Promise<void>((resolve) => { resolveEditions = resolve })

  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ edition: CV_EDITION }) }
    }
    if (String(url).startsWith('/api/editions/9')) {
      return { ok: true, json: async () => ({ edition: CV_EDITION, books: [] }) }
    }
    // The editions list resolves only once the test says so, simulating the window
    // between the edition loading and the collision check settling.
    await editionsPending
    return {
      ok: true,
      json: async () => ({
        editions: [
          { id: 9, name: 'Vol 7' },
          { id: 42, name: 'The Amazing Spider-Man (2025)' },
        ],
      }),
    }
  }) as unknown as typeof fetch

  renderPage()

  const button = await screen.findByRole('button', { name: /rename to The Amazing Spider-Man \(2025\)/i })
  expect(button).toBeDisabled()

  resolveEditions()

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /merge into The Amazing Spider-Man \(2025\)/i })).toBeEnabled())
})

// isLoading (v5: isPending && isFetching) only covers the initial fetch - if that fetch
// errors, isLoading flips back to false with no data ever having arrived, so gating on
// it alone would re-enable a "Rename to ..." button whose real answer is still unknown.
// The gate has to be "do we have the data at all", which stays true through pending,
// error, and any future paused state alike.
test('the button stays disabled if the editions list fails to load', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ edition: CV_EDITION }) }
    }
    if (String(url).startsWith('/api/editions/9')) {
      return { ok: true, json: async () => ({ edition: CV_EDITION, books: [] }) }
    }
    // The editions list fails outright. renderPage's QueryClient sets retry: false, so
    // this settles into an error state promptly rather than retrying.
    return { ok: false, status: 500, json: async () => ({}) }
  }) as unknown as typeof fetch

  renderPage()

  const button = await screen.findByRole('button', { name: /rename to The Amazing Spider-Man \(2025\)/i })
  await waitFor(() => expect(button).toBeDisabled())
})
