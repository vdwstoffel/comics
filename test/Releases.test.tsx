import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Releases from '../src/pages/Releases'

const RELEASES = {
  day: '2026-09-09',
  fetchedAt: '2026-09-14T12:00:00.000Z',
  publishers: [
    { name: 'Marvel', issues: [
      { id: 1192026, number: '14', volumeName: 'Black Cat', volumeId: 176900,
        coverUrl: 'https://cv/bc14.jpg', siteUrl: 'https://cv/1',
        owned: true, bookId: 79 },
      { id: 1192030, number: '27', volumeName: 'Wolverine', volumeId: 1111,
        coverUrl: 'https://cv/w27.jpg', siteUrl: 'https://cv/2',
        owned: false, match: { indexId: 5, title: 'Wolverine #27 (2026)' } },
    ] },
    { name: 'DC Comics', issues: [
      { id: 1191941, number: '1102', volumeName: 'Action Comics', volumeId: 91078,
        coverDate: '2026-11-01', storeDate: '2026-09-09',
        coverUrl: 'https://cv/ac.jpg', siteUrl: 'https://cv/3',
        owned: false, match: null },
    ] },
  ],
}

const WIKI_MARVEL = 'https://en.wikipedia.org/wiki/List_of_current_Marvel_Comics_publications'

const RUNNING = {
  publishers: [
    { name: 'Marvel', sourceUrl: WIKI_MARVEL, series: [
      { title: 'Invented Ongoing', kind: 'ongoing', issues: '#1–', pubYear: 2025, endsOn: null },
      { title: 'Invented Limited', kind: 'limited', issues: '#1–5', pubYear: 2026,
        endsOn: 'October 21, 2026' },
    ] },
    { name: 'DC Comics', sourceUrl: 'https://en.wikipedia.org/wiki/List_of_current_DC_Comics_publications',
      series: [
        { title: 'Invented Undated', kind: 'ongoing', issues: '#1–', pubYear: null, endsOn: null },
      ] },
  ],
}

function stub(body: unknown, running: unknown = RUNNING) {
  globalThis.fetch = vi.fn(async (url: string) => {
    // Releases now reads useDownload() too, to know which missing issues are queued.
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    // Before the generic branch: this path starts with /api/releases too.
    if (String(url).includes('/api/releases/running')) {
      return { ok: true, json: async () => running }
    }
    return { ok: true, json: async () => body }
  }) as unknown as typeof fetch
}

beforeEach(() => stub(RELEASES))

function draw(entry = '/releases') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes><Route path="/releases" element={<Releases />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Open the second tab. */
async function openRunning() {
  fireEvent.click(await screen.findByRole('tab', { name: /Currently running/i }))
}

/** Open one publisher's list inside the running tab. Names never collide with the
 *  outer tabs, so a plain role query reaches the right strip. */
async function openPublisher(name: string) {
  fireEvent.click(await screen.findByRole('tab', { name }))
}

test('the page names the day it is showing', async () => {
  draw()
  expect(await screen.findByRole('heading', { name: /Latest releases/i })).toBeInTheDocument()
  expect(await screen.findByText(/9 September 2026/)).toBeInTheDocument()
})

test("this week gets a tab per publisher, opening on Marvel", async () => {
  draw()
  expect(await screen.findByRole('tab', { name: 'Marvel' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'DC Comics' })).toHaveAttribute('aria-selected', 'false')
  // The tab carries the name now, so the heading would say it twice.
  expect(screen.queryByRole('heading', { name: 'Marvel' })).not.toBeInTheDocument()
})

test("choosing a publisher swaps this week's grid rather than adding to it", async () => {
  draw()
  await openPublisher('DC Comics')
  expect(await screen.findByText('Action Comics #1102')).toBeInTheDocument()
  expect(screen.queryByText('Black Cat #14')).not.toBeInTheDocument()
})

// One `pub` for the page: picking DC under one tab and finding yourself back on Marvel
// under the other is the kind of small re-pick that adds up.
test('the publisher choice carries across both tabs', async () => {
  draw('/releases?pub=dc')
  expect(await screen.findByText('Action Comics #1102')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Currently running/i }))
  expect(await screen.findByRole('cell', { name: 'Invented Undated' })).toBeInTheDocument()
})

test('a publisher with nothing out that week keeps its tab and says so', async () => {
  stub({ ...RELEASES, publishers: [RELEASES.publishers[0], { name: 'DC Comics', issues: [] }] })
  draw('/releases?pub=dc')
  expect(await screen.findByRole('tab', { name: 'DC Comics' })).toHaveAttribute('aria-selected', 'true')
  expect(await screen.findByText(/nothing from DC Comics/i)).toBeInTheDocument()
})

test('an issue is labelled with its series and number', async () => {
  draw()
  expect(await screen.findByText('Black Cat #14')).toBeInTheDocument()
})

