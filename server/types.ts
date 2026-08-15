import type { FastifyInstance } from 'fastify'
import type DatabaseType from 'better-sqlite3'
import type { Config } from './config.js'

export type Db = DatabaseType.Database

// --- Model output shapes (camelCase) ---

export interface Series {
  id: number
  name: string
  folder: string
  publisher: string | null
  summary: string | null
  comicvineId: number | null
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
  }
}

export type App = FastifyInstance
