import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function loadConfig(env = process.env) {
  const dataDir = resolve(env.DATA_DIR || './data')
  const config = {
    dataDir,
    port: Number(env.PORT || 3000),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 5368709120),
    comicVineApiKey: env.COMIC_VINE_API_KEY || '',
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
