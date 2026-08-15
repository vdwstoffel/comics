import { test, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { registerSpa } from '../server/index.js'

test('registerSpa serves index.html for unknown non-api routes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spa-'))
  const dist = join(dir, 'dist'); mkdirSync(dist)
  writeFileSync(join(dist, 'index.html'), '<html>app</html>')
  const app = Fastify()
  await app.register(fastifyStatic, { root: dist })
  registerSpa(app, dist)
  const res = await app.inject({ url: '/series/1' })
  expect(res.statusCode).toBe(200)
  expect(res.body).toContain('app')
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})
