import type { ProfileBlock } from '../api'

export interface ProfileSection {
  id: string
  text: string
  /** The subsections under it - the story arcs under "Major Story Arcs", and so on. */
  children: Array<{ id: string; text: string }>
}

/**
 * The contents of a character's profile: its sections, each with its subsections.
 *
 * Two levels and no deeper. A long profile has around ten sections, eighty subsections
 * and sixty headings below those - Iron Man's runs to 154 headings - and a contents list
 * that long is a second article rather than a way around the first. The third level is
 * mostly film, television and game titles under "Other Media", which nobody navigates by.
 *
 * Ids are by position, not by slug: two sections can share a name ("Earth-65" sits under
 * two different realities in Black Cat's), and an id is only an anchor on this one page.
 * `idFor` gives the id a heading block should carry, so the article and the contents
 * agree without either knowing about the other.
 */
export function profileSections(blocks: ProfileBlock[]): { sections: ProfileSection[]; idFor: Map<number, string> } {
  const sections: ProfileSection[] = []
  const idFor = new Map<number, string>()
  blocks.forEach((block, i) => {
    if (block.kind !== 'heading' || block.level > 3) return
    const id = `profile-${i}`
    idFor.set(i, id)
    const last = sections[sections.length - 1]
    // A subsection before any section - a profile that opens on a level-3 heading - is
    // listed as a section of its own rather than dropped.
    if (block.level === 3 && last) last.children.push({ id, text: block.text })
    else sections.push({ id, text: block.text, children: [] })
  })
  return { sections, idFor }
}
