import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ComicVineMatchDialog from '../src/components/ComicVineMatchDialog'

const RESULTS = [
  { id: 99, name: 'The Amazing Spider-Man', issueNumber: '11', year: '2022', publisher: 'Marvel', cover: 'https://cv/2022.jpg' },
  { id: 77, name: 'The Amazing Spider-Man', issueNumber: '11', year: '2025', publisher: 'Marvel', cover: 'https://cv/2025.jpg' },
]

function searchUrls() {
  return (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/comicvine/search'))
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ results: RESULTS }) })) as unknown as typeof fetch
})

function renderDialog(props: Partial<Parameters<typeof ComicVineMatchDialog>[0]> = {}) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<ComicVineMatchDialog defaultQuery="Amazing Spider-Man #11" onPick={onPick} onClose={onClose} {...props} />)
  return { onPick, onClose }
}

test('opens with the query already in the field', async () => {
  renderDialog()
  expect(await screen.findByDisplayValue('Amazing Spider-Man #11')).toBeInTheDocument()
})

// Landing on results is the point of the prefill; making the user press Search on a
// query they did not type would waste the work.
test('searches for the prefilled query without waiting for a click', async () => {
  renderDialog()
  await waitFor(() => expect(searchUrls()).toHaveLength(1))
  expect(searchUrls()[0]).toContain(encodeURIComponent('Amazing Spider-Man #11'))
  expect(await screen.findAllByRole('img')).toHaveLength(2)
})

test('an empty prefill searches for nothing and waits', async () => {
  renderDialog({ defaultQuery: '' })
  await waitFor(() => expect(screen.getByPlaceholderText('Search Comic Vine')).toBeInTheDocument())
  expect(searchUrls()).toHaveLength(0)
})

test('each candidate shows its cover art', async () => {
  renderDialog()
  const covers = await screen.findAllByRole('img')
  expect(covers.map((img) => img.getAttribute('src'))).toEqual(['https://cv/2022.jpg', 'https://cv/2025.jpg'])
})

// Two printings of "#11" are told apart by year alone, so the caption has to survive
// the move to a grid.
test('candidates keep the number and year that tell two printings apart', async () => {
  renderDialog()
  expect(await screen.findByText('#11 · 2022 · Marvel')).toBeInTheDocument()
  expect(screen.getByText('#11 · 2025 · Marvel')).toBeInTheDocument()
})

test('a candidate with no cover still offers something to click', async () => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true, json: async () => ({ results: [{ id: 5, name: 'Saga', issueNumber: '1' }] }),
  })) as unknown as typeof fetch
  renderDialog()
  expect(await screen.findByRole('button', { name: /Saga/ })).toBeInTheDocument()
  expect(screen.queryAllByRole('img')).toHaveLength(0)
})

test('picking a candidate hands back the whole result', async () => {
  const { onPick } = renderDialog()
  fireEvent.click(await screen.findByRole('button', { name: /2025/ }))
  expect(onPick).toHaveBeenCalledWith(RESULTS[1])
})

test('editing the query and searching again replaces the candidates', async () => {
  renderDialog()
  await waitFor(() => expect(searchUrls()).toHaveLength(1))
  fireEvent.change(screen.getByPlaceholderText('Search Comic Vine'), { target: { value: 'saga' } })
  fireEvent.click(screen.getByText('Search'))
  await waitFor(() => expect(searchUrls()).toHaveLength(2))
  expect(searchUrls()[1]).toContain('q=saga')
})

test('a failed search says so', async () => {
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch
  renderDialog()
  expect(await screen.findByText('Search failed')).toBeInTheDocument()
})
