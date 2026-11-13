import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ReadingList from '../src/pages/ReadingList'
import { phaseIssues, phasesIn, tally } from '../src/lib/readingList'
import type { ApiListPhase } from '../src/api'

// The list as the page receives it: whole, in Full, every tie-in marked, every phase as
// sections. Core reads Avengers #1, #2, #3, #4; Full puts Mighty Avengers #1 after #1, a
// phase of nothing but a tie-in before #3, and a Journal between #3 and #4 - the finale,
// which the guide splits into two sections. You have read #1 and hold #2, so #2 is next.
const one = (issues: unknown[]) => [{ name: null, note: null, issues }]
const LIST = {
  list: {
    id: 7, slug: 'test-list', name: 'Test List', publisher: 'Marvel', years: '2013',
    description: 'A story across two series.', cover: null,
  },
  length: 'core',
  hasExtras: true,
  next: { core: 102, full: 901 },
  phases: [
    {
      name: 'One', note: 'Where it starts.', sections: one([
        { id: 101, number: '1', volumeName: 'Avengers', owned: true, bookId: 11, readState: 'read', percent: 100, extra: false },
        { id: 901, number: '1', volumeName: 'Mighty Avengers', owned: false, match: null, extra: true },
        { id: 102, number: '2', volumeName: 'Avengers', owned: true, bookId: 12, readState: 'unread', percent: 0, extra: false },
      ]),
    },
    {
      name: 'Tie-ins only', note: null, sections: one([
        { id: 902, number: '1', volumeName: 'Infinity: The Hunt', coverDate: '2013-12-01', owned: false,
          match: { indexId: 5, title: 'Infinity: The Hunt #1 (2013)' }, extra: true },
      ]),
    },
    {
      name: 'Two', note: 'The finale.', sections: [
        { name: 'Last Days', note: 'The end begins.', issues: [
          { id: 103, number: '3', volumeName: 'Avengers', owned: false, match: null, extra: false },
          { id: 903, number: '1', volumeName: 'Secret Wars Journal', owned: false, match: null, extra: true },
        ] },
        { name: 'Battleworld', note: null, issues: [
          { id: 104, number: '4', volumeName: 'Avengers', owned: false, match: null, extra: false },
        ] },
      ],
    },
  ],
}

let sent: Array<{ method: string; url: string; body: unknown }> = []

function stub(served: Omit<typeof LIST, 'next'> & { next: { core: number | null; full: number | null } } = LIST) {
  sent = []
  // The server keeps the length, so the page's re-read after a switch comes back switched.
  let list = served
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (init?.method && init.method !== 'GET') {
      sent.push({ method: init.method, url: u, body: init.body ? JSON.parse(init.body) : undefined })
      if (init.method === 'PUT') {
        list = { ...list, length: JSON.parse(init.body!).length }
        return { ok: true, json: async () => JSON.parse(init.body!) }
      }
      return { ok: true, json: async () => ({ queued: true }) }
    }
    if (u.includes('/api/downloads')) return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    // The rail beside every library page; not what these tests are about.
    if (u.includes('/api/publishers')) return { ok: true, json: async () => ({ publishers: [] }) }
    if (u.includes('/api/editions')) return { ok: true, json: async () => ({ editions: [] }) }
    if (u.includes('/api/read-states')) return { ok: true, json: async () => ({ readStates: [] }) }
    if (u.endsWith('/api/arcs')) return { ok: true, json: async () => ({ arcs: [] }) }
    if (u.endsWith('/api/lists')) return { ok: true, json: async () => ({ lists: [] }) }
    if (u.endsWith('/api/follows')) return { ok: true, json: async () => ({ follows: [] }) }
    return { ok: true, json: async () => list }
  }) as unknown as typeof fetch
}

beforeEach(() => stub())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/lists/test-list']}>
        <Routes><Route path="/lists/:slug" element={<ReadingList />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const bar = (name: string | RegExp) => screen.getByRole('button', { name })

test('Core draws the story and leaves the tie-ins out, phases and all', async () => {
  draw()
  expect(await screen.findByRole('heading', { name: 'Test List' })).toBeInTheDocument()
  expect(screen.getByText('Marvel · 2013 · 2 of 4 in your library · 1 read')).toBeInTheDocument()
  expect(bar(/^One/)).toBeInTheDocument()
  expect(bar(/^Two/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Tie-ins only/ })).not.toBeInTheDocument()
  expect(screen.queryByText('Mighty Avengers #1')).not.toBeInTheDocument()
})

test("the phase holding the next issue is open and says you're here; the rest are folded", async () => {
  draw()
  const one = await screen.findByRole('button', { name: /^One/ })
  expect(one).toHaveAttribute('aria-expanded', 'true')
  expect(within(one).getByText("You're here")).toBeInTheDocument()
  expect(screen.getByText('Where it starts.')).toBeInTheDocument()
  expect(bar(/^Two/)).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Avengers #3')).not.toBeInTheDocument()
})

