import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

function stub(body: unknown) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch
}

beforeEach(() => stub(RELEASES))

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/releases']}>
        <Routes><Route path="/releases" element={<Releases />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('the page names the day it is showing', async () => {
  draw()
  expect(await screen.findByRole('heading', { name: /Latest releases/i })).toBeInTheDocument()
  expect(await screen.findByText(/9 September 2026/)).toBeInTheDocument()
})

test('both publishers get their own section', async () => {
  draw()
  expect(await screen.findByRole('heading', { name: 'Marvel' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'DC Comics' })).toBeInTheDocument()
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
  draw()
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
  draw()
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
