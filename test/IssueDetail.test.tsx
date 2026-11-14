import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import IssueDetail from '../src/components/IssueDetail'

const CREDITS = [
  { name: 'Joe Kelly', role: 'writer' },
  { name: 'Pepe Larraz', role: 'penciller' },
  { name: 'Marte Gracia', role: 'colorist' },
]

const TAGS = [
  { kind: 'character', value: 'Spider-Man' },
  { kind: 'character', value: 'Black Cat' },
  { kind: 'team', value: 'Avengers' },
  { kind: 'story_arc', value: '8 Deaths of Spider-Man' },
]

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch
})

function draw(props: Partial<ComponentProps<typeof IssueDetail>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IssueDetail credits={CREDITS} tags={TAGS} bookId={77} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/* ── what the issue page shows, shown here too ────────────────────────────── */

test('the summary has a heading of its own', () => {
  draw({ summary: 'Peter faces the eighth day.' })
  expect(screen.getByRole('heading', { name: /summary/i })).toBeInTheDocument()
  expect(screen.getByText('Peter faces the eighth day.')).toBeInTheDocument()
})

test('the details name the edition, and link to it', () => {
  draw({ editionId: 9, editionName: 'The Amazing Spider-Man (2025)' })
  expect(screen.getByRole('link', { name: 'The Amazing Spider-Man (2025)' }))
    .toHaveAttribute('href', '/edition/9')
})

// Scoped to Details: the issue page names the writer and the penciller both here and
// under Creators, and this block is a copy of that page, duplication included.
test('the details carry the writer, the penciller and the date', () => {
  draw({ writer: 'Joe Kelly', penciller: 'Pepe Larraz', date: '2026-10' })
  const details = screen.getByRole('heading', { name: 'Details' }).parentElement!
  expect(within(details).getByText('Pepe Larraz')).toBeInTheDocument()
  expect(within(details).getByText('2026-10')).toBeInTheDocument()
})

test('groups the credits under the role each person did', () => {
  draw()
  expect(screen.getByText('Penciller')).toBeInTheDocument()
  expect(screen.getByText('Pepe Larraz')).toBeInTheDocument()
})

// Two people doing the same job is one row, not two.
test('people sharing a role share its row', () => {
  draw({ credits: [{ name: 'Joe Kelly', role: 'writer' }, { name: 'Dan Slott', role: 'writer' }] })
  expect(screen.getByText('Joe Kelly, Dan Slott')).toBeInTheDocument()
})

/* ── the tags, as things you can act on ───────────────────────────────────── */

// The whole point of a character tag is looking the character up. Plain text was a list
// of names you could do nothing with.
test('a character whose id the comic holds links straight to their page', () => {
  draw({ tags: [{ kind: 'character', value: 'Spider-Man', extId: 1443 }] })
  expect(screen.getByRole('link', { name: 'Spider-Man' })).toHaveAttribute('href', '/characters/1443')
})

// The rest are asked about once, on the click, and the page opens on the answer.
test('a character with no id yet is looked up when clicked, then opened', async () => {
  const asked: string[] = []
  globalThis.fetch = vi.fn(async (url: string) => {
    asked.push(String(url))
    return { ok: true, json: async () => ({ id: 1443, verified: true }) }
  }) as unknown as typeof fetch
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/edition/3']}>
        <Routes>
          <Route path="/edition/3" element={<IssueDetail tags={[{ kind: 'character', value: 'Spider-Man' }]} bookId={77} />} />
          <Route path="/characters/:id" element={<p>character page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Spider-Man' }))
  expect(await screen.findByText('character page')).toBeInTheDocument()
  expect(asked).toEqual(['/api/books/77/character?name=Spider-Man'])
})

test('a story arc links to the arc', () => {
  draw()
  expect(screen.getByRole('link', { name: '8 Deaths of Spider-Man' }))
    .toHaveAttribute('href', '/arcs/8%20Deaths%20of%20Spider-Man')
})

// A team is not something there is anywhere to go to, so it is a label, not a control.
test('a team is shown but is not a control', () => {
  draw()
  expect(screen.getByText('Avengers')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Avengers' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Avengers' })).toBeNull()
})

// An issue tagged with a hundred characters would otherwise bury everything under it.
test('a long cast is held behind one control', () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ kind: 'character', value: `Hero ${i}` }))
  draw({ tags: many })
  expect(screen.queryByRole('button', { name: 'Hero 44' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /show all \(45\)/i }))
  expect(screen.getByRole('button', { name: 'Hero 44' })).toBeInTheDocument()
})

test('a cast short enough to show needs no control to show it', () => {
  draw()
  expect(screen.queryByRole('button', { name: /show all/i })).toBeNull()
})

/* ── where the issue falls in a story ─────────────────────────────────────── */

test('an arc the issue has a place in says which part it is', () => {
  draw({ arcs: [{ name: 'Gang War', position: 3, total: 6 }] })
  expect(screen.getByText(/Part 3 of 6/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Gang War/ })).toHaveAttribute('href', '/arcs/Gang%20War')
})

// A tie-in can carry the tag without the arc listing it back, and Comic Vine may simply
// not have answered. The arc is still worth naming.
test('an arc with no place still names itself', () => {
  draw({ arcs: [{ name: 'Gang War' }] })
  expect(screen.getByRole('link', { name: /Gang War/ })).toBeInTheDocument()
  expect(screen.queryByText(/Part/)).toBeNull()
})

/* ── nothing known ────────────────────────────────────────────────────────── */

test('nothing known means nothing drawn', () => {
  const { container } = draw({ credits: [], tags: [], summary: null, bookId: undefined })
  expect(container).toBeEmptyDOMElement()
})

/* ── reading lists ───────────────────────────────────────────────────────── */

// The way back from a comic to the story it was read for.
test('an issue in a reading list links back to it, with its place', () => {
  draw({ readingLists: [{ slug: 'hickmans-avengers', name: "Hickman's Avengers", position: 47, total: 92 }] })
  expect(screen.getByRole('heading', { name: 'Reading list' })).toBeInTheDocument()
  const link = screen.getByRole('link', { name: /Hickman's Avengers/ })
  expect(link).toHaveAttribute('href', '/lists/hickmans-avengers')
  expect(within(link).getByText('47 of 92')).toBeInTheDocument()
})

test('a tie-in while its list reads in Core says so instead of a place', () => {
  draw({ readingLists: [{ slug: 'hickmans-avengers', name: "Hickman's Avengers", tieIn: true, total: 92 }] })
  expect(within(screen.getByRole('link', { name: /Hickman's Avengers/ })).getByText('Tie-in')).toBeInTheDocument()
})

test('an issue in two lists names both', () => {
  draw({ readingLists: [
    { slug: 'a', name: 'First', position: 1, total: 2 },
    { slug: 'b', name: 'Second', position: 2, total: 9 },
  ] })
  expect(screen.getByRole('heading', { name: 'Reading lists' })).toBeInTheDocument()
})
