import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SeriesGroupTile from '../src/components/SeriesGroupTile'
import type { SeriesGroup } from '../src/lib/volumeGroups'
import type { ApiLibraryBook } from '../src/api'

const book = (id: number, editionId: number, editionName: string): ApiLibraryBook => ({
  id, editionId, editionName, seriesName: 'Batman', arcs: [], title: `Secret ${id}`,
  number: String(id), pageCount: 20, comicinfoSynced: false, readState: 'unread', percent: 0,
})

const volume = (editionId: number, editionName: string, unread: number, from = 1) => ({
  editionId,
  editionName,
  books: Array.from({ length: unread }, (_, i) => book(from + i, editionId, editionName)),
})

// Three runs of Batman, of different sizes so a tile reporting the wrong one is visible.
const batman: SeriesGroup = {
  key: 'batman',
  name: 'Batman',
  volumes: [volume(6, 'Batman (2012)', 10, 1), volume(7, 'Batman (2016)', 1, 11), volume(8, 'Batman (2025)', 9, 12)],
}

const knull: SeriesGroup = {
  key: 'knull (2026)',
  name: 'Knull (2026)',
  volumes: [volume(4, 'Knull (2026)', 2, 30)],
}

afterEach(() => { cleanup() })

function renderTile(group: SeriesGroup, open = false) {
  const onToggle = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <MemoryRouter>
      <div data-testid="elsewhere">the rest of the shelf</div>
      <SeriesGroupTile group={group} open={open} onToggle={onToggle} onClose={onClose} />
    </MemoryRouter>,
  )
  return { ...view, onToggle, onClose }
}

test('a series with several volumes is one tile, named by the series', () => {
  renderTile(batman)

  expect(screen.getByText('Batman')).toBeInTheDocument()
  expect(screen.queryByText('Batman (2012)')).not.toBeInTheDocument()
})

test('the tile says how many volumes it stands for and how many comics are behind it', () => {
  renderTile(batman)
  expect(screen.getByText('3 volumes · 20 unread')).toBeInTheDocument()
})

test('clicking the tile asks the shelf to open it', () => {
  const { onToggle } = renderTile(batman)
  fireEvent.click(screen.getByRole('button', { name: /Batman/ }))
  expect(onToggle).toHaveBeenCalled()
})

test('an open tile shows a tile per volume', () => {
  renderTile(batman, true)

  for (const name of ['Batman (2012)', 'Batman (2016)', 'Batman (2025)']) {
    expect(screen.getByRole('link', { name })).toBeInTheDocument()
  }
})

// Each volume keeps the behaviour it had when it was a shelf tile of its own: the cover
// goes straight to the comic at the front of that run.
test('a volume in the panel still opens its own next comic', () => {
  renderTile(batman, true)

  expect(screen.getByRole('link', { name: 'Batman (2012) #1' })).toHaveAttribute('href', '/book/1')
  expect(screen.getByRole('link', { name: 'Batman (2025) #12' })).toHaveAttribute('href', '/book/12')
})

// The point of floating the panel: the shelf behind it does not move. The tile keeps its
// cell and its cover while the volumes are on screen, so nothing below is pushed down.
test('the tile keeps its place on the shelf while it is open', () => {
  const { container } = renderTile(batman, true)

  expect(container.querySelector('.series-tile__head img')).toHaveAttribute('src', '/api/books/1/thumbnail')
  expect(container.querySelector('.series-tile__panel')).toBeInTheDocument()
})

test('clicking away closes the panel', () => {
  const { onClose } = renderTile(batman, true)
  fireEvent.mouseDown(screen.getByTestId('elsewhere'))
  expect(onClose).toHaveBeenCalled()
})

// Reaching for a volume is not reaching away from the panel.
test('clicking inside the panel leaves it open', () => {
  const { onClose } = renderTile(batman, true)
  fireEvent.mouseDown(screen.getByRole('link', { name: 'Batman (2012)' }))
  expect(onClose).not.toHaveBeenCalled()
})

test('Escape closes the panel', () => {
  const { onClose } = renderTile(batman, true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

// A tile nobody opened has no business listening for clicks elsewhere on the page.
test('a closed tile does not answer clicks elsewhere', () => {
  const { onClose } = renderTile(batman)
  fireEvent.mouseDown(screen.getByTestId('elsewhere'))
  expect(onClose).not.toHaveBeenCalled()
})

test('the tile tells a screen reader whether it is open', () => {
  const { rerender } = renderTile(batman)
  expect(screen.getByRole('button', { name: /Batman/ })).toHaveAttribute('aria-expanded', 'false')

  rerender(
    <MemoryRouter>
      <SeriesGroupTile group={batman} open onToggle={() => {}} onClose={() => {}} />
    </MemoryRouter>,
  )
  expect(screen.getByRole('button', { name: /Batman/ })).toHaveAttribute('aria-expanded', 'true')
})

// With three parallel runs there is no single comic that is "next", so the cover opens the
// panel rather than guessing at one. It still pictures a comic you have not read — the
// front of the first run — because the series' own thumbnail is an issue you finished
// long ago.
test('the cover is the front of the first run, and it opens the panel rather than a comic', () => {
  const { container } = renderTile(batman)

  expect(container.querySelector('img')).toHaveAttribute('src', '/api/books/1/thumbnail')
  expect(screen.queryByRole('link')).toBeNull()
})

test('the backlog behind the whole series is drawn as a stack', () => {
  const { container } = renderTile(batman)
  expect(container.querySelectorAll('.volume-tile__plate')).toHaveLength(3)
})

// A series holding one volume has nothing to open: the panel would buy the reader a second
// tile identical to the first.
test('a series with a single volume is drawn as that volume', () => {
  renderTile(knull)

  expect(screen.getByRole('link', { name: 'Knull (2026)' })).toHaveAttribute('href', '/edition/4?status=unread')
  expect(screen.getByText('2 unread')).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})
