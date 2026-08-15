import archiver from 'archiver'
import yauzl from 'yauzl'
import type { Entry } from 'yauzl'
import { createWriteStream } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'

export function embedComicInfo(cbzPath: string, xmlString: string): Promise<void> {
  const tmpOut = `${cbzPath}.tmp-${Date.now()}`
  return new Promise<void>((resolve, reject) => {
    let settled = false
    function fail(err: unknown) {
      if (settled) return
      settled = true
      unlink(tmpOut).catch(() => {}).finally(() => reject(err))
    }
    function succeed() {
      if (settled) return
      settled = true
      resolve()
    }

    yauzl.open(cbzPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return fail(err ?? new Error('failed to open zip'))
      const out = createWriteStream(tmpOut)
      const archive = archiver('zip', { store: true })
      archive.on('error', fail)
      out.on('error', fail)
      archive.pipe(out)

      zip.on('entry', (entry: Entry) => {
        if (/\/$/.test(entry.fileName) || /(^|\/)ComicInfo\.xml$/i.test(entry.fileName)) {
          zip.readEntry() // skip dirs and any existing ComicInfo.xml
          return
        }
        zip.openReadStream(entry, (e, s) => {
          if (e || !s) return fail(e ?? new Error('failed to open read stream'))
          archive.append(s, { name: entry.fileName })
          s.on('end', () => zip.readEntry())
        })
      })
      zip.on('end', () => {
        archive.append(Buffer.from(xmlString, 'utf8'), { name: 'ComicInfo.xml' })
        archive.finalize().catch(fail)
      })
      zip.on('error', fail)
      out.on('close', async () => {
        try { await rename(tmpOut, cbzPath); succeed() }
        catch (e) { await unlink(tmpOut).catch(() => {}); fail(e) }
      })
      zip.readEntry()
    })
  })
}
