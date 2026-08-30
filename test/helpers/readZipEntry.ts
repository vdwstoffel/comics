import yauzl from 'yauzl'

/** Read one entry out of a zip as utf8, or null when the archive has no such entry. */
export function readZipEntry(zipPath: string, name: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      zip.on('entry', (e) => {
        if (e.fileName === name) {
          zip.openReadStream(e, async (er, s) => {
            if (er || !s) { zip.close(); return reject(er) }
            const chunks: Buffer[] = []; for await (const c of s) chunks.push(c as Buffer)
            zip.close(); resolve(Buffer.concat(chunks).toString('utf8'))
          })
        } else zip.readEntry()
      })
      zip.on('end', () => { zip.close(); resolve(null) })
      zip.readEntry()
    })
  })
}
