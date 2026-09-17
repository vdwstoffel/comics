import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import SearchComics from '../src/pages/SearchComics'

const CATEGORIES = {
  categories: [{ name: 'Marvel Comics', count: 20800 }, { name: 'DC Comics', count: 16312 }],
  indexed: 37112,
}

function result(id: number, title: string, category = 'DC Comics') {
  return { id, title, url: `https://x.test/${id}/`, category }
}

function group(key: string, name: string, total: number, kinds: Record<string, number> = {}) {
  return {
    key, name, total,
    kinds: { issue: total, bundle: 0, collection: 0, other: 0, ...kinds },
    runs: [],
  }
}

function grouped(groups: ReturnType<typeof group>[], totalResults?: number) {
  return {
    groups,
    totalGroups: groups.length,
    totalResults: totalResults ?? groups.reduce((n, g) => n + g.total, 0),
  }
}

const BATMAN_ROWS = { results: [result(1, 'Batman (2011) #1'), result(2, 'Batman (2016) #1')], total: 2 }

/** Open a collapsed series heading. */
async function openGroup(name: RegExp = /Batman/) {
  fireEvent.click(await screen.findByRole('button', { name }))
}

const IDLE_SCRAPE = {
  running: false, mode: null, page: 0, totalPages: 0,
  inserted: 0, updated: 0, unchanged: 0, failedPages: 0,
  error: null, startedAt: null, finishedAt: null,
}

let calls: string[]
let posted: { url: string; body: string }[]

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  calls = []
  posted = []
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(String(url))
    if (init?.method === 'POST') posted.push({ url: String(url), body: String(init.body ?? '') })
    return { ok: true, json: async () => handler(String(url), init) }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return IDLE_SCRAPE
    if (url.includes('series=')) return BATMAN_ROWS
    return grouped([group('batman', 'Batman', 2)])
  })
})
afterEach(() => { cleanup() })

function renderPage(path = '/search') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><SearchComics /></MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

function typeQuery(text: string) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } })
}

test('typing a query lists one heading per series, not every comic', async () => {
  renderPage()
  typeQuery('batman')
  expect(await screen.findByRole('button', { name: /Batman/ })).toBeInTheDocument()
  expect(screen.queryByText('Batman (2011) #1')).not.toBeInTheDocument()
})

test('opening a series lists the comics in it', async () => {
  renderPage()
  typeQuery('batman')
  await openGroup()
  expect(await screen.findByText('Batman (2011) #1')).toBeInTheDocument()
  expect(screen.getByText('Batman (2016) #1')).toBeInTheDocument()
})

test('opening a series asks only for that series', async () => {
  renderPage()
  typeQuery('batman')
  await openGroup()
  await waitFor(() => expect(calls.some((c) => c.includes('series=batman'))).toBe(true))
})

test('a series can be closed again', async () => {
  renderPage()
  typeQuery('batman')
  await openGroup()
  await screen.findByText('Batman (2011) #1')
  await openGroup()
  await waitFor(() => expect(screen.queryByText('Batman (2011) #1')).not.toBeInTheDocument())
})

test('changing the query closes whatever was open', async () => {
  renderPage()
  typeQuery('batman')
  await openGroup()
  await screen.findByText('Batman (2011) #1')
  typeQuery('batgirl')
  await waitFor(() => expect(screen.queryByText('Batman (2011) #1')).not.toBeInTheDocument())
})

