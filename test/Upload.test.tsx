import type { ReactNode } from 'react'
import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Upload from '../src/pages/Upload'

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      editions: [
        { id: 1, name: 'Batman (2016)', bookCount: 12 },
        { id: 2, name: 'Saga', bookCount: 60 },
      ],
    }),
  })) as unknown as typeof fetch
})

function renderUpload(ui: ReactNode = <Upload />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

test('Upload page renders an edition field and file input', () => {
  renderUpload()
  expect(screen.getByPlaceholderText('Edition name')).toBeInTheDocument()
  expect(screen.getByLabelText(/comic file/i)).toBeInTheDocument()
})

test('editions already in the library are offered in the dropdown', async () => {
  renderUpload()

  fireEvent.focus(screen.getByPlaceholderText('Edition name'))

  const options = await screen.findAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(['Batman (2016)12', 'Saga60'])
})

// ---- fetching metadata for what you just uploaded ----

interface FakeXhr {
  status: number
  responseText: string
  onload: (() => void) | null
  onerror: (() => void) | null
  upload: { onprogress: ((e: unknown) => void) | null }
  open: (m: string, u: string) => void
  send: (b: unknown) => void
  sentBody: unknown
}
let xhrs: FakeXhr[] = []

function stubXhr() {
  xhrs = []
  class Fake {
    status = 0
    responseText = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    upload = { onprogress: null }
    sentBody: unknown = null
    open() {}
    send(body: unknown) { this.sentBody = body; xhrs.push(this as unknown as FakeXhr) }
  }
  globalThis.XMLHttpRequest = Fake as unknown as typeof XMLHttpRequest
}

/** Answer the app's REST calls; record every URL so tests can assert on them. */
function stubApi(urls: string[], posts: { url: string; body: unknown }[]) {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(String(url))
    if (init?.method === 'POST') {
      posts.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ book: { id: 46 } }) }
    }
    if (String(url).includes('/volume')) {
      return { ok: true, json: async () => ({ volume: { id: 167333, name: 'Venom', startYear: 2025, publisher: 'Marvel', editionName: 'Venom (2025)' } }) }
    }
    if (String(url).includes('/api/comicvine/search')) {
      return { ok: true, json: async () => ({ results: [{ id: 1159231, name: 'Venom', issueNumber: '256', year: '2026', publisher: 'Marvel' }] }) }
    }
    return { ok: true, json: async () => ({ editions: [{ id: 15, name: 'Venom (2025)', seriesName: 'Venom', bookCount: 1 }] }) }
  }) as unknown as typeof fetch
}

async function uploadOne(fileName = 'Venom 256 (2026) (Digital).cbz', edition = 'Venom (2025)') {
  fireEvent.change(screen.getByPlaceholderText('Edition name'), { target: { value: edition } })
  fireEvent.change(screen.getByLabelText(/comic file/i), {
    target: { files: [new File(['x'], fileName, { type: 'application/zip' })] },
  })
  fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
  await waitFor(() => expect(xhrs).toHaveLength(1))
}

function finishUpload(status = 200, body = JSON.stringify({ book: { id: 46, filePath: 'Venom/Venom (2025)/Venom 256 (2026) (Digital).cbz', number: null, title: null } })) {
  const xhr = xhrs[0]
  xhr.status = status
  xhr.responseText = body
  xhr.onload?.()
}

test('nothing offers to fetch metadata before anything is uploaded', () => {
  stubXhr(); stubApi([], [])
  renderUpload()
  expect(screen.queryByRole('button', { name: /fetch metadata/i })).not.toBeInTheDocument()
})

test('a finished upload offers to fetch its metadata', async () => {
  stubXhr(); stubApi([], [])
  renderUpload()
  await uploadOne()
  finishUpload()

  expect(await screen.findByRole('button', { name: /fetch metadata/i })).toBeInTheDocument()
})

// Rewritten when matching moved before the upload: "Fetch metadata" is now offered as
// soon as a file is chosen, so its presence after a failure says nothing. What must still
// hold is that a failed upload is not dressed up as a success.
test('an upload that failed says so and offers no comic to view', async () => {
  stubXhr(); stubApi([], [])
  renderUpload()
  await uploadOne()
  finishUpload(500, '')

  expect(await screen.findByText(/error/i)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /view comic/i })).not.toBeInTheDocument()
})

// The filename and the edition are all a fresh upload has — buildCvQuery reads the
// series and issue number off them, and the dialog searches on open.
test('the search is prefilled from the filename and the edition', async () => {
  const urls: string[] = []
  stubXhr(); stubApi(urls, [])
  renderUpload()
  await uploadOne()
  finishUpload()
  fireEvent.click(await screen.findByRole('button', { name: /fetch metadata/i }))

  await waitFor(() => expect(urls.some((u) => u.includes('/api/comicvine/search'))).toBe(true))
  const search = urls.find((u) => u.includes('/api/comicvine/search'))!
  expect(decodeURIComponent(search)).toContain('Venom #256')
})

