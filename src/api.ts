export interface ApiSeries {
  id: number
  name: string
  folder?: string
  publisher?: string | null
  summary?: string | null
  comicvineId?: number | null
  createdAt?: string
  bookCount?: number
}

export interface ApiBook {
  id: number
  seriesId: number
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

export interface PublisherFacet {
  name: string
  count: number
}

export interface ContinueReadingBook extends ApiBook {
  readState: 'unread' | 'reading' | 'read'
  percent: number
  seriesName: string
}

export interface SeriesListResponse { series: ApiSeries[] }
export interface ContinueReadingResponse { books: ContinueReadingBook[] }
export interface SeriesDetailResponse { series: ApiSeries; books: ApiBook[] }
export interface BookResponse { book: ApiBook; progress: ApiProgress; credits?: ApiCredit[]; tags?: ApiTag[] }
export interface ProgressResponse { progress: ApiProgress }
export interface CvSearchResponse { results: CvSearchResult[] }
export interface RenameSeriesResponse { series: ApiSeries }
export interface MoveBookSeriesResponse { book: ApiBook; series: ApiSeries }
export interface PublishersResponse { publishers: PublisherFacet[] }

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
  getSeries: (publisher?: string) => {
    const url = publisher ? `/api/series?publisher=${encodeURIComponent(publisher)}` : '/api/series'
    return json<SeriesListResponse>(url)
  },
  getPublishers: () => json<PublishersResponse>('/api/publishers'),
  getContinueReading: (publisher?: string) => {
    const url = publisher ? `/api/continue-reading?publisher=${encodeURIComponent(publisher)}` : '/api/continue-reading'
    return json<ContinueReadingResponse>(url)
  },
  getSeriesDetail: (id: string | number) => json<SeriesDetailResponse>(`/api/series/${id}`),
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
  renameSeries: (id: string | number, name: string) =>
    json<RenameSeriesResponse>(`/api/series/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    }),
  moveBookSeries: (id: string | number, name: string) =>
    json<MoveBookSeriesResponse>(`/api/books/${id}/series`, {
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
