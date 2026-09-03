import { test, expect } from 'vitest'
import { stripHtml, toBlocks } from '../server/lib/html.js'

test('stripHtml still flattens a fragment to one line', () => {
  expect(stripHtml('<p>Bruce <i>returns</i>.</p>')).toBe('Bruce returns.')
})

// The bug that makes stripHtml useless for a whole article: the heading fuses into the
// sentence after it — "…and Shapeshifter.OriginRoderick Kingsley was a famous…"
test('a heading does not fuse into the paragraph after it', () => {
  const blocks = toBlocks('<p>See Shapeshifter.</p><h2>Origin</h2><p>Roderick Kingsley was famous.</p>')
  expect(blocks).toEqual([
    { kind: 'para', text: 'See Shapeshifter.' },
    { kind: 'heading', level: 2, text: 'Origin' },
    { kind: 'para', text: 'Roderick Kingsley was famous.' },
  ])
})

test('heading levels are kept so sections nest', () => {
  const blocks = toBlocks('<h2>Major Story Arcs</h2><h3>Blackmail</h3><h4>Details</h4>')
  expect(blocks.map((b) => b.kind === 'heading' && b.level)).toEqual([2, 3, 4])
})

// Every link in a Comic Vine profile is relative — href="/hobgoblin/4005-26374/". Rendered
// inside the app they would resolve against our own origin and 404, so they become text.
test('a link is reduced to the words it wrapped', () => {
  const blocks = toBlocks('<p>See <a href="/hobgoblin/4005-26374/"><i>Hobgoblin (Macendale)</i></a> too.</p>')
  expect(blocks).toEqual([{ kind: 'para', text: 'See Hobgoblin (Macendale) too.' }])
})

test('inline emphasis is unwrapped, not dropped', () => {
  expect(toBlocks('<p>He was <b>very</b> <em>rich</em>.</p>')).toEqual([
    { kind: 'para', text: 'He was very rich.' },
  ])
})

test('a list keeps its items', () => {
  expect(toBlocks('<ul><li>Super Strength</li><li>Agility</li></ul>')).toEqual([
    { kind: 'list', items: ['Super Strength', 'Agility'] },
  ])
})

test('an ordered list is a list too', () => {
  expect(toBlocks('<ol><li>First</li><li>Second</li></ol>')).toEqual([
    { kind: 'list', items: ['First', 'Second'] },
  ])
})

// Six of these per profile, all hotlinked to Comic Vine, all redundant next to the portrait.
test('figures and their images are dropped', () => {
  const blocks = toBlocks('<p>Before.</p><figure><img src="x.jpg"><figcaption>A caption</figcaption></figure><p>After.</p>')
  expect(blocks).toEqual([
    { kind: 'para', text: 'Before.' },
    { kind: 'para', text: 'After.' },
  ])
})

test('noscript blocks are dropped', () => {
  expect(toBlocks('<noscript><img src="x.jpg"></noscript><p>Real text.</p>')).toEqual([
    { kind: 'para', text: 'Real text.' },
  ])
})

test('entities are decoded', () => {
  expect(toBlocks('<p>Peter &amp; MJ &quot;married&quot; &#39;97 &lt;here&gt;&nbsp;now</p>')).toEqual([
    { kind: 'para', text: 'Peter & MJ "married" \'97 <here> now' },
  ])
})

test('whitespace inside a block is collapsed', () => {
  expect(toBlocks('<p>Too\n\n   many     spaces</p>')).toEqual([
    { kind: 'para', text: 'Too many spaces' },
  ])
})

test('an empty block contributes nothing', () => {
  expect(toBlocks('<p></p><p>   </p><h2></h2><p>Kept.</p>')).toEqual([
    { kind: 'para', text: 'Kept.' },
  ])
})

test('no description means no blocks', () => {
  expect(toBlocks(undefined)).toEqual([])
  expect(toBlocks(null)).toEqual([])
  expect(toBlocks('')).toEqual([])
})

test('text outside any block tag is not lost', () => {
  expect(toBlocks('Loose words.<p>In a block.</p>')).toEqual([
    { kind: 'para', text: 'Loose words.' },
    { kind: 'para', text: 'In a block.' },
  ])
})
