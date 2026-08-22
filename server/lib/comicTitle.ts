/**
 * Derive an issue number and year from a scraped comic title.
 *
 * The number is zero-padded to a minimum of three digits and keeps its original width
 * when wider, so "#1000" stays "1000" rather than being truncated, and values order
 * correctly when read as numbers.
 */

// A 4-digit run straight after "(" - also catches the first year of "(2011-2012)".
const YEAR_RE = /\((\d{4})/g
const YEAR_MIN = 1900
const YEAR_MAX = 2099

// The first "#" followed (optionally after a space) by a digit or -digit. Skipping
// non-numeric tokens is what keeps the "#" inside words like "S#!t" from matching.
const NUMBER_RE = /#\s*(-?\d[^\s(]*)/

// Leading integer plus an optional dotted suffix: 1, -1, 1.5, 1.MU, 68.DEATHS.
// Anything after that (range tails like "-36", stray commas) is dropped.
const NUMBER_PARTS_RE = /^(-?\d+)(\.\w+)?/

const PAD = 3

export interface ParsedTitle {
  number: string | null
  year: number | null
}

export function parseComicTitle(title: string): ParsedTitle {
  return { number: parseNumber(title), year: parseYear(title) }
}

export function parseYear(title: string): number | null {
  for (const match of title.matchAll(YEAR_RE)) {
    const year = Number(match[1])
    if (year >= YEAR_MIN && year <= YEAR_MAX) return year
  }
  return null
}

export function parseNumber(title: string): string | null {
  const token = NUMBER_RE.exec(title)?.[1]
  if (!token) return null
  const parts = NUMBER_PARTS_RE.exec(token)
  if (!parts) return null
  const [, digits, suffix = ''] = parts
  const negative = digits.startsWith('-')
  const padded = String(Math.abs(Number(digits))).padStart(PAD, '0')
  return `${negative ? '-' : ''}${padded}${suffix}`
}
