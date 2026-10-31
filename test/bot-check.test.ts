import { test, expect } from 'vitest'
import { needsABrowser } from '../server/lib/botCheck.js'

const ARCHIVE = 'application/zip'

test('a 403 is the site refusing a request that did not look like a browser', () => {
  expect(needsABrowser({ status: 403, contentType: null })).toBe(true)
})

test('a 503 is a challenge, whatever it carries', () => {
  expect(needsABrowser({ status: 503, contentType: ARCHIVE })).toBe(true)
})

/**
 * The case the whole thing exists for: HTTP is satisfied, so without this the page
 * streams into a file named like a comic and only the zip guard in storeComic notices -
 * reporting a bot check as a corrupt download.
 */
test('a 200 of html is an interstitial served in the file\'s place', () => {
  expect(needsABrowser({ status: 200, contentType: 'text/html' })).toBe(true)
  expect(needsABrowser({ status: 200, contentType: 'text/html; charset=UTF-8' })).toBe(true)
  expect(needsABrowser({ status: 200, contentType: '  TEXT/HTML  ' })).toBe(true)
})

test('an actual comic is not a bot check', () => {
  expect(needsABrowser({ status: 200, contentType: ARCHIVE })).toBe(false)
  expect(needsABrowser({ status: 200, contentType: 'application/x-cbz' })).toBe(false)
  expect(needsABrowser({ status: 200, contentType: 'application/octet-stream' })).toBe(false)
})

/**
 * A server that says nothing about the type is taken at its word that it sent the file.
 * Guessing "html" from an absent header would block real downloads from hosts that do
 * not set one, and the zip guard still catches anything that turns out not to be a comic.
 */
test('a 200 with no content-type is left alone', () => {
  expect(needsABrowser({ status: 200, contentType: null })).toBe(false)
})

/**
 * `text/htmlish` is not html, and startsWith would have called it one. The word boundary
 * is what keeps this from over-reaching onto types it has never seen.
 */
test('a type that merely starts with text/html is not html', () => {
  expect(needsABrowser({ status: 200, contentType: 'text/htmlish' })).toBe(false)
})

/**
 * Other failures keep their old meaning. A 404 is a dead link and a 500 is the host
 * falling over; neither is improved by a person opening a browser, and both are still
 * worth the retry a blocked row deliberately does not get.
 */
test('ordinary failures are not bot checks', () => {
  expect(needsABrowser({ status: 404, contentType: 'text/html' })).toBe(false)
  expect(needsABrowser({ status: 500, contentType: 'text/html' })).toBe(false)
})