test('a folded phase opens when its bar is pressed, and folds again', async () => {
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /^Two/ }))
  expect(await screen.findByText('Avengers #3')).toBeInTheDocument()
  fireEvent.click(bar(/^Two/))
  expect(screen.queryByText('Avengers #3')).not.toBeInTheDocument()
})

test('a bar says how much of its phase you have read', async () => {
  draw()
  const one = await screen.findByRole('button', { name: /^One/ })
  expect(within(one).getByText('2 issues')).toBeInTheDocument()
  expect(within(one).getByText('1 read')).toBeInTheDocument()
})

test('Continue opens the next issue in the reader when you have it', async () => {
  draw()
  expect(await screen.findByRole('link', { name: 'Continue · Avengers #2' })).toHaveAttribute('href', '/read/12')
})

// Full is drawn at once from what is already here; the save is for Follow and the issue page.
test('switching to Full draws the tie-ins, marked, and saves the choice', async () => {
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /^Full/ }))

  expect(await screen.findByRole('button', { name: /^Tie-ins only/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Full/ })).toHaveAttribute('aria-pressed', 'true')
  const tieIn = screen.getByText('Mighty Avengers #1').closest('.list-issue')!
  expect(within(tieIn as HTMLElement).getByText('Tie-in')).toBeInTheDocument()
  expect(screen.getByText('Marvel · 2013 · 2 of 7 in your library · 1 read')).toBeInTheDocument()
  await waitFor(() => expect(sent).toContainEqual({
    method: 'PUT', url: '/api/lists/test-list/length', body: { length: 'full' },
  }))
})

// In Full the next issue is the tie-in, which you do not have: there is nothing to open.
test('Continue is not offered when the next issue is a gap', async () => {
  stub({ ...LIST, length: 'full' })
  draw()
  await screen.findByRole('heading', { name: 'Test List' })
  expect(screen.queryByRole('link', { name: /^Continue/ })).not.toBeInTheDocument()
})

test('a gap in the list is filled from the list', async () => {
  stub({ ...LIST, length: 'full' })
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /^Tie-ins only/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Get Infinity: The Hunt #1' }))
  await waitFor(() => expect(sent).toContainEqual({
    method: 'POST', url: '/api/lists/issues/902/download', body: undefined,
  }))
})

test('a list with no tie-ins has no switch', async () => {
  stub({ ...LIST, hasExtras: false })
  draw()
  await screen.findByRole('heading', { name: 'Test List' })
  expect(screen.queryByRole('group', { name: 'Length' })).not.toBeInTheDocument()
})

test('a list read to the end has no next issue and nothing open', async () => {
  stub({ ...LIST, next: { core: null, full: null } })
  draw()
  await screen.findByRole('heading', { name: 'Test List' })
  expect(screen.queryByText("You're here")).not.toBeInTheDocument()
  expect(bar(/^One/)).toHaveAttribute('aria-expanded', 'false')
})

// The finale's core is one issue per section; as sections in Core it would be a heading
// over every issue, so Core reads the phase as one run.
test('Core reads a phase the guide splits as one run, with no section headings', async () => {
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /^Two/ }))
  expect(await screen.findByText('Avengers #4')).toBeInTheDocument()
  expect(screen.getByText('The finale.')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Last Days' })).not.toBeInTheDocument()
  expect(screen.queryByText('Secret Wars Journal #1')).not.toBeInTheDocument()
})

test('Full heads each section of a split phase, with its note', async () => {
  stub({ ...LIST, length: 'full' })
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /^Two/ }))
  expect(await screen.findByRole('heading', { name: 'Last Days' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Battleworld' })).toBeInTheDocument()
  expect(screen.getByText('The end begins.')).toBeInTheDocument()
  expect(screen.getByText('Secret Wars Journal #1')).toBeInTheDocument()
})

// A phase the guide does not split is one section with no name, and draws no heading.
test('an unsplit phase has no section heading in Full', async () => {
  stub({ ...LIST, length: 'full' })
  draw()
  await screen.findByRole('heading', { name: 'Test List' })
  expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Test List'])
})

/* ── the helpers the page reads ──────────────────────────────────────────── */

test('phasesIn drops tie-ins, and emptied phases, only in Core', () => {
  const phases = LIST.phases as unknown as ApiListPhase[]
  expect(phasesIn(phases, 'full')).toBe(phases)
  expect(phasesIn(phases, 'core').map((p) => [p.name, phaseIssues(p).map((i) => i.id)]))
    .toEqual([['One', [101, 102]], ['Two', [103, 104]]])
})

test('tally counts what you hold and what you have read', () => {
  const issues = (LIST.phases as unknown as ApiListPhase[]).flatMap(phaseIssues)
  expect(tally(issues)).toEqual({ total: 7, owned: 2, read: 1 })
})
