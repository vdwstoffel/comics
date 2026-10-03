import { test, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ArcReorderList from '../src/components/ArcReorderList'
import type { ApiArcIssue } from '../src/api'

const ISSUES: ApiArcIssue[] = [
  { id: 1, number: '13', volumeName: 'Batman', owned: true, bookId: 7 },
  { id: 2, number: '23', volumeName: 'Batgirl', owned: false, match: null },
  { id: 3, number: '1113', volumeName: 'Detective Comics', owned: false, match: null },
]

function draw(issues = ISSUES) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(<ArcReorderList issues={issues} onSave={onSave} onCancel={onCancel} />)
  return { onSave, onCancel }
}

const rows = () => screen.getAllByRole('listitem')

test('the run starts in the order it was drawn in', () => {
  draw()
  expect(rows().map((r) => within(r).getByText(/#/).textContent))
    .toEqual(['Batman #13', 'Batgirl #23', 'Detective Comics #1113'])
})

test('the first cannot move up and the last cannot move down', () => {
  draw()
  expect(within(rows()[0]).getByRole('button', { name: /move .* up/i })).toBeDisabled()
  expect(within(rows()[2]).getByRole('button', { name: /move .* down/i })).toBeDisabled()
})

test('cancelling leaves the arrangement unsent', () => {
  const { onSave, onCancel } = draw()
  fireEvent.click(screen.getByRole('button', { name: 'Move Batman #13 down' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(onCancel).toHaveBeenCalled()
  expect(onSave).not.toHaveBeenCalled()
})

// --- what the drag arithmetic silently depends on ---
//
// Same dependency QueueList has, for the same reason: `dropIndex` measures ONE pitch, from
// the first two rows, and applies it all the way down. Rows of different heights therefore
// send every row below the first tall one to the wrong index, and the suite has no browser
// to observe that in. Reading the rules is the only way to hold it still.
const CSS = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')

function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`)
  expect(at, `${selector} has no rule`).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('}', at))
}

test('a reorder row is a fixed height, so every row is the same height', () => {
  expect(rule('.arc-reorder__row')).toMatch(/\n\s*height:\s*\d+px/)
})

test('a long issue label is cut rather than wrapped, so it cannot make its row taller', () => {
  const label = rule('.arc-reorder__label')
  expect(label).toMatch(/white-space:\s*nowrap/)
  expect(label).toMatch(/overflow:\s*hidden/)
  expect(label).toMatch(/text-overflow:\s*ellipsis/)
})

// Without this a tablet treats the drag as a scroll and the row never moves.
test('the drag handle claims the gesture from the browser', () => {
  expect(rule('.arc-reorder__handle')).toMatch(/touch-action:\s*none/)
})

test('the handle and the row buttons are touch targets, not mouse targets', () => {
  for (const selector of ['.arc-reorder__handle', '.arc-reorder__row .btn']) {
    expect(rule(selector)).toMatch(/min-width:\s*44px/)
    expect(rule(selector)).toMatch(/min-height:\s*44px/)
  }
})

// Every colour on this list has to come from a property that exists. A var that does not
// makes the declaration invalid, and the element quietly inherits instead.
test('the list paints with custom properties the stylesheet actually defines', () => {
  const declared = new Set([...CSS.matchAll(/^\s*(--[a-z-]+):/gm)].map((m) => m[1]))
  const used = [...CSS.matchAll(/\.arc-(?:reorder|detail)__[a-z-]+\s*\{[^}]*\}/g)]
    .flatMap((block) => [...block[0].matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]))

  expect(used.length).toBeGreaterThan(0)
  expect([...new Set(used)].filter((v) => !declared.has(v))).toEqual([])
})
