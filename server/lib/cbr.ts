// node-unrar-js loads the whole archive into memory (one-time import cost).
import { createExtractorFromData } from 'node-unrar-js'
import archiver from 'archiver'
import { readFile, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { naturalCompare } from './naturalSort.js'

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i

export function isCbr(filePath: string): boolean {
  return /\.cbr$/i.test(filePath)
}

export interface ExtractedEntry {
  name: string
  data: Uint8Array
}

export interface ConvertOptions {
  /** Injected extractor for testing — receives file data, returns entries. */
  extract?: (data: Uint8Array) => Promise<ExtractedEntry[]>
}

export async function convertCbrToCbz(
  cbrPath: string,
  cbzPath: string,
  opts?: ConvertOptions,
): Promise<void> {
  const buf = await readFile(cbrPath)
  // Offset-safe Buffer → ArrayBuffer
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

  let entries: ExtractedEntry[]

  if (opts?.extract) {
    entries = await opts.extract(new Uint8Array(arrayBuffer))
  } else {
    const extractor = await createExtractorFromData({ data: arrayBuffer })

    // Collect non-directory entries we care about
    const { fileHeaders } = extractor.getFileList()
    const wantedNames: string[] = []
    for (const header of fileHeaders) {
      if (header.flags.directory) continue
      const name = header.name
      if (IMAGE_RE.test(name) || /ComicInfo\.xml$/i.test(name)) {
        wantedNames.push(name)
      }
    }

    const { files } = extractor.extract({ files: wantedNames })
    entries = []
    for (const file of files) {
      if (file.fileHeader.flags.directory) continue
      if (file.extraction) {
        entries.push({ name: file.fileHeader.name, data: file.extraction })
      }
    }
  }

  // Separate images and ComicInfo
  const images = entries
    .filter((e) => IMAGE_RE.test(e.name))
    .sort((a, b) => naturalCompare(a.name, b.name))
  const comicInfoEntries = entries.filter((e) => /ComicInfo\.xml$/i.test(e.name))

  if (images.length === 0) {
    throw new Error(`convertCbrToCbz: no image entries found in ${cbrPath}`)
  }

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(cbzPath)
    const zip = archiver('zip', { store: true })

    zip.pipe(out)

    out.on('close', resolve)
    out.on('error', reject)
    zip.on('error', async (err: Error) => {
      out.destroy()
      await unlink(cbzPath).catch(() => {})
      reject(err)
    })

    for (const img of images) {
      zip.append(Buffer.from(img.data), { name: img.name })
    }
    for (const ci of comicInfoEntries) {
      zip.append(Buffer.from(ci.data), { name: ci.name })
    }

    zip.finalize().catch(async (err: Error) => {
      await unlink(cbzPath).catch(() => {})
      reject(err)
    })
  })
}
