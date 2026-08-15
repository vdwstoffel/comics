import archiver from 'archiver'
import sharp from 'sharp'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'

async function tinyPng(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: color },
  })
    .png()
    .toBuffer()
}

/** Write a .cbz containing one tiny PNG per entry in `filenames`. */
export async function makeCbz(dir: string, filenames: string[], outName = 'test.cbz'): Promise<string> {
  const outPath = join(dir, outName)
  const out = createWriteStream(outPath)
  const zip = archiver('zip', { store: true })
  zip.pipe(out)
  let i = 0
  for (const name of filenames) {
    const png = await tinyPng({ r: (i * 40) % 255, g: 0, b: 0 })
    zip.append(png, { name })
    i++
  }
  await zip.finalize()
  await new Promise((res) => out.on('close', res))
  return outPath
}