test('each result links to its source page in a new tab', async () => {
  renderPage()
  typeQuery('batman')
  await openGroup()
  const link = await screen.findByRole('link', { name: /Batman \(2011\) #1/ })
  expect(link).toHaveAttribute('href', 'https://x.test/1/')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
})

test('the query is sent url-encoded to the search endpoint', async () => {
  renderPage()
  typeQuery('batman year one')
  await waitFor(() => {
    expect(calls.some((c) => c.includes('q=batman+year+one') || c.includes('q=batman%20year%20one')))
      .toBe(true)
  })
})

test('shows how many matches were found', async () => {
  renderPage()
  typeQuery('batman')
  expect(await screen.findByText(/2 matches/i)).toBeInTheDocument()
})

test('an empty query searches nothing and prompts instead', async () => {
  renderPage()
  await waitFor(() => expect(calls.some((c) => c.includes('/categories'))).toBe(true))
  expect(calls.some((c) => c.includes('/search'))).toBe(false)
  expect(screen.getByText(/type to search/i)).toBeInTheDocument()
})

test('a query with no matches says so', async () => {
  mockFetch((url) => (url.includes('/categories') ? CATEGORIES : grouped([])))
  renderPage()
  typeQuery('zzzz')
  expect(await screen.findByText(/no matches/i)).toBeInTheDocument()
})

test('choosing a category sends it as a filter', async () => {
  renderPage()
  const chip = await screen.findByRole('button', { name: /DC Comics/ })
  fireEvent.click(chip)
  typeQuery('batman')
  await waitFor(() => {
    expect(calls.some((c) => c.includes('/search') && c.includes('category=DC+Comics')
      || c.includes('/search') && c.includes('category=DC%20Comics'))).toBe(true)
  })
})

test('load more fetches the next page of series and appends them', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('offset=50')) {
      return { groups: [group('page-two', 'Series Page Two', 1)], totalGroups: 51, totalResults: 51 }
    }
    return {
      groups: Array.from({ length: 50 }, (_, i) => group(`s${i}`, `Series ${i}`, 1)),
      totalGroups: 51, totalResults: 51,
    }
  })
  renderPage()
  typeQuery('batman')
  const more = await screen.findByRole('button', { name: /load more/i })
  fireEvent.click(more)
  expect(await screen.findByText('Series Page Two')).toBeInTheDocument()
  expect(screen.getByText('Series 0')).toBeInTheDocument()
})

test('no load more button when every series is already shown', async () => {
  renderPage()
  typeQuery('batman')
  await screen.findByRole('button', { name: /Batman/ })
  expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
})

test('a row shows the padded issue number and the year alongside the title', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('series=')) {
      return { results: [{ id: 1, title: 'Spider-Man #10 (2016)', url: 'https://x.test/1/',
                           category: 'Marvel Comics', number: '010', year: 2016 }], total: 1 }
    }
    return grouped([group('spider-man', 'Spider-Man', 1)])
  })
  renderPage()
  typeQuery('spider')
  await openGroup(/Spider-Man/)
  expect(await screen.findByText('#010')).toBeInTheDocument()
  expect(screen.getByText('2016')).toBeInTheDocument()
  // the link text stays exactly as scraped
  expect(screen.getByRole('link', { name: 'Spider-Man #10 (2016)' })).toBeInTheDocument()
})

test('a row with no issue number or year renders without empty columns', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('series=')) {
      return { results: [{ id: 2, title: 'Big Omnibus', url: 'https://x.test/2/',
                           category: 'DC Comics', number: null, year: null }], total: 1 }
    }
    return grouped([group('big omnibus', 'Big Omnibus', 1, { issue: 0, collection: 1 })])
  })
  renderPage()
  typeQuery('omnibus')
  await openGroup(/Big Omnibus/)
  expect(await screen.findByRole('link', { name: 'Big Omnibus' })).toBeInTheDocument()
  expect(screen.queryByText('#null')).not.toBeInTheDocument()
  expect(screen.queryByText('#')).not.toBeInTheDocument()
})

