import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  enqueue, takeNext, finish, fail, listQueue, listHistory, move, remove,
  retry, clearHistory, recoverRunning, pruneHistory, findLiveByIssue,
} from '../server/models/downloadQueue.js'

const db = () => openDb(':memory:')
const req = (n: number) => ({ url: `https://x.test/${n}`, label: `Item ${n}`, cvIssueId: 1000 + n })

test('enqueue assigns positions in the order things arrive', () => {
  const d = db()
  enqueue(d, req(1)); enqueue(d, req(2)); enqueue(d, req(3))
  expect(listQueue(d).map((e) => e.label)).toEqual(['Item 1', 'Item 2', 'Item 3'])
})

// The duplicate guard is the partial unique index, not a read-then-write: two presses in
// the same tick both reach the insert and the database rejects the second.
test('an issue already queued cannot be queued again', () => {
  const d = db()
  const first = enqueue(d, req(1))
  const second = enqueue(d, req(1))
  expect(first.queued).toBe(true)
  expect(second.queued).toBe(false)
  if (!second.queued) expect(second.duplicate.label).toBe('Item 1')
  expect(listQueue(d)).toHaveLength(1)
})

// The index covers live rows only, so finishing frees the issue to be fetched again.
test('a finished issue can be queued again', () => {
  const d = db()
  const first = enqueue(d, req(1))
  if (!first.queued) throw new Error('unreachable')
  finish(d, first.entry.id, { bookId: 7, fileName: 'x.cbz' })
  expect(enqueue(d, req(1)).queued).toBe(true)
})

// A pasted url carries no issue id, so the partial index does not apply to it.
test('two pasted urls with no issue id are both accepted', () => {
  const d = db()
  expect(enqueue(d, { url: 'https://x.test/a' }).queued).toBe(true)
  expect(enqueue(d, { url: 'https://x.test/a' }).queued).toBe(true)
})

test('takeNext marks the row running and hands it over once', () => {
  const d = db()
  enqueue(d, req(1)); enqueue(d, req(2))
  const first = takeNext(d)
  expect(first?.label).toBe('Item 1')
  expect(first?.state).toBe('running')
  expect(takeNext(d)?.label).toBe('Item 2')
  expect(takeNext(d)).toBeUndefined()
})

// not_before is what makes a retry a retry rather than a spin.
test('takeNext skips a row whose retry is still in the future', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d)
  fail(d, e.entry.id, 'boom', { retryAt: '2999-01-01T00:00:00.000Z' })
  expect(takeNext(d, '2026-09-15T00:00:00.000Z')).toBeUndefined()
  expect(takeNext(d, '2999-06-01T00:00:00.000Z')?.label).toBe('Item 1')
})

test('a failure with a retry goes back to the queue with attempts counted', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d)
  fail(d, e.entry.id, 'boom', { retryAt: '2026-01-01T00:00:00.000Z' })
  const [row] = listQueue(d)
  expect(row.state).toBe('queued')
  expect(row.attempts).toBe(1)
  expect(row.error).toBe('boom')
})

test('a failure with no retry is final and lands in history', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d)
  fail(d, e.entry.id, 'boom')
  expect(listQueue(d)).toEqual([])
  expect(listHistory(d)[0]).toMatchObject({ state: 'failed', error: 'boom' })
})

test('move reorders without leaving gaps or collisions', () => {
  const d = db()
  const ids = [1, 2, 3, 4].map((n) => { const e = enqueue(d, req(n)); if (!e.queued) throw new Error('x'); return e.entry.id })
  expect(move(d, ids[3], 0)).toBe(true)
  expect(listQueue(d).map((e) => e.label)).toEqual(['Item 4', 'Item 1', 'Item 2', 'Item 3'])
  expect(move(d, ids[0], 3)).toBe(true)
  expect(listQueue(d).map((e) => e.label)).toEqual(['Item 4', 'Item 2', 'Item 3', 'Item 1'])
  expect(new Set(listQueue(d).map((e) => e.position)).size).toBe(4)
})

test('a running row cannot be moved and an index off the end is refused', () => {
  const d = db()
  const e = enqueue(d, req(1)); enqueue(d, req(2))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d)
  expect(move(d, e.entry.id, 1)).toBe(false)
  expect(move(d, 999, 0)).toBe(false)
})

// A restart is not the download's fault, so it must not spend a retry.
test('recoverRunning puts a casualty back at the front without counting an attempt', () => {
  const d = db()
  enqueue(d, req(1)); enqueue(d, req(2))
  takeNext(d)
  expect(recoverRunning(d)).toBe(1)
  const q = listQueue(d)
  expect(q.map((e) => e.label)).toEqual(['Item 1', 'Item 2'])
  expect(q[0]).toMatchObject({ state: 'queued', attempts: 0 })
  expect(q[0].startedAt).toBeUndefined()
})

test('retry puts a failed row back at the end with its attempts reset', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d); fail(d, e.entry.id, 'boom')
  enqueue(d, req(2))
  expect(retry(d, e.entry.id)).toBe(true)
  expect(listQueue(d).map((x) => x.label)).toEqual(['Item 2', 'Item 1'])
  expect(listQueue(d)[1].attempts).toBe(0)
})

test('remove takes a row out and clearHistory empties the finished ones', () => {
  const d = db()
  const a = enqueue(d, req(1)); const b = enqueue(d, req(2))
  if (!a.queued || !b.queued) throw new Error('unreachable')
  expect(remove(d, a.entry.id)).toBe(true)
  expect(listQueue(d).map((e) => e.label)).toEqual(['Item 2'])
  takeNext(d); finish(d, b.entry.id, { bookId: 1 })
  expect(listHistory(d)).toHaveLength(1)
  clearHistory(d)
  expect(listHistory(d)).toEqual([])
})

test('history is pruned to the newest few', () => {
  const d = db()
  for (let n = 1; n <= 5; n++) {
    const e = enqueue(d, { url: `https://x.test/${n}`, label: `Item ${n}` })
    if (!e.queued) throw new Error('unreachable')
    takeNext(d)
    finish(d, e.entry.id, { bookId: n }, `2026-09-1${n}T00:00:00.000Z`)
  }
  pruneHistory(d, 2)
  expect(listHistory(d).map((e) => e.label)).toEqual(['Item 5', 'Item 4'])
})

test('findLiveByIssue sees a queued issue and not a finished one', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  expect(findLiveByIssue(d, 1001)?.label).toBe('Item 1')
  takeNext(d); finish(d, e.entry.id, { bookId: 1 })
  expect(findLiveByIssue(d, 1001)).toBeUndefined()
})

// At concurrency above 1 a restart can catch several downloads in flight. They must come
// back with distinct positions, or listQueue has no defined order for them.
test('two interrupted downloads come back in order, each with its own position', () => {
  const d = db()
  enqueue(d, req(1)); enqueue(d, req(2)); enqueue(d, req(3))
  takeNext(d); takeNext(d)
  expect(recoverRunning(d)).toBe(2)
  const q = listQueue(d)
  expect(q.map((e) => e.label)).toEqual(['Item 1', 'Item 2', 'Item 3'])
  expect(new Set(q.map((e) => e.position)).size).toBe(3)
})
