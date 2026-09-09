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

export interface DownloadStatus {
  running: boolean
  url: string | null
  fileName: string | null
  received: number
  total: number
  error: string | null
  bookId: number | null
  startedAt: string | null
  finishedAt: string | null
}

export interface ApiVolumeIssue {
  id: number
  number?: string
  name?: string | null
  coverDate?: string
  siteUrl?: string
  owned: boolean
  bookId?: number
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
}

export interface ApiStoryArcSummary {
  name: string
  owned: number
}

export interface ApiArcIssue {
  id: number
  name?: string
  siteUrl?: string
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

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`${res.status}`)
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

  getDownload: () => json<DownloadStatus>('/api/downloads'),

  startDownload: (body: { url: string; edition?: string; issueId?: number }) =>
    json<{ started: boolean; status: DownloadStatus }>('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getLibraryBooks: ({ readState, publisher }: { readState: ReadState; publisher?: string | null }) => {
    const params = new URLSearchParams({ readState })
    if (publisher) params.set('publisher', publisher)
    return json<{ books: ApiBook[] }>(`/api/books?${params}`)
  },

  getEditionIssues: (id: string | number, refresh = false) =>
    json<ApiEditionIssues>(`/api/editions/${id}/issues${refresh ? '?refresh=1' : ''}`),

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
  searchComicIndex: ({ q, category, yearFrom, yearTo, limit = 50, offset = 0 }: {
    q: string; category?: string; yearFrom?: number; yearTo?: number
    limit?: number; offset?: number
  }) => {
    const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) })
    if (category) params.set('category', category)
    if (yearFrom !== undefined) params.set('yearFrom', String(yearFrom))
    if (yearTo !== undefined) params.set('yearTo', String(yearTo))
    return json<ComicIndexSearchResponse>(`/api/comic-index/search?${params}`)
  },
  /** The link behind a post's "DOWNLOAD NOW" button; 404 when it only lists mirrors. */
  getComicIndexDownloadLink: (id: number) =>
    json<{ url: string }>(`/api/comic-index/${id}/download-link`),

  getComicIndexCategories: () => json<ComicIndexCategoriesResponse>('/api/comic-index/categories'),
  getScrapeStatus: () => json<ScrapeStatus>('/api/comic-index/scrape'),
  startScrape: (mode: 'quick' | 'full') =>
    json<StartScrapeResponse>('/api/comic-index/scrape', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }),
    }),
}
