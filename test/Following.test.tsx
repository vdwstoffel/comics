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
  shelfKey: 'edition:1', shelfName: 'Iron Man', shelfVolumeId: null,
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
  localStorage.clear()
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
      want: { id: 2, number: '7', name: null, seriesName: 'Iron Man', coverDate: null }, queued: false,
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

// The mixed case of spec §3.1 - something to read AND something still missing - used to
// say both. The cover now answers alone: a line only some follows carried, under a tile
// that already draws a comic, set the height of every tile in its row when it wrapped.
test('a follow with a comic to read says nothing beside it', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [BOOK] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{
      kind: 'volume', refId: 1, name: 'Iron Man', state: 'wanted',
      want: { id: 2, number: '7', name: null, seriesName: 'Iron Man', coverDate: null }, queued: true,
    }],
  })
  show()
  expect(await screen.findByRole('link', { name: /Iron Man #6/ })).toBeInTheDocument()
  expect(screen.queryByText('Getting #7')).not.toBeInTheDocument()
})

// The shelf answers "what am I following", and a follow with anything on it reads the
// same whether that is one issue or nine - the deck behind the cover already shows which.
// The Library's unread shelf is the page that is about how much there is, and keeps its.
test('a run on the follows shelf does not count its unread issues', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [BOOK] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'supplied' }],
  })
  show()
  await screen.findByRole('link', { name: /Iron Man #6/ })
  expect(screen.queryByText(/\d+ unread/)).not.toBeInTheDocument()
})

test('an arc on the follows shelf does not count its unread issues either', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({
    books: [{ ...BOOK, arcs: ['Death Spiral'] }],
  })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'arc', refId: 56676, name: 'Death Spiral', state: 'supplied' }],
  })
  show()
  await screen.findByRole('link', { name: /Death Spiral/ })
  expect(screen.queryByText(/\d+ unread/)).not.toBeInTheDocument()
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

// A list crosses series the way an arc does, so it is drawn as one - but opens the list,
// with the next comic in the list's own order on the cover.
test('a reading-list follow draws its unread comics as one tile that opens the list', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [
    { ...BOOK, id: 21, comicvineId: 102, number: '2', title: 'Avengers' },
    { ...BOOK, id: 20, comicvineId: 101, number: '1', title: 'Avengers' },
    { ...BOOK, id: 30, comicvineId: 555, number: '9' },
  ] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{
      kind: 'list', refId: 1, name: "Hickman's Avengers", state: 'supplied',
      list: { slug: 'hickmans-avengers', issueIds: [101, 102, 103] },
    }],
  })
  show()
  const tile = await screen.findByRole('link', { name: /Hickman's Avengers/ })
  expect(tile).toHaveAttribute('href', '/lists/hickmans-avengers')
  expect(tile.querySelector('img')).toHaveAttribute('src', '/api/books/20/thumbnail')
  expect(screen.getByRole('button', { name: "Unfollow Hickman's Avengers (reading list)" })).toBeInTheDocument()
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

/** One solicited issue, in the shape the Upcoming tab serves. */
function solicited(headline: string, week: string, coverUrl: string | null = null) {
  return {
    publishers: [{
      name: 'Marvel',
      weeks: [{
        week,
        issues: [{
          sourceId: headline, headline, seriesName: 'Iron Man', number: '16',
          releaseDate: week, coverUrl, siteUrl: 'https://example.test', creators: null,
        }],
      }],
    }],
  }
}

const CAUGHT_UP = {
  kind: 'volume' as const, refId: 1, name: 'Iron Man', state: 'caught-up' as const,
  edition: { name: 'Iron Man (2020)', seriesName: 'Iron Man', cvName: 'Iron Man', cvStartYear: 2020 },
}

test('a caught-up follow says when the calendar has the next issue landing', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [CAUGHT_UP] })
  vi.spyOn(api, 'getUpcoming').mockResolvedValue(solicited('Iron Man (2020) #16', '2026-10-28'))
  show()
  expect(await screen.findByText('Next: 28 Oct 2026')).toBeInTheDocument()
})

