import { test, expect } from 'vitest'
import { deckDepth } from '../src/lib/deckDepth'

test('a volume holding one unread comic has nothing stacked behind it', () => {
  expect(deckDepth(1)).toBe(0)
})

test('a couple of unread issues put one card behind the cover', () => {
  expect(deckDepth(2)).toBe(1)
  expect(deckDepth(4)).toBe(1)
})

test('a handful puts two behind', () => {
  expect(deckDepth(5)).toBe(2)
  expect(deckDepth(9)).toBe(2)
})

// The whole point of a cap: the tile has a fixed gutter to draw into, and a run you are
// forty issues behind on would otherwise reach into the tile beside it.
test('a long run puts three behind, however far behind you are', () => {
  expect(deckDepth(10)).toBe(3)
  expect(deckDepth(40)).toBe(3)
})

// The shelf never builds an empty group, but a depth of -1 would be drawn as one plate
// through the CSS, so the floor is worth holding.
test('a count of none stacks nothing', () => {
  expect(deckDepth(0)).toBe(0)
})
