import type { ApiListIssue, ApiListPhase, ListLength } from '../api'

/** A phase's issues in reading order, through its sections. */
export function phaseIssues(phase: ApiListPhase): ApiListIssue[] {
  return phase.sections.flatMap((s) => s.issues)
}

/**
 * The phases as this length reads them - the server's phasesIn, on the page's side. The
 * page is sent the whole list in Full so the switch can redraw without a request, which
 * leaves it to drop the tie-ins itself in Core, and with them any section or phase that
 * held nothing else: the Interlude is all tie-ins, and in Core it is not part of the story.
 */
export function phasesIn(phases: ApiListPhase[], length: ListLength): ApiListPhase[] {
  if (length === 'full') return phases
  return phases.flatMap((phase) => {
    const sections = phase.sections.flatMap((section) => {
      const issues = section.issues.filter((i) => !i.extra)
      return issues.length > 0 ? [{ ...section, issues }] : []
    })
    return sections.length > 0 ? [{ ...phase, sections }] : []
  })
}

/** How a run of issues reads so far: what you hold of it, and what you have finished. */
export function tally(issues: ApiListIssue[]): { total: number; owned: number; read: number } {
  return {
    total: issues.length,
    owned: issues.filter((i) => i.owned).length,
    read: issues.filter((i) => i.readState === 'read').length,
  }
}
