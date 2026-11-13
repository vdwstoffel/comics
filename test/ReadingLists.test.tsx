import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import ReadingLists from '../src/pages/ReadingLists'
import { api } from '../src/api'

beforeEach(() => {
  vi.restoreAllMocks()
  // The rail beside the shelf; not what these tests are about.
  vi.spyOn(api, 'getPublishers').mockResolvedValue({ publishers: [] })
  vi.spyOn(api, 'getEditions').mockResolvedValue({ editions: [] })
  vi.spyOn(api, 'getReadStates').mockResolvedValue({ readStates: [] })
  vi.spyOn(api, 'getArcs').mockResolvedValue({ arcs: [] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [] })
})

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ReadingLists /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('each list is a tile that opens it, counted in Core', async () => {
  vi.spyOn(api, 'getReadingLists').mockResolvedValue({ lists: [{
    id: 1, slug: 'hickmans-avengers', name: "Hickman's Avengers", publisher: 'Marvel', years: '2012–2016',
    cover: 'https://cv/cover.jpg', total: 92, owned: 31,
  }] })
  show()
  const tile = await screen.findByRole('link', { name: /Hickman's Avengers/ })
  expect(tile).toHaveAttribute('href', '/lists/hickmans-avengers')
  expect(screen.getByText('31 of 92')).toBeInTheDocument()
})

test('no lists says so rather than drawing nothing', async () => {
  vi.spyOn(api, 'getReadingLists').mockResolvedValue({ lists: [] })
  show()
  expect(await screen.findByText('No reading lists yet.')).toBeInTheDocument()
})