function typeYear(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

test('year bounds are sent as yearFrom and yearTo', async () => {
  renderPage()
  typeQuery('spider-man')
  typeYear(/year from/i, '2015')
  typeYear(/year to/i, '2018')
  await waitFor(() => {
    expect(calls.some((c) => c.includes('yearFrom=2015') && c.includes('yearTo=2018'))).toBe(true)
  })
})

test('a single bound is sent on its own', async () => {
  renderPage()
  typeQuery('spider-man')
  typeYear(/year from/i, '2015')
  await waitFor(() => {
    expect(calls.some((c) => c.includes('yearFrom=2015'))).toBe(true)
  })
  expect(calls.every((c) => !c.includes('yearTo='))).toBe(true)
})

test('a partly typed year is not sent until it is four digits', async () => {
  renderPage()
  typeQuery('spider-man')
  typeYear(/year from/i, '201')
  await waitFor(() => expect(calls.some((c) => c.includes('/search'))).toBe(true))
  expect(calls.every((c) => !c.includes('yearFrom=201&') && !c.endsWith('yearFrom=201'))).toBe(true)
})

test('clear resets both year bounds', async () => {
  renderPage()
  typeQuery('spider-man')
  typeYear(/year from/i, '2015')
  typeYear(/year to/i, '2018')
  await waitFor(() => expect(calls.some((c) => c.includes('yearFrom=2015'))).toBe(true))

  fireEvent.click(screen.getByRole('button', { name: /clear years/i }))

  expect(screen.getByLabelText(/year from/i)).toHaveValue(null)
  expect(screen.getByLabelText(/year to/i)).toHaveValue(null)
})

test('the clear control only appears once a bound is set', async () => {
  renderPage()
  expect(screen.queryByRole('button', { name: /clear years/i })).not.toBeInTheDocument()
  typeYear(/year from/i, '2015')
  expect(await screen.findByRole('button', { name: /clear years/i })).toBeInTheDocument()
})

test('both scrape buttons are offered', async () => {
  renderPage()
  expect(await screen.findByRole('button', { name: /check for new/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /full scrape/i })).toBeInTheDocument()
})

test('check for new posts a quick run', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /check for new/i }))
  await waitFor(() => {
    expect(posted.some((p) => p.url.includes('/api/comic-index/scrape') && p.body.includes('quick')))
      .toBe(true)
  })
})

test('full scrape posts a full run', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /full scrape/i }))
  await waitFor(() => {
    expect(posted.some((p) => p.body.includes('full'))).toBe(true)
  })
})

test('a run in flight shows progress and disables both buttons', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return {
      ...IDLE_SCRAPE, running: true, mode: 'full', page: 12, totalPages: 133, inserted: 47, updated: 3,
    }
    return { results: [], total: 0 }
  })
  renderPage()
  expect(await screen.findByText(/page 12 of 133/i)).toBeInTheDocument()
  expect(screen.getByText(/47 new/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /check for new/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /full scrape/i })).toBeDisabled()
})

test('a finished run reports what it added', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return {
      ...IDLE_SCRAPE, mode: 'quick', page: 5, totalPages: 5, inserted: 9, updated: 2, unchanged: 40,
      startedAt: '2026-08-22T10:00:00Z', finishedAt: '2026-08-22T10:00:30Z',
    }
    return { results: [], total: 0 }
  })
  renderPage()
  expect(await screen.findByText(/9 new/i)).toBeInTheDocument()
})

test('a scrape error is surfaced', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return { ...IDLE_SCRAPE, error: 'connect ETIMEDOUT', finishedAt: 'x' }
    return { results: [], total: 0 }
  })
  renderPage()
  expect(await screen.findByText(/connect ETIMEDOUT/)).toBeInTheDocument()
})

test('results refresh once a run finishes', async () => {
  let running = true
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return { ...IDLE_SCRAPE, running, mode: 'quick', totalPages: 5 }
    return grouped([group('batman', 'Batman', 1)])
  })
  renderPage()
  typeQuery('batman')
  await waitFor(() => expect(calls.some((c) => c.includes('/search'))).toBe(true))
  const before = calls.filter((c) => c.includes('/search')).length

  running = false
  await waitFor(
    () => expect(calls.filter((c) => c.includes('/search')).length).toBeGreaterThan(before),
    { timeout: 4000 },
  )
})

test('a q in the url fills the box and searches without waiting for a keystroke', async () => {
  renderPage('/search?q=Amazing%20Spider-Man')
  expect(screen.getByRole('searchbox')).toHaveValue('Amazing Spider-Man')
  await waitFor(() =>
    expect(calls.some((c) => c.includes('q=Amazing+Spider-Man'))).toBe(true))
})

test('a yearFrom in the url fills the bound and is sent with the search', async () => {
  renderPage('/search?q=Batman&yearFrom=2011')
  expect(screen.getByLabelText(/year from/i)).toHaveValue(2011)
  await waitFor(() =>
    expect(calls.some((c) => c.includes('yearFrom=2011'))).toBe(true))
})

