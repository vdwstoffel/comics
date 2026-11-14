import archiver from 'archiver'
import { createWriteStream, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Write a zip of whatever it is given - comics, nested zips, junk - for the collection
 * tests. An entry given a path is read from disk; one given a string or Buffer is that.
 */
export async function makeZip(
  dir: string,
  entries: Array<{ name: string; path?: string; data?: string | Buffer }>,
  outName = 'pack.zip',
): Promise<string> {
  const outPath = join(dir, outName)
  const out = createWriteStream(outPath)
  const zip = archiver('zip', { store: true })
  zip.pipe(out)
  for (const e of entries) zip.append(e.path ? readFileSync(e.path) : e.data ?? '', { name: e.name })
  await zip.finalize()
  await new Promise((res) => out.on('close', res))
  return outPath
}
