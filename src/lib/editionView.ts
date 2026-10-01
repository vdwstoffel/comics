/** How a volume page draws its run. */
export type EditionView = 'carousel' | 'grid'

const KEY = 'comics.editionView'
const VIEWS: EditionView[] = ['carousel', 'grid']

/**
 * Which view to open a volume on.
 *
 * Kept in storage rather than in the URL, so that choosing the grid once holds for every
 * volume you open afterwards - a view is a preference about how you read, not something
 * about the volume you are looking at. `?status=` stays in the URL for the opposite
 * reason: a filtered shelf is a different shelf, and a link to one should arrive filtered.
 *
 * Reading can throw outright - Safari's private mode and a browser with site data blocked
 * both do - and a page that will not render because it could not remember a layout is a
 * worse page than one that opens on the default.
 */
export function readEditionView(): EditionView {
  try {
    const stored = localStorage.getItem(KEY)
    return VIEWS.includes(stored as EditionView) ? (stored as EditionView) : 'carousel'
  } catch {
    return 'carousel'
  }
}

export function writeEditionView(view: EditionView): void {
  try {
    localStorage.setItem(KEY, view)
  } catch {
    // Nothing to do and nothing worth saying: the view still changed on screen, it just
    // will not be there next time.
  }
}
