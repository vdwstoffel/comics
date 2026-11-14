import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Character from '../src/pages/Character'
import type { ApiLibraryBook } from '../src/api'

afterEach(() => cleanup())

const IRON_MAN = {
  id: 1455,
  name: 'Iron Man',
  realName: 'Anthony Edward Stark',
  aliases: ['Shellhead', 'Golden Avenger'],
  deck: 'Genius inventor who built a suit of armor to save his life.',
  publisher: 'Marvel',
  firstAppearance: 'Tales of Suspense #39',
  appearanceCount: 9876,
  imageUrl: 'ironman.jpg',
  siteUrl: 'https://comicvine.gamespot.com/iron-man/4005-1455/',
  profile: [
    { kind: 'heading', level: 2, text: 'Origin' },
    { kind: 'para', text: 'Tony Stark was captured in a war zone.' },
  ],
}

function book(id: number, editionId: number, editionName: string, seriesName: string, number: string): ApiLibraryBook {
  return {
    id, editionId, editionName, seriesName, number, title: null, pageCount: 20, comicinfoSynced: true,
    shelfKey: `edition:${editionId}`, shelfName: editionName, shelfVolumeId: null, arcs: [], readState: 'unread',
  }
}

const BOOKS = [
  book(1, 10, 'Avengers (2018)', 'Avengers', '1'),
  book(2, 10, 'Avengers (2018)', 'Avengers', '2'),
  book(3, 20, 'Iron Man (2020)', 'Iron Man', '1'),
]

function serve(page: unknown, books: ApiLibraryBook[] = BOOKS) {
  globalThis.fetch = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).startsWith('/api/characters/') ? page : { books }),
  })) as unknown as typeof fetch
}

function draw(state?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/characters/1455', state }]}>
        <Routes><Route path="/characters/:id" element={<Character />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('the page says who they are: names, description, facts and the full profile', async () => {
  serve({ character: IRON_MAN, name: 'Iron Man' })
  draw()
  expect(await screen.findByRole('heading', { level: 1, name: 'Iron Man' })).toBeInTheDocument()
  expect(screen.getByText('Anthony Edward Stark')).toBeInTheDocument()
  expect(screen.getByText(/Genius inventor/)).toBeInTheDocument()
  expect(screen.getByText('Tales of Suspense #39')).toBeInTheDocument()
  expect(screen.getByText('Shellhead, Golden Avenger')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: 'Origin' })).toBeInTheDocument()
  expect(screen.getByText(/captured in a war zone/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Comic Vine/ })).toHaveAttribute('href', IRON_MAN.siteUrl)
})

// Reading comes first; the comics are what you do after.
test('your comics with them come last, after the profile', async () => {
  serve({ character: IRON_MAN, name: 'Iron Man' })
  draw()
  const comics = await screen.findByRole('region', { name: 'In your library' })
  const origin = screen.getByRole('heading', { name: 'Origin' })
  expect(origin.compareDocumentPosition(comics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(await screen.findByText(/3 comics in 2 series/)).toBeInTheDocument()
})

// A long profile would otherwise hide that you own a hundred of them.
test('how many of your comics they are in is said near the top', async () => {
  serve({ character: IRON_MAN, name: 'Iron Man' })
  draw()
  expect(await screen.findByRole('button', { name: 'In 3 of your comics ↓' })).toBeInTheDocument()
})

// Comic Vine being down must not blank the page: the comics are the library's to list.
test('with nothing from Comic Vine, the page is headed by your comics\' name for them and still lists them', async () => {
  serve({ character: null, name: 'Iron Man', unavailable: 'Comic Vine could not be read' })
  draw()
  expect(await screen.findByRole('heading', { level: 1, name: 'Iron Man' })).toBeInTheDocument()
  expect(screen.getByText(/Comic Vine could not be read/)).toBeInTheDocument()
  expect(await screen.findByText(/3 comics in 2 series/)).toBeInTheDocument()
})

test('a character found by name rather than from the comic\'s credits says it is a guess', async () => {
  serve({ character: IRON_MAN, name: 'Iron Man' })
  draw({ guess: true })
  expect(await screen.findByText(/best guess/)).toBeInTheDocument()
})

test('a character in none of your comics says so', async () => {
  serve({ character: IRON_MAN, name: null }, [])
  draw()
  expect(await screen.findByText(/None of your comics credit them yet/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /of your comics/ })).toBeNull()
})


// A long profile gets a way around it; a one-section profile has nowhere to jump.
test('a profile of several sections has contents, and one of a single section does not', async () => {
  serve({ character: { ...IRON_MAN, profile: [...IRON_MAN.profile, { kind: 'heading', level: 2, text: 'Powers' }] }, name: 'Iron Man' })
  draw()
  const contents = await screen.findByRole('navigation', { name: 'Contents' })
  expect(contents).toHaveTextContent('Origin')
  expect(contents).toHaveTextContent('Powers')
  expect(contents).toHaveTextContent('Your comics (3)')
  expect(screen.getByRole('heading', { name: 'Powers' })).toHaveAttribute('id')
  cleanup()

  serve({ character: IRON_MAN, name: 'Iron Man' })
  draw()
  await screen.findByRole('heading', { name: 'Origin' })
  expect(screen.queryByRole('navigation', { name: 'Contents' })).toBeNull()
})
