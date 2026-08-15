import yauzl from 'yauzl'
import { naturalCompare } from './naturalSort.js'

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i

function openZip(cbzPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(cbzPath, { lazyEntries: true }, (err, zip) => {
      if (err) reject(err)
      else resolve(zip)
    })
  })
}

function collectImageEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = []
    zip.on('entry', (entry) => {
      if (!/\/$/.test(entry.fileName) && IMAGE_RE.test(entry.fileName)) {
        entries.push(entry)
      }
      zip.readEntry()
    })
    zip.on('end', () => resolve(entries))
    zip.on('error', reject)
    zip.readEntry()
  })
}

export async function listPages(cbzPath) {
  const zip = await openZip(cbzPath)
  try {
    const entries = await collectImageEntries(zip)
    return entries.map((e) => e.fileName).sort(naturalCompare)
  } finally {
    zip.close()
  }
}

export async function readPage(cbzPath, index) {
  // First pass: collect and sort entries to find the target filename
  const scanZip = await openZip(cbzPath)
  const entries = await collectImageEntries(scanZip)
  scanZip.close()
  entries.sort((a, b) => naturalCompare(a.fileName, b.fileName))
  const targetName = entries[index]?.fileName
  if (!targetName) {
    throw new Error(`page ${index} out of range (have ${entries.length})`)
  }

  // Second pass: open a fresh zip and stream the specific entry
  const zip = await openZip(cbzPath)
  const stream = await new Promise((resolve, reject) => {
    zip.on('entry', (entry) => {
      if (entry.fileName === targetName) {
        zip.openReadStream(entry, (err, s) => {
          if (err) {
            zip.close()
            reject(err)
          } else {
            resolve(s)
          }
        })
      } else {
        zip.readEntry()
      }
    })
    zip.on('end', () => reject(new Error(`entry ${targetName} not found`)))
    zip.on('error', reject)
    zip.readEntry()
  })
  stream.on('end', () => zip.close())
  stream.on('error', () => zip.close())
  return { stream, entryName: targetName }
}
