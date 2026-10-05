import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Following from '../src/pages/Following'
import { api } from '../src/api'

const BOOK = {
  id: 9, editionId: 1, editionName: 'Iron Man', seriesName: 'Iron Man', arcs: [],
  title: 'Iron Man', number: '6', pageCount: 20, comicinfoSynced: false,
  readState: 'unread' as const, percent: 0,
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Following /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [] })
  // The rail beside the shelf asks for these; stub them so nothing reaches the network.
  vi.spyOn(api, 'getPublishers').mockResolvedValue({ publishers: [] })
  vi.spyOn(api, 'getEditions').mockResolvedValue({ editions: [] })
  vi.spyOn(api, 'getReadStates').mockResolvedValue({ readStates: [] })
  vi.spyOn(api, 'getArcs').mockResolvedValue({ arcs: [] })
})

test('a follow with unread issues draws the run, not a waiting tile', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [BOOK] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'supplied' }],
  })
  show()
  expect(await screen.findByRole('link', { name: /Iron Man #6/ })).toBeInTheDocument()
  expect(document.querySelector('.follow-waiting')).toBeNull()
  expect(document.querySelector('.follow-item__status')).toBeNull()
})

test('a caught-up follow says what it is waiting for', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'caught-up' }],
  })
  show()
  expect(await screen.findByText('Iron Man')).toBeInTheDocument()
  expect(screen.getByText(/waiting on the next issue to be announced/i)).toBeInTheDocument()
})

test('a follow waiting on an unposted issue names it', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{
      kind: 'volume', refId: 1, name: 'Iron Man', state: 'wanted',
      want: { id: 2, number: '7', name: null }, queued: false,
    }],
  })
  show()
  expect(await screen.findByText(/#7 is out — not posted yet/)).toBeInTheDocument()
})

test('a dormant follow explains what would start it', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'dormant' }],
  })
  show()
  expect(await screen.findByText(/finish an issue to pull the next/i)).toBeInTheDocument()
})

// The mixed case of spec §3.1: something to read AND something still missing.
test('a follow can offer a comic and still say it is waiting', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [BOOK] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{
      kind: 'volume', refId: 1, name: 'Iron Man', state: 'wanted',
      want: { id: 2, number: '7', name: null }, queued: true,
    }],
  })
  show()
  expect(await screen.findByRole('link', { name: /Iron Man #6/ })).toBeInTheDocument()
  expect(screen.getByText('Getting #7')).toBeInTheDocument()
})

test('an arc follow draws its arc tile', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({
    books: [{ ...BOOK, arcs: ['Death Spiral'] }],
  })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'arc', refId: 56676, name: 'Death Spiral', state: 'supplied' }],
  })
  show()
  const link = await screen.findByRole('link', { name: /Death Spiral/ })
  expect(link).toHaveAttribute('href', '/arcs/Death%20Spiral')
})

// groupByArc credits a book to every arc it carries; the shelf must draw the followed one.
test('an arc follow draws its own arc even when a tie-in lists another first', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({
    books: [{ ...BOOK, arcs: ['Maximum Carnage', 'Death Spiral'] }],
  })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'arc', refId: 56676, name: 'Death Spiral', state: 'supplied' }],
  })
  show()
  const link = await screen.findByRole('link', { name: /Death Spiral/ })
  expect(link).toHaveAttribute('href', '/arcs/Death%20Spiral')
  expect(screen.queryByRole('link', { name: /Maximum Carnage/ })).not.toBeInTheDocument()
})

test('a volume follow ignores unread books from another edition', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [{ ...BOOK, editionId: 2 }] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'caught-up' }],
  })
  show()
  expect(await screen.findByText(/waiting on the next issue/i)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Iron Man #6/ })).not.toBeInTheDocument()
})

test('an arc follow ignores unread books that do not carry its arc', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [{ ...BOOK, arcs: ['Other'] }] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'arc', refId: 5, name: 'Death Spiral', state: 'caught-up' }],
  })
  show()
  expect(await screen.findByText(/waiting on the next issue/i)).toBeInTheDocument()
  expect(document.querySelector('.follow-waiting')).not.toBeNull()
})

// Until the unread books arrive every follow looks empty; no waiting claim may be made.
test('nothing is claimed about a follow while the unread books are still loading', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockReturnValue(new Promise(() => {}))
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'dormant' }],
  })
  show()
  expect(await screen.findByText('Loading…')).toBeInTheDocument()
  await waitFor(() => expect(api.getFollows).toHaveBeenCalled())
  expect(screen.queryByText(/finish an issue to pull the next/i)).not.toBeInTheDocument()
  expect(document.querySelector('.follow-waiting')).toBeNull()
})

test('unfollowing asks the server', async () => {
  const unfollow = vi.spyOn(api, 'unfollow').mockResolvedValue({ unfollowed: true })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'caught-up' }],
  })
  show()
  fireEvent.click(await screen.findByRole('button', { name: /unfollow iron man \(run\)/i }))
  await waitFor(() => expect(unfollow).toHaveBeenCalledWith('volume', 1))
})

test('an empty shelf explains itself rather than looking broken', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [] })
  show()
  expect(await screen.findByText(/not following anything yet/i)).toBeInTheDocument()
})
