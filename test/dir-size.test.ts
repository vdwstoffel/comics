import { test, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { directorySize } from '../server/lib/dirSize.js'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'dirsize-'))
}

test('a directory weighs the sum of the files under it, however deep', async () => {
  const dir = scratch()
  try {
    writeFileSync(join(dir, 'loose.cbz'), Buffer.alloc(1000))
    mkdirSync(join(dir, 'Saga', 'Volume 1'), { recursive: true })
    writeFileSync(join(dir, 'Saga', 'Volume 1', 'one.cbz'), Buffer.alloc(2500))
    expect(await directorySize(dir)).toBe(3500)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// tmp is emptied at boot and thumbnails is made on demand, so a dir that is not there
// yet is a normal state of the install rather than something to report as a failure.
test('a directory that is not there yet weighs nothing', async () => {
  expect(await directorySize(join(tmpdir(), 'dirsize-no-such-dir-4821'))).toBe(0)
})

// A symlinked comic lives on some other filesystem, or twice in this one. Following it
// would bill the library for bytes it does not occupy - and a link to a parent would
// walk forever.
test('a symlink is counted as the link it is, not the tree it points at', async () => {
  const dir = scratch()
  try {
    mkdirSync(join(dir, 'real'))
    writeFileSync(join(dir, 'real', 'big.cbz'), Buffer.alloc(5000))
    mkdirSync(join(dir, 'library'))
    symlinkSync(join(dir, 'real'), join(dir, 'library', 'elsewhere'), 'dir')
    expect(await directorySize(join(dir, 'library'))).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
