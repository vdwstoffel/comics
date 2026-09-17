import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface Config {
  dataDir: string
  port: number
  maxUploadBytes: number
  comicsDir: string
  thumbsDir: string
  tmpDir: string
  dbPath: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.DATA_DIR || './data')
  const config: Config = {
    dataDir,
    port: Number(env.PORT || 3000),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 5368709120),
    comicsDir: join(dataDir, 'comics'),
    thumbsDir: join(dataDir, 'thumbnails'),
    tmpDir: join(dataDir, 'tmp'),
    dbPath: join(dataDir, 'library.sqlite'),
  }
  for (const dir of [config.comicsDir, config.thumbsDir, config.tmpDir]) {
    mkdirSync(dir, { recursive: true })
  }
  return config
}