test('arriving with no params leaves the page empty and prompting', async () => {
  renderPage()
  expect(screen.getByRole('searchbox')).toHaveValue('')
  expect(screen.getByText(/type to search the index/i)).toBeInTheDocument()
})

// ---- sending a result straight to the upload page ----

const DLS = 'https://getcomics.org/dls/tC3kM3XUCQr:X1Em+N7z=='

function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="loc">{loc.pathname}{loc.search}</span>
}

function renderWithLocation() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/search']}>
        <SearchComics />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const downloadButtons = () => screen.getAllByRole('button', { name: /^Download$/ })

test('every result inside an open series offers a download button', async () => {
  renderWithLocation()
  typeQuery('batman')
  await openGroup()
  await screen.findByText('Batman (2011) #1')
  expect(downloadButtons()).toHaveLength(2)
})

test('downloading a result asks the server for that row\'s link', async () => {
  renderWithLocation()
  typeQuery('batman')
  await openGroup()
  await screen.findByText('Batman (2016) #1')
  fireEvent.click(downloadButtons()[1])
  await waitFor(() => expect(calls).toContain('/api/comic-index/2/download-link'))
})

test('a found link sends you to the upload page with it filled in', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return IDLE_SCRAPE
    if (url.includes('/download-link')) return { url: DLS }
    if (url.includes('series=')) return { results: [result(1, 'Batman (2011) #1')], total: 1 }
    return grouped([group('batman', 'Batman', 1)])
  })
  renderWithLocation()
  typeQuery('batman')
  await openGroup()
  await screen.findByText('Batman (2011) #1')
  fireEvent.click(downloadButtons()[0])
  await waitFor(() =>
    expect(screen.getByTestId('loc')).toHaveTextContent(`/upload?url=${encodeURIComponent(DLS)}`))
})

test('a post with no direct link says so and stays on the search page', async () => {
  calls = []
  globalThis.fetch = vi.fn(async (url: string) => {
    calls.push(String(url))
    if (String(url).includes('/download-link')) {
      // The real shape: server/routes/comicIndex.ts replies with an `error` string, not a
      // bare status - the client's 404 branch must key off the status, not this text.
      return { ok: false, status: 404, json: async () => ({ error: 'that post has no direct download link' }) }
    }
    if (String(url).includes('/categories')) return { ok: true, json: async () => CATEGORIES }
    if (String(url).includes('/scrape')) return { ok: true, json: async () => IDLE_SCRAPE }
    if (String(url).includes('series=')) {
      return { ok: true, json: async () => ({ results: [result(1, 'Batman (2011) #1')], total: 1 }) }
    }
    return { ok: true, json: async () => grouped([group('batman', 'Batman', 1)]) }
  }) as unknown as typeof fetch

  renderWithLocation()
  typeQuery('batman')
  await openGroup()
  await screen.findByText('Batman (2011) #1')
  fireEvent.click(downloadButtons()[0])

  expect(await screen.findByText(/no download link/i)).toBeInTheDocument()
  expect(screen.getByTestId('loc')).toHaveTextContent('/search')
})

// ---- splitting a big series by what kind of release each row is ----

const BIG = group('thor', 'Thor', 159, { issue: 57, bundle: 12, collection: 27, other: 63 })

function stubBig() {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return IDLE_SCRAPE
    if (url.includes('kind=collection')) return { results: [result(7, 'Astonishing Thor (TPB)')], total: 27 }
    if (url.includes('series=')) return { results: [result(1, 'Thor #1 (2018)')], total: 159 }
    return grouped([BIG], 159)
  })
}

test('a big series is broken down by kind rather than dumping every row', async () => {
  stubBig()
  renderPage()
  typeQuery('thor')
  await openGroup(/Thor/)
  expect(await screen.findByRole('button', { name: /Issues/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Collections/ })).toBeInTheDocument()
  expect(screen.queryByText('Thor #1 (2018)')).not.toBeInTheDocument()
})

test('a kind with nothing in it is not offered', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return IDLE_SCRAPE
    if (url.includes('series=')) return { results: [], total: 0 }
    return grouped([group('thor', 'Thor', 40, { issue: 40 })], 40)
  })
  renderPage()
  typeQuery('thor')
  await openGroup(/Thor/)
  await waitFor(() => expect(screen.queryByRole('button', { name: /Collections/ })).not.toBeInTheDocument())
})