test('an issue you own links into your library', async () => {
  draw()
  const link = await screen.findByRole('link', { name: /Black Cat #14/ })
  expect(link).toHaveAttribute('href', '/book/79')
})

// This page is a shop window, and every issue on it is one you do not own. The arc
// page's spoiler rule would blank it entirely - see the exception in Releases.tsx.
test('covers are shown, including for issues you do not own', async () => {
  draw()
  const link = await screen.findByRole('link', { name: /Wolverine #27/ })
  expect(within(link).getByRole('img')).toHaveAttribute('src', 'https://cv/w27.jpg')
})

test('a matched missing issue offers to get it', async () => {
  draw()
  expect(await screen.findByRole('button', { name: /Get Wolverine #27/ })).toBeInTheDocument()
})

test('an unmatched missing issue offers to find it', async () => {
  draw('/releases?pub=dc')
  expect(await screen.findByRole('link', { name: /Find Action Comics #1102/ })).toBeInTheDocument()
})

test('a day Comic Vine could not answer for says so', async () => {
  stub({ ...RELEASES, unavailable: true, publishers: [] })
  draw()
  expect(await screen.findByText(/could not reach Comic Vine/i)).toBeInTheDocument()
})

// --- Finding 6: the Find link lost the year seed the edition page's Find has. Comic
// Vine's cover date runs ahead of the scraped release year, so a floor at the cover year
// exactly filters out the very row Find is meant to surface - back it off by one, the
// same slack the matching rule tolerates.
test('the Find link seeds the year from the cover date, one year back', async () => {
  draw('/releases?pub=dc')
  const link = await screen.findByRole('link', { name: /Find Action Comics #1102/ })
  const href = link.getAttribute('href')!
  expect(href).toContain('q=Action+Comics')
  expect(new URLSearchParams(href.split('?')[1]).get('yearFrom')).toBe('2025')
})

test('an issue with no cover date gets an unseeded Find link rather than a NaN year', async () => {
  stub({
    ...RELEASES,
    publishers: [{ name: 'DC Comics', issues: [
      { id: 7, number: '1', volumeName: 'Undated', volumeId: 1, siteUrl: 'https://cv/7',
        owned: false, match: null },
    ] }],
  })
  draw()
  const link = await screen.findByRole('link', { name: /Find Undated #1/ })
  expect(link.getAttribute('href')).not.toContain('yearFrom')
})

// --- The `stale` branch had no coverage at all, and its message had to change: `stale`
// has two producers, and "Showing what we last saw" was true only for the first.

test('a day we are not confident about says so', async () => {
  stub({ ...RELEASES, stale: true })
  draw()
  expect(await screen.findByText(/may be incomplete/i)).toBeInTheDocument()
  // It must not claim to be showing the last thing we saw - this is a fresh fetch of
  // the correct day whose publisher lookup came back short.
  expect(screen.queryByText(/what we last saw/i)).not.toBeInTheDocument()
})

// The worst shape: the publisher lookup lost every Marvel and DC volume, so the page has
// the right date and zero tiles. Without the line it is a correct date above nothing,
// explaining neither.
test('a stale day with nothing to show still explains itself', async () => {
  stub({ ...RELEASES, stale: true, publishers: [] })
  draw()
  expect(await screen.findByText(/9 September 2026/)).toBeInTheDocument()
  expect(screen.getByText(/may be incomplete/i)).toBeInTheDocument()
})

// A complete day must stay quiet - the line is a warning, not furniture.
test('a complete day carries no incompleteness warning', async () => {
  draw()
  expect(await screen.findByText('Black Cat #14')).toBeInTheDocument()
  expect(screen.queryByText(/may be incomplete/i)).not.toBeInTheDocument()
})

// --- The Currently running tab: Wikipedia's list of what Marvel and DC are publishing
// now, so a new run can be picked up without leaving the app. It shares the page with
// the weekly grid but shares none of its data - in particular, none of Comic Vine.

test('the page offers both tabs and opens on this week', async () => {
  draw()
  expect(await screen.findByRole('tab', { name: /This week/i })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: /Currently running/i })).toHaveAttribute('aria-selected', 'false')
  expect(await screen.findByText('Black Cat #14')).toBeInTheDocument()
})

test('the running tab opens on Marvel and lists what it is currently publishing', async () => {
  draw()
  await openRunning()
  expect(await screen.findByRole('cell', { name: 'Invented Ongoing' })).toBeInTheDocument()
  // The weekly grid is not on screen at the same time.
  expect(screen.queryByText('Black Cat #14')).not.toBeInTheDocument()
})

test('each publisher gets its own tab, opening on Marvel', async () => {
  draw('/releases?tab=running')
  expect(await screen.findByRole('tab', { name: 'Marvel' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'DC Comics' })).toHaveAttribute('aria-selected', 'false')
})

test('choosing a publisher swaps the list rather than adding to it', async () => {
  draw('/releases?tab=running')
  await openPublisher('DC Comics')
  expect(await screen.findByRole('cell', { name: 'Invented Undated' })).toBeInTheDocument()
  expect(screen.queryByRole('cell', { name: 'Invented Ongoing' })).not.toBeInTheDocument()
})

test('the chosen publisher survives in the url alongside the tab', async () => {
  draw('/releases?tab=running&pub=dc')
  expect(await screen.findByRole('cell', { name: 'Invented Undated' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'DC Comics' })).toHaveAttribute('aria-selected', 'true')
})

test('the publisher tabs are a strip of their own, not the page tabs', async () => {
  draw('/releases?tab=running')
  const strip = await screen.findByRole('tablist', { name: /Publisher/i })
  expect(within(strip).getByRole('tab', { name: 'Marvel' })).toBeInTheDocument()
  expect(within(strip).queryByRole('tab', { name: /This week/i })).not.toBeInTheDocument()
})

test('the chosen tab survives in the url', async () => {
  draw('/releases?tab=running')
  expect(await screen.findByRole('cell', { name: 'Invented Ongoing' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Currently running/i })).toHaveAttribute('aria-selected', 'true')
})

test('a series title links into the search page, seeded with its name and year', async () => {
  draw('/releases?tab=running')
  const link = await screen.findByRole('link', { name: 'Invented Ongoing' })
  const href = link.getAttribute('href')!
  const params = new URLSearchParams(href.split('?')[1])
  expect(href.startsWith('/search?')).toBe(true)
  expect(params.get('q')).toBe('Invented Ongoing')
  // Wikipedia's Pub. Year is the real year of publication, so it seeds exactly - unlike
  // the Find links on the weekly tab, which back off a year from a Comic Vine cover date.
  expect(params.get('yearFrom')).toBe('2025')
})

test('a series with no publication year gets an unseeded link rather than a NaN year', async () => {
  draw('/releases?tab=running&pub=dc')
  const link = await screen.findByRole('link', { name: 'Invented Undated' })
  expect(link.getAttribute('href')).not.toContain('yearFrom')
})

test('ongoing and limited series get a table each, and a row lands in the right one', async () => {
  draw('/releases?tab=running')
  const ongoing = await screen.findByRole('table', { name: /Ongoing series/i })
  const limited = screen.getByRole('table', { name: /Limited series/i })

  expect(within(ongoing).getByRole('cell', { name: 'Invented Ongoing' })).toBeInTheDocument()
  expect(within(ongoing).queryByRole('cell', { name: 'Invented Limited' })).not.toBeInTheDocument()
  expect(within(limited).getByRole('cell', { name: 'Invented Limited' })).toBeInTheDocument()
})

// The heading says it once; a column would repeat it on every row.
test('no Kind column survives the split', async () => {
  draw('/releases?tab=running')
  await screen.findByRole('table', { name: /Ongoing series/i })
  expect(screen.queryByRole('columnheader', { name: /Kind/i })).not.toBeInTheDocument()
})

// DC's fixture has ongoing series and nothing else.
test('a publisher with no limited series gets no empty limited table', async () => {
  draw('/releases?tab=running&pub=dc')
  expect(await screen.findByRole('table', { name: /Ongoing series/i })).toBeInTheDocument()
  expect(screen.queryByRole('table', { name: /Limited series/i })).not.toBeInTheDocument()
})

test('both tables are credited once, not once each', async () => {
  draw('/releases?tab=running')
  await screen.findByRole('table', { name: /Ongoing series/i })
  expect(screen.getAllByRole('link', { name: /Wikipedia/i })).toHaveLength(1)
})

test('an announced final issue is shown, because it decides whether to start', async () => {
  draw('/releases?tab=running')
  const row = (await screen.findByRole('cell', { name: 'Invented Limited' })).closest('tr')!
  expect(within(row).getByText('October 21, 2026')).toBeInTheDocument()
})

test('the table credits the page it was read from', async () => {
  draw('/releases?tab=running')
  expect(await screen.findByRole('link', { name: /Wikipedia/i })).toHaveAttribute('href', WIKI_MARVEL)
})

// A failed publisher keeps its tab. Dropping the tab would leave you hunting for where
// DC went; keeping it lets the tab answer the question.
test('a publisher whose page could not be read explains itself inside its own tab', async () => {
  stub(RELEASES, { ...RUNNING, failed: ['DC Comics'],
    publishers: [RUNNING.publishers[0], { ...RUNNING.publishers[1], series: [] }] })
  draw('/releases?tab=running&pub=dc')
  expect(await screen.findByRole('tab', { name: 'DC Comics' })).toBeInTheDocument()
  expect(await screen.findByText(/could not be read|couldn't read/i)).toBeInTheDocument()
})

test('a publisher that failed does not take the working one down with it', async () => {
  stub(RELEASES, { ...RUNNING, failed: ['DC Comics'],
    publishers: [RUNNING.publishers[0], { ...RUNNING.publishers[1], series: [] }] })
  draw('/releases?tab=running')
  expect(await screen.findByRole('cell', { name: 'Invented Ongoing' })).toBeInTheDocument()
  expect(screen.queryByText(/couldn't read/i)).not.toBeInTheDocument()
})

test('the running tab does not ask Comic Vine for anything', async () => {
  draw('/releases?tab=running')
  await screen.findByRole('cell', { name: 'Invented Ongoing' })
  const urls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => String(c[0]))
  expect(urls.some((u) => u.includes('/api/releases/running'))).toBe(true)
  expect(urls.some((u) => /\/api\/releases(\?|$)/.test(u))).toBe(false)
})
