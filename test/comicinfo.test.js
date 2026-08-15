import { test, expect } from 'vitest'
import { parseComicInfo, buildComicInfo } from '../server/lib/comicinfo.js'

const SAMPLE = `<?xml version="1.0"?>
<ComicInfo>
  <Title>The Beginning</Title>
  <Series>Batman</Series>
  <Number>1</Number>
  <Writer>Scott Snyder</Writer>
  <Penciller>Greg Capullo</Penciller>
  <Summary>Bruce returns.</Summary>
  <Publisher>DC</Publisher>
  <Year>2011</Year><Month>11</Month>
</ComicInfo>`

test('parseComicInfo extracts fields', () => {
  const m = parseComicInfo(SAMPLE)
  expect(m.title).toBe('The Beginning')
  expect(m.series).toBe('Batman')
  expect(m.number).toBe('1')
  expect(m.writer).toBe('Scott Snyder')
  expect(m.publisher).toBe('DC')
  expect(m.date).toBe('2011-11')
})

test('buildComicInfo round-trips through parse', () => {
  const xml = buildComicInfo({ title: 'X', series: 'Y', number: '3', writer: 'A', summary: 'S & <stuff>' })
  const m = parseComicInfo(xml)
  expect(m.title).toBe('X')
  expect(m.number).toBe('3')
  expect(m.summary).toBe('S & <stuff>')
})
