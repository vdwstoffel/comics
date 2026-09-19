import { test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import VolumeGroupTile from '../src/components/VolumeGroupTile'
import type { VolumeGroup } from '../src/lib/volumeGroups'
import type { ApiLibraryBook } from '../src/api'

const book = (id: number): ApiLibraryBook => ({
  id, editionId: 9, editionName: 'Venom (2025)', title: `Secret ${id}`, number: String(254 + id),
  pageCount: 20, comicinfoSynced: false, readState: 'unread', percent: 0,
})

const group = (unread: number): VolumeGroup => ({
  editionId: 9,
  editionName: 'Venom (2025)',
  books: Array.from({ length: unread }, (_, i) => book(i + 1)),
})

afterEach(() => { cleanup() })

function renderTile(unread: number) {
  const { container } = render(<MemoryRouter><VolumeGroupTile group={group(unread)} /></MemoryRouter>)
  return {
    plates: () => container.querySelectorAll('.volume-tile__plate'),
    cover: () => container.querySelector('.volume-tile__cover img'),
  }
}

test('a volume with one unread comic is drawn as a single cover', () => {
  expect(renderTile(1).plates()).toHaveLength(0)
})

test('a volume you are a few issues behind on is drawn as a stack', () => {
  expect(renderTile(3).plates()).toHaveLength(1)
})

test('the stack thickens with the backlog', () => {
  expect(renderTile(6).plates()).toHaveLength(2)
  expect(renderTile(12).plates()).toHaveLength(3)
})

// The stack is a drawing, and a screen reader reading the same name four times would be
// the tile saying the same thing four times.
test('the cards behind the cover are not announced, and are not a second way in', () => {
  const { plates } = renderTile(12)
  for (const plate of plates()) {
    expect(plate).toHaveAttribute('aria-hidden', 'true')
    expect(plate.tagName).toBe('SPAN')
  }
  // The volume's name is the other link on the tile; the deck adds no more.
  expect(screen.getAllByRole('link')).toHaveLength(2)
})

// The whole premise of dropping the dialog: the comic you would pick is the one at the
// front, so the cover goes straight to it. The server sorts by issue number and the
// grouping keeps that order, so the first book is the lowest-numbered unread one.
test('the cover opens the comic you would read next', () => {
  renderTile(12)
  expect(screen.getByRole('link', { name: 'Venom (2025) #255' })).toHaveAttribute('href', '/book/1')
})

// A title spoils as readily as a cover does — it is why the dialog blurred and renamed
// what it hid — so the link is named by the issue's number and never by its title.
test('the comic behind the cover is named by its number, not its title', () => {
  renderTile(12)
  expect(screen.queryByRole('link', { name: /Secret/ })).toBeNull()
})

test('a volume is still a way through to the whole unread run', () => {
  renderTile(12)
  expect(screen.getByRole('link', { name: 'Venom (2025)' })).toHaveAttribute('href', '/edition/9?status=unread')
})

// An unmatched comic has no number to be called by, and falling back to the volume's name
// would put two links with the same name on one tile, going to different places.
test('a comic with no issue number is still named apart from the volume link', () => {
  const untagged: VolumeGroup = {
    editionId: 4,
    editionName: 'Knull (2026)',
    books: [{ ...book(1), number: null, title: null }],
  }
  render(<MemoryRouter><VolumeGroupTile group={untagged} /></MemoryRouter>)

  expect(screen.getByRole('link', { name: 'Knull (2026), next unread' })).toHaveAttribute('href', '/book/1')
  expect(screen.getByRole('link', { name: 'Knull (2026)' })).toHaveAttribute('href', '/edition/4?status=unread')
})

// The cover has to picture the comic the tile opens. A volume's own thumbnail is its
// lowest-numbered issue overall - #1, read years ago on a run you are caught up to the
// middle of - so an unread shelf drawn from it is a wall of covers you have already seen,
// none of them the comic underneath.
test('the cover is the comic you would read next, not the volume\'s first issue', () => {
  expect(renderTile(12).cover()).toHaveAttribute('src', '/api/books/1/thumbnail')
})
