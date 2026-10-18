import type { FastifyInstance } from 'fastify'
import type DatabaseType from 'better-sqlite3'
import type { Config } from './config.js'
import type { DownloadRunner } from './services/downloader.js'
import type { ScrapeRunner } from './services/comicIndexScraper.js'

export type Db = DatabaseType.Database

// --- Model output shapes (camelCase) ---

export interface Edition {
  id: number
  name: string
  folder: string
  publisher: string | null
  summary: string | null
  comicvineId: number | null
  /** Series this edition belongs to; derived from the name, correctable by hand. */
  seriesName: string | null
  /** Comic Vine's own name for this volume, and the year its run started. */
  cvName: string | null
  cvStartYear: number | null
  /** Comic Vine's own page for this volume, stored rather than built: the canonical url
   *  carries a slug we cannot derive from the id. */
  cvSiteUrl: string | null
  /** The Comic Vine volume this edition REPRINTS, where `comicvineId` is the volume it
   *  IS. Both are right at once for a collected edition: "Amazing Spider-Man By Zeb
   *  Wells" is its own volume AND a bundle of The Amazing Spider-Man (2022)'s comics.
   *  Editions answering this the same way share a shelf. */
  collectsVolumeId: number | null
  /** Comic Vine's name and start year for that reprinted volume, denormalised so a shelf
   *  heading costs no request. */
  collectsCvName: string | null
  collectsCvStartYear: number | null
  collectsCvSiteUrl: string | null
  /** When we last worked out what this collects. Null means nobody has looked; set with
   *  a null `collectsVolumeId` means we looked and the answer was no - which is what
   *  stops a decline being proposed again on every page view. */
  collectsCheckedAt: string | null
  /** Comic Vine's suggestion as JSON, held apart from the confirmed link above: an
   *  answer nobody has agreed to must not move an edition between shelves. */
  collectsProposal: string | null
  createdAt: string
  bookCount?: number
}

export interface Book {
  id: number
  editionId: number
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
  credits?: Array<{ name: string; role: string }>
  characters?: string[]
  teams?: string[]
  storyArcs?: string[]
}

// --- Fastify decorations ---
declare module 'fastify' {
  interface FastifyInstance {
    config: Config
    db: Db
    scraper: ScrapeRunner
    downloader: DownloadRunner
  }
}

export type App = FastifyInstance
