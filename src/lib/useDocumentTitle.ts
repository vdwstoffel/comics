import { useEffect } from 'react'

const APP_NAME = 'Continuity'

/**
 * What the browser tab says while you are on this page.
 *
 * Every route calls this, including the ones whose answer is just the app name. A page
 * that stayed silent would wear the title of the page before it, and a default set once
 * in `App` could not fix that: a child's effect runs before its parent's, so the parent
 * would land second and overwrite whatever the page had just said.
 *
 * Nothing is restored on the way out for the same reason - the page you arrive on sets
 * the title itself, and a restore would only put the bare app name on screen for the one
 * frame in between.
 *
 * A subject that is absent, null or blank is not a subject: pages name themselves from a
 * query, and the first render of every one of them happens before the answer does.
 */
export function useDocumentTitle(subject?: string | null): void {
  const named = subject?.trim()
  useEffect(() => {
    document.title = named ? `${named} — ${APP_NAME}` : APP_NAME
  }, [named])
}
