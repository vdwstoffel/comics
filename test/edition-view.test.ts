// @vitest-environment jsdom

import { test, expect, beforeEach } from 'vitest'
import { readEditionView, writeEditionView } from '../src/lib/editionView'

beforeEach(() => { localStorage.clear() })

test('the carousel is what a volume page opens as', () => {
  expect(readEditionView()).toBe('carousel')
})

test('a chosen view is remembered', () => {
  writeEditionView('grid')
  expect(readEditionView()).toBe('grid')
})

// Anything else in that slot is not a view this page has, whether it is left over from an
// older build or typed in by hand.
test('a stored value that is not a view falls back to the carousel', () => {
  localStorage.setItem('comics.editionView', 'spiral')
  expect(readEditionView()).toBe('carousel')
})
