export interface ApiEdition {
  id: number
  name: string
  seriesName?: string | null
  folder?: string
  publisher?: string | null
  summary?: string | null
  comicvineId?: number | null
  createdAt?: string
  bookCount?: number
  cvName?: string | null
  cvStartYear?: number | null
}

export interface ApiBook {
  id: number
  editionId: number
  filePath?: string
  title: string | null
  number: string | null
  pageCount: number
  fileSize?: number
  writer?: string | null
  penciller?: string | null
  summary?: string | null
  date?: string | null
  comicvineId?: number | null
  comicinfoSynced: boolean
  addedAt?: string
  readState?: 'unread' | 'reading' | 'read'
  percent?: number
  year?: number | null
  coverUrl?: string | null
  cvSiteUrl?: string | null
}

export interface ApiSeries {
  name: string
  bookCount: number
  editions: ApiEdition[]
}

export interface ApiCredit {
  name: string
  role: string
}

export interface ApiTag {
  kind: string
  value: string
  /** Comic Vine id, present on character tags matched from an issue's credits. */
  extId?: number
}

/** One piece of a Comic Vine profile. The server parses the HTML away before it gets here. */
export type ProfileBlock =
  | { kind: 'heading'; level: 2 | 3 | 4; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; items: string[] }

export interface ApiCharacter {
  id?: number
  name?: string
  realName?: string
  aliases: string[]
  deck?: string
  publisher?: string
  firstAppearance?: string
  appearanceCount?: number
  imageUrl?: string
  siteUrl?: string
  profile: ProfileBlock[]
}

export interface QueueEntry {
  id: number
  position: number
  state: 'queued' | 'running' | 'done' | 'failed'
  url: string
  edition?: string
  cvIssueId?: number
  label?: string
  attempts: number
  fileName?: string
  bookId?: number
  error?: string
  queuedAt: string
  startedAt?: string
  finishedAt?: string
}

export interface ActiveDownload {
  id: number
  label?: string
  fileName: string | null
  received: number
  total: number
  startedAt: string
}

export interface DownloadsView {
  active: ActiveDownload[]
  queue: QueueEntry[]
  history: QueueEntry[]
}

export interface ApiSettings {
  downloadConcurrency: number
  comicVineApiKey: string
}

export interface ApiVolumeIssue {
  id: number
  number?: string
  name?: string | null
  coverDate?: string
  siteUrl?: string
  owned: boolean
  bookId?: number
  /** The one scraped row that is this issue, when there is exactly one. Present only on
   *  issues you do not own; null when nothing matched or several things did. */
  match?: { indexId: number; title: string } | null
}

/** A comic as the library shelf receives it: the book plus the volume, series and arcs
 *  holding it, which is what lets the shelf group three ways without a request per group. */
export interface ApiLibraryBook extends ApiBook {
  editionId: number
  editionName: string
  /** Null for a volume nobody has given a series to; the shelf falls back to its name. */
  seriesName: string | null
  /** Empty for the many comics tagged with no arc at all. */
  arcs: string[]
}

export interface ApiEditionExtra {
  bookId: number
  number?: string | null
  title?: string | null
}

export interface ApiEditionIssues {
  volumeId: number | null
  issues: ApiVolumeIssue[]
  extras: ApiEditionExtra[]
  owned: number
  total: number
  unavailable?: boolean
  /** When this run was last read from Comic Vine. */
  fetchedAt?: string
  /** True when Comic Vine could not be reached and this list is what we already held. */
  stale?: boolean
  /** Comic Vine's own page for this volume. Null when the edition has no volume, or when
   *  Comic Vine could not be asked for the link. */
  siteUrl?: string | null
}

export interface ApiStoryArcSummary {
  name: string
  owned: number
}

export interface ApiArcIssue {
  id: number
  /** The story title, which Comic Vine records for only a fraction of issues. */
  name?: string
  siteUrl?: string
  /** Series and number — what the tile is labelled with. Absent if the lookup failed. */
  volumeName?: string
  number?: string
  coverDate?: string
  storeDate?: string
  owned: boolean
  /** Present only when owned — the issue in your library. */
  bookId?: number
  /** Only for an issue you own — one you do not have has no read state. */
  readState?: 'unread' | 'reading' | 'read'
  percent?: number
}

