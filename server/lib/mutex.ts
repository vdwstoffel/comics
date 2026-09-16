/**
 * Run functions one at a time, in call order.
 *
 * One process means a promise chain is a sufficient lock: there is no second event loop to
 * race with, and no file or advisory lock is needed. Keep critical sections small - every
 * caller waits for the one in front.
 */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    // Swallow here only so one caller's rejection cannot poison the queue behind it; the
    // rejection is still delivered to that caller through `run`.
    tail = run.catch(() => {})
    return run
  }
}

/**
 * The one lock held across "pick a free filename, then rename onto it", shared by every
 * writer into `comicsDir`: a download filing a comic (storeComic), a book moving edition
 * (library.moveBookToEdition) and the library-wide rename (renameFiles).
 *
 * It has to be one instance, not one per service. `dedupeDestPath` is synchronous, so it
 * cannot interleave with itself - but the `await rename` after it can, and two callers
 * holding DIFFERENT locks are handed the same free name exactly as if neither held one.
 * That destroys one file and fails the other's UNIQUE constraint on book.file_path.
 *
 * Keep each critical section to those two steps. Anything slow inside it - a Comic Vine
 * lookup, an ingest - makes every other writer wait for it.
 */
export const renameLock = createMutex()
