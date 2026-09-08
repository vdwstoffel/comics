import { test, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearTmpDir } from '../server/lib/tmpFiles.js'

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'tmpf-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// A process killed mid-download leaves its partial file behind; nothing else ever did.
test('a leftover from a previous run is removed and counted', async () => {
  const { dir, cleanup } = scratch()
  try {
    writeFileSync(join(dir, 'abandoned.cbz'), 'half a comic')
    writeFileSync(join(dir, 'another.cbr'), 'x')

    expect(await clearTmpDir(dir)).toBe(2)
    expect(readdirSync(dir)).toEqual([])
  } finally { cleanup() }
})

test('the directory itself survives, since everything writes into it', async () => {
  const { dir, cleanup } = scratch()
  try {
    writeFileSync(join(dir, 'x.cbz'), 'x')
    await clearTmpDir(dir)
    expect(existsSync(dir)).toBe(true)
  } finally { cleanup() }
})

test('a directory that is not there yet is not an error', async () => {
  const { dir, cleanup } = scratch()
  try {
    expect(await clearTmpDir(join(dir, 'missing'))).toBe(0)
  } finally { cleanup() }
})

test('a nested directory goes too', async () => {
  const { dir, cleanup } = scratch()
  try {
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, 'nested', 'x.cbz'), 'x')

    expect(await clearTmpDir(dir)).toBe(1)
    expect(readdirSync(dir)).toEqual([])
  } finally { cleanup() }
})

test('an empty directory reports nothing to do', async () => {
  const { dir, cleanup } = scratch()
  try {
    expect(await clearTmpDir(dir)).toBe(0)
  } finally { cleanup() }
})