test('a caught-up follow nobody has solicited says there is no more to tell', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [CAUGHT_UP] })
  vi.spyOn(api, 'getUpcoming').mockResolvedValue(solicited('Captain America (2025) #16', '2026-10-28'))
  show()
  expect(await screen.findByText('Waiting on the next issue — no further details')).toBeInTheDocument()
})

test('a relaunch solicited under the same title is not this run', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [CAUGHT_UP] })
  vi.spyOn(api, 'getUpcoming').mockResolvedValue(solicited('Iron Man (2027) #16', '2026-10-28'))
  show()
  expect(await screen.findByText('Waiting on the next issue — no further details')).toBeInTheDocument()
})

test('a run the calendar dates a year off is still this run when its number carries on', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ ...CAUGHT_UP, edition: { ...CAUGHT_UP.edition, lastHeldNumber: 15 } }],
  })
  vi.spyOn(api, 'getUpcoming').mockResolvedValue(solicited('Iron Man (2019) #16', '2026-10-28'))
  show()
  expect(await screen.findByText('Next: 28 Oct 2026')).toBeInTheDocument()
})

test('an arc follow has no calendar to consult and says so', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'arc', refId: 77, name: 'Dark Reign', state: 'caught-up' }],
  })
  vi.spyOn(api, 'getUpcoming').mockResolvedValue(solicited('Iron Man (2020) #16', '2026-10-28'))
  show()
  expect(await screen.findByText('Waiting on the next issue — no further details')).toBeInTheDocument()
})

/** The shelf in the order it is drawn, read off the one control every follow carries. */
function shelfNames(): string[] {
  return [...document.querySelectorAll('.follow-item__unfollow')].map((b) => (
    (b.getAttribute('aria-label') ?? '').replace(/^Unfollow /, '').replace(/ \((run|story arc)\)$/, '')
  ))
}

/** Every heading the shelf drew, in the order it drew them. */
function headings(): string[] {
  return [...document.querySelectorAll('.shelf-heading')].map((h) => h.textContent ?? '')
}

/** A shelf of four, one in each of the states the headings sort on. */
function mixedShelf() {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({
    books: [{
      ...BOOK, editionId: 4, editionName: 'Venom', seriesName: 'Venom', title: 'Venom',
      shelfKey: 'edition:4', shelfName: 'Venom',
    }],
  })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [
      { kind: 'volume', refId: 1, name: 'Avengers', state: 'caught-up' },
      { ...CAUGHT_UP, refId: 2 },
      {
        kind: 'volume', refId: 3, name: 'Thor', state: 'wanted',
        want: { id: 2, number: '7', name: null, seriesName: 'Iron Man', coverDate: null }, queued: false,
      },
      { kind: 'volume', refId: 4, name: 'Venom', state: 'supplied' },
    ],
  })
  vi.spyOn(api, 'getUpcoming').mockResolvedValue(solicited('Iron Man (2020) #16', '2026-10-28'))
}

// Alphabetically these are Avengers, Iron Man, Thor, Venom. By what you can do with them
// they are the comic on the shelf, the one that is out, the dated wait, and the rest.
test('the shelf is headed by what exists, what has a date, and what has neither', async () => {
  mixedShelf()
  show()
  // Waiting on the calendar: until it answers, the dated follow has no date to sort on.
  await screen.findByText('Next: 28 Oct 2026')
  expect(headings()).toEqual(['Available', 'Coming soon', 'No date yet'])
  expect(shelfNames()).toEqual(['Venom', 'Thor', 'Iron Man', 'Avengers'])
})

