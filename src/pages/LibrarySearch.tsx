import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { MatchReason } from '../api'
import { statusFrom } from '../lib/readStatus'
import { groupBySeries } from '../lib/volumeGroups'
import type { SeriesGroup } from '../lib/volumeGroups'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import LibraryRail from '../components/LibraryRail'
import SeriesGroupTile from '../components/SeriesGroupTile'

/**
 * How each credit role reads in a sentence.
 *
 * Keyed on what the server stores, and the two sources of credits do not spell alike. A
 * ComicInfo file is read back as seven fixed names (see CREDIT_TAGS in comicinfo.ts), but
 * Comic Vine sends free lowercase text and the server keeps it as sent - `penciler` with
 * one l, plus `artist`, `plotter`, `scripter`, `translator`, `production` and `other` that
 * ComicInfo has no tag for, and `unknown` where the issue gave no role at all. So the
 * spellings that mean one thing are listed side by side rather than guessed at.
 *
 * A role not listed here still reads, just less idiomatically: "assistant by" beats no line.
 */
const BY: Record<string, string> = {
  writer: 'written by',
  scripter: 'scripted by',
  plotter: 'plotted by',
  artist: 'art by',
  cover: 'cover by',
  penciller: 'pencils by',
  penciler: 'pencils by',
  inker: 'inks by',
  colorist: 'colors by',
  colourist: 'colors by',
  letterer: 'lettered by',
  editor: 'edited by',
  translator: 'translated by',
  production: 'production by',
  // Comic Vine's own catch-alls say nothing about what the person did, and "other by" and
  // "unknown by" read as a fault in the page. The credit is still the reason it matched.
  other: 'credited to',
  unknown: 'credited to',
}

/**
 * Why a comic turned up, when the tile cannot say so itself.
 *
 * A name, a number or a run match is already visible - the title is on the tile and the
 * shelf is the run - so only a credit is worth a line: it is the one match whose reason is
 * nowhere on the cover.
 */
function creditLine(reason: MatchReason | undefined): string | null {
  if (!reason || typeof reason === 'string') return null
  return `${BY[reason.role] ?? `${reason.role} by`} ${reason.name}`
}

/** What a shelf tile should say about its comics: each distinct credit once, in shelf
 *  order. A tile stands for many comics and they need not all match for the same reason. */
function creditLines(group: SeriesGroup): string[] {
  const lines = group.volumes.flatMap((v) => v.books.map((b) => creditLine(b.matched)))
  return [...new Set(lines.filter((l): l is string => l !== null))]
}

export default function LibrarySearch() {
  // The query, the read state and the publisher all live in the url: a reload keeps the
  // results and a link reproduces them.
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  // Neither filter is inherited from the shelf you came from. A search is a question about
  // the whole library, so narrowing it is something you ask for here.
  const status = statusFrom(params)
  const publisher = params.get('publisher')
  useDocumentTitle(q || 'Search')
  const [openSeries, setOpenSeries] = useState<string | null>(null)

  const results = useQuery({
    queryKey: ['library-search', q, status, publisher],
    queryFn: () => api.searchLibrary({ q, readState: status ?? undefined, publisher }),
    enabled: q !== '',
  })

  // Rebuilt from the parts rather than patched, so a filter can never outlive the query it
  // was pressed against, and an empty one does not leave `?status=` behind.
  const refine = (next: { status?: string | null; publisher?: string | null }) => {
    const merged = { status, publisher, ...next }
    const out: Record<string, string> = { q }
    if (merged.status) out.status = merged.status
    if (merged.publisher) out.publisher = merged.publisher
    setParams(out)
  }

  const books = results.data?.books ?? []
  // Grouped by series even under `?status=read`, where the Library's Read shelf draws one
  // cover per comic. That shelf is somewhere to pick a comic to reread, so a cover for each
  // is what it should show. A search answers "what do I have by this name or hand", and a
  // name is usually a run: thirty loose covers of one series would bury the other results
  // under it. The series tile opens onto its volumes, so nothing is hidden, only folded.
  const groups = groupBySeries(books)

  return (
    <>
      <LibraryRail
        activePublisher={publisher}
        activeStatus={status}
        onPublisher={(key) => refine({ publisher: key })}
        onStatus={(key) => refine({ status: key })}
        includeRead
      />
      <main className="library-content">
        <h1 className="page-title">{q ? `Results for "${q}"` : 'Search'}</h1>
        {q === '' && <p>Type a name, an issue number or a creator in the search box.</p>}
        {results.isLoading && q !== '' && <p>Loading…</p>}
        {results.error && <p>Failed to search the library.</p>}
        {results.data && books.length === 0 && (
          <p>
            Nothing in your library matches "{q}".{' '}
            {/* The one moment the two searches should meet: you looked for a comic you
                thought you had, and you do not have it. */}
            <Link to={`/search?q=${encodeURIComponent(q)}`}>Look for it in Get comics →</Link>
          </p>
        )}
        {books.length > 0 && (
          <div className="tile-grid">
            {groups.map((group) => {
              const lines = creditLines(group)
              return (
                <div key={group.key} className="search-result">
                  <SeriesGroupTile
                    group={group}
                    open={openSeries === group.key}
                    onToggle={() => setOpenSeries(openSeries === group.key ? null : group.key)}
                    onClose={() => setOpenSeries(null)}
                    unread={false}
                  />
                  {lines.map((line) => <p key={line} className="search-match">{line}</p>)}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