export interface ApiStoryArc {
  id?: number
  name?: string
  deck?: string
  publisher?: string
  imageUrl?: string
  siteUrl?: string
  issues: ApiArcIssue[]
}

/** Where one issue falls in one arc it carries - the "Part 2 of 6" under the Read button. */
export interface ApiBookArc {
  name: string
  /** Absent when the tag never got an id, which is what makes the arc unlookupable. */
  arcId?: number
  /**
   * 1-based place in the run. Absent when Comic Vine could not be reached, when the book
   * has no Comic Vine id to be found by, or when the arc does not list this issue back -
   * a tie-in can carry the tag without appearing in the run.
   */
  position?: number
  /** How many issues the arc holds. A running arc gains them, so this grows. */
  total?: number
  siteUrl?: string
}
export interface BookArcsResponse { arcs: ApiBookArc[] }

export interface ApiReleaseIssue {
  id: number
  number?: string
  name?: string
  /** Comic Vine's publisher for the volume — always one of the two the tab shows. */
  publisher: string
  volumeId: number
  volumeName?: string
  /** Runs ahead of the on-sale date by about two months — the Find link's year seed. */
  coverDate?: string
  /** The day the issue went on sale, which is the day being shown. */
  storeDate?: string
  coverUrl?: string
  siteUrl?: string
  owned: boolean
  /** Present only when owned — the issue in your library. */
  bookId?: number
  /** Only for an issue you do not own; null when no single scraped row can be it. */
  match?: { indexId: number; title: string } | null
}

export interface ApiReleases {
  day: string
  fetchedAt: string | null
  stale?: boolean
  unavailable?: boolean
  publishers: Array<{ name: string; issues: ApiReleaseIssue[] }>
}

export type RunKind = 'ongoing' | 'limited'

/** One currently-published series, as Wikipedia lists it. */
export interface ApiRunningSeries {
  title: string
  kind: RunKind
  /** The issue range as printed: "#1–", "#1–5", "#957–1102". */
  issues: string | null
  pubYear: number | null
  /** An announced final issue. Filled on few rows, and worth knowing before you start. */
  endsOn: string | null
}

export interface ApiRunning {
  /** Publishers whose page could not be read; their `series` is empty. */
  failed?: string[]
  publishers: Array<{ name: string; sourceUrl: string; series: ApiRunningSeries[] }>
}

/** One solicited issue. `headline` is Marvel's own text, and is what the tile shows. */
export interface ApiUpcomingIssue {
  sourceId: string
  headline: string
  /** Derived for ordering only — never displayed. */
  seriesName: string
  /** Derived for ordering only, and null for a one-shot. Never displayed. */
  number: string | null
  releaseDate: string
  coverUrl: string | null
  siteUrl: string
  creators: string | null
}

export interface ApiUpcomingWeek {
  /** The Wednesday, `YYYY-MM-DD`. */
  week: string
  issues: ApiUpcomingIssue[]
}

export interface ApiUpcoming {
  publishers: Array<{
    name: string
    weeks: ApiUpcomingWeek[]
    /** No forward-looking source exists for this publisher. Not the same as empty. */
    unsupported?: boolean
    /** We have a source and could not read it. */
    unavailable?: boolean
  }>
  /** Weeks served from an older copy because the fetch failed. */
  staleWeeks?: string[]
}

export interface ApiProgress {
  bookId: number
  lastPage: number
  completed: boolean
  updatedAt: string | null
}

export interface CvSearchResult {
  id: number
  name?: string
  issueNumber?: string
  publisher?: string
  year?: string
  thumbnail?: string
  cover?: string
}

export type ReadState = 'unread' | 'reading' | 'read'

export interface ReadStateFacet {
  name: ReadState
  count: number
}

