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

const RICH = `<?xml version="1.0"?>
<ComicInfo>
  <Title>Shed</Title>
  <Writer>Scott Snyder</Writer>
  <Inker>Danny Miki</Inker>
  <Colorist>FCO Plascencia</Colorist>
  <CoverArtist>Greg Capullo</CoverArtist>
  <Characters>Batman, Alfred Pennyworth</Characters>
  <Teams>Court of Owls</Teams>
  <StoryArc>The Black Mirror, Night of the Owls</StoryArc>
</ComicInfo>`

test('parseComicInfo reads characters, teams and story arcs as lists', () => {
  const m = parseComicInfo(RICH)
  expect(m.characters).toEqual(['Batman', 'Alfred Pennyworth'])
  expect(m.teams).toEqual(['Court of Owls'])
  expect(m.storyArcs).toEqual(['The Black Mirror', 'Night of the Owls'])
})

test('parseComicInfo reads each creator tag back as a credit', () => {
  const m = parseComicInfo(RICH)
  expect(m.credits).toEqual([
    { name: 'Scott Snyder', role: 'writer' },
    { name: 'Danny Miki', role: 'inker' },
    { name: 'FCO Plascencia', role: 'colorist' },
    { name: 'Greg Capullo', role: 'cover' },
  ])
})

test('buildComicInfo writes each credit under its own tag, sharing one per role', () => {
  const xml = buildComicInfo({
    credits: [
      { name: 'Scott Snyder', role: 'writer' },
      { name: 'James Tynion IV', role: 'writer' },
      { name: 'Greg Capullo', role: 'cover' },
    ],
  })
  expect(xml).toContain('<Writer>Scott Snyder, James Tynion IV</Writer>')
  expect(xml).toContain('<CoverArtist>Greg Capullo</CoverArtist>')
})

test('buildComicInfo drops roles ComicInfo has no tag for', () => {
  const xml = buildComicInfo({ credits: [{ name: 'Someone', role: 'assistant' }] })
  expect(xml).not.toContain('Someone')
})

test('buildComicInfo falls back to the flat writer when no credit covers the role', () => {
  const xml = buildComicInfo({ writer: 'Scott Snyder', credits: [{ name: 'Greg Capullo', role: 'penciller' }] })
  expect(xml).toContain('<Writer>Scott Snyder</Writer>')
  expect(xml).toContain('<Penciller>Greg Capullo</Penciller>')
})

test('credits and tags round-trip through build and parse', () => {
  const meta = {
    credits: [{ name: 'A B', role: 'writer' }, { name: 'C D', role: 'letterer' }],
    characters: ['Batman', 'Robin'],
    teams: ['Justice League'],
    storyArcs: ['Endgame'],
  }
  const back = parseComicInfo(buildComicInfo(meta))
  expect(back.credits).toEqual(meta.credits)
  expect(back.characters).toEqual(meta.characters)
  expect(back.teams).toEqual(meta.teams)
  expect(back.storyArcs).toEqual(meta.storyArcs)
})

test('an empty list is left out of the xml entirely', () => {
  const xml = buildComicInfo({ title: 'X', characters: [], teams: [], storyArcs: [], credits: [] })
  expect(xml).not.toContain('Characters')
  expect(xml).not.toContain('StoryArc')
})
