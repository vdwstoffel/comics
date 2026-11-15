import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import ReadingLists from '../src/pages/ReadingLists'
import type { ApiReadingListSummary } from '../src/api'
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

/** A list you own all of and have not started; each test changes what it is about. */
function summary(over: Partial<ApiReadingListSummary> = {}): ApiReadingListSummary {
  return {
    id: 1, slug: 'hickmans-avengers', name: "Hickman's Avengers", publisher: 'Marvel', years: '2012–2016',
    description: 'Everything dies.', cover: 'https://cv/cover.jpg',
    size: { core: 92, full: 409 }, length: 'core', total: 92, read: 0, next: null,
    ...over,
  }
}

test('each list is a row that opens it, and says what it is, how big, and that you have not started', async () => {
  vi.spyOn(api, 'getReadingLists').mockResolvedValue({ lists: [summary()] })
  show()
  const row = await screen.findByRole('link', { name: "Hickman's Avengers" })
  expect(row).toHaveAttribute('href', '/lists/hickmans-avengers')
  // The tab says whose it is - and with one publisher there is no tab to choose.
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(screen.getByText('2012–2016 · 92 issues · 409 with tie-ins')).toBeInTheDocument()
  expect(screen.getByText('Everything dies.')).toBeInTheDocument()
  expect(screen.getByText('Not started')).toBeInTheDocument()
  // An unread list is opened, not continued.
  expect(screen.queryByRole('link', { name: /Continue/ })).not.toBeInTheDocument()
  // The cover is not what you pick a story by.
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

test('a list without a description, years or tie-ins leaves them out, not blank', async () => {
  vi.spyOn(api, 'getReadingLists').mockResolvedValue({ lists: [summary({
    slug: 'bare', name: 'Bare', years: null, description: null, size: { core: 4, full: 4 }, total: 4,
  })] })
  show()
  await screen.findByRole('link', { name: 'Bare' })
  expect(screen.getByText('4 issues')).toBeInTheDocument()
  expect(document.querySelector('.list-shelf__deck')).toBeNull()
})

test('a list you are reading says how far, and continues at the next comic', async () => {
  vi.spyOn(api, 'getReadingLists').mockResolvedValue({ lists: [summary({
    length: 'full', total: 409, read: 34, next: { bookId: 77, label: 'Avengers #12' },
  })] })
  show()
  expect(await screen.findByText('34 of 409 read')).toBeInTheDocument()
  // What you have of it is the list page's to say.
  expect(screen.queryByText(/missing/)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Continue · Avengers #12' })).toHaveAttribute('href', '/read/77')
})

test('a list read to the end says so', async () => {
  vi.spyOn(api, 'getReadingLists').mockResolvedValue({ lists: [summary({ read: 92 })] })
  show()
  expect(await screen.findByText('Finished')).toBeInTheDocument()
})

test('each publisher has a tab, Marvel first, and opens on the stories you are in, then the order they came out, finished last', async () => {
  vi.spyOn(api, 'getReadingLists').mockResolvedValue({ lists: [
    summary({ id: 1, slug: 'done', name: 'Done', years: '1991', read: 92 }),
    summary({ id: 2, slug: 'later', name: 'Later', years: '2012–2016' }),
    summary({ id: 3, slug: 'earlier', name: 'Earlier', years: '2006' }),
    summary({ id: 4, slug: 'crisis', name: 'Crisis', publisher: 'DC Comics', years: '1985' }),
    summary({ id: 5, slug: 'reading', name: 'Reading now', years: '2020', read: 10 }),
  ] })
  show()
  await screen.findByRole('link', { name: 'Reading now' })
  const tabs = screen.getAllByRole('tab')
  expect(tabs.map((t) => t.textContent)).toEqual(['Marvel', 'DC Comics'])
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  const shelf = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  expect(shelf()).toEqual(['Reading now', 'Earlier', 'Later', 'Done'])

  fireEvent.click(tabs[1])
  expect(shelf()).toEqual(['Crisis'])
  expect(screen.getByRole('tab', { name: 'DC Comics' })).toHaveAttribute('aria-selected', 'true')
})

test('no lists says so rather than drawing nothing', async () => {
  vi.spyOn(api, 'getReadingLists').mockResolvedValue({ lists: [] })
  show()
  expect(await screen.findByText('No reading lists yet.')).toBeInTheDocument()
})