// Published, just not here - so it is drawn beside the comics you can open, and behind
// them: a run you can read right now outranks one you would have to go and find.
test('an issue that is out but not posted joins the available runs, after them', async () => {
  mixedShelf()
  show()
  await screen.findByText('Next: 28 Oct 2026')
  const available = document.querySelectorAll('section')[0]!
  expect(available.querySelector('.volume-tile__name')).toHaveTextContent('Venom')
  expect(available.querySelector('.follow-waiting__name')).toHaveTextContent('Thor')
  expect(document.querySelectorAll('section')[2]!.querySelectorAll('.follow-waiting__name'))
    .toHaveLength(1)
})

test('a follow whose issue is out offers to go and find it', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{
      kind: 'volume', refId: 7, name: 'Thor', state: 'wanted',
      want: { id: 1145551, number: '4', name: null, seriesName: 'Thor', coverDate: '2026-01-01' },
      queued: false,
    }],
  })
  show()
  expect(await screen.findByRole('button', { name: /find thor #4/i })).toBeInTheDocument()
  // Get is the offer made when exactly one scraped row can be this issue, and the sweep
  // has already failed to find one. Only Find is honest here.
  expect(screen.queryByRole('button', { name: /^get /i })).not.toBeInTheDocument()
})

// The seed is the whole point of carrying seriesName and coverDate on the want: the
// index posts Thor (2025) as "The Mortal Thor", so the search has to go out under Comic
// Vine's name, from a year floor backed off one for the cover date running ahead.
test('Find searches the index under the run\'s own name, from the cover year back one', async () => {
  const groups = vi.spyOn(api, 'groupComicIndex').mockResolvedValue({
    groups: [], totalGroups: 0, totalResults: 0,
  })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{
      kind: 'volume', refId: 7, name: 'Thor', state: 'wanted',
      want: { id: 1145551, number: '4', name: null, seriesName: 'Thor', coverDate: '2026-01-01' },
      queued: false,
    }],
  })
  show()
  fireEvent.click(await screen.findByRole('button', { name: /find thor #4/i }))
  await waitFor(() => expect(groups).toHaveBeenCalled())
  expect(groups.mock.calls[0][0]).toMatchObject({ q: 'Thor', yearFrom: 2025 })
})

test('a follow already fetching its issue says so instead of offering again', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{
      kind: 'volume', refId: 7, name: 'Thor', state: 'wanted',
      want: { id: 1145551, number: '4', name: null, seriesName: 'Thor', coverDate: null },
      queued: true,
    }],
  })
  show()
  expect(await screen.findByRole('button', { name: /queued/i })).toBeDisabled()
  expect(screen.queryByRole('button', { name: /find/i })).not.toBeInTheDocument()
})

// Nothing else on the shelf has anything to offer: every other blank waits on somebody
// else, and a button that cannot do anything is worse than no button.
test('a follow with no issue to name carries no control', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'dormant' }],
  })
  show()
  await screen.findByText(/finish an issue to pull the next/i)
  expect(document.querySelector('.follow-waiting__action')).toBeNull()
})

test('a heading with nothing under it is not drawn', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'dormant' }],
  })
  show()
  await screen.findByText(/finish an issue to pull the next/i)
  expect(headings()).toEqual(['No date yet'])
})

test('a dated follow draws the solicited cover, over the publisher\'s page', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [CAUGHT_UP] })
  vi.spyOn(api, 'getUpcoming').mockResolvedValue(
    solicited('Iron Man (2020) #16', '2026-10-28', 'https://cdn.test/iron-man-16.jpg'),
  )
  show()
  const link = await screen.findByRole('link', { name: /Iron Man/ })
  expect(link).toHaveAttribute('href', 'https://example.test')
  expect(link.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/iron-man-16.jpg')
  expect(screen.getByText('28 Oct 2026')).toBeInTheDocument()
  // The dated cover IS the date; the sentence the blank carried would say it twice.
  expect(screen.queryByText('Next: 28 Oct 2026')).not.toBeInTheDocument()
})

