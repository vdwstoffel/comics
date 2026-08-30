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
export interface EditionResponse { edition: ApiEdition }
export interface MoveBookEditionResponse { book: ApiBook; edition: ApiEdition }
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
  embed: (id: string | number) => json<BookResponse>(`/api/books/${id}/embed`, { method: 'POST' }),
  cvSearch: (q: string, type: string) =>
    json<CvSearchResponse>(`/api/comicvine/search?q=${encodeURIComponent(q)}&type=${type}`),
  applyIssue: (id: string | number, issueId: number) =>
    json<BookResponse>(`/api/books/${id}/comicvine`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ issueId }),
    }),
  renameEdition: (id: string | number, name: string) =>
    json<EditionResponse>(`/api/editions/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    }),
  moveBookEdition: (id: string | number, name: string) =>
    json<MoveBookEditionResponse>(`/api/books/${id}/edition`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    }),
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
  getComicIndexCategories: () => json<ComicIndexCategoriesResponse>('/api/comic-index/categories'),
  getScrapeStatus: () => json<ScrapeStatus>('/api/comic-index/scrape'),
  startScrape: (mode: 'quick' | 'full') =>
    json<StartScrapeResponse>('/api/comic-index/scrape', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }),
    }),
}
