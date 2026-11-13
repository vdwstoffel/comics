import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiListIssue, ApiListPhase, ListLength, ReadingListResponse } from '../api'
import LibraryRail from '../components/LibraryRail'
import StoryIssueTile from '../components/StoryIssueTile'
import FollowButton from '../components/FollowButton'
import { arcIssueLabel } from '../lib/arcIssueLabel'
import { useBackLink } from '../lib/backOrigin'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { phaseIssues, phasesIn, tally } from '../lib/readingList'

interface PhaseProps {
  phase: ApiListPhase
  open: boolean
  here: boolean
  /** Whether the list is being read in Full, the only length that draws a tie-in. */
  full: boolean
  onToggle: () => void
}

/** The arc page's grid, with a tie-in marked where Full draws one. */
function IssueGrid({ issues, full }: { issues: ApiListIssue[]; full: boolean }) {
  return (
    <div className="tile-grid">
      {issues.map((issue) => (
        <div key={issue.id} className="list-issue">
          <StoryIssueTile
            issue={issue}
            get={() => api.downloadListIssue(issue.id)}
            download={(indexId) => api.downloadListIssue(issue.id, indexId)}
          />
          {full && issue.extra && <span className="list-issue__tie-in">Tie-in</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * One phase as a bar that folds. Folded, it is a line of progress - which is all a phase
 * you have finished or not reached yet needs to say - and open, it is the arc page's grid.
 * The bar is the button rather than a chevron beside it, so the whole line is the target.
 *
 * A phase the guide splits into sections shows them as headings in Full, where they are
 * what makes two hundred tie-ins readable. Core draws it as one run: there the sections
 * would be a heading over every issue.
 */
function Phase({ phase, open, here, full, onToggle }: PhaseProps) {
  const { total, read } = tally(phaseIssues(phase))
  const bodyId = `phase-${phase.name.replace(/\W+/g, '-').toLowerCase()}`

  return (
    <section className={`list-phase${open ? ' list-phase--open' : ''}`}>
      <button
        type="button"
        className="list-phase__bar"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="list-phase__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="list-phase__name">{phase.name}</span>
        {here && <span className="list-phase__here">You're here</span>}
        <span className="list-phase__count">{total} issue{total === 1 ? '' : 's'}</span>
        <span className="list-phase__progress" aria-hidden="true">
          <span className="list-phase__progress-fill" style={{ width: `${(read / total) * 100}%` }} />
        </span>
        <span className="list-phase__read">{read === total ? 'all read' : `${read} read`}</span>
      </button>
      {open && (
        <div className="list-phase__body" id={bodyId}>
          {phase.note && <p className="list-phase__note">{phase.note}</p>}
          {full
            ? phase.sections.map((section) => (
              <div key={section.name ?? ''} className="list-section">
                {section.name && <h3 className="list-section__name">{section.name}</h3>}
                {section.note && <p className="list-phase__note">{section.note}</p>}
                <IssueGrid issues={section.issues} full />
              </div>
            ))
            : <IssueGrid issues={phaseIssues(phase)} full={false} />}
        </div>
      )}
    </section>
  )
}

/**
 * A reading list: a story across series, in a guide's order, read short (Core) or long
 * (Full, with its tie-ins). The list is a file in the code - see server/readingLists - so
 * this page only reads it; the one thing it changes is which length you read it in.
 *
 * The phases fold, because Full can run to hundreds of issues. The one holding the next
 * issue opens on its own and says so; the rest wait to be clicked, and which ones you
 * opened is forgotten when you leave.
 */
export default function ReadingList() {
  const { slug = '' } = useParams()
  const qc = useQueryClient()
  const key = ['reading-list', slug]
  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => api.getReadingList(slug),
    retry: false,
  })
  useDocumentTitle(data?.list.name ?? 'Reading list')
  const back = useBackLink('/lists', 'All reading lists')

  // Phases you folded or opened by hand, by name. Everything else follows "You're here",
  // so the open phase moves with you as you read - and with the switch, which can put the
  // next issue in a different phase.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map())

  // Drawn at once rather than after the save: the whole list is already here in Full, so
  // nothing about the redraw waits on the server. What does is everything else that reads
  // the length - the follow it queues for, and the "47 of 92" on an issue's page.
  const setLength = useMutation({
    mutationFn: (length: ListLength) => api.setReadingListLength(slug, length),
    onMutate: async (length) => {
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData<ReadingListResponse>(key, (old) => (old ? { ...old, length } : old))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: ['follows'] })
      void qc.invalidateQueries({ queryKey: ['book'] })
    },
  })

  if (isLoading) return <Shell back={back}><p>Loading…</p></Shell>
  if (isError || !data) return <Shell back={back}><p>{"Couldn't load this reading list."}</p></Shell>

  const { list, length } = data
  const phases = phasesIn(data.phases, length)
  const run = phases.flatMap(phaseIssues)
  const { owned, read } = tally(run)
  const nextId = data.next[length]
  const next = run.find((i) => i.id === nextId)
  const herePhase = phases.findIndex((p) => phaseIssues(p).some((i) => i.id === nextId))
  const all = data.phases.flatMap(phaseIssues)
  const counts = { core: all.filter((i) => !i.extra).length, full: all.length }

  return (
    <Shell back={back}>
      <h1 className="page-title">{list.name}</h1>
      <p className="arc-detail__meta">
        {[list.publisher, list.years, `${owned} of ${run.length} in your library`, `${read} read`]
          .filter(Boolean).join(' · ')}
      </p>
      {list.description && <p className="arc-detail__deck">{list.description}</p>}
      <div className="arc-detail__actions list-detail__actions">
        {/* No switch on a list with no tie-ins: Full would be Core under another name. */}
        {data.hasExtras && (
          <div className="length-switch" role="group" aria-label="Length">
            {(['core', 'full'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className="length-switch__option"
                aria-pressed={length === l}
                onClick={() => { if (length !== l) setLength.mutate(l) }}
              >
                {l === 'core' ? 'Core' : 'Full'} <span className="length-switch__count">{counts[l]}</span>
              </button>
            ))}
          </div>
        )}
        {/* Only when the next issue is one you have: a gap has nothing to open, and the
            open phase already shows it with the way to fill it. */}
        {next?.owned && next.bookId != null && (
          <Link className="btn" to={`/read/${next.bookId}`}>Continue · {arcIssueLabel(next)}</Link>
        )}
        <FollowButton target={{ kind: 'list', listId: list.id }} refId={list.id} />
      </div>
      {phases.map((phase, i) => {
        const open = toggled.get(phase.name) ?? i === herePhase
        return (
          <Phase
            key={phase.name}
            phase={phase}
            open={open}
            here={i === herePhase}
            full={length === 'full'}
            onToggle={() => setToggled((m) => new Map(m).set(phase.name, !open))}
          />
        )
      })}
    </Shell>
  )
}

function Shell({ back, children }: { back: ReturnType<typeof useBackLink>; children: ReactNode }) {
  return (
    <>
      <LibraryRail />
      <main className="library-content">
        <Link to={back.to} onClick={back.onClick} className="back-link">← {back.label}</Link>
        {children}
      </main>
    </>
  )
}
