import sharp from 'sharp'
import type { Readable } from 'node:stream'
import { readPage } from './cbz.js'

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

export async function generateCover(cbzPath: string, outPath: string, width = 400): Promise<void> {
  const { stream } = await readPage(cbzPath, 0)
  const buf = await streamToBuffer(stream)
  await sharp(buf).resize({ width }).webp({ quality: 80 }).toFile(outPath)
}
