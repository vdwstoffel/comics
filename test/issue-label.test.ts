import { test, expect } from 'vitest'
import { issueLabel } from '../server/services/issueDownload.js'

test('a volume and a number read as one name', () => {
  expect(issueLabel('Wolverine', '27')).toBe('Wolverine #27')
})

test('a volume with no number is still a name', () => {
  expect(issueLabel('Wolverine', null)).toBe('Wolverine')
})

// The whole reason this is a function. Both halves are nullable, and the obvious join
// returns '' for the empty case - which is not null, so it survives every `label ?? url`
// fallback downstream and renders a blank row with an aria-label reading "Cancel ".
// Nothing to say has to come back as nothing, so the caller falls back to the url.
test('nothing to say comes back as nothing, not as an empty string', () => {
  expect(issueLabel(null, null)).toBeUndefined()
  expect(issueLabel(undefined, undefined)).toBeUndefined()
  expect(issueLabel('', '')).toBeUndefined()
  expect(issueLabel('   ', null)).toBeUndefined()
})
