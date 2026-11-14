import { test, expect } from 'vitest'
import { profileSections } from '../src/lib/profileSections'
import type { ProfileBlock } from '../src/api'

const h = (level: 2 | 3 | 4, text: string): ProfileBlock => ({ kind: 'heading', level, text })
const p = (text: string): ProfileBlock => ({ kind: 'para', text })

test('sections hold their subsections, and nothing deeper is listed', () => {
  const blocks = [h(2, 'Origin'), p('…'), h(2, 'Major Story Arcs'), h(3, 'Armor Wars'), h(4, 'Aftermath'), h(3, 'Civil War'), h(2, 'Other Media'), h(4, 'Films')]
  const { sections, idFor } = profileSections(blocks)
  expect(sections).toEqual([
    { id: 'profile-0', text: 'Origin', children: [] },
    { id: 'profile-2', text: 'Major Story Arcs', children: [{ id: 'profile-3', text: 'Armor Wars' }, { id: 'profile-5', text: 'Civil War' }] },
    { id: 'profile-6', text: 'Other Media', children: [] },
  ])
  // Only what the contents can jump to carries an anchor.
  expect([...idFor.keys()]).toEqual([0, 2, 3, 5, 6])
})

// Two realities can both have an "Earth-65": an id by name would collide.
test('two headings with one name get two anchors', () => {
  const { sections } = profileSections([h(2, 'Earth-65'), h(2, 'Earth-65')])
  expect(sections.map((s) => s.id)).toEqual(['profile-0', 'profile-1'])
})

test('a profile that opens on a subsection lists it rather than dropping it', () => {
  const { sections } = profileSections([h(3, 'Intro'), h(2, 'Origin')])
  expect(sections.map((s) => s.text)).toEqual(['Intro', 'Origin'])
})
