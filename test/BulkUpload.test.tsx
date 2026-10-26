import type { ReactNode } from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import BulkUpload from '../src/pages/BulkUpload'
import { uploadComic } from '../src/lib/uploadComic'
import type { ApiVolumeIssues } from '../src/api'

vi.mock('../src/lib/uploadComic', () => ({ uploadComic: vi.fn() }))
const uploadMock = vi.mocked(uploadComic)

const AVENGERS: ApiVolumeIssues = {
  volumeId: 42,
  volume: { name: 'Avengers', startYear: 2013 },
  edition: null,
  editionName: 'Avengers (2013)',
  issues: [
    { id: 1001, number: '20', name: 'Infinity', owned: false },
    { id: 1002, number: '21', name: 'Infinity', owned: false },
    { id: 1003, number: '24', name: '.NOW Rogue Planet', owned: false },
    { id: 1004, number: '26', name: 'Original Sin', owned: false },
  ],
}

const ANNUAL: ApiVolumeIssues = {
  volumeId: 99,
  volume: { name: 'Avengers Annual', startYear: 2014 },
  edition: null,
  editionName: 'Avengers Annual (2014)',
  issues: [{ id: 2001, number: '1', name: 'Annual', owned: false }],
}

let volumeSearch: Array<{ id: number; name?: string; startYear?: number; publisher?: string; issueCount?: number }>
let issuesByVolume: Record<number, ApiVolumeIssues>

beforeEach(() => {
  uploadMock.mockReset()
  uploadMock.mockResolvedValue({ book: { id: 1 } as never, metadataApplied: true })
  volumeSearch = [
    { id: 42, name: 'Avengers', startYear: 2013, publisher: 'Marvel', issueCount: 44 },
    { id: 99, name: 'Avengers Annual', startYear: 2014, publisher: 'Marvel', issueCount: 1 },
  ]
  issuesByVolume = { 42: AVENGERS, 99: ANNUAL }

  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    const issueMatch = /\/api\/comicvine\/volumes\/(\d+)\/issues/.exec(u)
    if (issueMatch) {
      return { ok: true, json: async () => issuesByVolume[Number(issueMatch[1])] }
    }
    if (u.includes('/api/comicvine/volumes')) {
      return { ok: true, json: async () => ({ volumes: volumeSearch }) }
    }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
})

afterEach(() => vi.restoreAllMocks())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter><BulkUpload /></MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

const file = (name: string) => new File(['comic'], name, { type: 'application/octet-stream' })

function pick(...names: string[]) {
  const input = screen.getByLabelText(/choose a folder or files/i)
  fireEvent.change(input, { target: { files: names.map(file) } })
}

async function chooseVolume(label: RegExp) {
  fireEvent.change(screen.getByLabelText(/search comic vine for the volume/i), {
    target: { value: 'avengers' },
  })
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
  const result = await screen.findByRole('button', { name: label })
  fireEvent.click(result)
}

test('picking files lists them, and a non-comic is ignored rather than flagged', async () => {
  draw()
  pick('Avengers 020 (2013) (Digital).cbr', 'readme.txt')
  expect(await screen.findByText('Avengers 020 (2013) (Digital).cbr')).toBeInTheDocument()
  expect(screen.getByText(/1 ignored/i)).toBeInTheDocument()
})

