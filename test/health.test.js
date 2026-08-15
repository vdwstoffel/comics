import { test, expect } from 'vitest'
import { buildServer } from '../server/index.js'

test('GET /api/health returns ok', async () => {
  const app = await buildServer()
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ status: 'ok' })
  await app.close()
})
