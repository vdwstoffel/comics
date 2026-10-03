import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { getArcOrder, saveArcOrder, clearArcOrder } from '../server/models/arcOrder.js'
import { cacheArc } from '../server/models/arcCache.js'

test('an order you save comes back in the order you saved it', () => {
  const db = openDb(':memory:')

  saveArcOrder(db, 61356, [1193040, 1193032, 1193070])

  expect(getArcOrder(db, 61356)).toEqual([1193040, 1193032, 1193070])
  db.close()
})

test('rearranging an arc replaces the order rather than adding to it', () => {
  const db = openDb(':memory:')

  saveArcOrder(db, 61356, [1, 2, 3])
  saveArcOrder(db, 61356, [3, 1])

  expect(getArcOrder(db, 61356)).toEqual([3, 1])
  db.close()
})

test('an id sent twice is stored once rather than failing the whole save', () => {
  const db = openDb(':memory:')

  saveArcOrder(db, 61356, [1, 2, 1, 3])

  expect(getArcOrder(db, 61356)).toEqual([1, 2, 3])
  db.close()
})

// The reason this is its own table. cacheArc wipes and rewrites arc_issue on every
// refresh; an arrangement kept alongside the issues would be thrown out with them.
test('a refresh that rewrites the arc leaves your arrangement alone', () => {
  const db = openDb(':memory:')
  saveArcOrder(db, 61356, [1193040, 1193032])

  cacheArc(db, 61356, {
    id: 61356,
    name: '"Batman" Bad Seeds',
    issues: [
      { id: 1193032, number: '7', volumeName: 'Batwoman', storeDate: '2026-09-16' },
      { id: 1193040, number: '1113', volumeName: 'Detective Comics', storeDate: '2026-09-16' },
    ],
  })

  expect(getArcOrder(db, 61356)).toEqual([1193040, 1193032])
  db.close()
})

test('clearing an arrangement drops the arc back to no order of its own', () => {
  const db = openDb(':memory:')
  saveArcOrder(db, 61356, [1, 2, 3])

  clearArcOrder(db, 61356)

  expect(getArcOrder(db, 61356)).toEqual([])
  db.close()
})
