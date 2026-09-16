import { test, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import QueueList from '../src/components/QueueList'
import type { QueueEntry } from '../src/api'

afterEach(() => cleanup())

const entry = (id: number, label: string, state: QueueEntry['state'] = 'queued'): QueueEntry => ({
  id, position: id, state, url: `https://x.test/${id}`, label, attempts: 0,
  queuedAt: '2026-09-15T00:00:00Z',
})

const THREE = [entry(1, 'one'), entry(2, 'two'), entry(3, 'three')]

function draw(over: Partial<{ entries: QueueEntry[]; onMove: () => void; onCancel: () => void }> = {}) {
  const props = { entries: THREE, onMove: vi.fn(), onCancel: vi.fn(), ...over }
  render(<QueueList {...props} />)
  return props
}

test('every waiting download is listed in order', () => {
  draw()
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    expect.stringContaining('one'),
    expect.stringContaining('two'),
    expect.stringContaining('three'),
  ])
})

test('moving a row down asks for the index below it', () => {
  const { onMove } = draw()
  const row = screen.getAllByRole('listitem')[0]
  fireEvent.click(within(row).getByRole('button', { name: /move down/i }))
  expect(onMove).toHaveBeenCalledWith(1, 1)
})

test('moving a row up asks for the index above it', () => {
  const { onMove } = draw()
  const row = screen.getAllByRole('listitem')[2]
  fireEvent.click(within(row).getByRole('button', { name: /move up/i }))
  expect(onMove).toHaveBeenCalledWith(3, 1)
})

// The ends have nowhere to go; the buttons say so rather than sending a doomed request.
test('the first cannot move up and the last cannot move down', () => {
  draw()
  const rows = screen.getAllByRole('listitem')
  expect(within(rows[0]).getByRole('button', { name: /move up/i })).toBeDisabled()
  expect(within(rows[2]).getByRole('button', { name: /move down/i })).toBeDisabled()
})

test('cancelling a row names it', () => {
  const { onCancel } = draw()
  fireEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: /cancel/i }))
  expect(onCancel).toHaveBeenCalledWith(2)
})

// A download already in flight is not reorderable - it is already going.
test('the running row cannot be reordered but can be cancelled', () => {
  draw({ entries: [entry(1, 'one', 'running'), entry(2, 'two')] })
  const row = screen.getAllByRole('listitem')[0]
  expect(within(row).getByRole('button', { name: /move down/i })).toBeDisabled()
  expect(within(row).getByRole('button', { name: /cancel/i })).toBeEnabled()
})

test('an empty queue says so rather than rendering an empty list', () => {
  draw({ entries: [] })
  expect(screen.queryByRole('listitem')).toBeNull()
  expect(screen.getByText(/nothing waiting/i)).toBeInTheDocument()
})

// --- what the drag arithmetic silently depends on ---
//
// `dropIndex` derives the pitch between rows from the tops `measure()` records, so the gap
// between rows is its business rather than this stylesheet's. What it still cannot see is
// rows of DIFFERENT heights: one pitch is measured, from the first two rows, and applied
// all the way down. Nothing in this component enforces a uniform height - the stylesheet
// does, and the suite has no browser to observe it in. Reading the rules is therefore the
// only way to hold the dependency still: a long label allowed to wrap makes every row
// below the first tall one land on the wrong index.
// Read from the repo root, which is where vitest runs. `import.meta.url` is not a file
// url under the jsdom environment this file runs in, so it cannot be resolved against.
const CSS = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')

/** The body of one rule, by selector. */
function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`)
  expect(at, `${selector} has no rule`).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('}', at))
}

test('a queue row is a fixed height, so every row is the same height', () => {
  expect(rule('.queue-list__row')).toMatch(/\n\s*height:\s*\d+px/)
})

test('a long label is cut rather than wrapped, so it cannot make its row taller', () => {
  const label = rule('.queue-list__label')
  expect(label).toMatch(/white-space:\s*nowrap/)
  expect(label).toMatch(/overflow:\s*hidden/)
  expect(label).toMatch(/text-overflow:\s*ellipsis/)
})

// A tablet feature: without this the browser treats the drag as a scroll and the row
// never moves.
test('the drag handle claims the gesture from the browser', () => {
  expect(rule('.queue-list__handle')).toMatch(/touch-action:\s*none/)
})

test('the handle and the row buttons are touch targets, not mouse targets', () => {
  for (const selector of ['.queue-list__handle', '.queue-list__row .btn']) {
    expect(rule(selector)).toMatch(/min-width:\s*44px/)
    expect(rule(selector)).toMatch(/min-height:\s*44px/)
  }
})
