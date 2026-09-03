import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CharacterDialog from '../src/components/CharacterDialog'

const HOBGOBLIN = {
  id: 7605,
  name: 'Hobgoblin (Kingsley)',
  realName: 'Roderick Kingsley',
  aliases: ['Devil-Spider', 'Hobgobbler'],
  deck: 'Roderick Kingsley became a worthy heir of the Goblin legacy.',
  publisher: 'Marvel',
  firstAppearance: 'Pretty Poison #43',
  appearanceCount: 576,
  imageUrl: 'https://cv/hobgoblin.jpg',
  siteUrl: 'https://comicvine.gamespot.com/hobgoblin/4005-7605/',
  profile: [
    { kind: 'heading', level: 2, text: 'Origin' },
    { kind: 'para', text: 'Kingsley was a famous fashion designer.' },
    { kind: 'heading', level: 3, text: 'Blackmail' },
    { kind: 'para', text: 'He blackmailed the Century Club.' },
    { kind: 'list', items: ['Super Strength', 'Agility'] },
  ],
}

function stubLookup(body: unknown, ok = true) {
  globalThis.fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body })) as unknown as typeof fetch
}

function lookupUrls() {
  return (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url))
}

beforeEach(() => stubLookup({ character: HOBGOBLIN, verified: true }))

function renderDialog(name = 'Hobgoblin (Kingsley)') {
  const onClose = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <CharacterDialog bookId={5} name={name} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

test('asks the book-scoped lookup for the clicked character', async () => {
  renderDialog()
  await waitFor(() => expect(lookupUrls()).toHaveLength(1))
  expect(lookupUrls()[0]).toBe(`/api/books/5/character?name=${encodeURIComponent('Hobgoblin (Kingsley)')}`)
})

test('shows who the character is', async () => {
  renderDialog()
  expect(await screen.findByText('Hobgoblin (Kingsley)')).toBeInTheDocument()
  expect(screen.getByText('Roderick Kingsley')).toBeInTheDocument()
  expect(screen.getByText(/Marvel/)).toBeInTheDocument()
})

test('shows the blurb', async () => {
  renderDialog()
  expect(await screen.findByText('Roderick Kingsley became a worthy heir of the Goblin legacy.')).toBeInTheDocument()
})

test('shows first appearance and how many issues the character is in', async () => {
  renderDialog()
  expect(await screen.findByText('Pretty Poison #43')).toBeInTheDocument()
  expect(screen.getByText('576')).toBeInTheDocument()
})

test('shows the other names the character goes by', async () => {
  renderDialog()
  expect(await screen.findByText('Devil-Spider, Hobgobbler')).toBeInTheDocument()
})

// The card is a summary; the 30KB profile stays on Comic Vine, which their terms require
// us to link back to anyway.
test('links out to the full profile on Comic Vine', async () => {
  renderDialog()
  const link = await screen.findByRole('link', { name: /Comic Vine/i })
  expect(link).toHaveAttribute('href', 'https://comicvine.gamespot.com/hobgoblin/4005-7605/')
})

test('shows the portrait', async () => {
  renderDialog()
  expect(await screen.findByRole('img')).toHaveAttribute('src', 'https://cv/hobgoblin.jpg')
})

// Resolved from the issue's own credits: this is the right Hobgoblin, so say nothing.
test('a verified character carries no caveat', async () => {
  renderDialog()
  await screen.findByText('Hobgoblin (Kingsley)')
  expect(screen.queryByText(/best guess/i)).not.toBeInTheDocument()
})

// Resolved by name search, which returns Deadpool for "Hobgoblin". Say so.
test('an unverified character is flagged as a guess', async () => {
  stubLookup({ character: HOBGOBLIN, verified: false })
  renderDialog()
  expect(await screen.findByText(/best guess/i)).toBeInTheDocument()
})

test('a character Comic Vine has nothing for says so', async () => {
  stubLookup({ error: 'character not found' }, false)
  renderDialog()
  expect(await screen.findByText(/couldn't find/i)).toBeInTheDocument()
})

test('a character with no blurb still renders', async () => {
  stubLookup({ character: { id: 1, name: 'Some Guy', aliases: [] }, verified: true })
  renderDialog('Some Guy')
  expect(await screen.findByText('Some Guy')).toBeInTheDocument()
})

// --- the full profile ------------------------------------------------------

// The blurb is the point of the card; the article is 70 blocks of it. It waits.
test('the profile is collapsed to begin with', async () => {
  renderDialog()
  await screen.findByText('Hobgoblin (Kingsley)')
  expect(screen.queryByText('Kingsley was a famous fashion designer.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /read the full profile/i })).toHaveAttribute('aria-expanded', 'false')
})

test('expanding shows the prose', async () => {
  renderDialog()
  fireEvent.click(await screen.findByRole('button', { name: /read the full profile/i }))
  expect(screen.getByText('Kingsley was a famous fashion designer.')).toBeInTheDocument()
  expect(screen.getByText('He blackmailed the Century Club.')).toBeInTheDocument()
})

test('expanding shows the section headings that make it navigable', async () => {
  renderDialog()
  fireEvent.click(await screen.findByRole('button', { name: /read the full profile/i }))
  expect(screen.getByRole('heading', { name: 'Origin' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Blackmail' })).toBeInTheDocument()
})

test('a list in the profile renders as a list', async () => {
  renderDialog()
  fireEvent.click(await screen.findByRole('button', { name: /read the full profile/i }))
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Super Strength', 'Agility'])
})

test('it collapses again', async () => {
  renderDialog()
  const toggle = await screen.findByRole('button', { name: /read the full profile/i })
  fireEvent.click(toggle)
  fireEvent.click(screen.getByRole('button', { name: /hide the full profile/i }))
  expect(screen.queryByText('Kingsley was a famous fashion designer.')).not.toBeInTheDocument()
})

// Plenty of obscure characters have a blurb and nothing else. Don't offer an empty drawer.
test('a character with no profile offers no toggle', async () => {
  stubLookup({ character: { id: 1, name: 'Symbie', aliases: [], profile: [] }, verified: true })
  renderDialog('Symbie')
  await screen.findByText('Symbie')
  expect(screen.queryByRole('button', { name: /full profile/i })).not.toBeInTheDocument()
})

// Their terms want the backlink regardless of how much we show inline.
test('the Comic Vine link survives alongside the inline profile', async () => {
  renderDialog()
  expect(await screen.findByRole('link', { name: /Comic Vine/i })).toBeInTheDocument()
})