// Marvel carries art for most solicitations and not all, and a row without it is still
// solicited for that Wednesday.
test('a dated follow the calendar gave no art for keeps the dated blank', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [CAUGHT_UP] })
  vi.spyOn(api, 'getUpcoming').mockResolvedValue(solicited('Iron Man (2020) #16', '2026-10-28'))
  show()
  expect(await screen.findByText('Next: 28 Oct 2026')).toBeInTheDocument()
  expect(headings()).toEqual(['Coming soon'])
  expect(document.querySelector('.follow-upcoming')).toBeNull()
})

// followStatus prints `Next:` for a caught-up follow alone, so a dormant one shows no
// date - and a cover with a date on it is that date, stated in art instead of words.
test('a dormant follow is not given a cover by a solicitation its tile never shows', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ ...CAUGHT_UP, state: 'dormant' as const }],
  })
  vi.spyOn(api, 'getUpcoming').mockResolvedValue(
    solicited('Iron Man (2020) #16', '2026-10-28', 'https://cdn.test/iron-man-16.jpg'),
  )
  show()
  await screen.findByText(/finish an issue to pull the next/i)
  expect(headings()).toEqual(['No date yet'])
  expect(document.querySelector('.follow-upcoming')).toBeNull()
})

// --- Sorting Available. Two runs and an issue that is out, each with a different cover
// month, named so that alphabetical and oldest-first disagree.

function datedShelf() {
  const run = (refId: number, name: string, date: string) => ({
    ...BOOK, id: refId * 10, editionId: refId, editionName: name, seriesName: name, title: name,
    shelfKey: `edition:${refId}`, shelfName: name, date,
  })
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({
    books: [run(1, 'Avengers', '2026-10'), run(2, 'Batman', '2027-01'), run(2, 'Batman', '2026-09')],
  })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [
      { kind: 'volume', refId: 1, name: 'Avengers', state: 'supplied' },
      { kind: 'volume', refId: 2, name: 'Batman', state: 'supplied' },
      {
        kind: 'volume', refId: 3, name: 'Thor', state: 'wanted',
        want: { id: 2, number: '10', name: null, seriesName: 'Thor', coverDate: '2026-11-01' }, queued: false,
      },
    ],
  })
}

const sortControl = () => screen.findByRole('combobox', { name: 'Sort' })

test('Available starts in name order, as it always was', async () => {
  datedShelf()
  show()
  expect(await sortControl()).toHaveValue('name')
  await screen.findAllByRole('link', { name: /Batman/ })
  expect(shelfNames()).toEqual(['Avengers', 'Batman', 'Thor'])
})

test('sorting by cover date puts the oldest comic first', async () => {
  datedShelf()
  show()
  fireEvent.change(await sortControl(), { target: { value: 'date' } })
  await screen.findAllByRole('link', { name: /Batman/ })
  // Batman's oldest unread is 2026-09 - the comic on its cover - though it also holds a
  // 2027-01. Avengers is 2026-10, Thor's issue is out at 2026-11.
  expect(shelfNames()).toEqual(['Batman', 'Avengers', 'Thor'])
})

test('the sort chosen is the sort the page opens on next time', async () => {
  datedShelf()
  const first = show()
  fireEvent.change(await sortControl(), { target: { value: 'date' } })
  first.unmount()

  show()
  expect(await sortControl()).toHaveValue('date')
  await screen.findAllByRole('link', { name: /Batman/ })
  expect(shelfNames()).toEqual(['Batman', 'Avengers', 'Thor'])
})

// A private window, or storage the browser has blocked, throws on access. Losing the
// remembered choice there is fine; losing the page is not.
test('a browser that will not store the choice still sorts', async () => {
  datedShelf()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  show()
  fireEvent.change(await sortControl(), { target: { value: 'date' } })
  await screen.findAllByRole('link', { name: /Batman/ })
  expect(shelfNames()).toEqual(['Batman', 'Avengers', 'Thor'])
})
