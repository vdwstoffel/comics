import { test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ArcGroupTile from '../src/components/ArcGroupTile'
import type { ArcGroup } from '../src/lib/volumeGroups'
import type { ApiLibraryBook } from '../src/api'

const book = (id: number, editionName: string): ApiLibraryBook => ({
  id, editionId: 2, editionName, seriesName: editionName, arcs: ['Armageddon'],
  title: `Secret ${id}`, number: String(id), pageCount: 20, comicinfoSynced: false,
  readState: 'unread', percent: 0,
})

const group = (books: ApiLibraryBook[], seriesCount = 2, name = 'Armageddon'): ArcGroup =>
  ({ name, books, seriesCount })

const armageddon = group([
  book(7, 'Avengers: Armageddon (2026)'),
  book(8, 'Avengers: Armageddon (2026)'),
  book(9, 'Captain America (2025)'),
])

afterEach(() => { cleanup() })

function renderTile(arc: ArcGroup) {
  return render(<MemoryRouter><ArcGroupTile group={arc} /></MemoryRouter>)
}

// The arc page is the one place that knows the running order, including the issues you do
// not own - which is what you need when the next part is in a series you have never read.
test('an arc tile opens the arc', () => {
  renderTile(armageddon)
  expect(screen.getByRole('link', { name: /Armageddon/ })).toHaveAttribute('href', '/arcs/Armageddon')
})

test('an arc whose name needs escaping still opens', () => {
  renderTile(group([book(7, 'Batman (2012)')], 1, 'Court of Owls'))
  expect(screen.getByRole('link', { name: /Court of Owls/ })).toHaveAttribute('href', '/arcs/Court%20of%20Owls')
})

// What the arc grouping is for: the shelf says out loud that these comics are one story
// told across two series.
test('the tile says how many comics are unread and how many series they span', () => {
  renderTile(armageddon)
  expect(screen.getByText('3 unread · 2 series')).toBeInTheDocument()
})

// An arc that never leaves its own series is still an arc, but "1 series" says nothing.
test('an arc inside a single series does not count its series', () => {
  renderTile(group([book(7, 'Batman (2012)')], 1))
  expect(screen.getByText('1 unread')).toBeInTheDocument()
})

// A local thumbnail rather than Comic Vine's arc cover: the shelf must draw without a
// Comic Vine key, and without a request per tile.
test('the cover is the first unread comic in the arc', () => {
  const { container } = renderTile(armageddon)
  expect(container.querySelector('img')).toHaveAttribute('src', '/api/books/7/thumbnail')
})

test('the backlog behind the arc is drawn as a stack', () => {
  const { container } = renderTile(armageddon)
  expect(container.querySelectorAll('.volume-tile__plate')).toHaveLength(1)
})

// The tile is one way in, not two: cover and name lead to the same page.
test('the whole tile is a single way into the arc', () => {
  renderTile(armageddon)
  expect(screen.getAllByRole('link')).toHaveLength(1)
})
