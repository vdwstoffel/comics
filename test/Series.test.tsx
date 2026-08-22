import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Series from '../src/pages/Series'

const SERIES = {
  id: 9,
  name: 'Amazing Spider-Man (2025)',
  groupName: 'Amazing Spider-Man',
  summary: null,
}

let patched: { url: string; body: Record<string, unknown> }[]

function mockFetch(series: Record<string, unknown> = SERIES) {
  patched = []
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patched.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ series }) }
    }
    return { ok: true, json: async () => ({ series, books: [] }) }
  }) as unknown as typeof fetch
}

beforeEach(() => { mockFetch() })
afterEach(() => { cleanup() })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/series/9']}>
        <Routes><Route path="/series/:id" element={<Series />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

async function startEditing() {
  fireEvent.click(await screen.findByLabelText(/edit series/i))
}

test('the edit row offers a group field holding the current group', async () => {
  renderPage()
  await startEditing()
  expect(screen.getByLabelText(/group/i)).toHaveValue('Amazing Spider-Man')
})

test('the group field is empty when the series has no group', async () => {
  mockFetch({ ...SERIES, groupName: null })
  renderPage()
  await startEditing()
  expect(screen.getByLabelText(/group/i)).toHaveValue('')
})

test('changing the group sends groupName and leaves the name alone', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/group/i), { target: { value: 'Spider-Man' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({ groupName: 'Spider-Man' })
})

test('changing the name still renames the series', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/series name/i), { target: { value: 'ASM (2025)' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({ name: 'ASM (2025)' })
})

test('saving with nothing changed does not rename or regroup', async () => {
  renderPage()
  await startEditing()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument())
  expect(patched).toEqual([])
})

test('a blank name is refused', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/series name/i), { target: { value: '  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(patched).toEqual([])
})

test('the editor is a dialog, not shown until the pencil is clicked', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Amazing Spider-Man (2025)' })
  expect(screen.queryByRole('heading', { name: /edit series/i })).not.toBeInTheDocument()

  await startEditing()
  expect(screen.getByRole('heading', { name: /edit series/i })).toBeInTheDocument()
})

test('cancelling the dialog closes it and saves nothing', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/group/i), { target: { value: 'Something Else' } })
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

  expect(screen.queryByRole('heading', { name: /edit series/i })).not.toBeInTheDocument()
  expect(patched).toEqual([])
})

test('the dialog closes once a save succeeds', async () => {
  renderPage()
  await startEditing()
  fireEvent.change(screen.getByLabelText(/group/i), { target: { value: 'Spider-Man' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: /edit series/i })).not.toBeInTheDocument())
})
