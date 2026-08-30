import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Edition from '../src/pages/Edition'

const EDITION = {
  id: 9,
  name: 'Amazing Spider-Man (2025)',
  seriesName: 'Amazing Spider-Man',
  summary: null,
}

let patched: { url: string; body: Record<string, unknown> }[]

function mockFetch(edition: Record<string, unknown> = EDITION) {
  patched = []
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ edition }) }
    }
    return { ok: true, json: async () => ({ edition, books: [] }) }
  }) as unknown as typeof fetch
}

beforeEach(() => { mockFetch() })
afterEach(() => { cleanup() })

function renderPage(path = '/edition/9') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/edition/:id" element={<Edition />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

async function startEditing() {
  fireEvent.click(await screen.findByLabelText(/edit edition/i))
}

test('the edit row offers a series field holding the current series', async () => {
  renderPage()
  await startEditing()
  expect(screen.getByLabelText(/^series$/i)).toHaveValue('Amazing Spider-Man')
})

test('the series field is empty when the edition has no series', async () => {
  mockFetch({ ...EDITION, seriesName: null })
  renderPage()
  await startEditing()
  expect(screen.getByLabelText(/^series$/i)).toHaveValue('')
})

test('changing the series sends seriesName and leaves the name alone', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: 'Spider-Man' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({ seriesName: 'Spider-Man' })
})

test('changing the name still renames the edition', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/edition name/i), { target: { value: 'ASM (2025)' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({ name: 'ASM (2025)' })
})

test('saving with nothing changed neither renames nor moves the edition', async () => {
  renderPage()
  await startEditing()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument())
  expect(patched).toEqual([])
})

test('a blank name is refused', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/edition name/i), { target: { value: '  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(patched).toEqual([])
})

test('the editor is a dialog, not shown until the pencil is clicked', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Amazing Spider-Man (2025)' })
  expect(screen.queryByRole('heading', { name: /edit edition/i })).not.toBeInTheDocument()

  await startEditing()
  expect(screen.getByRole('heading', { name: /edit edition/i })).toBeInTheDocument()
})

test('cancelling the dialog closes it and saves nothing', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: 'Something Else' } })
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

  expect(screen.queryByRole('heading', { name: /edit edition/i })).not.toBeInTheDocument()
  expect(patched).toEqual([])
})

test('the dialog closes once a save succeeds', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: 'Spider-Man' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: /edit edition/i })).not.toBeInTheDocument())
})

test('a status in the url is sent to the edition endpoint', async () => {
  renderPage('/edition/9?status=unread')
  await waitFor(() => {
    const urls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/editions/9') && u.includes('readState=unread'))).toBe(true)
  })
})

test('a filtered edition says so and offers a way back to everything', async () => {
  renderPage('/edition/9?status=unread')
  expect(await screen.findByText(/showing unread issues/i)).toBeInTheDocument()
  const showAll = screen.getByRole('link', { name: /show all/i })
  expect(showAll).toHaveAttribute('href', '/edition/9')
})

test('an unfiltered edition shows no filter notice', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Amazing Spider-Man (2025)' })
  expect(screen.queryByText(/showing .* issues/i)).not.toBeInTheDocument()
})