test('picking a match applies it to the comic that was just uploaded', async () => {
  const urls: string[] = []
  const posts: { url: string; body: unknown }[] = []
  stubXhr(); stubApi(urls, posts)
  renderUpload()
  await uploadOne()
  finishUpload()
  fireEvent.click(await screen.findByRole('button', { name: /fetch metadata/i }))

  fireEvent.click(await screen.findByRole('button', { name: /Venom/ }))

  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].url).toContain('/api/books/46/comicvine')
  expect(posts[0].body).toEqual({ issueId: 1159231 })
})

// ---- matching before the upload ----

/** Pick a file without uploading it. */
function chooseFile(fileName = 'Venom 256 (2026) (Digital).cbz') {
  fireEvent.change(screen.getByLabelText(/comic file/i), {
    target: { files: [new File(['x'], fileName, { type: 'application/zip' })] },
  })
}

test('metadata can be fetched as soon as a file is chosen, before uploading', async () => {
  stubXhr(); stubApi([], [])
  renderUpload()
  chooseFile()

  expect(await screen.findByRole('button', { name: /fetch metadata/i })).toBeEnabled()
  expect(xhrs).toHaveLength(0)
})

test('the search is built from the chosen file name', async () => {
  const urls: string[] = []
  stubXhr(); stubApi(urls, [])
  renderUpload()
  chooseFile()

  fireEvent.click(await screen.findByRole('button', { name: /fetch metadata/i }))

  await waitFor(() => expect(urls.some((u) => u.includes('/api/comicvine/search'))).toBe(true))
  expect(decodeURIComponent(urls.find((u) => u.includes('search'))!)).toContain('Venom #256')
})

test('picking a match fills in the edition it belongs to', async () => {
  stubXhr(); stubApi([], [])
  renderUpload()
  chooseFile()
  fireEvent.click(await screen.findByRole('button', { name: /fetch metadata/i }))

  fireEvent.click(await screen.findByRole('button', { name: /Venom/ }))

  await waitFor(() =>
    expect(screen.getByPlaceholderText('Edition name')).toHaveValue('Venom (2025)'))
})

test('an edition you type yourself survives the match', async () => {
  stubXhr(); stubApi([], [])
  renderUpload()
  chooseFile()
  fireEvent.click(await screen.findByRole('button', { name: /fetch metadata/i }))
  fireEvent.click(await screen.findByRole('button', { name: /Venom/ }))
  await waitFor(() => expect(screen.getByPlaceholderText('Edition name')).toHaveValue('Venom (2025)'))

  fireEvent.change(screen.getByPlaceholderText('Edition name'), { target: { value: 'My Own Edition' } })

  expect(screen.getByPlaceholderText('Edition name')).toHaveValue('My Own Edition')
})

test('the chosen issue is uploaded along with the file', async () => {
  stubXhr(); stubApi([], [])
  renderUpload()
  chooseFile()
  fireEvent.click(await screen.findByRole('button', { name: /fetch metadata/i }))
  fireEvent.click(await screen.findByRole('button', { name: /Venom/ }))
  await waitFor(() => expect(screen.getByPlaceholderText('Edition name')).toHaveValue('Venom (2025)'))

  fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

  await waitFor(() => expect(xhrs).toHaveLength(1))
  const sent = xhrs[0].sentBody as FormData
  expect(sent.get('issueId')).toBe('1159231')
  expect(sent.get('edition')).toBe('Venom (2025)')
})

test('a comic with no match still uploads', async () => {
  stubXhr(); stubApi([], [])
  renderUpload()
  chooseFile()
  fireEvent.change(screen.getByPlaceholderText('Edition name'), { target: { value: 'Unsorted' } })

  fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

  await waitFor(() => expect(xhrs).toHaveLength(1))
  expect((xhrs[0].sentBody as FormData).get('issueId')).toBeNull()
})

// ---- downloading from a url ----

const RESOLVED = { fileName: 'Amazing Spider-Man 031 (2026) (Digital).cbz', size: 56524265 }

