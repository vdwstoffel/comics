import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import LibraryRail from '../src/components/LibraryRail'
import { api } from '../src/api'

function show(includeRead?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><LibraryRail includeRead={includeRead} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'getPublishers').mockResolvedValue({ publishers: [] })
  vi.spyOn(api, 'getEditions').mockResolvedValue({ editions: [] })
  vi.spyOn(api, 'getReadStates').mockResolvedValue({
    readStates: [{ name: 'unread', count: 2 }, { name: 'read', count: 1 }],
  } as never)
  vi.spyOn(api, 'getArcs').mockResolvedValue({ arcs: [] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [] })
})

test('the shelf rail offers Unread and no Read', async () => {
  show()
  expect(await screen.findByRole('button', { name: 'Unread' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Read' })).toBeNull()
})

test('a rail asked to include Read offers it', async () => {
  show(true)
  expect(await screen.findByRole('button', { name: 'Read' })).toBeInTheDocument()
})
