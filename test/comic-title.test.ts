import { test, expect } from 'vitest'
import { parseComicTitle } from '../server/lib/comicTitle.js'

// Every case is a real title shape from the scraped index.
const CASES: [title: string, number: string | null, year: number | null][] = [
  ['Spider-Man #1 (2016)', '001', 2016],
  ['Spider-Man #10 (2023)', '010', 2023],
  ['Spider-Man #16 (2017)', '016', 2017],
  ['Batman #100 (2020)', '100', 2020],
  // wider than the pad must survive intact, not be truncated
  ['Detective Comics #1000 (2018)', '1000', 2018],
  ['Hitman #1000000 (1998)', '1000000', 1998],
  // decimals keep their suffix, integer part padded
  ['Amazing Spider-Man #1.1 (2016)', '001.1', 2016],
  ['Amazing Spider-Man #16.1 (2015)', '016.1', 2015],
  ['Radiant Black #30.5 (2024)', '030.5', 2024],
  ['Avengers #1.MU (2017)', '001.MU', 2017],
  ['The Amazing Spider-Man #68.DEATHS (2025)', '068.DEATHS', 2025],
  ['Ultimate Spider-Man #0.5 (2002)', '000.5', 2002],
  // negatives keep their sign
  ['Spider-Man #-1 (1997)', '-001', 1997],
  // ranges take the first number of the range
  ['Kent Blake of The Secret Service #1-14 (1951)', '001', 1951],
  ['Magneto #011-014 Free Download', '011', null],
  ['Lobo #1- 4 (2014-2015)', '001', 2014],
  ['Beyond the Fringe #1a - 6b (2011-2012)', '001', 2011],
  ['Famous First Edition - New Fun #1, C-63 (2020)', '001', 2020],
  // a '#' inside a word must not be mistaken for the issue marker
  ["Oh S#!t It's Kim & Kim #1 (2018)", '001', 2018],
  ["Oh S#!t It's Kim & Kim #1 - 5 (2018-2019)", '001', 2018],
  // year ranges yield the first year
  ['Boy Commandos Vol. 1 #1-36 (1942-1949 + 1973)', '001', 1942],
  // several years: the first wins
  ['Love and Rockets #1 (1982) Facsimile Edition (2026)', '001', 1982],
  ['Star Wars - Mace Windu (2003) (Marvel Edition) (2015)', null, 2003],
  // no issue marker at all
  ['The Flash by Joshua Williamson Omnibus Vol. 2 (2025)', null, 2025],
  ['Superman - Earth One Complete Collection (2026) (Fan-Made TPB)', null, 2026],
  // no year at all
  ['Amazing Spider-Man #1.5', '001.5', null],
  // neither
  ['Some Collected Edition', null, null],
]

test.each(CASES)('parses %s', (title, number, year) => {
  expect(parseComicTitle(title)).toEqual({ number, year })
})

test('rejects implausible years', () => {
  for (const title of ['Weird Title (0001)', 'Weird Title (3050)', 'Issue (12)']) {
    expect(parseComicTitle(title).year).toBeNull()
  }
})

test('padded numbers order numerically when read as numbers', () => {
  const numbers = [1, 2, 10, 11, 100, 999, 1000]
    .map((n) => parseComicTitle(`Title #${n} (2020)`).number as string)
  expect(numbers).toEqual(['001', '002', '010', '011', '100', '999', '1000'])
  expect([...numbers].sort((a, b) => Number(a) - Number(b))).toEqual(numbers)
})
