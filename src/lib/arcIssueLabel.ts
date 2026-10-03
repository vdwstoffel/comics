import type { ApiArcIssue } from '../api'

/**
 * What to call an issue in an arc. Comic Vine gives most of them no story title at all, so
 * the series and number carry the label; the bare id is the last resort, for when the issue
 * lookup that supplies those failed.
 *
 * Shared by the run's tiles and its reorder list so an issue is called the same thing in
 * both - the list is how you find the one you mean.
 */
export function arcIssueLabel(issue: ApiArcIssue): string {
  if (issue.volumeName) return issue.number ? `${issue.volumeName} #${issue.number}` : issue.volumeName
  return issue.name || `Issue ${issue.id}`
}
