import { stat, statfs } from 'node:fs/promises'
import { directorySize } from '../lib/dirSize.js'
import type { Config } from '../config.js'

/** What the disk holds, in bytes: the whole filesystem, then our share of it by kind. */
export interface StorageView {
  /** The filesystem the data dir sits on - the library's share of it is usually small. */
  total: number
  free: number
  comics: number
  covers: number
  database: number
  temp: number
}

export interface Storage {
  read(): Promise<StorageView>
}

/**
 * Long enough that opening the pane twice costs one walk, short enough that a download
 * finishing while you watch shows up on the next visit rather than the next restart.
 */
const DEFAULT_TTL_MS = 60_000

/** A file that may not exist yet - an install before its first write - weighs nothing. */
async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/**
 * What the server is holding, and what room is left for more of it.
 *
 * The four kinds are measured separately because they answer different questions: comics
 * is the library, covers and database are the price of indexing it, and temp should be
 * near zero - a large one means staging files outlived the runs that made them.
 *
 * Cached, because the comics walk is a stat per file and the pane asks on every visit.
 * The promise is what is held, not the result, so two visitors arriving together share
 * one walk instead of starting two.
 */
export function createStorage(config: Config, opts: { ttlMs?: number } = {}): Storage {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  let cached: { at: number; view: Promise<StorageView> } | null = null

  async function measure(): Promise<StorageView> {
    const [comics, covers, temp, db, wal, shm, disk] = await Promise.all([
      directorySize(config.comicsDir),
      directorySize(config.thumbsDir),
      directorySize(config.tmpDir),
      fileSize(config.dbPath),
      // sqlite keeps the write-ahead log and its index beside the database. They are the
      // database as far as the disk is concerned, and the log is not a rounding error.
      fileSize(`${config.dbPath}-wal`),
      fileSize(`${config.dbPath}-shm`),
      // The data dir rather than the comics dir: it is the one path that exists on every
      // install, and in the container it is the mount whose free space is the real limit.
      statfs(config.dataDir),
    ])
    return {
      total: Number(disk.bsize) * Number(disk.blocks),
      // What this user may actually fill, not counting the root reserve, which is not
      // room the app will ever get to use.
      free: Number(disk.bsize) * Number(disk.bavail),
      comics,
      covers,
      database: db + wal + shm,
      temp,
    }
  }

  return {
    read(): Promise<StorageView> {
      const now = Date.now()
      if (cached && now - cached.at < ttlMs) return cached.view
      // A failed walk is not worth remembering for a minute: clearing it means the next
      // visit tries again rather than being handed the same error until the ttl runs out.
      const entry: { at: number; view: Promise<StorageView> } = {
        at: now,
        view: measure().catch((err) => {
          if (cached === entry) cached = null
          throw err
        }),
      }
      cached = entry
      return entry.view
    },
  }
}
