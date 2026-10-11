import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import OtherVolumes from '../src/components/OtherVolumes'
import type { CvVolumeMatch } from '../src/api'

const SERIES = 'The Amazing Spider-Man'
const KEY = ['cv-volumes', SERIES]

const V1963: CvVolumeMatch = {
  id: 2127, name: 'The Amazing Spider-Man', startYear: 1963, publisher: 'Marvel', issueCount: 651,
  siteUrl: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-2127/',
  thumbnail: 'https://comicvine.gamespot.com/a/uploads/scale_avatar/0/4/42-asm1.jpg',
}
const V2025: CvVolumeMatch = {
  id: 163325, name: 'The Amazing Spider-Man', startYear: 2025, publisher: 'Marvel', issueCount: 36,
  siteUrl: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-163325/',
}

afterEach(() => { cleanup() })

/**
 * Renders with the answer already in hand, so what is on the page is settled before the
 * first assertion - an absence asserted against a request still in flight proves nothing.
 */
function renderWith(volumes: CvVolumeMatch[], owned: number[] = [], stale = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(KEY, { volumes, fetchedAt: '2026-10-11T12:00:00.000Z', stale })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><OtherVolumes series={SERIES} ownedVolumeIds={owned} /></MemoryRouter>
    </QueryClientProvider>,
  )
  return qc
}

/** Renders against a live fetch and waits for the query to settle, however it settles. */
async function renderAwaiting(fetchImpl: typeof fetch, owned: number[] = []) {
  globalThis.fetch = fetchImpl
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><OtherVolumes series={SERIES} ownedVolumeIds={owned} /></MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(qc.getQueryState(KEY)?.status).not.toBe('pending'))
  return qc
}

test('names a volume by its title', () => {
  renderWith([V1963])
  expect(screen.getByText('The Amazing Spider-Man')).toBeInTheDocument()
})

test('shows the year a volume started, apart from its title', () => {
  renderWith([V1963])
  expect(screen.getByText('1963')).toBeInTheDocument()
})

test('a volume links out to Comic Vine in a new tab', () => {
  renderWith([V1963])
  const row = screen.getByText('The Amazing Spider-Man').closest('a')
  expect(row).toHaveAttribute('href', V1963.siteUrl)
  expect(row).toHaveAttribute('target', '_blank')
})

// Six volumes of one title differ by year and nothing else, so the years are the
// column you read down. Newest first: what is nearest what you are reading now.
test('orders the volumes newest year first', () => {
  renderWith([
    { ...V1963, id: 1 },
    { ...V1963, id: 2, startYear: 2022 },
    { ...V1963, id: 3, startYear: 1999 },
  ])
  const years = screen.getAllByTestId('other-volume-year').map((el) => el.textContent)
  expect(years).toEqual(['2022', '1999', '1963'])
})

// Comic Vine does not always have one, and there is nowhere honest to put it in a
// run of years.
test('a volume with no start year sorts last and shows no year', () => {
  renderWith([
    { ...V1963, id: 1, startYear: undefined },
    { ...V1963, id: 2, startYear: 1999 },
  ])
  const years = screen.getAllByTestId('other-volume-year').map((el) => el.textContent)
  expect(years).toEqual(['1999', ''])
})

test('a volume names its publisher and issue count', () => {
  renderWith([V1963])
  expect(screen.getByText('Marvel · 651 issues')).toBeInTheDocument()
})

test('a one-issue volume is counted in the singular', () => {
  renderWith([{ ...V1963, issueCount: 1 }])
  expect(screen.getByText('Marvel · 1 issue')).toBeInTheDocument()
})

// Volumes come back missing either field often enough that a lone separator would show.
test('a volume with no publisher or count carries no facts line', () => {
  renderWith([{ id: 99, name: 'Spider-Man', startYear: 1990, siteUrl: 'https://example.test/' }])
  expect(screen.getByText('Spider-Man')).toBeInTheDocument()
  expect(screen.queryByText(/·/)).not.toBeInTheDocument()
})

// The point of the shelf is what is missing. A volume on the page above is not.
test('a volume the library already has is not offered again', () => {
  renderWith([V1963, V2025], [163325])
  expect(screen.getByText('1963')).toBeInTheDocument()
  expect(screen.queryByText('2025')).not.toBeInTheDocument()
})

test('says nothing at all when every volume is already owned', () => {
  renderWith([V2025], [163325])
  expect(screen.queryByText(/other volumes/i)).not.toBeInTheDocument()
})

test('says nothing at all when Comic Vine has nothing to add', () => {
  renderWith([])
  expect(screen.queryByText(/other volumes/i)).not.toBeInTheDocument()
})

test('an old answer says so rather than passing itself off as current', () => {
  renderWith([V1963], [], true)
  expect(screen.getByText(/Comic Vine is not answering/i)).toBeInTheDocument()
})

test('a current answer makes no excuses for itself', () => {
  renderWith([V1963])
  expect(screen.queryByText(/Comic Vine is not answering/i)).not.toBeInTheDocument()
})

// No key configured answers 400, unreachable with nothing held answers 502. The series
// page is not the place to report either.
test('says nothing at all when Comic Vine cannot be reached', async () => {
  await renderAwaiting(vi.fn(async () => ({
    ok: false, status: 502, json: async () => ({ error: 'Comic Vine did not answer' }),
  })) as unknown as typeof fetch)
  expect(screen.queryByText(/other volumes/i)).not.toBeInTheDocument()
})

test('asks Comic Vine for the series it was given', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ volumes: [V1963], fetchedAt: null, stale: false }),
  })) as unknown as typeof fetch
  await renderAwaiting(fetchMock)
  expect(fetchMock).toHaveBeenCalledWith('/api/comicvine/volumes?series=The%20Amazing%20Spider-Man', undefined)
})

test('a volume offers a way to go looking for it', () => {
  renderWith([V1963])
  const find = screen.getByRole('link', { name: /find/i })
  expect(find).toHaveAttribute('href', '/search?q=The+Amazing+Spider-Man&yearFrom=1962&yearTo=1964')
})

// Nine volumes of one title would otherwise be nine links all reading "Find".
test('each Find names the volume it would go looking for', () => {
  renderWith([V1963])
  expect(screen.getByRole('link', { name: 'Find The Amazing Spider-Man (1963)' })).toBeInTheDocument()
})

// Two destinations in one row: Find stays inside the app, the name leads out.
test('the name still leads out to Comic Vine', () => {
  renderWith([V1963])
  const out = screen.getByRole('link', { name: 'The Amazing Spider-Man' })
  expect(out).toHaveAttribute('href', V1963.siteUrl)
  expect(out).toHaveAttribute('target', '_blank')
})
