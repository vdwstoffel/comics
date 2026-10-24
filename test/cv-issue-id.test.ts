import { test, expect } from 'vitest'
import { parseCvIssueId } from '../src/lib/cvIssueId'

test.each([
  ['https://comicvine.gamespot.com/amazing-spider-man-halloween-special-1/4000-1197227/', 1197227],
  ['http://comicvine.gamespot.com/x/4000-1197227/', 1197227],
  ['COMICVINE.GAMESPOT.COM/x/4000-1197227', 1197227],
  ['https://comicvine.gamespot.com/x/4000-1197227/?foo=1#bar', 1197227],
  ['  4000-1197227  ', 1197227],
  ['4000-1197227/', 1197227],
  ['1197227', 1197227],
])('parses %s', (input, id) => {
  expect(parseCvIssueId(input)).toEqual({ ok: true, id })
})

test('rejects a volume link by name', () => {
  const r = parseCvIssueId('https://comicvine.gamespot.com/amazing-spider-man-halloween-special/4050-177664/')
  expect(r).toEqual({ ok: false, error: 'That is a volume link. Paste the link to a single issue.' })
})

test.each([
  ['4005-1443', 'That is a character link. Paste the link to a single issue.'],
  ['4045-56676', 'That is a story arc link. Paste the link to a single issue.'],
])('rejects other resource prefix %s with its name', (input, error) => {
  expect(parseCvIssueId(input)).toEqual({ ok: false, error })
})

test('names an unmapped resource code by its number', () => {
  expect(parseCvIssueId('4010-1')).toEqual({
    ok: false,
    error: 'That is a Comic Vine 4010 link, not an issue. Paste the link to a single issue.',
  })
})

test.each(['', '   ', 'nonsense', '0', '-5', 'https://example.com/4000-1'])('rejects %s', (input) => {
  expect(parseCvIssueId(input).ok).toBe(false)
})

test('parses an issue link whose slug carries a year', () => {
  expect(parseCvIssueId('https://comicvine.gamespot.com/spider-man-2099-1/4000-123456/')).toEqual({ ok: true, id: 123456 })
})

test('names a volume link whose slug carries a year', () => {
  expect(parseCvIssueId('https://comicvine.gamespot.com/spider-man-2099/4050-177664/')).toEqual({
    ok: false,
    error: 'That is a volume link. Paste the link to a single issue.',
  })
})
