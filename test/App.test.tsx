import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import App from '../src/App'

/** The current url, so a test can see where the header's search box sent you. */
function Where() {
  const loc = useLocation()
  return <span data-testid="where">{loc.pathname}{loc.search}</span>
}

const RUNNING = {
  active: [{
    id: 1, fileName: 'Knull 005 (2026).cbz',
    received: 20_000_000, total: 50_000_000, startedAt: '2026-09-09T00:00:00Z',
  }],
  queue: [], history: [],
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/downloads')) return { ok: true, json: async () => RUNNING }
    if (u.includes('/api/series')) return { ok: true, json: async () => ({ series: [] }) }
    if (u.includes('/api/editions')) return { ok: true, json: async () => ({ editions: [] }) }
    // The results page the header's search box lands on; empty is enough, these tests
    // look at where the box sent you, not at what it found.
    if (u.includes('/api/books?')) return { ok: true, json: async () => ({ books: [] }) }
    if (u.includes('/api/books/')) return { ok: true, json: async () => ({ book: { id: 1, pageCount: 1 }, progress: { lastPage: 0, completed: false } }) }
    if (u.includes('/api/releases')) return { ok: true, json: async () => ({ day: '2026-09-09', fetchedAt: null, publishers: [] }) }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup() })

function renderAt(path: string, aside: ReactNode = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><App /><Where />{aside}</MemoryRouter>
    </QueryClientProvider>,
  )
}

test('a running download is reported on the library page', async () => {
  renderAt('/')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Downloading/i))
})

test('a running download is reported on the upload page', async () => {
  renderAt('/upload')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Downloading/i))
})

test('a running download is reported on the search page', async () => {
  renderAt('/search')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Downloading/i))
})

test('the reader is left alone', async () => {
  renderAt('/read/1')
  await new Promise((r) => setTimeout(r, 250))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('starting a download puts it on the bar straight away', async () => {
  let running = false
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/downloads') && init?.method === 'POST') {
      running = true
      return { ok: true, json: async () => ({ queued: true }) }
    }
    if (u.includes('/api/downloads')) {
      return { ok: true, json: async () => (running ? RUNNING : { active: [], queue: [], history: [] }) }
    }
    return { ok: true, json: async () => ({ editions: [] }) }
  }) as unknown as typeof fetch

  renderAt('/upload')
  fireEvent.change(await screen.findByPlaceholderText(/paste a link/i), {
    target: { value: 'https://x.test/dls/tok' },
  })
  fireEvent.click(screen.getByRole('button', { name: /^download$/i }))

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Downloading/i))
})

// --- the header tabs ------------------------------------------------------