test('opening a kind lists just those rows', async () => {
  stubBig()
  renderPage()
  typeQuery('thor')
  await openGroup(/Thor/)
  fireEvent.click(await screen.findByRole('button', { name: /Collections/ }))
  expect(await screen.findByText('Astonishing Thor (TPB)')).toBeInTheDocument()
  await waitFor(() => expect(calls.some((c) => c.includes('kind=collection'))).toBe(true))
})

test('a small series skips the extra layer and shows its rows', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return IDLE_SCRAPE
    if (url.includes('series=')) return { results: [result(1, 'Red Thorn #1')], total: 3 }
    return grouped([group('red thorn', 'Red Thorn', 3, { issue: 2, collection: 1 })], 3)
  })
  renderPage()
  typeQuery('thorn')
  await openGroup(/Red Thorn/)
  expect(await screen.findByText('Red Thorn #1')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Collections/ })).not.toBeInTheDocument()
})

test('the count line reports comics and series separately', async () => {
  stubBig()
  renderPage()
  typeQuery('thor')
  expect(await screen.findByText(/159 matches/i)).toBeInTheDocument()
  expect(screen.getByText(/1 series/i)).toBeInTheDocument()
})

// ---- runs standing in for the Issues heading ----

const RUNS = [
  { key: '2021_2023_1', label: '2021-2023 · #1-35', yearFrom: 2021, yearTo: 2023, first: 1, last: 35, total: 35 },
  { key: '2018_2019_1', label: '2018-2019 · #1-16', yearFrom: 2018, yearTo: 2019, first: 1, last: 16, total: 16 },
]

function stubRuns(runs = RUNS, kinds: Record<string, number> = { issue: 51, collection: 27 }) {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return IDLE_SCRAPE
    if (url.includes('run=2021_2023_1')) return { results: [result(9, 'Thor #1 (2021)')], total: 35 }
    if (url.includes('series=')) return { results: [result(1, 'Thor #1 (2018)')], total: 78 }
    return { groups: [{ key: 'thor', name: 'Thor', total: 78, kinds: { bundle: 0, other: 0, ...kinds }, runs }],
             totalGroups: 1, totalResults: 78 }
  })
}

test('a series offers its runs in place of a single Issues heading', async () => {
  stubRuns()
  renderPage()
  typeQuery('thor')
  await openGroup(/Thor/)
  expect(await screen.findByRole('button', { name: /2021-2023/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /2018-2019/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Issues/ })).not.toBeInTheDocument()
})

test('the other kinds are still listed alongside the runs', async () => {
  stubRuns()
  renderPage()
  typeQuery('thor')
  await openGroup(/Thor/)
  expect(await screen.findByRole('button', { name: /Collections/ })).toBeInTheDocument()
})

test('opening a run asks for just that run', async () => {
  stubRuns()
  renderPage()
  typeQuery('thor')
  await openGroup(/Thor/)
  fireEvent.click(await screen.findByRole('button', { name: /2021-2023/ }))
  expect(await screen.findByText('Thor #1 (2021)')).toBeInTheDocument()
  await waitFor(() => expect(calls.some((c) => c.includes('run=2021_2023_1'))).toBe(true))
})

test('a series with no trustworthy runs falls back to an Issues heading', async () => {
  stubRuns([])
  renderPage()
  typeQuery('thor')
  await openGroup(/Thor/)
  expect(await screen.findByRole('button', { name: /Issues/ })).toBeInTheDocument()
})

test('runs split a series even when every row is the same kind', async () => {
  stubRuns(RUNS, { issue: 51 })
  renderPage()
  typeQuery('thor')
  await openGroup(/Thor/)
  expect(await screen.findByRole('button', { name: /2021-2023/ })).toBeInTheDocument()
})

/* ── Comic Vine lookup ─────────────────────────────────────────────────────── */