export interface PublisherFacet {
  name: string
  count: number
}

export interface EditionsListResponse { editions: ApiEdition[] }
export interface SeriesListResponse { series: ApiSeries[] }
export interface SeriesResponse { series: ApiSeries }
export interface EditionDetailResponse { edition: ApiEdition; books: ApiBook[] }
export interface BookResponse { book: ApiBook; progress: ApiProgress; credits?: ApiCredit[]; tags?: ApiTag[] }
export interface ProgressResponse { progress: ApiProgress }
export interface CvSearchResponse { results: CvSearchResult[] }
/** `verified` is false when the character was resolved by name search rather than by id. */
export interface CharacterResponse { character: ApiCharacter; verified: boolean }
export interface ArcsListResponse { arcs: ApiStoryArcSummary[] }
export interface ArcResponse { arc: ApiStoryArc }
export interface EditionResponse { edition: ApiEdition }
export interface MoveBookEditionResponse { book: ApiBook; edition: ApiEdition }
export interface DeleteBookResponse { deleted: true; editionId: number; editionRemoved: boolean }
export interface DeleteEditionResponse { deleted: true; books: number }
export interface DeleteSeriesResponse { deleted: true; editions: number; books: number }
export interface PublishersResponse { publishers: PublisherFacet[] }
export interface ReadStatesResponse { readStates: ReadStateFacet[] }

export interface ComicIndexResult {
  id: number
  title: string
  url: string
  category: string
  number: string | null
  year: number | null
  importedAt?: string
}

export interface ComicIndexCategory {
  name: string
  count: number
}

export interface ComicIndexSearchResponse { results: ComicIndexResult[]; total: number }

export type ReleaseKind = 'issue' | 'miniseries' | 'bundle' | 'collection' | 'other'

export interface IssueRun {
  key: string
  label: string
  yearFrom: number
  yearTo: number
  first: number
  last: number
  total: number
}

export interface ComicIndexGroup {
  key: string
  name: string
  total: number
  kinds: Record<ReleaseKind, number>
  runs: IssueRun[]
}

/**
 * One Comic Vine volume a series heading could mean. Offered rather than resolved — a
 * scraped heading cannot be matched to a volume reliably, so the list is shown as Comic
 * Vine ranked it and the reader picks.
 */
export interface CvVolumeMatch {
  id: number
  name?: string
  startYear?: number
  publisher?: string
  issueCount?: number
  deck?: string
  thumbnail?: string
  siteUrl?: string
}

export interface CvVolumesResponse {
  volumes: CvVolumeMatch[]
  fetchedAt: string | null
  /** True when Comic Vine could not be reached and this list is what we already held. */
  stale: boolean
}

export interface ComicIndexGroupsResponse {
  groups: ComicIndexGroup[]
  totalGroups: number
  totalResults: number
}

export interface ScrapeStatus {
  running: boolean
  mode: 'quick' | 'full' | null
  page: number
  totalPages: number
  inserted: number
  updated: number
  unchanged: number
  failedPages: number
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface StartScrapeResponse { started: boolean; status: ScrapeStatus }
export interface ComicIndexCategoriesResponse { categories: ComicIndexCategory[]; indexed: number }

export interface ComicIndexQuery {
  q: string
  category?: string
  yearFrom?: number
  yearTo?: number
  limit?: number
  offset?: number
}

function indexParams(
  o: ComicIndexQuery & { series?: string; kind?: ReleaseKind; run?: string },
): URLSearchParams {
  const params = new URLSearchParams({
    q: o.q, limit: String(o.limit ?? 50), offset: String(o.offset ?? 0),
  })
  if (o.category) params.set('category', o.category)
  if (o.yearFrom !== undefined) params.set('yearFrom', String(o.yearFrom))
  if (o.yearTo !== undefined) params.set('yearTo', String(o.yearTo))
  if (o.series) params.set('series', o.series)
  if (o.kind) params.set('kind', o.kind)
  if (o.run) params.set('run', o.run)
  return params
}

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts)
  if (!res.ok) {
    // The server explains its own refusals - "Comic Vine did not accept that key" is the
    // whole point of the settings save, and a bare status throws that explanation away.
    // A body that is not json, or carries no `error`, falls back to the status, which is
    // what every caller received before.
    let message = `${res.status}`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body?.error === 'string' && body.error) message = body.error
    } catch { /* not json; the status stands */ }
    throw Object.assign(new Error(message), { status: res.status })
  }
  return res.json() as Promise<T>
}

