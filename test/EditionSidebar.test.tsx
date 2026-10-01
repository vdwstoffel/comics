import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ComponentProps } from 'react'
import EditionSidebar from '../src/components/EditionSidebar'

const MISSING = [
  { id: 4, label: '#4' },
  { id: 9, label: '#9' },
  { id: 17, label: '#17' },
]

const SOON = [
  { sourceId: 'a', headline: 'Amazing Spider-Man (2025) #36', label: '#36', week: '2026-10-07' },
  { sourceId: 'b', headline: 'Amazing Spider-Man (2025) #37', label: '#37', week: '2026-10-21' },
]

const base = {
  missing: MISSING,
  soon: SOON,
  gettable: 2,
  onGetAll: () => {},
  getAllPending: false,
  renderAction: (id: number) => <button type="button">Get {id}</button>,
}

const draw = (props: Partial<ComponentProps<typeof EditionSidebar>> = {}) =>
  render(<EditionSidebar {...base} {...props} />)

// The count is the thing you need at a glance, and on a phone it is all you see until
// you open the section - so it belongs in the heading, not inside the fold.
test('the missing heading counts the gaps', () => {
  draw()
  expect(screen.getByRole('button', { name: /missing \(3\)/i })).toBeInTheDocument()
})

test('lists every gap with the way to fill it', () => {
  draw()
  expect(screen.getByText('#4')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Get 17' })).toBeInTheDocument()
})

// Get all sits outside the fold, so filling a run never requires opening anything.
test('offers to get every gap the rule can fill, counted', () => {
  draw()
  expect(screen.getByRole('button', { name: /get all 2/i })).toBeInTheDocument()
})

// A run whose every gap the rule refused to close has nothing to offer in bulk.
test('nothing certain to take means no bulk offer', () => {
  draw({ gettable: 0 })
  expect(screen.queryByRole('button', { name: /get all/i })).toBeNull()
})

test('a complete run has no missing section at all', () => {
  draw({ missing: [] })
  expect(screen.queryByRole('button', { name: /missing/i })).toBeNull()
})

// Short, because beside the comic this is a footnote: every row of it is a Wednesday, so
// the word adds nothing a reader of the list does not already know.
test('dates each solicited issue, briefly', () => {
  draw()
  expect(screen.getByText('7 Oct 2026')).toBeInTheDocument()
})

// Every row of this list is the volume whose page it is on, so repeating the volume's
// name on each one spends the column's whole width saying what the page already says.
test('names an issue by its number rather than by the volume it is already under', () => {
  draw()
  expect(screen.getByText('#36')).toBeInTheDocument()
  expect(screen.queryByText(/Amazing Spider-Man \(2025\) #36/)).toBeNull()
})

// "Coming soon: nothing" reads as a promise broken rather than as a run that has ended.
test('a run nobody has solicited past has no coming soon section', () => {
  draw({ soon: [] })
  expect(screen.queryByRole('button', { name: /coming soon/i })).toBeNull()
})

// Folded is the resting state, because on a phone both headings have to fit above the
// fold. The stylesheet unfolds them where there is a column to put them in.
test('each section starts folded and opens when asked', () => {
  draw()
  const missing = screen.getByRole('button', { name: /missing \(3\)/i })
  expect(missing).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(missing)
  expect(missing).toHaveAttribute('aria-expanded', 'true')
})

test('pressing get all asks once', () => {
  const onGetAll = vi.fn()
  draw({ onGetAll })
  fireEvent.click(screen.getByRole('button', { name: /get all 2/i }))
  expect(onGetAll).toHaveBeenCalledTimes(1)
})

/* ── Keeping the run up to date ───────────────────────────────────────────── */

test('offers to read the run again', () => {
  const onRefresh = vi.fn()
  draw({ onRefresh })
  fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
  expect(onRefresh).toHaveBeenCalledTimes(1)
})

test('says so while it is re-reading', () => {
  draw({ onRefresh: () => {}, refreshing: true })
  expect(screen.getByRole('button', { name: /refreshing/i })).toBeDisabled()
})

test('links out to the volume on Comic Vine', () => {
  draw({ cvUrl: 'https://comicvine.gamespot.com/venom/4050-167333/' })
  const link = screen.getByRole('link', { name: /on Comic Vine/i })
  expect(link).toHaveAttribute('href', 'https://comicvine.gamespot.com/venom/4050-167333/')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
})

// A run we could not re-read is news. When it was last read is bookkeeping, and was
// taking a line of the header to say something nobody acts on.
test('a run it could not re-read says so, without dating it', () => {
  draw({ onRefresh: () => {}, stale: true })
  expect(screen.getByText(/could not reach comic vine/i)).toBeInTheDocument()
  expect(screen.queryByText(/as of/i)).toBeNull()
})

test('a run read from Comic Vine says nothing about when', () => {
  draw({ onRefresh: () => {} })
  expect(screen.queryByText(/as of/i)).toBeNull()
  expect(screen.queryByText(/could not reach/i)).toBeNull()
})

// An edition with no volume has no run to re-read and no volume to link to.
test('an edition with nothing to refresh offers nothing', () => {
  draw({ onRefresh: undefined, cvUrl: null })
  expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull()
  expect(screen.queryByRole('link', { name: /comic vine/i })).toBeNull()
})