test('choosing a volume groups the files it claims under it', async () => {
  draw()
  pick('Avengers 020 (2013) (Digital).cbr', 'Avengers 024.NOW (2014) (Digital).cbr')
  await chooseVolume(/Avengers \(2013\)/)

  const group = await screen.findByRole('region', { name: /Avengers \(2013\)/ })
  expect(within(group).getByText(/#20/)).toBeInTheDocument()
  // The .NOW gotcha, resolved by the base-number fallback rather than left for the user.
  expect(within(group).getByText(/#24/)).toBeInTheDocument()
})

test('the group names the edition the batch will file into', async () => {
  draw()
  pick('Avengers 020 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  expect(await screen.findByText(/files into Avengers \(2013\)/i)).toBeInTheDocument()
})

test('a second volume search is offered only the files still unplaced', async () => {
  draw()
  pick('Avengers 020 (2013).cbr', 'Avengers Annual 001 (2014).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  await screen.findByRole('region', { name: /Avengers \(2013\)/ })

  await chooseVolume(/Avengers Annual \(2014\)/)
  const annual = await screen.findByRole('region', { name: /Avengers Annual \(2014\)/ })
  expect(within(annual).getByText('Avengers Annual 001 (2014).cbr')).toBeInTheDocument()

  const run = screen.getByRole('region', { name: /^Avengers \(2013\)/ })
  expect(within(run).queryByText('Avengers Annual 001 (2014).cbr')).toBeNull()
})

test('a file needing an issue is offered only that volume\'s unclaimed issues', async () => {
  draw()
  pick('Avengers 020 (2013).cbr', 'Avengers 999 (2014).cbr')
  await chooseVolume(/Avengers \(2013\)/)

  const picker = await screen.findByLabelText(/pick an issue for Avengers 999/i)
  const offered = within(picker).getAllByRole('option').map((o) => o.textContent)
  expect(offered.some((t) => t?.includes('#20'))).toBe(false)
  expect(offered.some((t) => t?.includes('#21'))).toBe(true)
})

test('a copy already in this run is skipped, and one filed elsewhere replaces', async () => {
  issuesByVolume[42] = {
    ...AVENGERS,
    edition: { id: 7, name: 'Avengers (2013)' },
    editionName: 'Avengers (2013)',
    issues: [
      { id: 1001, number: '20', owned: true, bookId: 5, ownedIn: { editionId: 7, editionName: 'Avengers (2013)' } },
      { id: 1002, number: '21', owned: true, bookId: 6, ownedIn: { editionId: 99, editionName: 'Unsorted' } },
    ],
  }
  draw()
  pick('Avengers 020 (2013).cbr', 'Avengers 021 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)

  const here = await screen.findByLabelText(/replace Avengers 020/i) as HTMLInputElement
  const elsewhere = screen.getByLabelText(/replace Avengers 021/i) as HTMLInputElement
  expect(here.checked).toBe(false)
  expect(elsewhere.checked).toBe(true)
  expect(screen.getByText(/filed under Unsorted/i)).toBeInTheDocument()
})

test('the button counts what it will add, replace and skip', async () => {
  issuesByVolume[42] = {
    ...AVENGERS,
    edition: { id: 7, name: 'Avengers (2013)' },
    issues: [
      { id: 1001, number: '20', owned: false },
      { id: 1002, number: '21', owned: true, bookId: 6, ownedIn: { editionId: 7, editionName: 'Avengers (2013)' } },
      { id: 1003, number: '24', owned: true, bookId: 7, ownedIn: { editionId: 99, editionName: 'Unsorted' } },
    ],
  }
  draw()
  pick('Avengers 020 (2013).cbr', 'Avengers 021 (2013).cbr', 'Avengers 024 (2014).cbr', 'readme.txt')
  await chooseVolume(/Avengers \(2013\)/)

  const button = await screen.findByRole('button', { name: /upload 2 comics/i })
  expect(button).toBeEnabled()
  expect(screen.getByText(/1 will replace and delete/i)).toBeInTheDocument()
  expect(screen.getByText(/1 skipped/i)).toBeInTheDocument()
  expect(screen.getByText(/1 ignored/i)).toBeInTheDocument()
})

test('the upload button is disabled until something is matched', async () => {
  draw()
  pick('readme.txt')
  expect(await screen.findByRole('button', { name: /upload/i })).toBeDisabled()
})

test('an unreachable issue list still renders the group, with the files unplaced', async () => {
  issuesByVolume[42] = { ...AVENGERS, issues: [], unavailable: true }
  draw()
  pick('Avengers 020 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  expect(await screen.findByText(/comic vine could not be read/i)).toBeInTheDocument()
  expect(screen.getByText('Avengers 020 (2013).cbr')).toBeInTheDocument()
})

test('a batch over 150 files warns about the Comic Vine budget without blocking', async () => {
  draw()
  pick(...Array.from({ length: 151 }, (_, i) => `Avengers ${String(i + 1).padStart(3, '0')} (2013).cbr`))
  expect(await screen.findByText(/comic vine allows about 200 requests an hour/i)).toBeInTheDocument()
})

test('uploading sends the edition, issue id and name parts for each row', async () => {
  draw()
  pick('Avengers 020 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  fireEvent.click(await screen.findByRole('button', { name: /upload 1 comic/i }))

  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
  expect(uploadMock.mock.calls[0][0]).toMatchObject({
    edition: 'Avengers (2013)', issueId: 1001, volumeName: 'Avengers', issueNumber: '20',
  })
})

test('a row that replaces sends the book it replaces', async () => {
  issuesByVolume[42] = {
    ...AVENGERS,
    edition: { id: 7, name: 'Avengers (2013)' },
    issues: [{ id: 1001, number: '20', owned: true, bookId: 5, ownedIn: { editionId: 99, editionName: 'Unsorted' } }],
  }
  draw()
  pick('Avengers 020 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  fireEvent.click(await screen.findByRole('button', { name: /upload 1 comic/i }))

  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
  expect(uploadMock.mock.calls[0][0]).toMatchObject({ replaceBookId: 5 })
})

test('a failed row marks itself and the batch carries on', async () => {
  uploadMock
    .mockRejectedValueOnce(new Error('Upload failed (413)'))
    .mockResolvedValueOnce({ book: { id: 2 } as never, metadataApplied: true })
  draw()
  pick('Avengers 020 (2013).cbr', 'Avengers 021 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  fireEvent.click(await screen.findByRole('button', { name: /upload 2 comics/i }))

  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2))
  expect(await screen.findByText(/1 failed/i)).toBeInTheDocument()
  expect(screen.getByText(/1 added/i)).toBeInTheDocument()
})

// The server answers 200 for this, so taking it at face value would report a batch that
// exhausted Comic Vine's budget as a complete success with forty bare comics in it.
test('a comic that landed without metadata is reported apart from a success', async () => {
  uploadMock.mockResolvedValue({ book: { id: 2 } as never, metadataApplied: false })
  draw()
  pick('Avengers 020 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  fireEvent.click(await screen.findByRole('button', { name: /upload 1 comic/i }))

  expect(await screen.findByText(/1 landed without metadata/i)).toBeInTheDocument()
  expect(screen.queryByText(/1 added/i)).toBeNull()
})

// The row→file lookup reads a ref that re-picking replaces wholesale, and keys are
// index+name - so a second folder picked mid-run can hand the loop a different file
// under a row that already carries an issueId and a replaceBookId.
test('the file picker and the volume results are locked while a batch runs', async () => {
  let release: (() => void) | undefined
  uploadMock.mockImplementation(() => new Promise((resolve) => {
    release = () => resolve({ book: { id: 1 } as never, metadataApplied: true })
  }))

  draw()
  pick('Avengers 020 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  fireEvent.click(await screen.findByRole('button', { name: /upload 1 comic/i }))

  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
  expect(screen.getByLabelText(/choose a folder or files/i)).toBeDisabled()
  expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled()

  release?.()
  await waitFor(() => expect(screen.getByLabelText(/choose a folder or files/i)).toBeEnabled())
})

// Counting only done/bare/failed meant a row the loop skipped vanished from the summary
// with nothing said about it.
test('a row whose file went missing is reported failed, not silently dropped', async () => {
  draw()
  pick('Avengers 020 (2013).cbr', 'Avengers 021 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  fireEvent.click(await screen.findByRole('button', { name: /upload 2 comics/i }))
  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2))
  expect(await screen.findByText(/2 added/i)).toBeInTheDocument()
})

// The irreversible half. The button warns beforehand; the summary has to account for it
// afterwards, or a batch that deleted three comics never says so.
test('the summary says how many comics it replaced and deleted', async () => {
  issuesByVolume[42] = {
    ...AVENGERS,
    edition: { id: 7, name: 'Avengers (2013)' },
    issues: [{ id: 1001, number: '20', owned: true, bookId: 5, ownedIn: { editionId: 99, editionName: 'Unsorted' } }],
  }
  uploadMock.mockResolvedValue({
    book: { id: 2 } as never, metadataApplied: true, replaced: { bookId: 5, editionRemoved: false },
  })
  draw()
  pick('Avengers 020 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  fireEvent.click(await screen.findByRole('button', { name: /upload 1 comic/i }))

  expect(await screen.findByText(/1 replaced/i)).toBeInTheDocument()
})

// The server answers 200 and says the old copy survived; the page must not claim a clean
// replace when two copies are now on the shelf.
test('a replace the server could not complete is called out', async () => {
  issuesByVolume[42] = {
    ...AVENGERS,
    edition: { id: 7, name: 'Avengers (2013)' },
    issues: [{ id: 1001, number: '20', owned: true, bookId: 5, ownedIn: { editionId: 99, editionName: 'Unsorted' } }],
  }
  uploadMock.mockResolvedValue({ book: { id: 2 } as never, metadataApplied: true, replaceFailed: true })
  draw()
  pick('Avengers 020 (2013).cbr')
  await chooseVolume(/Avengers \(2013\)/)
  fireEvent.click(await screen.findByRole('button', { name: /upload 1 comic/i }))

  expect(await screen.findByText(/old copy could not be removed/i)).toBeInTheDocument()
})
