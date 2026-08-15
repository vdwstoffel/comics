import archiver from 'archiver'
import yauzl from 'yauzl'
import { createWriteStream } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'

export function embedComicInfo(cbzPath, xmlString) {
  const tmpOut = `${cbzPath}.tmp-${Date.now()}`
  return new Promise((resolve, reject) => {
    yauzl.open(cbzPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      const out = createWriteStream(tmpOut)
      const archive = archiver('zip', { store: true })
      archive.on('error', reject)
      archive.pipe(out)

      zip.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName) || /(^|\/)ComicInfo\.xml$/i.test(entry.fileName)) {
          zip.readEntry() // skip dirs and any existing ComicInfo.xml
          return
        }
        zip.openReadStream(entry, (e, s) => {
          if (e) return reject(e)
          archive.append(s, { name: entry.fileName })
          s.on('end', () => zip.readEntry())
        })
      })
      zip.on('end', async () => {
        archive.append(Buffer.from(xmlString, 'utf8'), { name: 'ComicInfo.xml' })
        await archive.finalize()
      })
      zip.on('error', reject)
      out.on('close', async () => {
        try { await rename(tmpOut, cbzPath); resolve() }
        catch (e) { await unlink(tmpOut).catch(() => {}); reject(e) }
      })
      zip.readEntry()
    })
  })
}
