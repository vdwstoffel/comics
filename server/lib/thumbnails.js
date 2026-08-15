import sharp from 'sharp'
import { readPage } from './cbz.js'

async function streamToBuffer(stream) {
  const chunks = []
  for await (const c of stream) chunks.push(c)
  return Buffer.concat(chunks)
}

export async function generateCover(cbzPath, outPath, width = 400) {
  const { stream } = await readPage(cbzPath, 0)
  const buf = await streamToBuffer(stream)
  await sharp(buf).resize({ width }).webp({ quality: 80 }).toFile(outPath)
}