// Library and Latest releases are peers, not a brand and a link: the two things you
// browse, side by side, with the one you are on marked.
test('the header offers Library and Latest releases as tabs', async () => {
  renderAt('/')
  expect(await screen.findByRole('link', { name: 'Library' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('link', { name: 'Latest releases' })).toHaveAttribute('href', '/releases')
})

test('the library tab is marked when you are on the library', async () => {
  renderAt('/')
  expect(await screen.findByRole('link', { name: 'Library', current: 'page' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Latest releases' })).not.toHaveAttribute('aria-current')
})

test('the latest releases tab is marked when you are on it', async () => {
  renderAt('/releases')
  expect(await screen.findByRole('link', { name: 'Latest releases', current: 'page' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Library' })).not.toHaveAttribute('aria-current')
})

// The queue page used to be reachable only from the download bar, which appears only
// while something is downloading - so you could not change a setting there until you had
// already started the thing the setting governs.
test('the header links to downloads without waiting for one to start', async () => {
  renderAt('/')
  const link = await screen.findByRole('link', { name: 'Downloads' })
  expect(link).toHaveAttribute('href', '/downloads')
})

test('the header links to settings', async () => {
  renderAt('/')
  const link = await screen.findByRole('link', { name: 'Settings' })
  expect(link).toHaveAttribute('href', '/settings')
})

// It is a utility beside Get comics, not one of the two things you browse, so it never
// takes the tab underline even when you are on it.
test('the downloads link is not one of the tabs', async () => {
  renderAt('/downloads')
  await screen.findByRole('link', { name: 'Downloads' })
  expect(screen.queryByRole('link', { current: 'page' })).toBeNull()
})

// Same reasoning as Downloads: a utility link beside Get comics, not one of the two things
// you browse, so it never takes the tab underline even when you are on it.
test('the settings link is not one of the tabs', async () => {
  renderAt('/settings')
  await screen.findByRole('link', { name: 'Settings' })
  expect(screen.queryByRole('link', { current: 'page' })).toBeNull()
})

// A page that is neither marks neither, rather than leaving the library lit while you
// are somewhere else entirely.
test('neither tab is marked on a page that is neither', async () => {
  renderAt('/upload')
  await screen.findByRole('link', { name: 'Library' })
  expect(screen.queryByRole('link', { current: 'page' })).toBeNull()
})

// --- the header search ----------------------------------------------------

const where = () => screen.getByTestId('where').textContent
const searchBox = async () => screen.findByRole('searchbox', { name: 'Search your library' })

// There are two searches now: this one looks at the comics you own, and Get comics looks
// outward at what could be downloaded. The box is the first; the link is the second.
test('the header searches the library you have', async () => {
  renderAt('/')
  fireEvent.change(await searchBox(), { target: { value: 'venom' } })
  fireEvent.submit(screen.getByRole('search'))
  expect(where()).toBe('/library/search?q=venom')
})

test('the link to the download search says Get comics', async () => {
  renderAt('/')
  expect(await screen.findByRole('link', { name: 'Get comics' })).toBeInTheDocument()
  // The old label is gone, not merely joined by a new one: two links called Search
  // would be the very ambiguity this rename exists to end.
  expect(screen.queryByRole('link', { name: 'Search' })).toBeNull()
})

// The Find buttons on the edition and releases pages build /search?q=...&yearFrom=... urls.
// The label moved; the route did not.
test('Get comics still points at /search', async () => {
  renderAt('/')
  expect(await screen.findByRole('link', { name: 'Get comics' })).toHaveAttribute('href', '/search')
})

test('an empty box submits nothing', async () => {
  renderAt('/releases')
  const box = await searchBox()
  fireEvent.submit(screen.getByRole('search'))
  expect(where()).toBe('/releases')
  // Spaces are not a question either; they would search for everything or for nothing.
  fireEvent.change(box, { target: { value: '   ' } })
  fireEvent.submit(screen.getByRole('search'))
  expect(where()).toBe('/releases')
})

// Clearing the box on the results page means "clear this search". The native cancel button
// of a type=search input empties the text and fires no submit, so the change itself clears.
test('emptying the box on the results page returns to the library', async () => {
  renderAt('/library/search?q=venom')
  fireEvent.change(await searchBox(), { target: { value: '' } })
  expect(where()).toBe('/')
})

test('a blank submit on the results page returns to the library', async () => {
  renderAt('/library/search?q=venom')
  fireEvent.change(await searchBox(), { target: { value: '   ' } })
  // Spaces are mid-edit, not a clear: someone typing a leading space is not sent away.
  expect(where()).toBe('/library/search?q=venom')
  fireEvent.submit(screen.getByRole('search'))
  expect(where()).toBe('/')
})

test('emptying the box off the results page goes nowhere', async () => {
  renderAt('/releases')
  const box = await searchBox()
  fireEvent.change(box, { target: { value: 'venom' } })
  fireEvent.change(box, { target: { value: '' } })
  expect(where()).toBe('/releases')
})

test('the spaces around a search are not part of it', async () => {
  renderAt('/')
  fireEvent.change(await searchBox(), { target: { value: '  venom  ' } })
  fireEvent.submit(screen.getByRole('search'))
  expect(where()).toBe('/library/search?q=venom')
})

// Typed into a url unescaped, the ampersand would end the query and "Venom" would be read
// as a parameter of its own.
test('a search carrying url characters reaches the results page whole', async () => {
  renderAt('/')
  fireEvent.change(await searchBox(), { target: { value: 'Spider-Man & Venom' } })
  fireEvent.submit(screen.getByRole('search'))
  expect(where()).toBe('/library/search?q=Spider-Man%20%26%20Venom')
})

// The results page has no box of its own, so the header's is the only place to refine a
// search; if it came up empty you would retype the whole query to change a word.
test('the box shows what the results page is for', async () => {
  renderAt('/library/search?q=venom')
  expect(await searchBox()).toHaveValue('venom')
})

test('searching again replaces the query in the box and in the url', async () => {
  renderAt('/library/search?q=venom')
  const box = await searchBox()
  fireEvent.change(box, { target: { value: 'knull' } })
  fireEvent.submit(screen.getByRole('search'))
  expect(where()).toBe('/library/search?q=knull')
  expect(box).toHaveValue('knull')
})

// A search is a question about the whole library, so the filters from the last one are not
// carried over; the results page says the same of the shelf you came from.
// Back changes the query without anyone typing in the box. Were the box to keep what it
// last held, it would say "knull" over a page of venom results.
test('the box follows the url when you go back to an earlier search', async () => {
  function Back() {
    const navigate = useNavigate()
    return <button onClick={() => navigate(-1)}>Back</button>
  }
  renderAt('/library/search?q=venom', <Back />)
  const box = await searchBox()
  fireEvent.change(box, { target: { value: 'knull' } })
  fireEvent.submit(screen.getByRole('search'))
  expect(box).toHaveValue('knull')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(where()).toBe('/library/search?q=venom')
  expect(box).toHaveValue('venom')
})

test('a new search does not keep the filters of the last one', async () => {
  renderAt('/library/search?q=venom&status=unread&publisher=marvel')
  fireEvent.change(await searchBox(), { target: { value: 'knull' } })
  fireEvent.submit(screen.getByRole('search'))
  expect(where()).toBe('/library/search?q=knull')
})

test('the box is empty on a page that is not the results', async () => {
  renderAt('/upload')
  expect(await searchBox()).toHaveValue('')
})

// The box is a form, not a link, and not one of the two things you browse: it takes no
// tab underline on the page it leads to.
test('the search box is not one of the tabs', async () => {
  renderAt('/library/search?q=venom')
  await searchBox()
  expect(screen.queryByRole('link', { current: 'page' })).toBeNull()
})
