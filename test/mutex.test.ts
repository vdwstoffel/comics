import { test, expect } from 'vitest'
import { createMutex } from '../server/lib/mutex.js'

// Deterministic: no filesystem, no timing luck. If the mutex lets anything overlap, the
// recorded trace interleaves and this fails every single run.
test('sections never overlap, and run in call order', async () => {
  const lock = createMutex()
  const trace: string[] = []
  const section = (name: string, ticks: number) => lock(async () => {
    trace.push(`${name}:enter`)
    for (let i = 0; i < ticks; i++) await Promise.resolve()
    trace.push(`${name}:exit`)
  })

  await Promise.all([section('a', 5), section('b', 1), section('c', 3)])

  expect(trace).toEqual([
    'a:enter', 'a:exit', 'b:enter', 'b:exit', 'c:enter', 'c:exit',
  ])
})

// One caller throwing must not wedge the queue behind it.
test('a rejected section still lets the next one run', async () => {
  const lock = createMutex()
  const failed = lock(async () => { throw new Error('boom') })
  const after = lock(async () => 'ran')

  await expect(failed).rejects.toThrow('boom')
  await expect(after).resolves.toBe('ran')
})

test('the value a section returns is the value the caller gets', async () => {
  const lock = createMutex()
  await expect(lock(async () => 42)).resolves.toBe(42)
})
