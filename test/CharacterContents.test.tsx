import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import CharacterContents from '../src/components/CharacterContents'
import type { ProfileSection } from '../src/lib/profileSections'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

const SECTIONS: ProfileSection[] = [
  { id: 'profile-0', text: 'Origin', children: [] },
  { id: 'profile-2', text: 'Powers', children: [{ id: 'profile-3', text: 'Armor' }] },
  { id: 'profile-4', text: 'Major Story Arcs', children: [{ id: 'profile-5', text: 'Armor Wars' }, { id: 'profile-6', text: 'Civil War' }] },
]

/** The article's headings, as the page would have them. */
function headings(ids: string[]) {
  for (const id of ids) {
    const el = document.createElement('h2')
    el.id = id
    document.body.appendChild(el)
  }
}

test('every section is listed, and only the one being read opens onto its subsections', () => {
  // jsdom lays nothing out: every heading sits at the top, so the last is the one "read".
  headings(['profile-0', 'profile-2', 'profile-3', 'profile-4', 'profile-5', 'profile-6'])
  render(<CharacterContents sections={SECTIONS} />)
  for (const text of ['Origin', 'Powers', 'Major Story Arcs']) {
    expect(screen.getByRole('button', { name: text })).toBeInTheDocument()
  }
  expect(screen.getByRole('button', { name: 'Civil War' })).toHaveAttribute('aria-current', 'location')
  expect(screen.getByRole('button', { name: 'Armor Wars' })).toBeInTheDocument()
  // Powers is not being read, so its subsection stays folded away.
  expect(screen.queryByRole('button', { name: 'Armor' })).toBeNull()
})

test('choosing a section jumps to its heading', () => {
  headings(['profile-0', 'profile-2', 'profile-3', 'profile-4', 'profile-5', 'profile-6'])
  const jump = vi.fn()
  document.getElementById('profile-2')!.scrollIntoView = jump
  render(<CharacterContents sections={SECTIONS} />)
  fireEvent.click(screen.getByRole('button', { name: 'Powers' }))
  expect(jump).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
})

test('the comics at the foot of the page are the last entry', () => {
  render(<CharacterContents sections={SECTIONS} comics={{ id: 'character-comics', count: 121 }} />)
  const items = screen.getAllByRole('button').map((b) => b.textContent)
  expect(items[items.length - 1]).toBe('Your comics (121)')
})

// On a phone it is folded until asked for.
test('the contents unfold from a toggle', () => {
  render(<CharacterContents sections={SECTIONS} />)
  const toggle = screen.getByRole('button', { name: /^Contents/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
})
