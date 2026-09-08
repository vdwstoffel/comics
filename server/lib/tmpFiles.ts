import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Empty the tmp dir, keeping the directory itself, and report how many entries went.
 *
 * Uploads and downloads both stage a comic here under a uuid and clean up after
 * themselves — except when the process dies mid-write, which leaves a partial file
 * nothing owns. Startup is the one moment clearing this is provably safe: no request has
 * been accepted yet, so anything present belongs to a run that is already over. A
 * periodic sweep could not say that, and would eventually delete a download in flight.
 *
 * A directory that is not there yet, or a single entry that refuses to go, is not worth
 * failing a boot over.
 */
export async function clearTmpDir(tmpDir: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(tmpDir)
  } catch {
    return 0
  }

  let removed = 0
  for (const entry of entries) {
    try {
      await rm(join(tmpDir, entry), { recursive: true, force: true })
      removed++
    } catch {
      // Something is holding it. Leaving one stray file behind beats refusing to start.
    }
  }
  return removed
}