export const api = {
  getEditions: (publisher?: string) => {
    const url = publisher ? `/api/editions?publisher=${encodeURIComponent(publisher)}` : '/api/editions'
    return json<EditionsListResponse>(url)
  },
  getPublishers: () => json<PublishersResponse>('/api/publishers'),
  getReadStates: () => json<ReadStatesResponse>('/api/read-states'),
  getSeries: ({ publisher, readState }: { publisher?: string; readState?: ReadState } = {}) => {
    const params = new URLSearchParams()
    if (publisher) params.set('publisher', publisher)
    if (readState) params.set('readState', readState)
    const query = params.toString()
    return json<SeriesListResponse>(`/api/series${query ? `?${query}` : ''}`)
  },
  getSeriesByName: (name: string, readState?: ReadState) => {
    const query = readState ? `?readState=${readState}` : ''
    return json<SeriesResponse>(`/api/series/${encodeURIComponent(name)}${query}`)
  },
  setEditionSeries: (id: string | number, seriesName: string) =>
    json<EditionResponse>(`/api/editions/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seriesName }),
    }),
  getEditionDetail: (id: string | number, readState?: ReadState) => {
    const query = readState ? `?readState=${readState}` : ''
    return json<EditionDetailResponse>(`/api/editions/${id}${query}`)
  },
  getBook: (id: string | number) => json<BookResponse>(`/api/books/${id}`),
  /** Its own call, not part of getBook: a cold arc cache costs a Comic Vine read, and the
   *  issue page must never wait on that. */
  getBookArcs: (id: string | number) => json<BookArcsResponse>(`/api/books/${id}/arcs`),
  putProgress: (id: string | number, body: { lastPage: number; completed: boolean }) =>
    json<ProgressResponse>(`/api/books/${id}/progress`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
  patchMetadata: (id: string | number, body: Record<string, unknown>) =>
    json<BookResponse>(`/api/books/${id}/metadata`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
  getArcs: () => json<ArcsListResponse>('/api/arcs'),
  getArc: (name: string) => json<ArcResponse>(`/api/arcs/${encodeURIComponent(name)}`),

  getReleases: () => json<ApiReleases>('/api/releases'),

  getRunning: () => json<ApiRunning>('/api/releases/running'),

  getUpcoming: () => json<ApiUpcoming>('/api/releases/upcoming'),

  downloadRelease: (cvIssueId: number) =>
    json<{ started: boolean }>(`/api/releases/issues/${cvIssueId}/download`, { method: 'POST' }),
  getCharacter: (bookId: string | number, name: string) =>
    json<CharacterResponse>(`/api/books/${bookId}/character?name=${encodeURIComponent(name)}`),
  cvSearch: (q: string, type: string) =>
    json<CvSearchResponse>(`/api/comicvine/search?q=${encodeURIComponent(q)}&type=${type}`),
  applyIssue: (id: string | number, issueId: number) =>
    json<BookResponse>(`/api/books/${id}/comicvine`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ issueId }),
    }),
  renameEdition: (id: string | number, name: string, seriesName?: string) =>
    json<EditionResponse>(`/api/editions/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(seriesName === undefined ? { name } : { name, seriesName }),
    }),
  resolveDownload: (url: string) =>
    json<{ fileName: string | null; size: number }>('/api/downloads/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),

  getSettings: () => json<ApiSettings>('/api/settings'),

  updateSettings: (body: Partial<ApiSettings>) =>
    json<ApiSettings>('/api/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  getDownloads: () => json<DownloadsView>('/api/downloads'),
  queueDownload: (body: { url: string; edition?: string; issueId?: number; label?: string }) =>
    json<{ queued: boolean }>('/api/downloads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  cancelDownload: (id: number) => json<{ cancelled: boolean }>(`/api/downloads/queue/${id}`, { method: 'DELETE' }),
  retryDownload: (id: number) => json<{ retried: boolean }>(`/api/downloads/queue/${id}/retry`, { method: 'POST' }),
  moveDownload: (id: number, index: number) =>
    json<{ moved: boolean }>(`/api/downloads/queue/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }),
    }),
  clearDownloadHistory: () => json<{ cleared: boolean }>('/api/downloads/history', { method: 'DELETE' }),

  getLibraryBooks: ({ readState, publisher }: { readState: ReadState; publisher?: string | null }) => {
    const params = new URLSearchParams({ readState })
    if (publisher) params.set('publisher', publisher)
    return json<{ books: ApiLibraryBook[] }>(`/api/books?${params}`)
  },

  getEditionIssues: (id: string | number, refresh = false) =>
    json<ApiEditionIssues>(`/api/editions/${id}/issues${refresh ? '?refresh=1' : ''}`),

  /** Download the one scraped release that is this missing issue, into this edition. */
  downloadMissingIssue: (editionId: string | number, cvIssueId: number) =>
    json<{ started: boolean }>(`/api/editions/${editionId}/issues/${cvIssueId}/download`, { method: 'POST' }),

  /** Every gap in this volume the index can fill, in one press. Answers with how many it
   *  is about to queue; the rows themselves arrive over the following minutes. */
  downloadAllMissing: (editionId: string | number) =>
    json<{ queued: number }>(`/api/editions/${editionId}/issues/download-all`, { method: 'POST' }),

  issueVolume: (issueId: number | string) =>
    json<{ volume: { id: number; name: string | null; startYear: number | null; publisher: string | null; editionName: string | null } | null }>(
      `/api/comicvine/issues/${issueId}/volume`,
    ),

  checkComicVineVolume: (id: string | number) =>
    json<{ matched: boolean; edition?: ApiEdition }>(`/api/editions/${id}/comicvine-volume`, { method: 'POST' }),
  moveBookEdition: (id: string | number, name: string) =>
    json<MoveBookEditionResponse>(`/api/books/${id}/edition`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    }),
  deleteBook: (id: string | number) =>
    json<DeleteBookResponse>(`/api/books/${id}`, { method: 'DELETE' }),
  deleteEdition: (id: string | number) =>
    json<DeleteEditionResponse>(`/api/editions/${id}`, { method: 'DELETE' }),
  deleteSeries: (name: string) =>
    json<DeleteSeriesResponse>(`/api/series/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /** Bare, the search answers with one entry per series. */
  groupComicIndex: (opts: ComicIndexQuery) =>
    json<ComicIndexGroupsResponse>(`/api/comic-index/search?${indexParams(opts)}`),

  /** Named a series, it answers with that group's rows. */
  searchComicIndex: (opts: ComicIndexQuery & { series?: string; kind?: ReleaseKind; run?: string }) =>
    json<ComicIndexSearchResponse>(`/api/comic-index/search?${indexParams(opts)}`),
  /** The link behind a post's "DOWNLOAD NOW" button; 404 when it only lists mirrors. */
  getComicIndexDownloadLink: (id: number) =>
    json<{ url: string }>(`/api/comic-index/${id}/download-link`),

  getComicIndexCategories: () => json<ComicIndexCategoriesResponse>('/api/comic-index/categories'),
  getScrapeStatus: () => json<ScrapeStatus>('/api/comic-index/scrape'),
  /** Which Comic Vine volumes a series heading could mean. Cached server-side for a day. */
  getComicVineVolumes: (series: string) =>
    json<CvVolumesResponse>(`/api/comicvine/volumes?series=${encodeURIComponent(series)}`),
  startScrape: (mode: 'quick' | 'full') =>
    json<StartScrapeResponse>('/api/comic-index/scrape', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }),
    }),
}
