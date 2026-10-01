import { test, expect } from 'vitest'
import { carouselStart } from '../src/lib/carouselStart'

/** An issue of the run you own, whose book is in whatever read state you give it. */
function owned(number: string, readState: 'unread' | 'reading' | 'read') {
  return { owned: true as const, readState }
}

/** A gap: an issue Comic Vine lists that the library does not have. */
function gap() {
  return { owned: false as const }
}

test('opens on the first issue you have not finished', () => {
  const run = [owned('1', 'read'), owned('2', 'read'), owned('3', 'unread'), owned('4', 'unread')]

  expect(carouselStart(run)).toBe(2)
})

test('counts a comic you are partway through as unfinished', () => {
  const run = [owned('1', 'read'), owned('2', 'reading'), owned('3', 'unread')]

  expect(carouselStart(run)).toBe(1)
})

test('counts a gap as unread, so the run opens on the issue you are missing', () => {
  const run = [owned('1', 'read'), gap(), owned('3', 'unread')]

  expect(carouselStart(run)).toBe(1)
})

test('opens on the newest issue when the whole run is read', () => {
  const run = [owned('1', 'read'), owned('2', 'read'), owned('3', 'read')]

  expect(carouselStart(run)).toBe(2)
})

test('opens on the first issue of a run with nothing in it to go on', () => {
  expect(carouselStart([])).toBe(0)
})

test('treats a book whose read state never arrived as unread', () => {
  const run = [{ owned: true as const }, owned('2', 'unread')]

  expect(carouselStart(run)).toBe(0)
})