const VOLUMES = {
  volumes: [
    {
      id: 86113, name: 'Mighty Thor', startYear: 2016, publisher: 'Marvel',
      issueCount: 30, deck: 'Jane Foster lifts the hammer.', thumbnail: 't.jpg',
      siteUrl: 'https://comicvine.gamespot.com/mighty-thor/4050-86113/',
    },
    { id: 39763, name: 'The Mighty Thor', startYear: 2011, publisher: 'Marvel', issueCount: 23 },
  ],
  fetchedAt: '2026-09-12T00:00:00.000Z',
  stale: false,
}

/** The search page, with a Comic Vine lookup answering for the Batman heading. */
function mockWithVolumes(volumes: unknown = VOLUMES) {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return IDLE_SCRAPE
    if (url.includes('/comicvine/volumes')) return volumes
    if (url.includes('series=')) return BATMAN_ROWS
    return grouped([group('batman', 'Batman', 2)])
  })
}

async function lookUp() {
  fireEvent.click(await screen.findByRole('button', { name: /Look up on Comic Vine/i }))
}

test('opening a series offers a Comic Vine lookup', async () => {
  mockWithVolumes()
  renderPage()
  typeQuery('batman')
  await openGroup()
  expect(await screen.findByRole('button', { name: /Look up on Comic Vine/i })).toBeInTheDocument()
})

test('opening a series does not reach Comic Vine until the lookup is asked for', async () => {
  mockWithVolumes()
  renderPage()
  typeQuery('batman')
  await openGroup()
  await screen.findByText('Batman (2011) #1')
  expect(calls.some((c) => c.includes('/comicvine/volumes'))).toBe(false)
})

test('the lookup asks Comic Vine for the series on the heading', async () => {
  mockWithVolumes()
  renderPage()
  typeQuery('batman')
  await openGroup()
  await lookUp()
  await waitFor(() => expect(calls.some((c) => c.includes('/comicvine/volumes?series=Batman'))).toBe(true))
})

test('each candidate names the volume, its year, publisher and issue count', async () => {
  mockWithVolumes()
  renderPage()
  typeQuery('batman')
  await openGroup()
  await lookUp()
  expect(await screen.findByText('Mighty Thor (2016)')).toBeInTheDocument()
  expect(screen.getByText(/Marvel · 30 issues/)).toBeInTheDocument()
  expect(screen.getByText('Jane Foster lifts the hammer.')).toBeInTheDocument()
})

test('a candidate links out to its Comic Vine page in a new tab', async () => {
  mockWithVolumes()
  renderPage()
  typeQuery('batman')
  await openGroup()
  await lookUp()
  const link = await screen.findByRole('link', { name: /Mighty Thor \(2016\)/ })
  expect(link).toHaveAttribute('href', 'https://comicvine.gamespot.com/mighty-thor/4050-86113/')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
})

test('a candidate with no deck still lists what it is', async () => {
  mockWithVolumes()
  renderPage()
  typeQuery('batman')
  await openGroup()
  await lookUp()
  expect(await screen.findByText('The Mighty Thor (2011)')).toBeInTheDocument()
  expect(screen.getByText(/Marvel · 23 issues/)).toBeInTheDocument()
})

test('a series Comic Vine knows nothing about says so rather than showing an empty list', async () => {
  mockWithVolumes({ volumes: [], fetchedAt: null, stale: false })
  renderPage()
  typeQuery('batman')
  await openGroup()
  await lookUp()
  expect(await screen.findByText(/Nothing on Comic Vine/i)).toBeInTheDocument()
})

test('a failed lookup reports it under the button that was clicked', async () => {
  mockFetch((url) => {
    if (url.includes('/categories')) return CATEGORIES
    if (url.includes('/scrape')) return IDLE_SCRAPE
    if (url.includes('series=')) return BATMAN_ROWS
    return grouped([group('batman', 'Batman', 2)])
  })
  const ok = globalThis.fetch as unknown as typeof fetch
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('/comicvine/volumes')) {
      calls.push(String(url))
      return { ok: false, status: 502, json: async () => ({ error: 'Comic Vine did not answer' }) }
    }
    return ok(url as never, init as never)
  }) as unknown as typeof fetch

  renderPage()
  typeQuery('batman')
  await openGroup()
  await lookUp()
  expect(await screen.findByText(/Could not reach Comic Vine/i)).toBeInTheDocument()
})
