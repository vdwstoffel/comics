import type { FastifyInstance } from 'fastify'
import type DatabaseType from 'better-sqlite3'
import type { Config } from './config.js'
import type { ScrapeRunner } from './services/comicIndexScraper.js'

export type Db = DatabaseType.Database

// --- Model output shapes (camelCase) ---

export interface Series {
  id: number
  name: string
  folder: string
  publisher: string | null
  summary: string | null
  comicvineId: number | null
  /** Franchise this series belongs to; derived from the name, correctable by hand. */
  groupName: string | null
  createdAt: string
  bookCount?: number
}

export interface Book {
  id: number
  seriesId: number
  filePath: string
  title: string | null
  number: string | null
  pageCount: number
  fileSize: number
  writer: string | null
  penciller: string | null
  summary: string | null
  date: string | null
  comicvineId: number | null
  comicinfoSynced: boolean
  addedAt: string
  year: number | null
  coverUrl: string | null
  cvSiteUrl: string | null
  publisher: string | null
}

export interface ComicIndexEntry {
  title: string
  url: string
  category: string
}

export interface ComicIndexRow extends ComicIndexEntry {
  id: number
  // Derived from the title on insert; see lib/comicTitle.ts
  number: string | null
  year: number | null
  importedAt: string
}

export interface Progress {
  bookId: number
  lastPage: number
  completed: boolean
  updatedAt: string | null
}

export interface Ctx {
  db: Db
  config: Config
}

// --- ComicInfo metadata shape ---
export interface ComicMeta {
  title?: string
  series?: string
  number?: string
  writer?: string
  penciller?: string
  summary?: string
  publisher?: string
  date?: string
}

// --- Fastify decorations ---
declare module 'fastify' {
  interface FastifyInstance {
    config: Config
    db: Db
    scraper: ScrapeRunner
  }
}

export type App = FastifyInstance