/** Answers the download endpoints; `statuses` is served in order as the page polls. */
function stubDownload(statuses: unknown[], urls: string[] = [], posts: { url: string; body: Record<string, unknown> }[] = []) {
  let i = 0
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    urls.push(u)
    if (init?.method === 'POST') posts.push({ url: u, body: JSON.parse(String(init.body)) })
    if (u.includes('/api/downloads/resolve')) return { ok: true, json: async () => RESOLVED }
    if (u.includes('/api/downloads') && init?.method === 'POST') {
      return { ok: true, json: async () => ({ started: true, status: {} }) }
    }
    if (u.includes('/api/downloads')) {
      const body = statuses[Math.min(i++, statuses.length - 1)]
      return { ok: true, json: async () => body }
    }
    if (u.includes('/api/comicvine/search')) {
      return { ok: true, json: async () => ({ results: [{ id: 1159231, name: 'Amazing Spider-Man', issueNumber: '31', year: '2026', publisher: 'Marvel' }] }) }
    }
    if (u.includes('/volume')) {
      return { ok: true, json: async () => ({ volume: { id: 163325, name: 'The Amazing Spider-Man', startYear: 2025, editionName: 'The Amazing Spider-Man (2025)' } }) }
    }
    return { ok: true, json: async () => ({ editions: [] }) }
  }) as unknown as typeof fetch
}

const IDLE = { running: false, url: null, fileName: null, received: 0, total: 0, error: null, bookId: null }

function pasteUrl(url = 'https://getcomics.example/dls/VihnoomBUb2Wfcz') {
  fireEvent.change(screen.getByPlaceholderText(/paste a link/i), { target: { value: url } })
}

test('a pasted link offers to fetch its metadata', async () => {
  stubDownload([IDLE])
  renderUpload()
  pasteUrl()

  expect(await screen.findByRole('button', { name: /fetch metadata/i })).toBeEnabled()
})

// The pasted link says nothing about the comic; the name comes from resolving it.
test('the search is built from the name the link resolves to', async () => {
  const urls: string[] = []
  stubDownload([IDLE], urls)
  renderUpload()
  pasteUrl()

  fireEvent.click(await screen.findByRole('button', { name: /fetch metadata/i }))

  await waitFor(() => expect(urls.some((u) => u.includes('/api/downloads/resolve'))).toBe(true))
  await waitFor(() => expect(urls.some((u) => u.includes('/api/comicvine/search'))).toBe(true))
  expect(decodeURIComponent(urls.find((u) => u.includes('search'))!)).toContain('Amazing Spider-Man #31')
})

test('the chosen issue and edition travel with the download', async () => {
  const posts: { url: string; body: Record<string, unknown> }[] = []
  stubDownload([IDLE], [], posts)
  renderUpload()
  pasteUrl()
  fireEvent.click(await screen.findByRole('button', { name: /fetch metadata/i }))
  fireEvent.click(await screen.findByRole('button', { name: /Amazing Spider-Man/ }))
  await waitFor(() => expect(screen.getByPlaceholderText('Edition name')).toHaveValue('The Amazing Spider-Man (2025)'))

  fireEvent.click(screen.getByRole('button', { name: /^download$/i }))

  await waitFor(() => expect(posts.some((p) => p.url.endsWith('/api/downloads'))).toBe(true))
  const start = posts.find((p) => p.url.endsWith('/api/downloads'))!
  expect(start.body).toMatchObject({
    url: 'https://getcomics.example/dls/VihnoomBUb2Wfcz',
    edition: 'The Amazing Spider-Man (2025)',
    issueId: 1159231,
  })
})

// Progress, the finished result and any failure are the download bar's job now — it
// reports them on every page, not just this one. See DownloadBar.test.tsx. What is left
// here is what the form itself still owns.

test('the page does not report progress itself; the bar does', async () => {
  stubDownload([
    { ...IDLE, running: true, received: 21400000, total: 52100000, fileName: 'x.cbz' },
  ])
  renderUpload()
  pasteUrl()
  fireEvent.click(screen.getByRole('button', { name: /^download$/i }))

  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByText(/41%/)).not.toBeInTheDocument()
})

test('asking for a download while one is already running says so', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/downloads') && init?.method === 'POST') {
      return { ok: false, status: 409, json: async () => ({ started: false }) }
    }
    if (u.includes('/api/downloads')) return { ok: true, json: async () => IDLE }
    return { ok: true, json: async () => ({ editions: [] }) }
  }) as unknown as typeof fetch

  renderUpload()
  pasteUrl()
  fireEvent.click(screen.getByRole('button', { name: /^download$/i }))

  expect(await screen.findByText(/already running/i)).toBeInTheDocument()
})

// ---- arriving from a search result with the link already found ----

function renderUploadAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><Upload /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const DLS = 'https://getcomics.org/dls/tC3kM3XUCQr:X1Em+N7z=='

test('a url in the query string arrives already filled into the link field', () => {
  renderUploadAt(`/upload?url=${encodeURIComponent(DLS)}`)
  expect(screen.getByPlaceholderText(/Paste a link/i)).toHaveValue(DLS)
})

test('a seeded link enables the download button without picking a file', () => {
  renderUploadAt(`/upload?url=${encodeURIComponent(DLS)}`)
  expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
})

test('no url in the query string leaves the link field empty', () => {
  renderUploadAt('/upload')
  expect(screen.getByPlaceholderText(/Paste a link/i)).toHaveValue('')
})
