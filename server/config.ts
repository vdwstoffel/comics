import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface Config {
  dataDir: string
  port: number
  maxUploadBytes: number
  /**
   * The most one download may be. Not the upload limit: a long run in one zip is ten
   * gigabytes, where no single comic is near five. Whether the disk has room is asked
   * separately, of the disk, before each download starts.
   */
  maxDownloadBytes: number
  comicsDir: string
  thumbsDir: string
  tmpDir: string
  /**
   * Collections unpacked and waiting for review. Not under tmpDir on purpose: startup
   * empties tmp, and a collection sitting here can be days old and still wanted.
   */
  stagingDir: string
  dbPath: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.DATA_DIR || './data')
  const config: Config = {
    dataDir,
    port: Number(env.PORT || 3000),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 5368709120),
    maxDownloadBytes: Number(env.MAX_DOWNLOAD_BYTES || 53687091200),
    comicsDir: join(dataDir, 'comics'),
    thumbsDir: join(dataDir, 'thumbnails'),
    tmpDir: join(dataDir, 'tmp'),
    stagingDir: join(dataDir, 'collections'),
    dbPath: join(dataDir, 'library.sqlite'),
  }
  for (const dir of [config.comicsDir, config.thumbsDir, config.tmpDir, config.stagingDir]) {
    mkdirSync(dir, { recursive: true })
  }
  return config
}
